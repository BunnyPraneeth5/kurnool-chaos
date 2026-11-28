import { describe, expect, it } from 'vitest';
import {
  PICKUP_WEAPONS, WEAPONS, WEAPON_IDS, nextWeapon, pickUp, refill, spend, startInventory, throwDistance, throwVelocity, usable, weaponLabel,
} from '../src/combat/weapons';
import { Health, MAX_HP, REGEN_AFTER, DOWN_S, crashDamage } from '../src/combat/health';
import { EMOTE_IDS, NO_ACTS, decodeActs, encodeActs, type Acts } from '../src/net/acts';
import { parseState } from '../src/net/interp';
import { pickupSpots } from '../src/combat/pickups';
import type { MapData } from '../src/map/types';
import type { RoundState } from '../src/modes/types';
import { mayHit } from '../src/combat/rules';
import { chorPoliceMode } from '../src/modes/chorPolice';
import { ctx, state } from './helpers';

// Tasks M.6 to M.12: weapons, health, what friends see, hits on the state message.

describe('weapons', () => {
  it('everyone starts with fists, bat and pistol (Bunny check proposal); the rest are pickups', () => {
    const inv = startInventory();
    expect(inv.have).toEqual(['fists', 'bat', 'pistol']);
    expect(inv.current).toBe('fists');
    expect(inv.ammo.pistol).toBe(WEAPONS.pistol.ammo);
    expect([...PICKUP_WEAPONS].sort()).toEqual(['balloon', 'cracker', 'lathi', 'shotgun', 'tomato']);
  });

  it('switching skips weapons with no ammo and wraps round', () => {
    const inv = startInventory();
    expect(nextWeapon(inv)).toBe('bat');
    inv.current = 'bat';
    expect(nextWeapon(inv)).toBe('pistol');
    inv.ammo.pistol = 0;
    expect(usable(inv, 'pistol')).toBe(false);
    expect(nextWeapon(inv)).toBe('fists');
  });

  it('ammo is spent, picked up up to the most you can carry, and refilled', () => {
    const inv = startInventory();
    expect(spend(inv, 'fists')).toBe(true);
    expect(spend(inv, 'pistol')).toBe(true);
    expect(inv.ammo.pistol).toBe(35);
    expect(pickUp(inv, 'shotgun')).toBe('Shotgun (12)');
    expect(inv.have).toEqual(['fists', 'bat', 'pistol', 'shotgun']);
    expect(pickUp(inv, 'shotgun')).toBe('Shotgun (24)');
    expect(pickUp(inv, 'shotgun')).toBeNull(); // full
    inv.ammo.pistol = 3;
    expect(refill(inv)).toBe(true);
    expect(inv.ammo.pistol).toBe(36);
    expect(pickUp(inv, 'bat')).toBeNull(); // already had it
    inv.ammo.shotgun = 0;
    inv.current = 'shotgun';
    expect(spend(inv, 'shotgun')).toBe(false);
    expect(weaponLabel(inv)).toBe('Shotgun 0');
  });

  it('a longer hold throws farther, never past the weapon reach; the launch lands there', () => {
    const w = WEAPONS.balloon;
    expect(throwDistance(w, 0)).toBeCloseTo(w.reach * 0.35);
    expect(throwDistance(w, 5)).toBeCloseTo(w.reach);
    const d = 15;
    const g = 20;
    const v = throwVelocity(d, g);
    // Flight on flat ground: up and back down in 2 up / g seconds.
    expect(v.h * ((2 * v.up) / g)).toBeCloseTo(d);
  });

  it('every weapon has sane numbers', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      expect(w.cooldown).toBeGreaterThan(0);
      expect(w.reach).toBeGreaterThan(0);
      if (w.kind !== 'throw') expect(w.damage).toBeGreaterThan(0);
    }
  });
});

describe('health', () => {
  it('goes down to zero, lies down, gets up full with a short shield', () => {
    const h = new Health();
    expect(h.damage(40)).toBe(false);
    expect(h.hp).toBe(60);
    expect(h.damage(70)).toBe(true);
    expect(h.isDown).toBe(true);
    expect(h.damage(10)).toBe(false); // no more damage while down
    expect(h.update(DOWN_S - 0.1)).toBe(false);
    expect(h.update(0.2)).toBe(true);
    expect(h.hp).toBe(MAX_HP);
    expect(h.damage(10)).toBe(false); // shield
    expect(h.hp).toBe(MAX_HP);
  });

  it('comes back after a while without hits (people); officers do not heal', () => {
    const h = new Health();
    h.damage(50);
    h.update(REGEN_AFTER - 1);
    expect(h.hp).toBe(50);
    h.update(2);
    expect(h.hp).toBeGreaterThan(50);
    const o = new Health(false);
    o.damage(50);
    o.update(30);
    expect(o.hp).toBe(50);
  });

  it('crash damage: small bumps nothing, hard hits a lot, heavy vehicles take less', () => {
    expect(crashDamage(2, 1)).toBe(0);
    expect(crashDamage(14 * 0.55 * 1.8, 1)).toBeGreaterThan(20);
    expect(crashDamage(10, 4)).toBeLessThan(crashDamage(10, 1));
  });
});

describe('what friends see (acts)', () => {
  it('packs and unpacks every combination it needs', () => {
    const cases: Acts[] = [
      NO_ACTS,
      { crouch: true, roll: false, down: false, emote: 'dance', weapon: 'shotgun', swing: false, fire: true },
      { crouch: false, roll: true, down: true, emote: null, weapon: 'cracker', swing: true, fire: false },
    ];
    for (const id of EMOTE_IDS) cases.push({ ...NO_ACTS, emote: id });
    for (const id of WEAPON_IDS) cases.push({ ...NO_ACTS, weapon: id });
    for (const a of cases) expect(decodeActs(encodeActs(a))).toEqual(a);
  });

  it('ignores junk', () => {
    expect(decodeActs('x')).toEqual(NO_ACTS);
    expect(decodeActs(-1)).toEqual(NO_ACTS);
    expect(decodeActs(1.5)).toEqual(NO_ACTS);
  });
});

describe('state message extras', () => {
  const base = { id: 'p1', t: 1, x: 1, z: 2, y: 0, h: 0, v: 0, mode: 'foot', car: -1 };

  it('keeps acts, vehicle health and hits; drops broken ones', () => {
    const s = parseState({ ...base, a: 0x123, vd: 40, hits: [['p2', 18, 'pistol'], ['p3', 999, 'bat'], [1, 2, 3], 'x'] });
    expect(s?.a).toBe(0x123);
    expect(s?.vd).toBe(40);
    expect(s?.hits).toEqual([
      ['p2', 18, 'pistol'],
      ['p3', 100, 'bat'],
    ]);
    const bad = parseState({ ...base, a: -4, vd: 300, hits: 'no' });
    expect(bad?.a).toBeUndefined();
    expect(bad?.vd).toBeUndefined();
    expect(bad?.hits).toBeUndefined();
  });

  it('at most 8 hits per message', () => {
    const hits = Array.from({ length: 20 }, (_, i) => [`p${i}`, 5, 'fists']);
    expect(parseState({ ...base, hits })?.hits).toHaveLength(8);
  });
});

describe('pickups', () => {
  const map = {
    graph: { nodes: Array.from({ length: 400 }, (_, i) => [(i % 20) * 200, Math.floor(i / 20) * 200]), edges: [] },
    playArea: { minX: 0, minZ: 0, maxX: 4000, maxZ: 4000 },
  } as unknown as MapData;
  const world = { heightAt: () => 0 };

  it('are the same on every screen, spread out, and give every pickup weapon', () => {
    const a = pickupSpots(map, world);
    const b = pickupSpots(map, world);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z)).toBeGreaterThan(170);
    expect(new Set(a.map((p) => p.weapon))).toEqual(new Set(PICKUP_WEAPONS));
  });
});

describe('who may hit whom (task M.11)', () => {
  const st = (o: Partial<RoundState>): RoundState => state({ players: ['a', 'b'], ...o });

  it('free roam: everyone; in a round and out of it: nobody', () => {
    expect(mayHit(st({ phase: 'lobby', players: [] }), 'a', 'b')).toBe(true);
    expect(mayHit(st({ players: ['a'] }), 'a', 'b')).toBe(false);
    expect(mayHit(st({ players: ['a'] }), 'b', 'a')).toBe(false);
  });

  it('Chaos yes; Landmark hunt and Hill climb no; not during the countdown', () => {
    expect(mayHit(st({ mode: 'chaos' }), 'a', 'b')).toBe(true);
    expect(mayHit(st({ mode: 'hunt' }), 'a', 'b')).toBe(false);
    expect(mayHit(st({ mode: 'climb' }), 'a', 'b')).toBe(false);
    expect(mayHit(st({ mode: 'chaos', phase: 'countdown' }), 'a', 'b')).toBe(false);
  });

  it('Chor–Police: police and chors only, not your own team', () => {
    const roles = { a: 'police', b: 'chor', c: 'chor' };
    const s = st({ mode: 'chor', players: ['a', 'b', 'c'], roles });
    expect(mayHit(s, 'a', 'b')).toBe(true);
    expect(mayHit(s, 'b', 'a')).toBe(true);
    expect(mayHit(s, 'b', 'c')).toBe(false);
  });

  it('a police stun from gun range counts as a catch; a touch-catch from there does not', () => {
    const s = state({ players: ['a', 'b'], roles: { a: 'police', b: 'chor' }, scores: { a: 0, b: 0 }, data: { turnedAt: { a: 0 }, caughtBy: {} }, elapsedMs: 20000 });
    const far = ctx({ a: { x: 0, z: 0 }, b: { x: 50, z: 0 } });
    expect(chorPoliceMode.claim(structuredClone(s), 'a', { kind: 'catch', target: 'b' }, far)).toBe(false);
    expect(chorPoliceMode.claim(s, 'a', { kind: 'catch', target: 'b', stun: true }, far)).toBe(true);
    expect(s.roles.b).toBe('police');
  });
});
