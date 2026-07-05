// Persistent offline log for debugging in the field. Keeps a ring buffer of
// log lines in localStorage (capped ~1MB, oldest dropped first) and captures
// uncaught errors, unhandled rejections and console.error/warn automatically.
// The user can download the whole buffer as a text file from the profile menu.

const STORAGE_KEY = 'vault.logs.v1';
const MAX_BYTES = 1_000_000;
const FLUSH_DELAY_MS = 400;

type Level = 'info' | 'warn' | 'error';

let lines: string[] = [];
let size = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Quota exceeded — drop the older half and try once more.
    lines = lines.slice(Math.floor(lines.length / 2));
    size = lines.reduce((n, l) => n + l.length + 1, 0);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* give up silently — logging must never break the app */
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persist();
  }, FLUSH_DELAY_MS);
}

function fmt(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function log(level: Level, ...args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${args
    .map(fmt)
    .join(' ')}`;
  lines.push(line);
  size += line.length + 1;
  while (size > MAX_BYTES && lines.length > 0) {
    size -= lines[0].length + 1;
    lines.shift();
  }
  scheduleFlush();
}

export const logger = {
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};

export function getLogsText(): string {
  return lines.join('\n');
}

export function clearLogs(): void {
  lines = [];
  size = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Trigger a browser download of the current log buffer. */
export function downloadLogs(): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([getLogsText()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vault-logs-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Install once at startup: restores the persisted buffer + global capture. */
export function initLogger(): void {
  if (installed) return;
  installed = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      lines = JSON.parse(raw) as string[];
      size = lines.reduce((n, l) => n + l.length + 1, 0);
    }
  } catch {
    lines = [];
    size = 0;
  }

  log('info', `--- session start · ${navigator.userAgent} ---`);

  window.addEventListener('error', (e) => {
    log('error', 'uncaught:', e.message, `${e.filename ?? '?'}:${e.lineno ?? '?'}`,
      e.error instanceof Error ? e.error : '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    log('error', 'unhandled rejection:', e.reason instanceof Error ? e.reason : fmt(e.reason));
  });

  // Mirror console.error/warn into the buffer without changing their behaviour.
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    log('error', ...args);
    origError(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    log('warn', ...args);
    origWarn(...args);
  };
}
