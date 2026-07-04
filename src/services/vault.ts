// App-wide service singletons, wired to the auth store's token provider.
import { useAuthStore } from '../store/authStore';
import { createDriveClient } from './driveClient';
import { createDocumentsService } from './documentsService';

const driveClient = createDriveClient(() => useAuthStore.getState().getAccessToken());

export const documents = createDocumentsService(driveClient);
