// Room codes, player ids and nicknames (ARCHITECTURE: Multiplayer).

/** Uppercase letters and digits without 0/O/1/I, so codes are easy to read out. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const NICK_MAX = 16;
const NICK_STORE = 'kc.nick';

function randomChars(n: number, chars: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

export function newRoomCode(): string {
  return randomChars(6, CODE_CHARS);
}

/** Normalises user input ("k7mp q2" -> "K7MPQ2"); returns null if it is not a valid code. */
export function parseRoomCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.replace(/[\s-]/g, '').toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** One id per page load, so two tabs on one laptop are two players. */
export function newPlayerId(): string {
  return randomChars(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

/** Trims, drops control characters and caps the length. Shown with textContent only. */
export function cleanNick(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
}

export function loadNick(): string {
  try {
    return cleanNick(localStorage.getItem(NICK_STORE));
  } catch {
    return '';
  }
}

export function saveNick(nick: string): void {
  try {
    localStorage.setItem(NICK_STORE, nick);
  } catch {
    // private mode: the nickname just is not remembered
  }
}

export function roomLink(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}
