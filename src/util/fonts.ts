// The bundled Telugu font (Noto Sans Telugu Bold, SIL Open Font License, public/fonts/).
// Phones without a Telugu font would show boxes, so canvas text waits for this font.

export const TELUGU_FONT = 'Noto Sans Telugu';

let loading: Promise<boolean> | null = null;

/** Load the Telugu font once. Resolves false (and logs why) if it cannot be loaded. */
export function loadTeluguFont(): Promise<boolean> {
  if (loading) return loading;
  const url = `${import.meta.env.BASE_URL}fonts/NotoSansTelugu-Bold.ttf`;
  const face = new FontFace(TELUGU_FONT, `url(${url})`, { weight: '700' });
  loading = face.load().then(
    (f) => {
      document.fonts.add(f);
      return true;
    },
    (err: unknown) => {
      console.error(`Could not load the Telugu font from ${url}:`, err);
      return false;
    },
  );
  return loading;
}
