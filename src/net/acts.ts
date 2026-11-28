import { WEAPON_IDS, type WeaponId } from '../combat/weapons';

// What a player on foot is doing, packed into one small number for the state message `s`
// (field `a`, tasks M.6 to M.11). Friends draw crouches, rolls, emotes, falls, the weapon in
// hand and its swings and shots from it. Pure; tests/combat.test.ts.

export const EMOTE_IDS = ['wave', 'dance', 'point', 'namaste'] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];

export interface Acts {
  crouch: boolean;
  roll: boolean;
  /** lying down (health ran out) */
  down: boolean;
  emote: EmoteId | null;
  weapon: WeaponId;
  /** swinging a melee weapon or throwing, this moment */
  swing: boolean;
  /** just fired a gun */
  fire: boolean;
}

export const NO_ACTS: Acts = { crouch: false, roll: false, down: false, emote: null, weapon: 'fists', swing: false, fire: false };

export function encodeActs(a: Acts): number {
  const emote = a.emote ? EMOTE_IDS.indexOf(a.emote) + 1 : 0;
  const weapon = Math.max(0, WEAPON_IDS.indexOf(a.weapon));
  return (a.crouch ? 1 : 0) | (a.roll ? 2 : 0) | (a.down ? 4 : 0) | (a.swing ? 8 : 0) | (a.fire ? 16 : 0) | (emote << 5) | (weapon << 8);
}

export function decodeActs(n: unknown): Acts {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 0xffff) return NO_ACTS;
  const emote = (n >> 5) & 7;
  const weapon = (n >> 8) & 15;
  return {
    crouch: !!(n & 1),
    roll: !!(n & 2),
    down: !!(n & 4),
    swing: !!(n & 8),
    fire: !!(n & 16),
    emote: emote >= 1 && emote <= EMOTE_IDS.length ? EMOTE_IDS[emote - 1] : null,
    weapon: WEAPON_IDS[weapon] ?? 'fists',
  };
}

/** Emote wheel entries. */
export const EMOTE_WHEEL: { id: EmoteId; label: string; symbol: string }[] = [
  { id: 'wave', label: 'Wave', symbol: '👋' },
  { id: 'dance', label: 'Dance', symbol: '💃' },
  { id: 'point', label: 'Point', symbol: '👉' },
  { id: 'namaste', label: 'Namaste', symbol: '🙏' },
];
