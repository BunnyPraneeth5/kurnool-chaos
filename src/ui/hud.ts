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
  // Fighting (tasks M.7 to M.12): health bar, hit direction, hit marker, splash.
  private readonly bar = document.createElement('div');
  private readonly barFill = document.createElement('i');
  private readonly barLabel = document.createElement('span');
  private lastBar = '';
  private readonly hitDir = document.createElement('div');
  private hitDirT = 0;
  private readonly mark = document.createElement('div');
  private markT = 0;
  private readonly splashEl = document.createElement('div');
  private splashT = 0;

  constructor() {
    this.bar.id = 'hpbar';
    this.bar.append(this.barFill, this.barLabel);
    this.bar.setAttribute('role', 'meter');
    this.hitDir.id = 'hitdir';
    this.hitDir.hidden = true;
    this.mark.id = 'hitmark';
    this.mark.hidden = true;
    this.splashEl.id = 'splash';
    this.splashEl.hidden = true;
    document.body.append(this.bar, this.hitDir, this.mark, this.splashEl);
  }

  /** Your health on foot, or your vehicle's while driving (null hides that one). */
  health(hp: number | null, vehicle: number | null): void {
    const v = vehicle ?? hp;
    const key = v === null ? '' : `${vehicle !== null ? 'v' : 'p'}${Math.ceil(v)}`;
    if (key === this.lastBar) return;
    this.lastBar = key;
    this.bar.hidden = v === null;
    if (v === null) return;
    const n = Math.max(0, Math.ceil(v));
    this.barFill.style.width = `${n}%`;
    this.bar.className = `${vehicle !== null ? 'veh' : ''} ${n < 30 ? 'low' : n < 60 ? 'mid' : ''}`;
    this.barLabel.textContent = vehicle !== null ? (n <= 0 ? 'Wrecked' : `Vehicle ${n}`) : `Health ${n}`;
    this.bar.setAttribute('aria-label', this.barLabel.textContent);
  }

  /** Hit: a red arrow towards where it came from (radians, 0 = ahead), or a splash over the screen. */
  hurt(relAngle: number | null, splash: string | null): void {
    if (splash) {
      this.splashEl.className = splash;
      this.splashEl.hidden = false;
      this.splashT = 2;
      return;
    }
    if (relAngle === null) return;
    // Screen: ahead is up; angles grow to the left in the world, so flip for the screen.
    this.hitDir.style.transform = `translate(-50%, -50%) rotate(${(-relAngle * 180) / Math.PI}deg)`;
    this.hitDir.hidden = false;
    this.hitDirT = 0.8;
  }

  /** Our hit landed: a small cross in the middle. */
  hitMark(): void {
    this.mark.hidden = false;
    this.markT = 0.18;
  }

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
    for (const [t, el] of [['hitDirT', this.hitDir], ['markT', this.mark], ['splashT', this.splashEl]] as const) {
      if (this[t] <= 0) continue;
      this[t] -= dt;
      if (this[t] <= 0) el.hidden = true;
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.hidden = true;
    }
  }
}
