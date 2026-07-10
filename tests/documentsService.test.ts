import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentsService, expiryInfo } from '../src/services/documentsService';
import type { DriveClient, DriveFile } from '../src/services/driveClient';

const FOLDER = 'application/vnd.google-apps.folder';

/** Minimal in-memory Drive used to exercise the domain layer. */
function fakeDrive() {
  const files = new Map<string, DriveFile>();
  let seq = 0;
  const id = () => `id-${++seq}`;

  const client: DriveClient = {
    async getFile(fileId) {
      return files.get(fileId) ?? null;
    },
    async listFolders(parentId) {
      return [...files.values()].filter(
        (f) => f.mimeType === FOLDER && f.parents?.[0] === parentId,
      );
    },
    async listChildren(parentId) {
      return [...files.values()].filter((f) => f.parents?.[0] === parentId);
    },
    async listByAppProperty(key, value) {
      return [...files.values()].filter(
        (f) => f.mimeType === FOLDER && f.appProperties?.[key] === value,
      );
    },
    async findFolderByName(name, parentId) {
      return (
        [...files.values()].find(
          (f) =>
            f.name === name &&
            f.mimeType === FOLDER &&
            (!parentId || f.parents?.[0] === parentId),
        ) ?? null
      );
    },
    async createFolder(name, parentId, appProperties, description) {
      const f: DriveFile = {
        id: id(),
        name,
        mimeType: FOLDER,
        parents: parentId ? [parentId] : undefined,
        appProperties,
        description,
        createdTime: new Date().toISOString(),
      };
      files.set(f.id, f);
      return f;
    },
    async updateFileMeta(fileId, meta) {
      const f = files.get(fileId);
      if (!f) return;
      if (meta.name !== undefined) f.name = meta.name;
      if (meta.description !== undefined) f.description = meta.description;
      if (meta.appProperties) {
        const merged = { ...f.appProperties };
        for (const [k, v] of Object.entries(meta.appProperties)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        f.appProperties = merged;
      }
    },
    async renameFile(fileId, name) {
      const f = files.get(fileId);
      if (f) f.name = name;
    },
    async moveFile(fileId, _from, to) {
      const f = files.get(fileId);
      if (f) f.parents = [to];
    },
    async uploadFile(parentId, name, _blob, appProperties) {
      const f: DriveFile = {
        id: id(),
        name,
        mimeType: 'image/jpeg',
        parents: [parentId],
        appProperties,
      };
      files.set(f.id, f);
      return f;
    },
    async updateAppProperties(fileId, appProperties) {
      const f = files.get(fileId);
      if (f) f.appProperties = { ...f.appProperties, ...appProperties };
    },
    async downloadFile() {
      return new Blob(['data']);
    },
    async deleteFile(fileId) {
      files.delete(fileId);
      // Cascade delete children (folder deletion).
      for (const [k, v] of files) if (v.parents?.[0] === fileId) files.delete(k);
    },
  };

  return { client, files };
}

describe('documentsService', () => {
  beforeEach(() => localStorage.clear());

  it('creates and caches the root folder once', async () => {
    const { client } = fakeDrive();
    const spy = vi.spyOn(client, 'createFolder');
    const svc = createDocumentsService(client);

    const a = await svc.ensureRoot();
    const b = await svc.ensureRoot();

    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1); // memoised + cached
    expect(localStorage.getItem('vault.rootFolderId')).toBe(a);
  });

  it('re-discovers the root when the cached id no longer exists in Drive', async () => {
    const { client } = fakeDrive();
    localStorage.setItem('vault.rootFolderId', 'ghost-id'); // stale/deleted folder
    const svc = createDocumentsService(client);

    const rootId = await svc.ensureRoot();

    expect(rootId).not.toBe('ghost-id');
    expect(localStorage.getItem('vault.rootFolderId')).toBe(rootId);
  });

  it('creates a multi-part document as a folder with part files', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);

    const doc = await svc.createDocument('License', [
      { label: 'Front', filename: 'front.jpg', blob: new Blob(['1']) },
      { label: 'Back', filename: 'back.jpg', blob: new Blob(['2']) },
    ]);

    expect(doc.parts).toHaveLength(2);
    expect(doc.parts.map((p) => p.label)).toEqual(['Front', 'Back']);
  });

  it('separates groups from documents and treats legacy/untyped folders correctly', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const rootId = await svc.ensureRoot();

    await svc.createGroup('Vehicles'); // kind=group
    await svc.createDocument('Passport', [
      { label: 'Photo', filename: 'p.jpg', blob: new Blob(['1']) },
    ]);
    // Legacy document (pre-groups: title but no kind).
    const legacy = await client.createFolder('Old License', rootId, {
      title: 'Old License',
      category: 'ID / License',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // Folder made directly in Drive UI (no properties) → group.
    await client.createFolder('Made In Drive', rootId);

    const level = await svc.listLevel();

    expect(level.groups.map((g) => g.name).sort()).toEqual(['Made In Drive', 'Vehicles']);
    expect(level.documents.map((d) => d.title).sort()).toEqual(['Old License', 'Passport']);

    // Legacy doc gets lazily stamped so global search can find it.
    await new Promise((r) => setTimeout(r, 0));
    expect(files.get(legacy.id)?.appProperties?.kind).toBe('doc');
  });

  it('supports nested groups with documents inside', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);

    const vehicles = await svc.createGroup('Vehicles');
    const car = await svc.createGroup('Car', vehicles.id);
    await svc.createDocument('Insurance',
      [{ label: 'Policy', filename: 'p.pdf', blob: new Blob(['1']) }],
      car.id,
    );

    const carLevel = await svc.listLevel(car.id);
    expect(carLevel.documents).toHaveLength(1);
    expect(carLevel.documents[0].title).toBe('Insurance');
    expect(carLevel.documents[0].parentId).toBe(car.id);

    const root = await svc.listLevel();
    expect(root.groups.map((g) => g.name)).toEqual(['Vehicles']);
    expect(root.documents).toHaveLength(0);
  });

  it('counts nested documents and groups inside a group', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    const house = await svc.createGroup('House');
    const papers = await svc.createGroup('Papers', house.id);
    await svc.createDocument('Deed',
      [{ label: 'Deed', filename: 'd.pdf', blob: new Blob(['1']) }],
      house.id,
    );
    await svc.createDocument('Tax',
      [{ label: 'Tax', filename: 't.pdf', blob: new Blob(['1']) }],
      papers.id,
    );

    expect(await svc.countContents(house.id)).toEqual({ docs: 2, groups: 1 });
    expect(await svc.countContents(papers.id)).toEqual({ docs: 1, groups: 0 });

    const empty = await svc.createGroup('Empty');
    expect(await svc.countContents(empty.id)).toEqual({ docs: 0, groups: 0 });
  });

  it('deletes a group together with everything inside it', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const group = await svc.createGroup('House');
    await svc.createDocument('Deed',
      [{ label: 'Deed', filename: 'd.pdf', blob: new Blob(['1']) }],
      group.id,
    );

    await svc.deleteGroup(group.id);
    expect(files.has(group.id)).toBe(false);
  });

  it('moves a document between groups', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const car = await svc.createGroup('Car');
    const doc = await svc.createDocument('RC Book', [
      { label: 'Front', filename: 'f.jpg', blob: new Blob(['1']) },
    ]); // created at root

    await svc.moveItem(doc.id, undefined, car.id);

    expect(files.get(doc.id)?.parents?.[0]).toBe(car.id);
    const carLevel = await svc.listLevel(car.id);
    expect(carLevel.documents.map((d) => d.title)).toEqual(['RC Book']);
  });

  it('blocks moving a group into its own descendant', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    const vehicles = await svc.createGroup('Vehicles');
    const car = await svc.createGroup('Car', vehicles.id);

    await expect(svc.moveItem(vehicles.id, undefined, car.id)).rejects.toThrow(
      /inside itself/i,
    );
  });

  it('searches documents across all depths by title', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    const vehicles = await svc.createGroup('Vehicles');
    const car = await svc.createGroup('Car', vehicles.id);
    await svc.createDocument('Car Insurance',
      [{ label: 'Policy', filename: 'p.pdf', blob: new Blob(['1']) }],
      car.id,
    );
    await svc.createDocument('Passport', [
      { label: 'Photo', filename: 'p.jpg', blob: new Blob(['1']) },
    ]);

    const byTitle = await svc.searchDocuments('insur');
    expect(byTitle.map((d) => d.title)).toEqual(['Car Insurance']);

    expect(await svc.searchDocuments('nothing')).toEqual([]);
  });

  it('stores and reads expiry, reminder and notes', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    await svc.createDocument(
      'Insurance',
      [{ label: 'Policy', filename: 'p.pdf', blob: new Blob(['1']) }],
      undefined,
      { expiresAt: '2027-07-14', remindDays: 30, notes: 'Policy #123' },
    );

    const level = await svc.listLevel();
    expect(level.documents[0]).toMatchObject({
      expiresAt: '2027-07-14',
      remindDays: 30,
      notes: 'Policy #123',
    });
  });

  it('renames a document (folder name + title property)', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const doc = await svc.createDocument('anita aadhar', [
      { label: 'Front', filename: 'f.jpg', blob: new Blob(['1']) },
    ]);

    await svc.renameDocument(doc.id, 'Anita Aadhaar');

    const level = await svc.listLevel();
    expect(level.documents[0].title).toBe('Anita Aadhaar');
    expect(files.get(doc.id)?.name).toBe('Anita Aadhaar'); // Drive folder too
  });

  it('updateDocumentMeta updates and clears metadata', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    const doc = await svc.createDocument(
      'Insurance',
      [{ label: 'Policy', filename: 'p.pdf', blob: new Blob(['1']) }],
      undefined,
      { expiresAt: '2027-07-14', remindDays: 30, notes: 'old' },
    );

    await svc.updateDocumentMeta(doc.id, { expiresAt: '2028-01-01', remindDays: 5, notes: 'new' });
    let level = await svc.listLevel();
    expect(level.documents[0]).toMatchObject({
      expiresAt: '2028-01-01',
      remindDays: 5,
      notes: 'new',
    });

    await svc.updateDocumentMeta(doc.id, {}); // clear everything
    level = await svc.listLevel();
    expect(level.documents[0].expiresAt).toBeUndefined();
    expect(level.documents[0].remindDays).toBeUndefined();
    expect(level.documents[0].notes).toBeUndefined();
  });

  it('expiryInfo honours the per-document reminder window', () => {
    const now = new Date(2027, 6, 1); // 1 Jul 2027
    expect(expiryInfo({ expiresAt: '2027-07-14', remindDays: 30 }, now)).toEqual({
      state: 'expiring',
      days: 13,
    });
    expect(expiryInfo({ expiresAt: '2027-07-14', remindDays: 5 }, now)).toEqual({
      state: 'ok',
      days: 13,
    });
    expect(expiryInfo({ expiresAt: '2027-06-30' }, now)).toEqual({ state: 'expired', days: 1 });
    expect(expiryInfo({ expiresAt: '2027-07-01' }, now)).toEqual({ state: 'expiring', days: 0 });
    expect(expiryInfo({}, now)).toBeNull();
  });

  it('listExpiring returns expired + in-window docs across depths, sorted by date', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    const car = await svc.createGroup('Car');
    const part = () => [{ label: 'A', filename: 'a.pdf', blob: new Blob(['1']) }];
    await svc.createDocument('Expired RC', part(), car.id, {
      expiresAt: '2027-06-20',
      remindDays: 5,
    });
    await svc.createDocument('Insurance soon', part(), undefined, {
      expiresAt: '2027-07-10',
      remindDays: 30,
    });
    await svc.createDocument('Far away', part(), undefined, {
      expiresAt: '2028-07-01',
      remindDays: 5,
    });
    await svc.createDocument('No expiry', part());

    const now = new Date(2027, 6, 1); // 1 Jul 2027
    const list = await svc.listExpiring(now);
    expect(list.map((d) => d.title)).toEqual(['Expired RC', 'Insurance soon']);
  });

  it('deleting a document removes its part files too', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const doc = await svc.createDocument('Temp', [
      { label: 'A', filename: 'a.jpg', blob: new Blob(['1']) },
    ]);

    await svc.deleteDocument(doc.id);
    expect(files.has(doc.id)).toBe(false);
    expect([...files.values()].some((f) => f.parents?.[0] === doc.id)).toBe(false);
  });
});
