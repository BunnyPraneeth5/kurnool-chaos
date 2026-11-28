// Health (task M.7) for people (you, cops on foot) and vehicles (task M.12). Pure, tested in
// tests/combat.test.ts.

export const MAX_HP = 100;
/** Seconds without a hit before health starts coming back (people only). */
export const REGEN_AFTER = 8;
export const REGEN_PER_S = 12;
/** Seconds lying down before getting up (at a hospital, for players). */
export const DOWN_S = 5;

export class Health {
  hp = MAX_HP;
  private since = 99;
  /** seconds left lying down (0 = up) */
  down = 0;
  /** no damage while this is above 0 (rolling, just got up) */
  shield = 0;

  constructor(private readonly regen = true) {}

  get isDown(): boolean {
    return this.down > 0;
  }

  /** Take damage. Returns true when this hit put them down. */
  damage(n: number): boolean {
    if (n <= 0 || this.down > 0 || this.shield > 0) return false;
    this.hp = Math.max(0, this.hp - n);
    this.since = 0;
    if (this.hp > 0) return false;
    this.down = DOWN_S;
    return true;
  }

  /** Time passes. Returns true in the frame they get back up. */
  update(dt: number): boolean {
    this.shield = Math.max(0, this.shield - dt);
    if (this.down > 0) {
      this.down -= dt;
      if (this.down > 0) return false;
      this.down = 0;
      this.hp = MAX_HP;
      this.since = 99;
      this.shield = 2;
      return true;
    }
    this.since += dt;
    if (this.regen && this.since > REGEN_AFTER && this.hp < MAX_HP) this.hp = Math.min(MAX_HP, this.hp + REGEN_PER_S * dt);
    return false;
  }

  reset(): void {
    this.hp = MAX_HP;
    this.down = 0;
    this.since = 99;
  }
}

/** Damage a vehicle takes from a crash at `impact` m/s of lost speed, by its weight. */
export function crashDamage(impact: number, mass: number): number {
  // Small bumps do nothing; a 50 km/h wall hit on a car takes about a third.
  const over = Math.max(0, impact - 3);
  return (over * over * 0.35) / Math.max(0.3, Math.sqrt(mass));
}
