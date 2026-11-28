// Line icons for the touch buttons (task M.2). Our own simple 24x24 drawings, white strokes.

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  gas: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  brake: svg('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  left: svg('<path d="M15 4l-8 8 8 8"/>'),
  right: svg('<path d="M9 4l8 8-8 8"/>'),
  run: svg('<circle cx="15" cy="4" r="2"/><path d="M8 21l3-6 3 2v4M6 11l3-3h5l3 4h3M11 15l1-7"/>'),
  drift: svg('<circle cx="12" cy="12" r="5.5"/><path d="M5 5.5a9 9 0 0 0 0 13M19 5.5a9 9 0 0 1 0 13M12 9v3.5M12 15v.2"/>'),
  getIn: svg('<path d="M14 4h5v16h-5M3 12h11M10 8l4 4-4 4"/>'),
  getOut: svg('<path d="M10 4H5v16h5M9 12h12M17 8l4 4-4 4"/>'),
  ride: svg('<path d="M5 17h14l-2-6H7l-2 6zM7 17v2M17 17v2M9 11l1-4h4l1 4"/>'),
  horn: svg('<path d="M3 10v4h4l6 4V6l-6 4H3zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/>'),
  boost: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
  unstuck: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>'),
  back: svg('<path d="M15 4l-8 8 8 8"/>'),
  fist: svg('<path d="M7 11V8a1.5 1.5 0 0 1 3 0v2M10 10V7a1.5 1.5 0 0 1 3 0v3M13 10V8a1.5 1.5 0 0 1 3 0v3M16 11v-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-3a1.5 1.5 0 0 1 2.4-1.8L7 13"/>'),
  bat: svg('<path d="M4 20l3-3M7 17l10-11a2.5 2.5 0 0 1 3.5 3.5L9.5 19.5z"/>'),
  gun: svg('<path d="M3 8h17v4h-9l-1 2H8l-1 5H4l1-7H3z"/><path d="M14 12v2"/>'),
  throwIt: svg('<circle cx="17" cy="6" r="3"/><path d="M4 20c2-6 6-10 11-12"/><path d="M4 14v6h6"/>'),
  jump: svg('<path d="M12 3v11M7 8l5-5 5 5M5 20h14"/>'),
  crouch: svg('<circle cx="12" cy="7" r="2"/><path d="M8 20l2-5 4 1 2 4M9 13l3-3 4 2"/>'),
  swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  emote: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>'),
} as const;

export type IconName = keyof typeof ICONS;
