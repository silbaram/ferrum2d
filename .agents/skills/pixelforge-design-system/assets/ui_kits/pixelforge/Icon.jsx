/* global React */
// Pixelforge — Icon primitive.
// Wraps lucide-style stroke icons. 16px default, 1.75 stroke.
// Pass `name` (a known key) or `children` (raw SVG path nodes).
const ICONS = {
  // file system
  folder:   <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
  file:     <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
  // editor
  play:     <><polygon points="6 4 20 12 6 20 6 4"/></>,
  pause:    <><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></>,
  stop:     <><rect x="6" y="6" width="12" height="12"/></>,
  // tools
  cursor:   <><path d="M5 3l6 18 3-8 8-3z"/></>,
  move:     <><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></>,
  rotate:   <><path d="M21 12a9 9 0 1 1-3.5-7.1"/><polyline points="21 4 21 9 16 9"/></>,
  scale:    <><path d="M3 3h7v2H5v5H3zM21 21h-7v-2h5v-5h2zM21 3l-9 9M3 21l9-9"/></>,
  rect:     <><rect x="4" y="4" width="16" height="16"/></>,
  // activity bar
  layers:   <><polygon points="12 2 22 8 12 14 2 8 12 2"/><polyline points="2 16 12 22 22 16"/><polyline points="2 12 12 18 22 12"/></>,
  files:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
  search:   <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></>,
  git:      <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v6a4 4 0 0 0 4 4h2"/><path d="M18 8v2a4 4 0 0 1-4 4h-2"/></>,
  plug:     <><path d="M9 2v6M15 2v6M5 8h14v3a7 7 0 0 1-14 0z"/><path d="M12 18v4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  // misc
  plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  more:     <><circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/></>,
  x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  chev:     <><polyline points="9 18 15 12 9 6"/></>,
  zoomIn:   <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></>,
  zoomOut:  <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/><line x1="8" y1="11" x2="14" y2="11"/></>,
  grid:     <><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></>,
  snap:     <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
  trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V3h6v3"/></>,
  cmd:      <><path d="M9 9h6v6H9z"/><path d="M9 9a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"/><path d="M15 9a3 3 0 1 0 3-3 3 3 0 0 0-3 3z"/><path d="M9 15a3 3 0 1 0-3 3 3 3 0 0 0 3-3z"/><path d="M15 15a3 3 0 1 1 3 3 3 3 0 0 1-3-3z"/></>,
  bug:      <><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M9 9l-3-2M15 9l3-2M9 14H5M15 14h4M9 19l-3 2M15 19l3 2M12 6V3"/></>,
  music:    <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
  terminal: <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
};

function Icon({ name, size = 16, stroke = 1.75, className = "", style }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      className={`ico-svg ${className}`}
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round"
      style={style}
    >
      {body}
    </svg>
  );
}

window.Icon = Icon;
