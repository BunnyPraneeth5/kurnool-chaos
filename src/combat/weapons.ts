import type { IconName } from '../ui/icons';

// Weapons (tasks M.8 to M.10): cartoon style, no blood. Numbers in one place so the guide
// and the game agree. Damage is against 100 health (people) or 100 vehicle health.

export const WEAPON_IDS = ['fists', 'bat', 'lathi', 'pistol', 'shotgun', 'balloon', 'tomato', 'cracker'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export interface Weapon {
  id: WeaponId;
  name: string;
  /** symbol for the wheel and the guide */
  symbol: string;
  kind: 'melee' | 'gun' | 'throw';
  /** word on the Attack button and its icon */
  verb: string;
  icon: IconName;
  /** damage to a person per hit (per pellet for the shotgun) */
  damage: number;
  /** damage to a vehicle per hit or pellet */
  carDamage: number;
  /** melee: reach in metres; guns: range; throwables: the farthest throw */
  reach: number;
  /** melee: half the swing's width in radians */
  arc?: number;
  /** seconds between attacks */
  cooldown: number;
  /** shotgun: pellets per shot and their spread (radians) */
  pellets?: number;
  spread?: number;
  /** throwables: blast or splash radius */
  radius?: number;
  /** ammo you get with it (undefined = no ammo needed) */
  ammo?: number;
  /** most ammo you can carry */
  maxAmmo?: number;
  /** everyone has it from the start (M.9 proposal: fists, bat, pistol) */
  start: boolean;
  /** for the guide */
  about: string;
}

export const WEAPONS: Record<WeaponId, Weapon> = {
  fists: { id: 'fists', name: 'Fists', symbol: '👊', kind: 'melee', verb: 'Punch', icon: 'fist', damage: 12, carDamage: 1, reach: 1.6, arc: 0.9, cooldown: 0.38, start: true, about: 'Punch, punch, kick: every third hit is a kick for more.' },
  bat: { id: 'bat', name: 'Cricket bat', symbol: '🏏', kind: 'melee', verb: 'Swing', icon: 'bat', damage: 30, carDamage: 9, reach: 2.1, arc: 1.0, cooldown: 0.7, start: true, about: 'A big swing that knocks people over.' },
  lathi: { id: 'lathi', name: 'Lathi', symbol: '🦯', kind: 'melee', verb: 'Swing', icon: 'bat', damage: 24, carDamage: 7, reach: 2.6, arc: 0.8, cooldown: 0.55, start: false, about: 'Longer reach than the bat, quicker, a bit less damage. Pick one up around the city.' },
  pistol: { id: 'pistol', name: 'Pistol', symbol: '🔫', kind: 'gun', verb: 'Shoot', icon: 'gun', damage: 18, carDamage: 8, reach: 60, cooldown: 0.32, ammo: 36, maxAmmo: 72, start: true, about: 'Toy-looking pistol with a bright tracer. Aim assist picks the target in front on phones.' },
  shotgun: { id: 'shotgun', name: 'Shotgun', symbol: '💥', kind: 'gun', verb: 'Shoot', icon: 'gun', damage: 9, carDamage: 5, reach: 25, cooldown: 0.9, pellets: 6, spread: 0.18, ammo: 12, maxAmmo: 24, start: false, about: 'Six pellets at short range. Pick one up around the city.' },
  balloon: { id: 'balloon', name: 'Water balloon', symbol: '🎈', kind: 'throw', verb: 'Throw', icon: 'throwIt', damage: 0, carDamage: 0, reach: 22, cooldown: 0.6, radius: 2.5, ammo: 5, maxAmmo: 10, start: false, about: 'Splash! No damage; a friend’s screen gets wet for 2 seconds.' },
  tomato: { id: 'tomato', name: 'Tomato', symbol: '🍅', kind: 'throw', verb: 'Throw', icon: 'throwIt', damage: 0, carDamage: 0, reach: 24, cooldown: 0.5, radius: 1.8, ammo: 5, maxAmmo: 10, start: false, about: 'Splat. No damage; makes people look round and friends see red for 2 seconds.' },
  cracker: { id: 'cracker', name: 'Firecracker', symbol: '🧨', kind: 'throw', verb: 'Throw', icon: 'throwIt', damage: 35, carDamage: 40, reach: 20, cooldown: 0.9, radius: 4.5, ammo: 3, maxAmmo: 6, start: false, about: 'Small blast after a short fuse: knocks people over and scares traffic.' },
};

/** Which weapons pickups around the city give (the rest you start with). */
export const PICKUP_WEAPONS: readonly WeaponId[] = WEAPON_IDS.filter((id) => !WEAPONS[id].start);

/** Throw speed for a throwable held for `holdS` seconds (longer hold, farther throw). */
export function throwDistance(w: Weapon, holdS: number): number {
  const t = Math.max(0, Math.min(1, holdS / 0.8));
  return w.reach * (0.35 + 0.65 * t);
}

/** A launch speed (horizontal and up) that lands `dist` metres away on flat ground with gravity g. */
export function throwVelocity(dist: number, g = 20): { h: number; up: number } {
  // 45 degrees: h = up = sqrt(d g / 2)
  const v = Math.sqrt((Math.max(0.5, dist) * g) / 2);
  return { h: v, up: v };
}

export interface Inventory {
  /** weapons you have, in wheel order */
  have: WeaponId[];
  ammo: Partial<Record<WeaponId, number>>;
  current: WeaponId;
}

export function startInventory(): Inventory {
  const have = WEAPON_IDS.filter((id) => WEAPONS[id].start);
  const ammo: Inventory['ammo'] = {};
  for (const id of have) if (WEAPONS[id].ammo !== undefined) ammo[id] = WEAPONS[id].ammo;
  return { have, ammo, current: 'fists' };
}

/** Can the weapon be used now (ammo left)? */
export function usable(inv: Inventory, id: WeaponId): boolean {
  return inv.have.includes(id) && (WEAPONS[id].ammo === undefined || (inv.ammo[id] ?? 0) > 0);
}

/** The next usable weapon after the current one (wraps round; fists always work). */
export function nextWeapon(inv: Inventory): WeaponId {
  const i = inv.have.indexOf(inv.current);
  for (let k = 1; k <= inv.have.length; k++) {
    const id = inv.have[(i + k) % inv.have.length];
    if (usable(inv, id)) return id;
  }
  return 'fists';
}

/** Pick up a weapon or its ammo; returns what you got (null if already full). */
export function pickUp(inv: Inventory, id: WeaponId): string | null {
  const w = WEAPONS[id];
  const had = inv.have.includes(id);
  if (!had) {
    inv.have.push(id);
    inv.have.sort((a, b) => WEAPON_IDS.indexOf(a) - WEAPON_IDS.indexOf(b));
  }
  if (w.ammo === undefined) return had ? null : w.name;
  const now = inv.ammo[id] ?? 0;
  const next = Math.min(w.maxAmmo ?? w.ammo, now + w.ammo);
  inv.ammo[id] = next;
  if (had && next === now) return null;
  return `${w.name} (${next})`;
}

/** Refill the ammo of the weapons you have to what they start with (respawn, police station). */
export function refill(inv: Inventory, guns = true): boolean {
  let any = false;
  for (const id of inv.have) {
    const w = WEAPONS[id];
    if (w.ammo === undefined || (w.kind === 'gun') !== guns) continue;
    if ((inv.ammo[id] ?? 0) < w.ammo) {
      inv.ammo[id] = w.ammo;
      any = true;
    }
  }
  return any;
}

/** Use one shot; false if there was none. */
export function spend(inv: Inventory, id: WeaponId): boolean {
  if (WEAPONS[id].ammo === undefined) return true;
  const n = inv.ammo[id] ?? 0;
  if (n <= 0) return false;
  inv.ammo[id] = n - 1;
  return true;
}

/** Text for the weapon button: name and ammo. */
export function weaponLabel(inv: Inventory): string {
  const w = WEAPONS[inv.current];
  const n = inv.ammo[inv.current];
  return n === undefined ? w.name.split(' ').pop()! : `${w.name.split(' ').pop()} ${n}`;
}
