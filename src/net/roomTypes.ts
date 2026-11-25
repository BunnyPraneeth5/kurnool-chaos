// Room types shared with code that must not pull in the Supabase client
// (it is loaded only when someone plays in a room).

export const ROOM_CAP = 8;

export interface PlayerInfo {
  id: string;
  nick: string;
  /** 0..7: decides colour and spawn point */
  slot: number;
  joinedAt: number;
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly kind: 'connect' | 'full',
  ) {
    super(message);
  }
}

export type RoomStatus = 'online' | 'reconnecting';

/** One colour per slot: name tag, player list dot and on-foot shirt. */
export const PLAYER_COLOURS = [0xffc247, 0x3d8fd6, 0x49b08c, 0xe4573d, 0xb25fc4, 0xf08a5d, 0x4fd1e0, 0xeae3d6];

export function playerColour(slot: number): number {
  return PLAYER_COLOURS[((slot % PLAYER_COLOURS.length) + PLAYER_COLOURS.length) % PLAYER_COLOURS.length];
}

export function cssColour(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
