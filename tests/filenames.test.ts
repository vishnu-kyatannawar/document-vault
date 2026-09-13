import { describe, expect, it } from 'vitest';
import { extensionOf, slugFilename } from '../src/services/filenames';
import { suggestFilename } from '../src/features/capture/capture';

describe('filenames', () => {
  it('keeps an existing extension, case intact', () => {
    expect(extensionOf('front.jpg')).toBe('.jpg');
    expect(extensionOf('IMG_0001.JPG')).toBe('.JPG');
    expect(extensionOf('scan.final.pdf')).toBe('.pdf');
  });

  it('derives the extension from the mime type when the name has none', () => {
    expect(extensionOf('blob', 'application/pdf')).toBe('.pdf');
    expect(extensionOf('blob', 'image/jpeg')).toBe('.jpg');
    expect(extensionOf('blob')).toBe('.jpg');
    expect(extensionOf('.hidden')).toBe('.jpg');
  });

  it('slugifies labels', () => {
    expect(slugFilename('Back side', '.jpg')).toBe('back-side.jpg');
    expect(slugFilename('Page 2', '.pdf')).toBe('page-2.pdf');
    expect(slugFilename('Passport – Réné!', '.jpg')).toBe('passport-r-n-.jpg');
  });

  it('suggestFilename combines both for a picked file', () => {
    const jpg = new File(['x'], 'IMG_1.jpeg', { type: 'image/jpeg' });
    const pdf = new File(['x'], 'noext', { type: 'application/pdf' });
    expect(suggestFilename('Front', jpg)).toBe('front.jpeg');
    expect(suggestFilename('Page 3', pdf)).toBe('page-3.pdf');
  });
});
