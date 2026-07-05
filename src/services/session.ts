// Sign-out cleanup: wipe everything cached locally so a different account
// signing in on the same device never sees stale data (documents list, root
// folder id, generated thumbnails).

import { useDocumentsStore } from '../store/documentsStore';
import { documents } from './vault';
import { cacheClear } from './thumbCache';
import { clearThumbnailMemory } from './thumbnails';

export async function resetLocalData(): Promise<void> {
  documents.invalidateRoot();
  clearThumbnailMemory();
  useDocumentsStore.setState({ items: [], loading: false, error: null });
  await cacheClear();
}
