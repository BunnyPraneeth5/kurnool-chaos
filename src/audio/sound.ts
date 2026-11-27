import { settings, onSettings } from '../ui/settings';
import type { VehicleType } from '../vehicles/params';

// Basic sound (task H.7) with Web Audio, all generated (no sound files): the engine of the
// vehicle you drive, your horn, traffic horns from where they are, cop sirens, crash thuds
// and short beeps. Browsers only allow sound after a tap or key press, so it starts then.

const ENGINE: Record<VehicleType, { base: number; perMs: number; type: OscillatorType; cut: number }> = {
  car: { base: 46, perMs: 3.1, type: 'sawtooth', cut: 380 },
  auto: { base: 70, perMs: 6, type: 'square', cut: 520 },
  bike: { base: 80, perMs: 5.5, type: 'sawtooth', cut: 700 },
  bus: { base: 32, perMs: 2.6, type: 'sawtooth', cut: 260 },
  lorry: { base: 30, perMs: 2.6, type: 'sawtooth', cut: 240 },
};
const HORN: Record<VehicleType, [number, number]> = {
  car: [392, 494],
  auto: [660, 660],
  bike: [880, 880],
  bus: [220, 277],
  lorry: [196, 247],
};
const VOLUME = { low: 0.35, normal: 0.7, high: 1 };
const HEAR_M = 90;

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineType: VehicleType | null = null;
  private hornNodes: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  /** Listener: where the camera is and which way it looks. */
  private lx = 0;
  private lz = 0;
  private lyaw = 0;

  constructor() {
    const start = (): void => this.start();
    window.addEventListener('pointerdown', start, { passive: true });
    window.addEventListener('keydown', start);
    onSettings(() => this.applyVolume());
  }

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      console.warn('Web Audio is not available: the game will be silent');
      return;
    }
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.applyVolume();
    // Engine: one oscillator through a low-pass filter.
    this.engineOsc = ctx.createOscillator();
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    // Siren: a triangle wave swept up and down.
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const s = settings();
    this.master.gain.setTargetAtTime(s.sound ? VOLUME[s.volume] * 0.6 : 0, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, z: number, yaw: number): void {
    this.lx = x;
    this.lz = z;
    this.lyaw = yaw;
  }

  /** Your engine: the vehicle type you drive (null on foot), speed in m/s, throttle 0..1. */
  engine(type: VehicleType | null, speed: number, throttle: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    const t = ctx.currentTime;
    if (!type) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const e = ENGINE[type];
    if (type !== this.engineType) {
      this.engineType = type;
      this.engineOsc.type = e.type;
      this.engineFilter.frequency.value = e.cut;
    }
    this.engineOsc.frequency.setTargetAtTime(e.base + Math.abs(speed) * e.perMs, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.05 + 0.04 * Math.abs(throttle), t, 0.08);
  }

  /** Your own horn, held down. */
  horn(on: boolean, type: VehicleType | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (on && type && !this.hornNodes) {
      const gain = ctx.createGain();
      gain.gain.value = 0.09;
      gain.connect(this.master);
      const oscs = HORN[type].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(gain);
        o.start();
        return o;
      });
      this.hornNodes = { oscs, gain };
    } else if ((!on || !type) && this.hornNodes) {
      const h = this.hornNodes;
      h.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      for (const o of h.oscs) o.stop(ctx.currentTime + 0.1);
      this.hornNodes = null;
    }
  }

  /** Stereo pan and loudness for a sound at (x, z), or null when out of earshot. */
  private place(x: number, z: number): { gain: number; pan: number } | null {
    const dx = x - this.lx, dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d > HEAR_M) return null;
    // Right of the view direction (sin yaw, cos yaw) is (-cos yaw, sin yaw).
    const right = (-dx * Math.cos(this.lyaw) + dz * Math.sin(this.lyaw)) / Math.max(d, 1);
    return { gain: (1 - d / HEAR_M) ** 2, pan: Math.max(-1, Math.min(1, right)) };
  }

  /** A short honk from a traffic vehicle (beep-beep for autos and bikes). */
  honkAt(x: number, z: number, type: VehicleType): void {
    const ctx = this.ctx;
    const p = this.place(x, z);
    if (!ctx || !this.master || !p) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    pan.connect(this.master);
    const double = type === 'auto' || type === 'bike';
    const t0 = ctx.currentTime;
    for (let k = 0; k < (double ? 2 : 1); k++) {
      const g = ctx.createGain();
      const start = t0 + k * 0.22;
      const len = double ? 0.15 : 0.45;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.08 * p.gain, start + 0.01);
      g.gain.setValueAtTime(0.08 * p.gain, start + len);
      g.gain.linearRampToValueAtTime(0, start + len + 0.03);
      g.connect(pan);
      for (const f of HORN[type]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(g);
        o.start(start);
        o.stop(start + len + 0.05);
      }
    }
  }

  /** Cop sirens: loudness from the nearest cop's distance (Infinity = none). */
  siren(nearestM: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sirenOsc || !this.sirenGain) return;
    const t = ctx.currentTime;
    const level = nearestM < 220 ? (1 - nearestM / 220) ** 1.5 : 0;
    this.sirenGain.gain.setTargetAtTime(level * 0.06, t, 0.1);
    if (level > 0) this.sirenOsc.frequency.setTargetAtTime(700 + 350 * Math.sin(t * 5), t, 0.02);
  }

  /** A crash: a short burst of noise. */
  thud(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = 0.25;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.5, 0.25 * strength + 0.1);
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /** A short beep (getting in, a star, busted). */
  beep(freq: number, dur: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0.07;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }
}

export const sound = new Sound();
