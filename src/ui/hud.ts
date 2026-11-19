// Small HUD pieces for now: speed readout in vehicles and short toast messages.
// The full HUD and minimap come in task 5.4.

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e;
}

export class Hud {
  private readonly spd = el('spd');
  private readonly kmh = el('kmh');
  private readonly toastEl = el('toast');
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

  toast(msg: string): void {
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
