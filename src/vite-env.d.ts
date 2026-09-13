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
