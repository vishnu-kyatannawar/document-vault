// File acquisition helpers. Uses a hidden <input type="file"> which, on mobile
// browsers, transparently supports camera capture, gallery and file storage.

export type CaptureSource = 'camera' | 'gallery' | 'files';

const ACCEPT: Record<CaptureSource, string> = {
  camera: 'image/*',
  gallery: 'image/*',
  files: 'image/*,application/pdf',
};

/**
 * Open the native picker for the given source and resolve with the chosen files.
 * Resolves with an empty array if the user cancels.
 */
export function pickFiles(source: CaptureSource, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[source];
    input.multiple = multiple;
    // `capture` hints the OS to open the rear camera directly.
    if (source === 'camera') input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.onchange = () => done(input.files ? Array.from(input.files) : []);
    // Fallback: if focus returns with no selection, treat as cancel.
    window.addEventListener(
      'focus',
      () => setTimeout(() => done([]), 500),
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

/** Suggest a filename for a captured/selected file, keeping the extension. */
export function suggestFilename(label: string, file: File): string {
  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.'))
    : file.type === 'application/pdf'
      ? '.pdf'
      : '.jpg';
  const safe = label.replace(/[^\w-]+/g, '-').toLowerCase();
  return `${safe}${ext}`;
}
