/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

// Injected at build time (vite.config.ts `define`).
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Google Identity Services (loaded from https://accounts.google.com/gsi/client)
interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: '' | 'none' | 'consent' }) => void;
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (resp: TokenResponse) => void;
          error_callback?: (err: { type: string }) => void;
        }) => TokenClient;
        revoke: (token: string, done?: () => void) => void;
      };
    };
  };
}
