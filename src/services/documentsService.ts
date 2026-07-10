// Domain layer: an arbitrary folder tree in Drive.
//
//   "Document Vault"/                    (root, cached id)
//     <Group folder>                     (appProperties: kind='group')
//       <Group folder>                   (groups nest to any depth)
//       <Document folder>                (kind='doc' + title/category/createdAt)
//         <part file>                    (appProperties: label)
//
// Legacy document folders (created before groups existed) have no `kind`; they
// are detected by their `title` property and lazily stamped. Folders created
// directly in the Drive UI have no properties at all and are treated as groups
// so their contents stay reachable.

import { ROOT_FOLDER_NAME } from '../config';
import { DriveClient, DriveFile } from './driveClient';

const ROOT_CACHE_KEY = 'vault.rootFolderId';

export interface DocumentPart {
  id: string;
  label: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
}

export interface VaultGroup {
  id: string;
  name: string;
  parentId: string;
}

export interface VaultDocument {
  id: string;
  title: string;
  createdAt: string;
  /** ISO date (YYYY-MM-DD), optional. */
  expiresAt?: string;
  /** Days before expiry to start warning; defaults to DEFAULT_REMIND_DAYS. */
  remindDays?: number;
  notes?: string;
  parts: DocumentPart[];
  parentId: string;
}

/** Optional per-document metadata (all clearable). */
export interface DocMeta {
  expiresAt?: string;
  remindDays?: number;
  notes?: string;
  /** Creation-time override — used by import so copies keep the original date. */
  createdAt?: string;
}

export const DEFAULT_REMIND_DAYS = 30;
export const REMIND_OPTIONS = [5, 7, 14, 30, 60, 90];

export interface ExpiryInfo {
  state: 'expired' | 'expiring' | 'ok';
  /** Days overdue when expired, days remaining otherwise. */
  days: number;
}

/** Expiry state relative to `now`, honouring the per-document reminder window. */
export function expiryInfo(
  doc: { expiresAt?: string; remindDays?: number },
  now: Date = new Date(),
): ExpiryInfo | null {
  if (!doc.expiresAt) return null;
  const [y, m, d] = doc.expiresAt.split('-').map(Number);
  if (!y || !m || !d) return null;
  const expiry = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((expiry - today) / 86_400_000);
  if (days < 0) return { state: 'expired', days: -days };
  if (days <= (doc.remindDays ?? DEFAULT_REMIND_DAYS)) return { state: 'expiring', days };
  return { state: 'ok', days };
}

export interface VaultLevel {
  groups: VaultGroup[];
  documents: VaultDocument[];
}

export interface NewPart {
  label: string;
  filename: string;
  blob: Blob;
}

export interface DocumentsService {
  ensureRoot(): Promise<string>;
  /** Forget the cached root folder id (e.g. on sign-out / account switch). */
  invalidateRoot(): void;
  /** One level of the tree. `parentId` omitted = root. */
  listLevel(parentId?: string): Promise<VaultLevel>;
  getGroup(id: string): Promise<VaultGroup | null>;
  createGroup(name: string, parentId?: string): Promise<VaultGroup>;
  renameGroup(id: string, name: string): Promise<void>;
  /** Recursive tally of what lives inside a group (for delete warnings). */
  countContents(id: string): Promise<{ docs: number; groups: number }>;
  /** Deletes a group AND everything inside it (Drive cascades the folder). */
  deleteGroup(id: string): Promise<void>;
  createDocument(
    title: string,
    parts: NewPart[],
    parentId?: string,
    meta?: DocMeta,
  ): Promise<VaultDocument>;
  /** Update (or clear) a document's expiry/reminder/notes. */
  updateDocumentMeta(id: string, meta: DocMeta): Promise<void>;
  /** All documents (any depth) that are expired or inside their reminder window. */
  listExpiring(now?: Date): Promise<VaultDocument[]>;
  /** Fetch a single document by id (deep links), or null if gone. */
  getDocument(id: string): Promise<VaultDocument | null>;
  addPart(documentId: string, part: NewPart): Promise<DocumentPart>;
  deletePart(fileId: string): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  getPartBlob(fileId: string): Promise<Blob>;
  /** Move a document or group. `undefined` parent = root. Guards cycles. */
  moveItem(
    id: string,
    fromParentId: string | undefined,
    toParentId: string | undefined,
  ): Promise<void>;
  /** Search ALL documents at any depth by title/category substring. */
  searchDocuments(text: string): Promise<VaultDocument[]>;
}

function toPart(file: DriveFile): DocumentPart {
  return {
    id: file.id,
    label: file.appProperties?.label ?? file.name,
    name: file.name,
    mimeType: file.mimeType,
    thumbnailLink: file.thumbnailLink,
  };
}

function classify(folder: DriveFile): 'doc' | 'group' {
  const kind = folder.appProperties?.kind;
  if (kind === 'doc') return 'doc';
  if (kind === 'group') return 'group';
  // Legacy documents carry a title; untyped folders are treated as groups.
  return folder.appProperties?.title ? 'doc' : 'group';
}

function toDoc(folder: DriveFile, parts: DocumentPart[], parentId: string): VaultDocument {
  const remind = folder.appProperties?.remindDays;
  return {
    id: folder.id,
    title: folder.appProperties?.title ?? folder.name,
    createdAt: folder.appProperties?.createdAt ?? folder.createdTime ?? '',
    expiresAt: folder.appProperties?.expiresAt || undefined,
    remindDays: remind ? Number.parseInt(remind, 10) || undefined : undefined,
    notes: folder.description || undefined,
    parts,
    parentId,
  };
}

export function createDocumentsService(drive: DriveClient): DocumentsService {
  let rootIdPromise: Promise<string> | null = null;

  async function resolveRoot(): Promise<string> {
    const cached = localStorage.getItem(ROOT_CACHE_KEY);
    if (cached) {
      // Verify once per session — the folder may have been trashed/deleted in
      // Drive, and blindly trusting a stale id breaks every later call.
      const file = await drive.getFile(cached);
      if (file && !file.trashed) return cached;
      localStorage.removeItem(ROOT_CACHE_KEY);
    }
    const existing = await drive.findFolderByName(ROOT_FOLDER_NAME);
    const folder = existing ?? (await drive.createFolder(ROOT_FOLDER_NAME));
    localStorage.setItem(ROOT_CACHE_KEY, folder.id);
    return folder.id;
  }

  function ensureRoot(): Promise<string> {
    if (!rootIdPromise) {
      // Don't memoise failures — a transient error must not poison the session.
      rootIdPromise = resolveRoot().catch((e) => {
        rootIdPromise = null;
        throw e;
      });
    }
    return rootIdPromise;
  }

  async function docWithParts(folder: DriveFile, parentId: string): Promise<VaultDocument> {
    const children = await drive.listChildren(folder.id);
    return toDoc(folder, children.map(toPart), parentId);
  }

  return {
    ensureRoot,

    invalidateRoot() {
      rootIdPromise = null;
      localStorage.removeItem(ROOT_CACHE_KEY);
    },

    async listLevel(parentId) {
      const pid = parentId ?? (await ensureRoot());
      const folders = await drive.listFolders(pid);

      const groups: VaultGroup[] = [];
      const docFolders: DriveFile[] = [];
      for (const f of folders) {
        if (classify(f) === 'group') groups.push({ id: f.id, name: f.name, parentId: pid });
        else docFolders.push(f);
      }

      const documents = await Promise.all(
        docFolders.map((f) => {
          // Lazily stamp legacy documents so global search can find them.
          if (f.appProperties?.kind !== 'doc') {
            void drive.updateAppProperties(f.id, { kind: 'doc' }).catch(() => undefined);
          }
          return docWithParts(f, pid);
        }),
      );

      groups.sort((a, b) => a.name.localeCompare(b.name));
      documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { groups, documents };
    },

    async getGroup(id) {
      const f = await drive.getFile(id);
      if (!f || f.trashed) return null;
      return { id: f.id, name: f.name, parentId: f.parents?.[0] ?? '' };
    },

    async createGroup(name, parentId) {
      const pid = parentId ?? (await ensureRoot());
      const folder = await drive.createFolder(name, pid, {
        kind: 'group',
        createdAt: new Date().toISOString(),
      });
      return { id: folder.id, name, parentId: pid };
    },

    renameGroup(id, name) {
      return drive.renameFile(id, name);
    },

    async countContents(id) {
      let docs = 0;
      let groups = 0;
      const walk = async (pid: string): Promise<void> => {
        const folders = await drive.listFolders(pid);
        for (const f of folders) {
          if (classify(f) === 'doc') docs += 1;
          else {
            groups += 1;
            await walk(f.id);
          }
        }
      };
      await walk(id);
      return { docs, groups };
    },

    deleteGroup(id) {
      // Drive deletes the folder's entire subtree with it.
      return drive.deleteFile(id);
    },

    async createDocument(title, parts, parentId, meta) {
      const pid = parentId ?? (await ensureRoot());
      const createdAt = meta?.createdAt ?? new Date().toISOString();
      const appProperties: Record<string, string> = { kind: 'doc', title, createdAt };
      if (meta?.expiresAt) appProperties.expiresAt = meta.expiresAt;
      if (meta?.remindDays != null) appProperties.remindDays = String(meta.remindDays);
      const folder = await drive.createFolder(title, pid, appProperties, meta?.notes);
      const uploaded = await Promise.all(
        parts.map((p) => drive.uploadFile(folder.id, p.filename, p.blob, { label: p.label })),
      );
      return {
        id: folder.id,
        title,
        createdAt,
        expiresAt: meta?.expiresAt,
        remindDays: meta?.remindDays,
        notes: meta?.notes,
        parts: uploaded.map(toPart),
        parentId: pid,
      };
    },

    async updateDocumentMeta(id, meta) {
      await drive.updateFileMeta(id, {
        description: meta.notes ?? '',
        appProperties: {
          expiresAt: meta.expiresAt ?? null, // null deletes the key
          remindDays: meta.remindDays != null ? String(meta.remindDays) : null,
        },
      });
    },

    async listExpiring(now = new Date()) {
      const all = await drive.listByAppProperty('kind', 'doc');
      return all
        .map((f) => toDoc(f, [], f.parents?.[0] ?? ''))
        .filter((d) => {
          const info = expiryInfo(d, now);
          return info !== null && info.state !== 'ok';
        })
        .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));
    },

    async getDocument(id) {
      const f = await drive.getFile(id);
      if (!f || f.trashed || classify(f) !== 'doc') return null;
      return docWithParts(f, f.parents?.[0] ?? '');
    },

    async addPart(documentId, part) {
      const file = await drive.uploadFile(documentId, part.filename, part.blob, {
        label: part.label,
      });
      return toPart(file);
    },

    deletePart(fileId) {
      return drive.deleteFile(fileId);
    },

    deleteDocument(documentId) {
      // Deleting the folder removes all its part files too.
      return drive.deleteFile(documentId);
    },

    getPartBlob(fileId) {
      return drive.downloadFile(fileId);
    },

    async moveItem(id, fromParentId, toParentId) {
      const from = fromParentId ?? (await ensureRoot());
      const to = toParentId ?? (await ensureRoot());
      if (from === to) return;

      // Cycle guard: walk up from the destination; hitting the moved node
      // means we'd be moving a group inside itself.
      let cursor: string | null = to;
      for (let depth = 0; cursor && depth < 30; depth += 1) {
        if (cursor === id) throw new Error("Can't move a group inside itself.");
        const f: DriveFile | null = await drive.getFile(cursor);
        cursor = f?.parents?.[0] ?? null;
      }

      await drive.moveFile(id, from, to);
    },

    async searchDocuments(text) {
      const q = text.trim().toLowerCase();
      if (!q) return [];
      const all = await drive.listByAppProperty('kind', 'doc');
      const matches = all
        .filter((f) => (f.appProperties?.title ?? f.name).toLowerCase().includes(q))
        .slice(0, 30);
      return Promise.all(matches.map((f) => docWithParts(f, f.parents?.[0] ?? '')));
    },
  };
}
