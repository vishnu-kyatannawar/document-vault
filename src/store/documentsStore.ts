import { create } from 'zustand';
import { DocMeta, NewPart, VaultDocument, VaultGroup } from '../services/documentsService';
import { documents as service } from '../services/vault';
import { logger } from '../services/logger';

/** Level key for the vault root (other levels are keyed by group id). */
export const ROOT_KEY = 'root';

const toParentId = (key: string): string | undefined =>
  key === ROOT_KEY ? undefined : key;

export interface LevelState {
  groups: VaultGroup[];
  documents: VaultDocument[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

interface DocumentsState {
  levels: Record<string, LevelState>;
  /** Group display names for headers, filled as levels load. */
  groupNames: Record<string, string>;
  loadLevel: (key: string) => Promise<void>;
  /** Mark a level stale so it reloads next time it is shown. */
  invalidateLevel: (key: string) => void;
  /** Invalidate by a Drive parent folder id (root id unknown → also root). */
  invalidateForParent: (parentId: string) => void;
  setGroupName: (id: string, name: string) => void;
  createGroup: (key: string, name: string) => Promise<void>;
  renameGroup: (key: string, id: string, name: string) => Promise<void>;
  deleteGroup: (key: string, id: string) => Promise<void>;
  createDocument: (
    key: string,
    title: string,
    parts: NewPart[],
    meta?: DocMeta,
  ) => Promise<void>;
  /** Move a doc/group between level keys ('root' or group ids). */
  moveItem: (id: string, fromKey: string, toKey: string) => Promise<void>;
}

const emptyLevel: LevelState = {
  groups: [],
  documents: [],
  loading: false,
  loaded: false,
  error: null,
};

export const useDocumentsStore = create<DocumentsState>((set, get) => {
  const patchLevel = (key: string, patch: Partial<LevelState>) =>
    set((s) => ({
      levels: { ...s.levels, [key]: { ...(s.levels[key] ?? emptyLevel), ...patch } },
    }));

  return {
    levels: {},
    groupNames: {},

    loadLevel: async (key) => {
      patchLevel(key, { loading: true, error: null });
      try {
        const level = await service.listLevel(toParentId(key));
        const names = Object.fromEntries(level.groups.map((g) => [g.id, g.name]));
        set((s) => ({ groupNames: { ...s.groupNames, ...names } }));
        patchLevel(key, {
          groups: level.groups,
          documents: level.documents,
          loading: false,
          loaded: true,
        });
      } catch (e) {
        logger.error(`Level load failed (${key})`, e as Error);
        patchLevel(key, { loading: false, error: (e as Error).message });
      }
    },

    invalidateLevel: (key) => {
      const level = get().levels[key];
      if (level) patchLevel(key, { loaded: false });
    },

    invalidateForParent: (parentId) => {
      const { invalidateLevel } = get();
      invalidateLevel(parentId);
      // The root level is keyed 'root', not by its Drive id — when the parent
      // id is unknown to us it may be the root, so invalidate that too.
      if (!get().levels[parentId]) invalidateLevel(ROOT_KEY);
    },

    setGroupName: (id, name) =>
      set((s) => ({ groupNames: { ...s.groupNames, [id]: name } })),

    createGroup: async (key, name) => {
      const group = await service.createGroup(name.trim(), toParentId(key));
      get().setGroupName(group.id, group.name);
      const level = get().levels[key] ?? emptyLevel;
      patchLevel(key, {
        groups: [...level.groups, group].sort((a, b) => a.name.localeCompare(b.name)),
      });
    },

    renameGroup: async (key, id, name) => {
      await service.renameGroup(id, name.trim());
      get().setGroupName(id, name.trim());
      const level = get().levels[key] ?? emptyLevel;
      patchLevel(key, {
        groups: level.groups
          .map((g) => (g.id === id ? { ...g, name: name.trim() } : g))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    },

    deleteGroup: async (key, id) => {
      await service.deleteGroup(id);
      const level = get().levels[key] ?? emptyLevel;
      patchLevel(key, { groups: level.groups.filter((g) => g.id !== id) });
    },

    createDocument: async (key, title, parts, meta) => {
      const doc = await service.createDocument(title, parts, toParentId(key), meta);
      const level = get().levels[key] ?? emptyLevel;
      patchLevel(key, { documents: [doc, ...level.documents] });
    },

    moveItem: async (id, fromKey, toKey) => {
      await service.moveItem(id, toParentId(fromKey), toParentId(toKey));
      const { levels, invalidateLevel } = get();
      const from = levels[fromKey];
      if (from) {
        // Optimistically remove from the source so the UI updates instantly.
        patchLevel(fromKey, {
          groups: from.groups.filter((g) => g.id !== id),
          documents: from.documents.filter((d) => d.id !== id),
        });
      }
      invalidateLevel(toKey);
    },
  };
});
