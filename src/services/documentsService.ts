// Domain layer: turns the folder-per-document Drive layout into Vault documents.
//
// Layout in Drive:
//   "Document Vault"/                 (root, cached id)
//     <Document folder>               (appProperties: title, category, createdAt)
//       <part file>                   (appProperties: label)  e.g. Front / Back

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

export interface VaultDocument {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  parts: DocumentPart[];
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
  listDocuments(): Promise<VaultDocument[]>;
  createDocument(title: string, category: string, parts: NewPart[]): Promise<VaultDocument>;
  addPart(documentId: string, part: NewPart): Promise<DocumentPart>;
  deletePart(fileId: string): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  getPartBlob(fileId: string): Promise<Blob>;
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

  return {
    ensureRoot,

    invalidateRoot() {
      rootIdPromise = null;
      localStorage.removeItem(ROOT_CACHE_KEY);
    },

    async listDocuments() {
      const rootId = await ensureRoot();
      const folders = await drive.listFolders(rootId);
      const docs = await Promise.all(
        folders.map(async (folder): Promise<VaultDocument> => {
          const children = await drive.listChildren(folder.id);
          return {
            id: folder.id,
            title: folder.appProperties?.title ?? folder.name,
            category: folder.appProperties?.category ?? 'Other',
            createdAt: folder.appProperties?.createdAt ?? folder.createdTime ?? '',
            parts: children.map(toPart),
          };
        }),
      );
      return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async createDocument(title, category, parts) {
      const rootId = await ensureRoot();
      const createdAt = new Date().toISOString();
      const folder = await drive.createFolder(title, rootId, { title, category, createdAt });
      const uploaded = await Promise.all(
        parts.map((p) =>
          drive.uploadFile(folder.id, p.filename, p.blob, { label: p.label }),
        ),
      );
      return {
        id: folder.id,
        title,
        category,
        createdAt,
        parts: uploaded.map(toPart),
      };
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
  };
}
