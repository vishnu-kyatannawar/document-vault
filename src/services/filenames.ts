// Filename helpers shared by capture (upload) and rename (Drive file name).

/** Extension (with dot) of an existing filename, else derived from mime type. */
export function extensionOf(name: string, mimeType?: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot);
  return mimeType === 'application/pdf' ? '.pdf' : '.jpg';
}

/** Slugified label + extension, e.g. ('Back side', '.jpg') → 'back-side.jpg'. */
export function slugFilename(label: string, ext: string): string {
  const safe = label.replace(/[^\w-]+/g, '-').toLowerCase();
  return `${safe}${ext}`;
}
