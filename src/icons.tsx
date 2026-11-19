// Small stroke icons and the logo, drawn inline so they follow the theme colour.
import React from "react";

type P = { size?: number };

const S = ({ size = 18, children, sw = 1.8 }: P & { children: React.ReactNode; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconPlus = (p: P) => <S {...p} sw={2}><path d="M12 5v14M5 12h14" /></S>;
export const IconMinus = (p: P) => <S {...p} sw={2}><path d="M5 12h14" /></S>;
export const IconX = (p: P) => <S {...p} sw={2}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IconUpload = (p: P) => <S {...p} sw={2}><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></S>;
export const IconPaste = (p: P) => (
  <S {...p}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 11h6M9 15h4" /></S>
);
export const IconLock = (p: P) => (
  <S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>
);
export const IconUnlock = (p: P) => (
  <S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></S>
);
export const IconCopy = (p: P) => (
  <S {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></S>
);
export const IconTrash = (p: P) => <S {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>;
export const IconDots = (p: P) => (
  <S {...p} sw={2.6}><path d="M5 12h.01M12 12h.01M19 12h.01" /></S>
);
export const IconFocus = (p: P) => (
  <S {...p}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><rect x="9" y="9" width="6" height="6" rx="1" /></S>
);
export const IconSwap = (p: P) => <S {...p}><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></S>;
export const IconDrop = (p: P) => (
  <S {...p}><path d="M14.5 4.5l5 5M17 7l-9.5 9.5L5 19l2.5-2.5M12 7l5 5" /></S>
);
export const IconShuffle = (p: P) => (
  <S {...p}><path d="M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c1.5 0 2.6-.9 3.4-2M13.6 9C14.4 7.9 15.5 7 17 7h3M17 4l3 3-3 3" /></S>
);
export const IconImage = (p: P) => (
  <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></S>
);
export const IconSwatches = (p: P) => (
  <S {...p}><rect x="3" y="6" width="5" height="12" rx="1" /><rect x="9.5" y="6" width="5" height="12" rx="1" /><rect x="16" y="6" width="5" height="12" rx="1" /></S>
);
export const IconEdit = (p: P) => <S {...p}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></S>;
export const IconCheck = (p: P) => <S {...p} sw={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>;
export const IconGray = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="8" /><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></S>
);
export const IconArtwork = (p: P) => (
  <S {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><rect x="9" y="12" width="3" height="3" /><rect x="13" y="12" width="3" height="3" /></S>
);

export const IconArrowLeft = (p: P) => <S {...p} sw={2}><path d="M19 12H5M11 6l-6 6 6 6" /></S>;
export const IconSliders = (p: P) => (
  <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>
);
export const IconSun = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>
);
export const IconMoon = (p: P) => <S {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></S>;
export const IconGear = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></S>
);

export const IconReset = (p: P) => <S {...p}><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" /></S>;
export const IconShare = (p: P) => <S {...p}><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></S>;
export const IconChevron = (p: P) => <S {...p} sw={2.2}><path d="M9 6l6 6-6 6" /></S>;
export const IconText = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" fillRule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm1.5 4.5v2.2h3.3V17h2.4V9.7h3.3V7.5z" />
  </svg>
);
export const IconWheel = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M12 10V4M13.7 13l5 3M10.3 13l-5 3" /></S>
);
export const IconEye = (p: P) => (
  <S {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>
);
// App icon by Anderson Santos: four colour stripes and the B on amber (assets/logo.svg).
export function Logo({ size = 36 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 136.64 136.64" role="img" aria-label="Buni Palette logo" style={{ display: "block", borderRadius: 6, flex: "0 0 auto" }}>
      <rect fill="#FFBF00" width="136.64" height="136.64" />
      <path
        fill="#343434"
        d="M111.71,55.58c.74-.74,1.16-1.75,1.16-2.81v-13c0-1.06-.4-1.99-1.18-2.78l-13.9-13.9c-.75-.74-1.67-1.11-2.79-1.11h-41.24s0,0,0,0v92.69h41.24c1.11,0,2.04-.38,2.79-1.11l13.9-13.91c.79-.79,1.18-1.71,1.18-2.78v-13c0-1.05-.42-2.06-1.16-2.81l-9.93-9.93c-1.55-1.55-1.55-4.06,0-5.61l9.94-9.94ZM89.72,54.73l-10.78,10.78c-1.55,1.55-1.55,4.06,0,5.61l10.78,10.78v14.26h-12.8v-55.7h12.8v14.26Z"
      />
      <rect fill="#343434" x="15.3" y="76.2" width="23.17" height="53.77" transform="translate(-76.2 129.96) rotate(-90)" />
      <rect fill="#FFBF00" x="15.3" y="53.02" width="23.17" height="53.77" transform="translate(-53.02 106.79) rotate(-90)" />
      <rect fill="#EDEBE8" x="15.3" y="29.85" width="23.17" height="53.77" transform="translate(-29.85 83.62) rotate(-90)" />
      <rect fill="#FF4242" x="15.3" y="6.68" width="23.17" height="53.77" transform="translate(-6.68 60.44) rotate(-90)" />
    </svg>
  );
}
export const IconSearch = (p: P) => <S {...p} sw={2}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></S>;
