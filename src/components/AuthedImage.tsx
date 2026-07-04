import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface Props {
  /** A Drive URL that requires the bearer token (e.g. thumbnailLink or alt=media). */
  src?: string;
  alt: string;
  className?: string;
}

/**
 * Fetches an authenticated Drive image with the access token and renders it via
 * an object URL. Drive image links cannot be used directly in <img src>.
 */
export default function AuthedImage({ src, alt, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let active = true;
    setUrl(null);
    setFailed(false);

    if (!src) {
      setFailed(true);
      return;
    }

    (async () => {
      try {
        const token = await useAuthStore.getState().getAccessToken();
        const res = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!active) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src]);

  if (failed) return null;
  if (!url) return <div className={className} data-loading="true" />;
  return <img className={className} src={url} alt={alt} />;
}
