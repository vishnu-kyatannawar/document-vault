// Keeps the installed PWA fresh.
//
// The service worker is registered with skipWaiting + clientsClaim, so a new
// build takes over as soon as it is fetched; the register helper then reloads
// the page (registerType 'autoUpdate'). The gap is *when* the browser checks
// for a new SW — by default only on navigation, which installed PWAs rarely
// do. So we also check: on app resume (foreground), and every 15 minutes.

import { registerSW } from 'virtual:pwa-register';
import { logger } from './logger';

export const APP_VERSION = __APP_VERSION__;
export const BUILD_DATE = __BUILD_DATE__;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;

export function initAppUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  try {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, r) {
        registration = r;
        if (!r) return;
        setInterval(() => void r.update().catch(() => undefined), CHECK_INTERVAL_MS);
        // Installed PWAs mostly sit in the background — check on every resume
        // so new deployments show up the moment the app is reopened.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void r.update().catch(() => undefined);
        });
      },
      onRegisterError(e) {
        logger.error('SW registration failed', e as Error);
      },
    });
  } catch (e) {
    logger.error('SW register threw', e as Error);
  }
}

/**
 * Manual "check for updates". Resolves:
 *  - 'updating'    a newer build was found and is installing — the page will
 *                  reload by itself in a moment
 *  - 'current'     already on the latest build
 *  - 'unsupported' no service worker (e.g. dev mode)
 */
export async function checkForUpdate(): Promise<'updating' | 'current' | 'unsupported'> {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch (e) {
    logger.warn('Update check failed', { error: (e as Error).message });
    return 'current';
  }
  return registration.installing || registration.waiting ? 'updating' : 'current';
}
