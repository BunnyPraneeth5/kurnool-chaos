// Small frame-rate readout for performance checks. Shown in dev builds or with ?fps in the URL.

export interface FpsMeter {
  frame(now: number): void;
}

declare global {
  interface Window {
    /** Last measured frames per second (for automated checks). */
    __fps?: number;
  }
}

export function createFpsMeter(label: string): FpsMeter {
  const show = import.meta.env.DEV || new URLSearchParams(location.search).has('fps');
  const el = document.getElementById('fps');
  if (el) el.hidden = !show;
  let frames = 0;
  let last = performance.now();
  return {
    frame(now) {
      frames++;
      if (now - last >= 500) {
        const fps = (frames * 1000) / (now - last);
        window.__fps = Math.round(fps);
        if (el && show) el.textContent = `${Math.round(fps)} fps · ${label}`;
        frames = 0;
        last = now;
      }
    },
  };
}
