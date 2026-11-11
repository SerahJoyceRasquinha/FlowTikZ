/**
 * Small line icons drawn for FlowTikZ. Every icon is a 24x24 stroke drawing
 * in `currentColor`, so it follows the button's text colour on hover, when
 * active and when disabled.
 */
const PATHS: Record<string, React.ReactNode> = {
  /* Scientific tools */
  sigma: <path d="M18 5H6l6.5 7L6 19h12" />,
  bolt: (
    <>
      <circle cx="12" cy="12" r="2" />
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6.5L4.8 18.2A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.8L14 9.5V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  resistor: <path d="M2 12h4l1.5-4 3 8 3-8 3 8 1.5-4h4" />,
  molecule: (
    <>
      <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
      <circle cx="12" cy="12" r="3.6" />
    </>
  ),
  select: <path d="M5 3l14 8-6 1.6L10 19z" />,
  pan: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  connect: (
    <>
      <rect x="2.5" y="4" width="7" height="6" rx="1.5" />
      <rect x="14.5" y="14" width="7" height="6" rx="1.5" />
      <path d="M6 10v4.5a2.5 2.5 0 0 0 2.5 2.5H12" />
      <path d="M10.5 14.5L13 17l-2.5 2.5" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3" height="7" rx="0.8" />
      <rect x="10.5" y="6" width="3" height="12" rx="0.8" />
      <rect x="15.5" y="9" width="3" height="9" rx="0.8" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 3v8a6 6 0 0 0 12 0V3" />
      <path d="M6 7h3M15 7h3M9 3v8a3 3 0 0 0 6 0V3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  newFile: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </>
  ),
  eraser: (
    <>
      <path d="M8 20h12" />
      <path d="M4.5 14.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.5z" />
      <path d="M9 10l5 5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6" />
      <path d="M12 17.2v.3" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5.5 3.5-5.5 3.5z" fill="currentColor" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z" />
      <path d="M4 20a2 2 0 0 0 2 2h13v-4" />
    </>
  ),
  alignLeft: <path d="M4 3v18M8 7h10M8 12h6M8 17h12" />,
  alignCenterH: <path d="M12 3v18M6 7h12M8 12h8M5 17h14" />,
  alignRight: <path d="M20 3v18M6 7h10M10 12h6M4 17h12" />,
  alignTop: <path d="M3 4h18M7 8v10M12 8v6M17 8v12" />,
  alignCenterV: <path d="M3 12h18M7 6v12M12 8v8M17 5v14" />,
  alignBottom: <path d="M3 20h18M7 6v10M12 10v6M17 4v12" />,
  distH: (
    <>
      <path d="M4 4v16M20 4v16" />
      <rect x="9.5" y="8" width="5" height="8" rx="1" />
    </>
  ),
  distV: (
    <>
      <path d="M4 4h16M4 20h16" />
      <rect x="8" y="9.5" width="8" height="5" rx="1" />
    </>
  ),
  align: (
    <>
      <path d="M4 3v18" />
      <rect x="8" y="5" width="11" height="5" rx="1" />
      <rect x="8" y="14" width="7" height="5" rx="1" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  toFront: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity="0.25" />
      <path d="M15 5V4H4v11h1" />
    </>
  ),
  toBack: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity="0.25" />
      <path d="M19 9h1v11H9v-1" />
    </>
  ),
  forward: <path d="M12 19V5M6 11l6-6 6 6" />,
  backward: <path d="M12 5v14M6 13l6 6 6-6" />,
  group: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.5" />
      <rect x="7" y="7" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  sparkles: (
    <>
      <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
      <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  dots: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  wand: (
    <>
      <path d="M4 20L15 9" />
      <path d="M15 4v2M19 8h2M18 5l1.5-1.5M20 11l-1-1M13 5l-1-1" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, stroke = 1.9 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
