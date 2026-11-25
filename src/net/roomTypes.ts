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
