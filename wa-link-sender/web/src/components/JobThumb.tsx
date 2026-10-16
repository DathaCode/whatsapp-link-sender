import { ImageOff, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import type { Job, Platform } from '../types';
import { PlatformIcon } from './PlatformIcon';

const OLD_PLATFORMS: Platform[] = ['facebook', 'tiktok', 'youtube'];

/** Small square for a send: its image (or "image expired"), a platform icon for old link-only sends, or a message icon. */
export function JobThumb({ job, size = 44 }: { job: Job; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };
  if (job.imageId) {
    return broken ? (
      <span style={box} className="grid shrink-0 place-items-center rounded-lg bg-surface-2 text-muted" title="Image expired">
        <ImageOff className="size-5" aria-label="Image expired" />
      </span>
    ) : (
      <img
        src={`/api/uploads/${job.imageId}`}
        alt=""
        style={box}
        className="shrink-0 rounded-lg object-cover ring-1 ring-line"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  if (OLD_PLATFORMS.includes(job.platform as Platform)) return <PlatformIcon platform={job.platform as Platform} size={Math.round(size * 0.65)} />;
  return (
    <span style={box} className="grid shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
      <MessageSquareText className="size-5" aria-hidden />
    </span>
  );
}

/** The text that was (or will be) sent: new sends store it; old sends only had a URL. */
export const jobText = (job: Job) => job.messageText ?? job.url;
