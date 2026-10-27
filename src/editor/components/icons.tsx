import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16, props: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

const make = (paths: JSX.Element) => ({ size, ...props }: P) => <svg {...base(size, props)}>{paths}</svg>;

export const IconPlay = make(<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />);
export const IconPause = make(
  <>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </>,
);
export const IconRestart = make(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </>,
);
export const IconStep = make(
  <>
    <path d="M6 5v14l9-7z" fill="currentColor" stroke="none" />
    <path d="M18 5v14" />
  </>,
);
export const IconUndo = make(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);
export const IconRedo = make(
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>,
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconTrash = make(
  <>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </>,
);
export const IconCopy = make(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </>,
);
export const IconEye = make(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(
  <>
    <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3" />
  </>,
);
export const IconSparkle = make(<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />);
export const IconGrid = make(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);
export const IconDownload = make(
  <>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>,
);
export const IconUpload = make(
  <>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>,
);
export const IconLink = make(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>,
);
export const IconCamera = make(
  <>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </>,
);
export const IconRecord = make(<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />);
export const IconStop = make(<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />);
export const IconCursor = make(<path d="M5 3l14 7-6 2-2 6z" />);
export const IconMagnet = make(
  <>
    <path d="M6 3v8a6 6 0 0 0 12 0V3" />
    <path d="M6 7h4M14 7h4" />
  </>,
);
export const IconBurst = make(<path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.5 3.5M15.6 15.6l3.5 3.5M4.9 19.1l3.5-3.5M15.6 8.4l3.5-3.5" />);
export const IconSwirl = make(<path d="M12 12a2 2 0 1 1 2 2 4 4 0 0 1-4-4 6 6 0 0 1 6-6 8 8 0 0 1 0 16 10 10 0 0 1-10-10" />);
export const IconBrush = make(
  <>
    <path d="M14 4l6 6-9 9H5v-6z" />
    <path d="M12 6l6 6" />
  </>,
);
export const IconEraser = make(
  <>
    <path d="M16 3l5 5-10 10H6l-3-3z" />
    <path d="M9 21h12" />
  </>,
);
export const IconSpray = make(
  <>
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="10" cy="4" r="1" fill="currentColor" />
    <circle cx="4" cy="10" r="1" fill="currentColor" />
    <rect x="9" y="9" width="8" height="12" rx="2" />
    <path d="M11 9V6h4v3" />
  </>,
);
export const IconChart = make(<path d="M3 20h18M6 16l4-5 3 3 5-7" />);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const IconKeyframe = make(<path d="M12 3l9 9-9 9-9-9z" />);
export const IconChevron = make(<path d="M9 6l6 6-6 6" />);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconDice = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </>,
);
export const IconDna = make(<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12M8 7h8M8 17h8M10 12h4" />);
export const IconMaximize = make(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconMic = make(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const IconMusic = make(
  <>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </>,
);
export const IconSave = make(
  <>
    <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M8 3v5h7V3M8 21v-7h8v7" />
  </>,
);
export const IconCompare = make(<path d="M12 3v18M5 7h4v10H5zM15 7h4v10h-4z" />);
export const IconCommand = make(<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />);
export const IconEmitter = make(
  <>
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </>,
);
export const IconForce = make(<path d="M3 12h13M12 6l6 6-6 6M21 4v16" />);
export const IconScene = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
  </>,
);
export const IconWand = make(<path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20l10-10M18.5 4.5l1-1M18.5 7.5l1 1" />);
export const IconKeyboard = make(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </>,
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </>,
);
