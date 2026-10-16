import { CheckCheck } from 'lucide-react';

/** An outgoing WhatsApp message bubble (green, tail top-right, time + blue double ticks). */
export function ChatBubble({ text }: { text: string }) {
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  return (
    <div className="wallpaper rounded-xl px-4 py-5">
      <div className="relative ml-auto w-fit max-w-[88%] rounded-lg rounded-tr-none bg-bubble-out px-3 pt-2 pb-1.5 text-[15px] text-ink shadow-sm">
        <svg viewBox="0 0 8 13" width="8" height="13" className="absolute top-0 -right-2 text-bubble-out" aria-hidden>
          <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
        </svg>
        <span className="break-words whitespace-pre-wrap">{text}</span>
        <span className="float-right mt-1.5 ml-3 inline-flex translate-y-0.5 items-center gap-1 text-[11px] text-ink/60">
          {time}
          <CheckCheck className="size-4 text-tick" aria-label="Read" />
        </span>
      </div>
    </div>
  );
}
