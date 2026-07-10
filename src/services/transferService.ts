// Export/import of vault content as a single portable bundle.
//
// Bundle = zip (fflate, stored — never compressed) containing:
//   manifest.json        tree + metadata (groups, docs, expiry/notes, parts)
//   files/<n>/<name>     raw part bytes, one dir per document
// Optionally sealed with a password (see crypto.ts) → ".dvault" instead of ".zip".
//
// Import is copy semantics: fresh Drive folders/files are created under the
// chosen destination; nothing syncs back to the source.

import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import { decryptBundle, encryptBundle, isEncrypted } from './crypto';
import type { DocumentsService, NewPart, VaultDocument } from './documentsService';

export const BUNDLE_FORMAT = 'document-vault';
export const BUNDLE_VERSION = 1;

export type ExportSource =
  | { kind: 'vault' }
  | { kind: 'group'; id: string; name: string }
  | { kind: 'doc'; id: string };

export type ProgressFn = (done: number, total: number) => void;

export interface ImportResult {
  imported: number;
  total: number;
  /** Set when the import stopped early: name of the failing item. */
  failedAt?: string;
  error?: string;
}

export interface TransferService {
  /** Bundle a vault/group/document into a single shareable file. */
  buildExport(
    source: ExportSource,
    opts?: { password?: string; onProgress?: ProgressFn },
  ): Promise<{ blob: Blob; filename: string }>;
  /**
   * Recreate a bundle's tree inside `destParentId` (undefined = vault root).
   * Resolves with a partial result instead of rejecting when Drive fails
   * midway — already-imported items stay in place (no transactions in Drive).
   */
  applyImport(
    bytes: Uint8Array,
    opts: { password?: string; destParentId?: string; onProgress?: ProgressFn },
  ): Promise<ImportResult>;
}

// ---------------------------------------------------------------- manifest --

interface ManifestPart {
  label: string;
  filename: string;
  mimeType: string;
  /** Zip entry path holding the bytes. */
  path: string;
}

interface ManifestDoc {
  type: 'doc';
  title: string;
  createdAt?: string;
  expiresAt?: string;
  remindDays?: number;
  notes?: string;
  parts: ManifestPart[];
}

interface ManifestGroup {
  type: 'group';
  name: string;
  children: ManifestNode[];
}

interface ManifestVault {
  type: 'vault';
  children: ManifestNode[];
}

type ManifestNode = ManifestDoc | ManifestGroup;

interface Manifest {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  root: ManifestVault | ManifestNode;
}

// ------------------------------------------------------------------ helpers --

const zipAsync = (data: Zippable): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    zip(data, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))),
  );

const unzipAsync = (data: Uint8Array): Promise<Unzipped> =>
  new Promise((resolve, reject) =>
    unzip(data, (err, out) => (err ? reject(err) : resolve(out))),
  );

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'export';

/** `image.jpg` → `image-2.jpg` when the name is already taken in this doc dir. */
function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** Run tasks with limited concurrency; stops scheduling once one rejects. */
async function runPool<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length && failure === null) {
      const task = tasks[next++];
      try {
        await task();
      } catch (e) {
        failure = failure ?? e;
      }
    }
  });
  await Promise.all(workers);
  if (failure !== null) throw failure;
}

const RETRYABLE = /\b(403|429)\b|rate ?limit/i;

/** Retry Drive writes on rate-limit errors — authed() only handles 401s. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !RETRYABLE.test((e as Error).message ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}

// ------------------------------------------------------------------ service --

export function createTransferService(documents: DocumentsService): TransferService {
  /** A doc scheduled for export: manifest node + part file ids to download. */
  interface PendingDoc {
    node: ManifestDoc;
    partFileIds: string[];
  }

  function docNode(doc: VaultDocument, dir: string, pending: PendingDoc[]): ManifestDoc {
    const used = new Set<string>();
    const node: ManifestDoc = {
      type: 'doc',
      title: doc.title,
      createdAt: doc.createdAt || undefined,
      expiresAt: doc.expiresAt,
      remindDays: doc.remindDays,
      notes: doc.notes,
      parts: doc.parts.map((p) => ({
        label: p.label,
        filename: p.name,
        mimeType: p.mimeType,
        path: `${dir}/${dedupeName(p.name, used)}`,
      })),
    };
    pending.push({ node, partFileIds: doc.parts.map((p) => p.id) });
    return node;
  }

  async function collectLevel(
    parentId: string | undefined,
    counter: { n: number },
    pending: PendingDoc[],
  ): Promise<ManifestNode[]> {
    const level = await documents.listLevel(parentId);
    const children: ManifestNode[] = [];
    for (const group of level.groups) {
      children.push({
        type: 'group',
        name: group.name,
        children: await collectLevel(group.id, counter, pending),
      });
    }
    for (const doc of level.documents) {
      children.push(docNode(doc, `files/${counter.n++}`, pending));
    }
    return children;
  }

  return {
    async buildExport(source, opts = {}) {
      const counter = { n: 0 };
      const pending: PendingDoc[] = [];

      let root: Manifest['root'];
      let baseName: string;
      if (source.kind === 'vault') {
        root = { type: 'vault', children: await collectLevel(undefined, counter, pending) };
        baseName = 'vault-backup';
      } else if (source.kind === 'group') {
        root = {
          type: 'group',
          name: source.name,
          children: await collectLevel(source.id, counter, pending),
        };
        baseName = `${slug(source.name)}-export`;
      } else {
        const doc = await documents.getDocument(source.id);
        if (!doc) throw new Error('Document no longer exists.');
        root = docNode(doc, `files/${counter.n++}`, pending);
        baseName = `${slug(doc.title)}-export`;
      }

      // Download every part (this is the slow half — report progress).
      const total = pending.reduce((sum, d) => sum + d.partFileIds.length, 0);
      let done = 0;
      const files: Zippable = {};
      const downloads: Array<() => Promise<void>> = [];
      for (const item of pending) {
        item.partFileIds.forEach((fileId, i) => {
          downloads.push(async () => {
            const blob = await documents.getPartBlob(fileId);
            files[item.node.parts[i].path] = new Uint8Array(await blob.arrayBuffer());
            opts.onProgress?.(++done, total);
          });
        });
      }
      await runPool(3, downloads);

      const manifest: Manifest = {
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        root,
      };
      files['manifest.json'] = strToU8(JSON.stringify(manifest));

      let bytes = await zipAsync(files);
      let ext = 'zip';
      let type = 'application/zip';
      if (opts.password) {
        bytes = await encryptBundle(bytes, opts.password);
        ext = 'dvault';
        type = 'application/octet-stream';
      }
      const date = new Date().toISOString().slice(0, 10);
      return {
        blob: new Blob([bytes as BlobPart], { type }),
        filename: `${baseName}-${date}.${ext}`,
      };
    },

    async applyImport(bytes, opts) {
      let zipBytes = bytes;
      if (isEncrypted(bytes)) {
        if (!opts.password) throw new Error('This bundle is password-protected.');
        zipBytes = await decryptBundle(bytes, opts.password);
      }

      let entries: Unzipped;
      let manifest: Manifest;
      try {
        entries = await unzipAsync(zipBytes);
        manifest = JSON.parse(strFromU8(entries['manifest.json'])) as Manifest;
      } catch {
        throw new Error('This file is not a vault backup.');
      }
      if (manifest.format !== BUNDLE_FORMAT || typeof manifest.version !== 'number') {
        throw new Error('This file is not a vault backup.');
      }
      if (manifest.version > BUNDLE_VERSION) {
        throw new Error('This backup was made with a newer app version — update first.');
      }

      const countDocs = (node: Manifest['root'] | ManifestNode): number =>
        node.type === 'doc'
          ? 1
          : node.children.reduce((sum, c) => sum + countDocs(c), 0);
      const total = countDocs(manifest.root);

      let imported = 0;
      let failedAt: string | undefined;
      let errorMsg: string | undefined;

      const toParts = (doc: ManifestDoc): NewPart[] =>
        doc.parts.map((p) => {
          const data = entries[p.path];
          if (!data) throw new Error(`Bundle is missing file for "${doc.title}".`);
          return {
            label: p.label,
            filename: p.filename,
            blob: new Blob([data as BlobPart], { type: p.mimeType }),
          };
        });

      async function importDoc(doc: ManifestDoc, parentId: string | undefined) {
        try {
          await withRetry(() =>
            documents.createDocument(doc.title, toParts(doc), parentId, {
              createdAt: doc.createdAt,
              expiresAt: doc.expiresAt,
              remindDays: doc.remindDays,
              notes: doc.notes,
            }),
          );
          imported += 1;
          opts.onProgress?.(imported, total);
        } catch (e) {
          failedAt = failedAt ?? doc.title;
          errorMsg = errorMsg ?? (e as Error).message;
          throw e;
        }
      }

      async function importChildren(nodes: ManifestNode[], parentId: string | undefined) {
        // Documents at this level go through a small pool (Drive rate limits);
        // groups recurse sequentially so parent folders exist before children.
        const docs = nodes.filter((n): n is ManifestDoc => n.type === 'doc');
        await runPool(3, docs.map((d) => () => importDoc(d, parentId)));
        for (const group of nodes.filter((n): n is ManifestGroup => n.type === 'group')) {
          let created;
          try {
            created = await withRetry(() => documents.createGroup(group.name, parentId));
          } catch (e) {
            failedAt = failedAt ?? group.name;
            errorMsg = errorMsg ?? (e as Error).message;
            throw e;
          }
          await importChildren(group.children, created.id);
        }
      }

      try {
        const dest = opts.destParentId;
        if (manifest.root.type === 'doc') {
          await importDoc(manifest.root, dest);
        } else if (manifest.root.type === 'group') {
          await importChildren([manifest.root], dest);
        } else {
          await importChildren(manifest.root.children, dest);
        }
      } catch {
        // Partial import: surface what happened instead of losing progress.
        return { imported, total, failedAt: failedAt ?? 'unknown', error: errorMsg };
      }

      return { imported, total };
    },
  };
}
