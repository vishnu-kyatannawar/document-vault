import { beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type {
  DocMeta,
  DocumentsService,
  NewPart,
  VaultDocument,
  VaultGroup,
} from '../src/services/documentsService';

// jsdom lacks SubtleCrypto and Blob#arrayBuffer — back both with Node's.
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    vi.stubGlobal('crypto', webcrypto);
  }
  if (!Blob.prototype.arrayBuffer) {
    const { Blob: NodeBlob } = await import('node:buffer');
    vi.stubGlobal('Blob', NodeBlob);
  }
});

const ROOT = 'fake-root';

/**
 * Minimal in-memory DocumentsService: just enough tree + blob storage for the
 * transfer layer (listLevel/getDocument/getPartBlob to read, createGroup/
 * createDocument to write).
 */
function fakeVault() {
  let seq = 0;
  const id = () => `f-${++seq}`;

  const groups = new Map<string, VaultGroup>();
  const docs = new Map<string, VaultDocument>();
  const blobs = new Map<string, Blob>();
  const createDocCalls: Array<{
    title: string;
    parts: NewPart[];
    parentId?: string;
    meta?: DocMeta;
  }> = [];

  const svc = {
    async ensureRoot() {
      return ROOT;
    },
    invalidateRoot() {},
    async listLevel(parentId?: string) {
      const pid = parentId ?? ROOT;
      return {
        groups: [...groups.values()].filter((g) => g.parentId === pid),
        documents: [...docs.values()].filter((d) => d.parentId === pid),
      };
    },
    async getGroup(gid: string) {
      return groups.get(gid) ?? null;
    },
    async createGroup(name: string, parentId?: string) {
      const g: VaultGroup = { id: id(), name, parentId: parentId ?? ROOT };
      groups.set(g.id, g);
      return g;
    },
    async createDocument(title: string, parts: NewPart[], parentId?: string, meta?: DocMeta) {
      createDocCalls.push({ title, parts, parentId, meta });
      const doc: VaultDocument = {
        id: id(),
        title,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        expiresAt: meta?.expiresAt,
        remindDays: meta?.remindDays,
        notes: meta?.notes,
        parentId: parentId ?? ROOT,
        parts: parts.map((p) => {
          const pid = id();
          blobs.set(pid, p.blob);
          return { id: pid, label: p.label, name: p.filename, mimeType: p.blob.type || 'application/octet-stream' };
        }),
      };
      docs.set(doc.id, doc);
      return doc;
    },
    async getDocument(did: string) {
      return docs.get(did) ?? null;
    },
    async getPartBlob(pid: string) {
      const b = blobs.get(pid);
      if (!b) throw new Error(`no blob ${pid}`);
      return b;
    },
    // Unused by the transfer layer:
    async renameGroup() {},
    async renameDocument() {},
    async deleteGroup() {},
    async countContents() {
      return { docs: 0, groups: 0 };
    },
    async updateDocumentMeta() {},
    async listExpiring() {
      return [];
    },
    async addPart(): Promise<never> {
      throw new Error('unused');
    },
    async deletePart() {},
    async deleteDocument() {},
    async moveItem() {},
    async searchDocuments() {
      return [];
    },
  } satisfies DocumentsService;

  return { svc, groups, docs, blobs, createDocCalls };
}

const part = (label: string, filename: string, bytes: string, type = 'image/jpeg'): NewPart => ({
  label,
  filename,
  blob: new Blob([bytes], { type }),
});

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

async function makeService(svc: DocumentsService) {
  const { createTransferService } = await import('../src/services/transferService');
  return createTransferService(svc);
}

describe('transferService — export', () => {
  it('exports the whole vault with nested structure, metadata and exact bytes', async () => {
    const { svc } = fakeVault();
    const vehicles = await svc.createGroup('Vehicles');
    const car = await svc.createGroup('Car', vehicles.id);
    await svc.createDocument(
      'Insurance',
      [part('Policy', 'policy.pdf', 'PDFBYTES', 'application/pdf')],
      car.id,
      { expiresAt: '2027-07-14', remindDays: 30, notes: 'Policy #123', createdAt: '2026-01-05T00:00:00.000Z' },
    );
    await svc.createDocument('Passport', [part('Photo', 'photo.jpg', 'JPG1')]);

    const transfer = await makeService(svc);
    const progress: Array<[number, number]> = [];
    const { blob, filename } = await transfer.buildExport(
      { kind: 'vault' },
      { onProgress: (done, total) => progress.push([done, total]) },
    );

    expect(filename).toMatch(/\.zip$/);
    const entries = unzipSync(await bytesOf(blob));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));

    expect(manifest.format).toBe('document-vault');
    expect(manifest.version).toBe(1);
    expect(manifest.root.type).toBe('vault');

    const groupNode = manifest.root.children.find((n: { type: string }) => n.type === 'group');
    expect(groupNode.name).toBe('Vehicles');
    expect(groupNode.children[0].name).toBe('Car');
    const insurance = groupNode.children[0].children[0];
    expect(insurance).toMatchObject({
      type: 'doc',
      title: 'Insurance',
      expiresAt: '2027-07-14',
      remindDays: 30,
      notes: 'Policy #123',
      createdAt: '2026-01-05T00:00:00.000Z',
    });

    // Part bytes land in the zip uncompressed and unchanged.
    const partEntry = insurance.parts[0];
    expect(partEntry).toMatchObject({ label: 'Policy', mimeType: 'application/pdf' });
    expect(strFromU8(entries[partEntry.path])).toBe('PDFBYTES');

    const passport = manifest.root.children.find((n: { type: string }) => n.type === 'doc');
    expect(strFromU8(entries[passport.parts[0].path])).toBe('JPG1');

    // Progress reached done === total (2 parts).
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it('exports a single group and a single document as roots', async () => {
    const { svc } = fakeVault();
    const car = await svc.createGroup('Car');
    const doc = await svc.createDocument('RC Book', [part('Front', 'f.jpg', 'F1')], car.id);

    const transfer = await makeService(svc);

    const g = await transfer.buildExport({ kind: 'group', id: car.id, name: 'Car' });
    const gm = JSON.parse(strFromU8(unzipSync(await bytesOf(g.blob))['manifest.json']));
    expect(gm.root).toMatchObject({ type: 'group', name: 'Car' });
    expect(gm.root.children[0].title).toBe('RC Book');

    const d = await transfer.buildExport({ kind: 'doc', id: doc.id });
    const dm = JSON.parse(strFromU8(unzipSync(await bytesOf(d.blob))['manifest.json']));
    expect(dm.root).toMatchObject({ type: 'doc', title: 'RC Book' });
  });

  it('dedupes clashing part filenames within a document', async () => {
    const { svc } = fakeVault();
    await svc.createDocument('License', [
      part('Front', 'image.jpg', 'FRONT'),
      part('Back', 'image.jpg', 'BACK'),
    ]);

    const transfer = await makeService(svc);
    const { blob } = await transfer.buildExport({ kind: 'vault' });
    const entries = unzipSync(await bytesOf(blob));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));

    const paths = manifest.root.children[0].parts.map((p: { path: string }) => p.path);
    expect(new Set(paths).size).toBe(2);
    expect(strFromU8(entries[paths[0]])).toBe('FRONT');
    expect(strFromU8(entries[paths[1]])).toBe('BACK');
  });
});

describe('transferService — import', () => {
  it('rebuilds the exported tree inside the chosen destination', async () => {
    const { svc: source } = fakeVault();
    const vehicles = await source.createGroup('Vehicles');
    const car = await source.createGroup('Car', vehicles.id);
    await source.createDocument(
      'Insurance',
      [part('Policy', 'policy.pdf', 'PDFBYTES', 'application/pdf')],
      car.id,
      { expiresAt: '2027-07-14', remindDays: 30, notes: 'Policy #123', createdAt: '2026-01-05T00:00:00.000Z' },
    );
    await source.createDocument('Passport', [part('Photo', 'photo.jpg', 'JPG1')]);

    const exporter = await makeService(source);
    const { blob } = await exporter.buildExport({ kind: 'vault' });

    const dest = fakeVault();
    const destGroup = await dest.svc.createGroup('Imported stuff');
    const importer = await makeService(dest.svc);

    const result = await importer.applyImport(await bytesOf(blob), {
      destParentId: destGroup.id,
    });
    expect(result).toEqual({ imported: 2, total: 2 });

    // Structure under the destination group.
    const level = await dest.svc.listLevel(destGroup.id);
    expect(level.groups.map((g) => g.name)).toEqual(['Vehicles']);
    expect(level.documents.map((d) => d.title)).toEqual(['Passport']);

    const vehiclesLevel = await dest.svc.listLevel(level.groups[0].id);
    const carLevel = await dest.svc.listLevel(vehiclesLevel.groups[0].id);
    const insurance = carLevel.documents[0];
    expect(insurance).toMatchObject({
      title: 'Insurance',
      expiresAt: '2027-07-14',
      remindDays: 30,
      notes: 'Policy #123',
      createdAt: '2026-01-05T00:00:00.000Z', // original date preserved
    });

    // Bytes survive the round trip.
    const restored = await dest.svc.getPartBlob(insurance.parts[0].id);
    expect(strFromU8(await bytesOf(restored))).toBe('PDFBYTES');
    expect(insurance.parts[0].mimeType).toBe('application/pdf');
  });

  it('imports a doc-rooted bundle straight into the destination (root by default)', async () => {
    const { svc: source } = fakeVault();
    const doc = await source.createDocument('RC Book', [part('Front', 'f.jpg', 'F1')]);
    const exporter = await makeService(source);
    const { blob } = await exporter.buildExport({ kind: 'doc', id: doc.id });

    const dest = fakeVault();
    const importer = await makeService(dest.svc);
    const result = await importer.applyImport(await bytesOf(blob), {});

    expect(result).toEqual({ imported: 1, total: 1 });
    const level = await dest.svc.listLevel();
    expect(level.documents.map((d) => d.title)).toEqual(['RC Book']);
  });

  it('round-trips an encrypted bundle and rejects the wrong password', async () => {
    const { svc: source } = fakeVault();
    await source.createDocument('Secret', [part('A', 'a.jpg', 'TOPSECRET')]);
    const exporter = await makeService(source);
    const { blob, filename } = await exporter.buildExport(
      { kind: 'vault' },
      { password: 'hunter2' },
    );
    expect(filename).toMatch(/\.dvault$/);

    const { isEncrypted } = await import('../src/services/crypto');
    const bytes = await bytesOf(blob);
    expect(isEncrypted(bytes)).toBe(true);

    const dest = fakeVault();
    const importer = await makeService(dest.svc);
    await expect(importer.applyImport(bytes, { password: 'nope' })).rejects.toThrow(/password/i);

    const result = await importer.applyImport(bytes, { password: 'hunter2' });
    expect(result).toEqual({ imported: 1, total: 1 });
  });

  it('rejects bundles that are not a vault export', async () => {
    const dest = fakeVault();
    const importer = await makeService(dest.svc);
    await expect(
      importer.applyImport(new Uint8Array([1, 2, 3, 4]), {}),
    ).rejects.toThrow(/not a .*(backup|export)/i);
  });

  it('reports partial progress when the import fails midway', async () => {
    const { svc: source } = fakeVault();
    for (let i = 1; i <= 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await source.createDocument(`Doc ${i}`, [part('A', `a${i}.jpg`, `B${i}`)]);
    }
    const exporter = await makeService(source);
    const { blob } = await exporter.buildExport({ kind: 'vault' });

    const dest = fakeVault();
    const original = dest.svc.createDocument.bind(dest.svc);
    dest.svc.createDocument = async (...args) => {
      if (args[0] === 'Doc 2') throw new Error('Drive quota exceeded');
      return original(...args);
    };

    const importer = await makeService(dest.svc);
    const result = await importer.applyImport(await bytesOf(blob), {});

    expect(result.total).toBe(3);
    expect(result.imported).toBeLessThan(3);
    expect(result.failedAt).toBe('Doc 2');
    expect(result.error).toMatch(/quota/);
  });
});
