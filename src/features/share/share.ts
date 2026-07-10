// Sharing + download helpers.

export interface ShareableFile {
  filename: string;
  mimeType: string;
  blob: Blob;
}

function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator.canShare === 'function' && navigator.canShare({ files })
  );
}

/**
 * Share a document file via the OS share sheet (WhatsApp, etc.).
 * Falls back to a wa.me text link when file sharing is unsupported (desktop).
 * @returns 'shared' | 'fallback'
 */
export async function shareFile(item: ShareableFile, title: string): Promise<'shared' | 'fallback'> {
  const file = new File([item.blob], item.filename, { type: item.mimeType });

  if (navigator.share && canShareFiles([file])) {
    await navigator.share({ files: [file], title, text: title });
    return 'shared';
  }

  // Desktop fallback: open WhatsApp with a text message (files can't be attached
  // via URL). The user still has the file downloaded to attach manually.
  downloadFile(item);
  const text = encodeURIComponent(`Sharing document: ${title}`);
  window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  return 'fallback';
}

/**
 * Share via the OS sheet when possible (mobile), otherwise plain download.
 * Unlike shareFile there is no WhatsApp fallback — used for backups/exports.
 * @returns 'shared' | 'downloaded'
 */
export async function shareOrDownload(
  item: ShareableFile,
  title: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([item.blob], item.filename, { type: item.mimeType });
  if (navigator.share && canShareFiles([file])) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  downloadFile(item);
  return 'downloaded';
}

/** Trigger a browser download of the blob. */
export function downloadFile(item: ShareableFile): void {
  const url = URL.createObjectURL(item.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
