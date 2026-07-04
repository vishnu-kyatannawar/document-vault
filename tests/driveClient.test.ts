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
});
