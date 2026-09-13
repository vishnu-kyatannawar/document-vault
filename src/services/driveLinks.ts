// Deep links into the Google Drive UI. Every id the app holds is a raw Drive
// file/folder id, so links are built locally — no extra API call or scope.
// With the Drive app installed on Android/iOS these https links open in-app.

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/** Open a Drive link in a new tab. The CSP forbids framing Drive in-app. */
export function openInDrive(url: string): void {
  window.open(url, '_blank', 'noopener');
}
