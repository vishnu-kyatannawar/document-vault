import { afterEach, describe, expect, it, vi } from 'vitest';
import { driveFileUrl, driveFolderUrl, openInDrive } from '../src/services/driveLinks';

describe('driveLinks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds folder and file viewer URLs from raw Drive ids', () => {
    expect(driveFolderUrl('1AbC_-xyz')).toBe('https://drive.google.com/drive/folders/1AbC_-xyz');
    expect(driveFileUrl('9zYx')).toBe('https://drive.google.com/file/d/9zYx/view');
  });

  it('URL-encodes ids defensively', () => {
    expect(driveFolderUrl('a/b?c')).toBe('https://drive.google.com/drive/folders/a%2Fb%3Fc');
  });

  it('opens links in a new tab without an opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInDrive('https://drive.google.com/drive/folders/x');
    expect(open).toHaveBeenCalledWith(
      'https://drive.google.com/drive/folders/x',
      '_blank',
      'noopener',
    );
  });
});
