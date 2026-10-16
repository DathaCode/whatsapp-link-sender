import type { Platform } from '../types';

/** Simple recognisable marks, drawn locally (no brand assets downloaded). */
export function PlatformIcon({ platform, size = 24 }: { platform: Platform; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (platform === 'youtube') {
    return (
      <svg {...common}>
        <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0033" />
        <path d="M10 8.8v6.4l5.6-3.2L10 8.8Z" fill="#fff" />
      </svg>
    );
  }
  if (platform === 'facebook') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10.5" fill="#1877F2" />
        <path
          d="M13.3 19.5v-5.6h1.9l.3-2.3h-2.2v-1.4c0-.7.2-1.1 1.1-1.1h1.2V7c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.6H8.9v2.3h1.9v5.6h2.5Z"
          fill="#fff"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#111" />
      <g strokeLinecap="round" fill="none" strokeWidth="2.1">
        <path d="M12.6 6.2v8.4a2.6 2.6 0 1 1-2.6-2.6" stroke="#25F4EE" transform="translate(-.7 -.5)" />
        <path d="M12.6 6.2c.3 1.9 1.7 3.2 3.6 3.4" stroke="#25F4EE" transform="translate(-.7 -.5)" />
        <path d="M12.6 6.2v8.4a2.6 2.6 0 1 1-2.6-2.6" stroke="#FE2C55" transform="translate(.7 .5)" />
        <path d="M12.6 6.2c.3 1.9 1.7 3.2 3.6 3.4" stroke="#FE2C55" transform="translate(.7 .5)" />
        <path d="M12.6 6.2v8.4a2.6 2.6 0 1 1-2.6-2.6" stroke="#fff" />
        <path d="M12.6 6.2c.3 1.9 1.7 3.2 3.6 3.4" stroke="#fff" />
      </g>
    </svg>
  );
}
