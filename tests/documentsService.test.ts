import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentsService } from '../src/services/documentsService';
import type { DriveClient, DriveFile } from '../src/services/driveClient';

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
        (f) => f.mimeType === 'application/vnd.google-apps.folder' && f.parents?.[0] === parentId,
      );
    },
    async listChildren(parentId) {
      return [...files.values()].filter((f) => f.parents?.[0] === parentId);
    },
    async findFolderByName(name, parentId) {
      return (
        [...files.values()].find(
          (f) =>
            f.name === name &&
            f.mimeType === 'application/vnd.google-apps.folder' &&
            (!parentId || f.parents?.[0] === parentId),
        ) ?? null
      );
    },
    async createFolder(name, parentId, appProperties) {
      const f: DriveFile = {
        id: id(),
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
        appProperties,
        createdTime: new Date().toISOString(),
      };
      files.set(f.id, f);
      return f;
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
    async updateAppProperties() {},
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
    // And the recovered root actually works:
    const folder = await client.getFile(rootId);
    expect(folder?.name).toBe('Document Vault');
  });

  it('creates a multi-part document as a folder with part files', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);

    const doc = await svc.createDocument('License', 'ID / License', [
      { label: 'Front', filename: 'front.jpg', blob: new Blob(['1']) },
      { label: 'Back', filename: 'back.jpg', blob: new Blob(['2']) },
    ]);

    expect(doc.parts).toHaveLength(2);
    expect(doc.parts.map((p) => p.label)).toEqual(['Front', 'Back']);
    expect(doc.category).toBe('ID / License');
  });

  it('lists documents with metadata from appProperties', async () => {
    const { client } = fakeDrive();
    const svc = createDocumentsService(client);
    await svc.createDocument('Passport', 'ID / License', [
      { label: 'Photo', filename: 'p.jpg', blob: new Blob(['1']) },
    ]);

    const docs = await svc.listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Passport');
    expect(docs[0].parts).toHaveLength(1);
  });

  it('deleting a document removes its part files too', async () => {
    const { client, files } = fakeDrive();
    const svc = createDocumentsService(client);
    const doc = await svc.createDocument('Temp', 'Other', [
      { label: 'A', filename: 'a.jpg', blob: new Blob(['1']) },
    ]);

    await svc.deleteDocument(doc.id);
    expect(files.has(doc.id)).toBe(false);
    expect([...files.values()].some((f) => f.parents?.[0] === doc.id)).toBe(false);
  });
});
