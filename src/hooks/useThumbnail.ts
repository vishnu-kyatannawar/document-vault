import { useEffect, useState } from 'react';
import { DocumentPart } from '../services/documentsService';
import { getThumbnail } from '../services/thumbnails';
import { logger } from '../services/logger';

/** Loads a cached preview for a document part (or null while loading / on error). */
export function useThumbnail(part?: DocumentPart): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    if (!part) {
      setFailed(true);
      return;
    }
    getThumbnail(part)
      .then((u) => active && setUrl(u))
      .catch((e) => {
        logger.error(`Thumbnail failed for "${part.name}" (${part.mimeType})`, e as Error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [part?.id]);

  return { url, failed };
}
