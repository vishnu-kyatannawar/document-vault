import { create } from 'zustand';
import { NewPart, VaultDocument } from '../services/documentsService';
import { documents as service } from '../services/vault';

interface DocumentsState {
  items: VaultDocument[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (title: string, category: string, parts: NewPart[]) => Promise<void>;
  addPart: (documentId: string, part: NewPart) => Promise<void>;
  removePart: (documentId: string, fileId: string) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const items = await service.listDocuments();
      set({ items, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  create: async (title, category, parts) => {
    const doc = await service.createDocument(title, category, parts);
    set({ items: [doc, ...get().items] });
  },

  addPart: async (documentId, part) => {
    const newPart = await service.addPart(documentId, part);
    set({
      items: get().items.map((d) =>
        d.id === documentId ? { ...d, parts: [...d.parts, newPart] } : d,
      ),
    });
  },

  removePart: async (documentId, fileId) => {
    await service.deletePart(fileId);
    set({
      items: get().items.map((d) =>
        d.id === documentId
          ? { ...d, parts: d.parts.filter((p) => p.id !== fileId) }
          : d,
      ),
    });
  },

  remove: async (documentId) => {
    await service.deleteDocument(documentId);
    set({ items: get().items.filter((d) => d.id !== documentId) });
  },
}));
