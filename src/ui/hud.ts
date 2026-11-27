// HUD (TASKS 5.4, from the demo): speed readout in vehicles, short toast messages and
// police heat stars that pulse while a bust is building. The minimap is in minimap.ts.

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e;
}

export class Hud {
  private readonly spd = el('spd');
  private readonly kmh = el('kmh');
  private readonly toastEl = el('toast');
  private readonly heatEl = el('heat');
  private readonly stars = Array.from(this.heatEl.children) as HTMLElement[];
  private lastHeat = -1;
  private readonly chaosEl = el('chaos');
  private readonly chaosNum = this.chaosEl.querySelector('b') as HTMLElement;
  private readonly pop = el('chaospop');
  private lastChaos = -1;
  private toastT = 0;
  private lastKmh = -1;

  speed(inVehicle: boolean, metresPerSecond: number): void {
    this.spd.hidden = !inVehicle;
    if (!inVehicle) return;
    const v = Math.round(Math.abs(metresPerSecond) * 3.6);
    if (v !== this.lastKmh) {
      this.lastKmh = v;
      this.kmh.textContent = String(v);
    }
  }

  heat(level: number, bust: number): void {
    if (level !== this.lastHeat) {
      this.lastHeat = level;
      this.stars.forEach((s, i) => s.classList.toggle('on', i < level));
      this.heatEl.setAttribute('aria-label', `Police heat ${level} of 3`);
      this.heatEl.classList.toggle('hot', level > 0);
    }
    this.heatEl.classList.toggle('bust', bust > 0.15);
  }

  /** Chaos points counter beside the stars. */
  chaos(total: number): void {
    if (total === this.lastChaos) return;
    this.lastChaos = total;
    this.chaosEl.hidden = total <= 0;
    this.chaosNum.textContent = String(total);
  }

  /** A short "+15 Near miss" that floats up and fades. */
  chaosPop(delta: number, label: string): void {
    const d = document.createElement('div');
    d.className = delta < 0 ? 'bad' : '';
    d.textContent = `${delta > 0 ? '+' : ''}${delta} ${label}`;
    this.pop.append(d);
    while (this.pop.children.length > 4) this.pop.firstElementChild?.remove();
    window.setTimeout(() => d.remove(), 1600);
  }

  toast(msg: string, cls?: 'bad'): void {
    this.toastEl.className = cls ?? '';
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    this.toastT = 2.2;
  }

  update(dt: number): void {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.hidden = true;
    }
  }
}
