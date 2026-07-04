// Thin wrapper over the Google Drive REST v3 API.
// Built as a factory that receives a token provider so it is trivially testable.

import { DRIVE_FOLDER_MIME } from '../config';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export type TokenProvider = () => Promise<string>;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}

export interface DriveClient {
  listFolders(parentId: string): Promise<DriveFile[]>;
  listChildren(parentId: string): Promise<DriveFile[]>;
  findFolderByName(name: string, parentId?: string): Promise<DriveFile | null>;
  createFolder(
    name: string,
    parentId?: string,
    appProperties?: Record<string, string>,
  ): Promise<DriveFile>;
  uploadFile(
    parentId: string,
    name: string,
    blob: Blob,
    appProperties?: Record<string, string>,
  ): Promise<DriveFile>;
  updateAppProperties(id: string, appProperties: Record<string, string>): Promise<void>;
  downloadFile(id: string): Promise<Blob>;
  deleteFile(id: string): Promise<void>;
}

export function createDriveClient(getToken: TokenProvider): DriveClient {
  async function authed(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive ${init.method ?? 'GET'} ${url} → ${res.status} ${body}`);
    }
    return res;
  }

  const FIELDS = 'files(id,name,mimeType,thumbnailLink,createdTime,appProperties,parents)';

  async function query(q: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q,
      fields: FIELDS,
      orderBy: 'createdTime desc',
      pageSize: '1000',
      spaces: 'drive',
    });
    const res = await authed(`${API}/files?${params.toString()}`);
    const data = await res.json();
    return (data.files ?? []) as DriveFile[];
  }

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return {
    listFolders(parentId) {
      return query(
        `'${esc(parentId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and trashed=false`,
      );
    },

    listChildren(parentId) {
      return query(`'${esc(parentId)}' in parents and trashed=false`);
    },

    async findFolderByName(name, parentId) {
      const parentClause = parentId ? `and '${esc(parentId)}' in parents ` : '';
      const files = await query(
        `name='${esc(name)}' and mimeType='${DRIVE_FOLDER_MIME}' ${parentClause}and trashed=false`,
      );
      return files[0] ?? null;
    },

    async createFolder(name, parentId, appProperties) {
      const res = await authed(`${API}/files?fields=id,name,mimeType,appProperties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: DRIVE_FOLDER_MIME,
          parents: parentId ? [parentId] : undefined,
          appProperties,
        }),
      });
      return (await res.json()) as DriveFile;
    },

    async uploadFile(parentId, name, blob, appProperties) {
      const metadata = { name, parents: [parentId], appProperties };
      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
      );
      form.append('file', blob);
      const res = await authed(
        `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,thumbnailLink,createdTime,appProperties`,
        { method: 'POST', body: form },
      );
      return (await res.json()) as DriveFile;
    },

    async updateAppProperties(id, appProperties) {
      await authed(`${API}/files/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appProperties }),
      });
    },

    async downloadFile(id) {
      const res = await authed(`${API}/files/${id}?alt=media`);
      return res.blob();
    },

    async deleteFile(id) {
      await authed(`${API}/files/${id}`, { method: 'DELETE' });
    },
  };
}
