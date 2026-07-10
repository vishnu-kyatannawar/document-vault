// App-wide service singletons, wired to the auth store's token provider.
import { useAuthStore } from '../store/authStore';
import { createDriveClient } from './driveClient';
import { createDocumentsService } from './documentsService';
import { createTransferService } from './transferService';

const driveClient = createDriveClient(
  () => useAuthStore.getState().getAccessToken(),
  // On a 401 the client drops the cached token and retries once fresh.
  () => useAuthStore.getState().invalidateToken(),
);

export const documents = createDocumentsService(driveClient);
export const transfer = createTransferService(documents);
