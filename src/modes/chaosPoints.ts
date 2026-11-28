// Chaos points (task H.10): earned in free roam and in Chaos rounds for crashing into
// traffic, near misses at speed, drifting, holding police heat, escaping cops and running
// red lights. Being busted loses a quarter of them. Local to each player; in a Chaos round
// each player reports their own round points to the host.

export const CHAOS = {
  crash: 10, // plus 1 per m/s of the crash
  nearMiss: 15,
  driftPerS: 10,
  heatPerStarS: 2,
  escapePerStar: 50,
  redLight: 10,
  smash: 5, // per railing, fence panel or barricade (Phase R)
  hit: 5, // a hit on a person (task M.8)
  wreck: 25, // a vehicle wrecked (task M.12)
  boom: 20, // a blast (firecracker, a vehicle blowing up)
  knockoutShare: 0.1, // health ran out (task M.7): lose a tenth
  knockoutMin: 20,
  bustedShare: 0.25,
  bustedMin: 50,
} as const;

export class ChaosPoints {
  total = 0;
  /** points since the current round started (Chaos rounds) */
  round = 0;
  best = 0;
  /** A gain or loss to show on screen. */
  onChange: (delta: number, label: string) => void = () => {};
  private heatAcc = 0;

  add(points: number, label: string): void {
    const p = Math.round(points);
    if (p <= 0) return;
    this.total += p;
    this.round += p;
    this.best = Math.max(this.best, this.round);
    if (label) this.onChange(p, label);
  }

  /** Busted: lose a quarter (at least 50, never below 0). */
  busted(): number {
    const loss = Math.min(this.total, Math.max(CHAOS.bustedMin, Math.round(this.total * CHAOS.bustedShare)));
    const roundLoss = Math.min(this.round, Math.max(CHAOS.bustedMin, Math.round(this.round * CHAOS.bustedShare)));
    this.total -= loss;
    this.round -= roundLoss;
    if (loss > 0) this.onChange(-loss, 'Busted');
    return loss;
  }

  /** Knocked out (task M.7): lose a tenth (at least 20, never below 0). */
  knockedOut(): number {
    const loss = Math.min(this.total, Math.max(CHAOS.knockoutMin, Math.round(this.total * CHAOS.knockoutShare)));
    this.total -= loss;
    this.round = Math.max(0, this.round - loss);
    if (loss > 0) this.onChange(-loss, 'Knocked out');
    return loss;
  }

  /** Per frame: points for every second with police heat. */
  heat(dt: number, stars: number): void {
    if (stars <= 0) return;
    this.heatAcc += dt * stars * CHAOS.heatPerStarS;
    if (this.heatAcc >= 1) {
      const whole = Math.floor(this.heatAcc);
      this.heatAcc -= whole;
      this.add(whole, '');
    }
  }

  startRound(): void {
    this.round = 0;
  }
}
