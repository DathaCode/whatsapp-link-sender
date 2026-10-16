import { CheckCheck } from 'lucide-react';
import { WhatsAppText } from '../waFormat';

/**
 * An outgoing WhatsApp message bubble (green, tail top-right, time + blue double ticks),
 * optionally with an image on top, the way WhatsApp shows a captioned photo.
 */
export function ChatBubble({ text, links = [], imageUrl = null, wallpaper = true }: { text: string; links?: string[]; imageUrl?: string | null; wallpaper?: boolean }) {
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  return (
    <div className={wallpaper ? 'wallpaper rounded-xl px-3 py-5 sm:px-5' : ''}>
      <div className={`relative ml-auto w-fit max-w-[min(88%,26rem)] rounded-lg rounded-tr-none bg-bubble-out text-ink shadow-sm ${imageUrl ? 'p-1' : 'px-3 pt-2 pb-1.5'}`}>
        <svg viewBox="0 0 8 13" width="8" height="13" className="absolute top-0 -right-2 text-bubble-out" aria-hidden>
          <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
        </svg>
        {imageUrl && <img src={imageUrl} alt="Attached image" className="block max-h-96 w-full rounded-md object-cover" />}
        <div className={imageUrl ? 'px-2 pt-1.5 pb-1' : ''}>
          {text && (
            <span className="font-message text-[15px] leading-[1.45] break-words whitespace-pre-wrap">
              <WhatsAppText text={text} links={links} />
            </span>
          )}
          <span className="float-right mt-1.5 ml-3 inline-flex translate-y-0.5 items-center gap-1 text-[11px] text-ink/60">
            {time}
            <CheckCheck className="size-4 text-tick" aria-label="Read" />
          </span>
        </div>
      </div>
    </div>
  );
}
