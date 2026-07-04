// Public runtime configuration.
// The OAuth Client ID is PUBLIC by design (no secret ever ships to the browser).
// Set VITE_GOOGLE_CLIENT_ID in a local `.env` file or a GitHub Actions variable.

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

// Minimal Drive scope: the app can only touch files it created itself.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Requested OAuth scopes: profile/email only to show who is signed in,
// plus the minimal drive.file scope for storage.
export const AUTH_SCOPES = ['openid', 'email', 'profile', DRIVE_SCOPE].join(' ');

// Name of the single root folder the app creates in the user's Drive.
export const ROOT_FOLDER_NAME = 'Document Vault';

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export const isConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;
