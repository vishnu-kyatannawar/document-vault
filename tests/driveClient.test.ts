import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriveClient } from '../src/services/driveClient';

const getToken = async () => 'test-token';

function mockFetch(response: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (..._args: unknown[]) =>
    ({
      ok,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
      blob: async () => new Blob([JSON.stringify(response)]),
    }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('driveClient', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it('attaches the bearer token to requests', async () => {
    const fetchMock = mockFetch({ files: [] });
    const client = createDriveClient(getToken);
    await client.listFolders('root-id');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('escapes single quotes in query values to prevent query injection', async () => {
    const fetchMock = mockFetch({ files: [] });
    const client = createDriveClient(getToken);
    await client.findFolderByName("O'Brien");

    const url = fetchMock.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("name='O\\'Brien'");
  });

  it('uploads via multipart with metadata + file parts', async () => {
    const fetchMock = mockFetch({ id: 'f1', name: 'front.jpg' });
    const client = createDriveClient(getToken);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const result = await client.uploadFile('parent', 'front.jpg', blob, { label: 'Front' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('uploadType=multipart');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(result.id).toBe('f1');
  });

  it('throws with status text on a non-ok response', async () => {
    mockFetch({ error: 'nope' }, false, 403);
    const client = createDriveClient(getToken);
    await expect(client.deleteFile('x')).rejects.toThrow(/403/);
  });

  it('drops the token and retries once on 401', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (..._args: unknown[]) => {
      calls += 1;
      const first = calls === 1;
      return {
        ok: !first,
        status: first ? 401 : 200,
        json: async () => ({ files: [] }),
        text: async () => (first ? 'unauthorized' : ''),
        blob: async () => new Blob(),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();

    const client = createDriveClient(getToken, onUnauthorized);
    await client.listFolders('root');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('moveFile PATCHes with addParents/removeParents', async () => {
    const fetchMock = mockFetch({ id: 'f1', parents: ['new'] });
    const client = createDriveClient(getToken);
    await client.moveFile('f1', 'old-parent', 'new-parent');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('addParents=new-parent');
    expect(String(url)).toContain('removeParents=old-parent');
    expect((init as RequestInit).method).toBe('PATCH');
  });

  it('getFile returns null when the file no longer exists (404)', async () => {
    mockFetch({ error: 'gone' }, false, 404);
    const client = createDriveClient(getToken);
    expect(await client.getFile('missing-id')).toBeNull();
  });

  describe('sharing', () => {
    it('requests ownership/capability fields so shared items can be recognised', async () => {
      const fetchMock = mockFetch({ files: [] });
      const client = createDriveClient(getToken);
      await client.listFolders('root-id');
      const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
      expect(url).toContain('ownedByMe');
      expect(url).toContain('sharedWithMe');
      expect(url).toContain('capabilities(canEdit,canDownload)');
      expect(url).toContain('copyRequiresWriterPermission');
    });

    it('lists folders shared with me', async () => {
      const fetchMock = mockFetch({ files: [{ id: 'g1', name: 'Car' }] });
      const client = createDriveClient(getToken);
      const files = await client.listSharedWithMeFolders();
      const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
      expect(url).toContain('sharedWithMe=true');
      expect(url).toContain("mimeType='application/vnd.google-apps.folder'");
      expect(files[0].id).toBe('g1');
    });

    it('creates a reader permission for a user and notifies them', async () => {
      const fetchMock = mockFetch({ id: 'p1', type: 'user', role: 'reader', emailAddress: 'a@b.com' });
      const client = createDriveClient(getToken);
      const p = await client.createReaderPermission('f1', 'a@b.com');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/files/f1/permissions');
      expect(url).toContain('sendNotificationEmail=true');
      expect((init as RequestInit).method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        role: 'reader',
        type: 'user',
        emailAddress: 'a@b.com',
      });
      expect(p.id).toBe('p1');
    });

    it('lists and deletes permissions', async () => {
      const fetchMock = mockFetch({ permissions: [{ id: 'p1', type: 'user', role: 'reader' }] });
      const client = createDriveClient(getToken);
      const list = await client.listPermissions('f1');
      expect(list).toHaveLength(1);
      expect(fetchMock.mock.calls[0][0]).toContain('/files/f1/permissions?');

      await client.deletePermission('f1', 'p1');
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toContain('/files/f1/permissions/p1');
      expect((init as RequestInit).method).toBe('DELETE');
    });

    it('toggles the view-only (no download) restriction', async () => {
      const fetchMock = mockFetch({});
      const client = createDriveClient(getToken);
      await client.setCopyRequiresWriterPermission('f1', true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/files/f1');
      expect((init as RequestInit).method).toBe('PATCH');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        copyRequiresWriterPermission: true,
      });
    });
  });
});
