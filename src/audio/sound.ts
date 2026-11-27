import { settings, onSettings } from '../ui/settings';
import { showNotice } from '../ui/status';
import { VEHICLES, type VehicleType } from '../vehicles/params';
import { CLIP_NAMES, CUES, ENGINES, HORNS, clipInfo, fetchClip, type ClipName, type Cue } from './clips';

// Sound (task H.7) with Web Audio, playing the recordings in public/sounds/ (clips.ts): the
// engine of the vehicle you drive, your horn, traffic horns from where they are, cop
// sirens, crashes and short beeps. A file that cannot load is named on screen and stays
// silent until Retry. Browsers only allow sound after a tap or key press, so it starts then.

const VOLUME = { low: 0.35, normal: 0.7, high: 1 };
const HEAR_M = 90;
const SIREN_M = 220;
/** A quick tap on the horn still sounds this long. */
const MIN_HORN_S = 0.15;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Downloaded files, kept until the audio context exists to decode them. */
  private readonly files = new Map<ClipName, ArrayBuffer>();
  private readonly buffers = new Map<ClipName, AudioBuffer>();
  private readonly failed = new Map<ClipName, string>();
  private engineVoice: (Voice & { type: VehicleType }) | null = null;
  private hornVoice: (Voice & { type: VehicleType; since: number }) | null = null;
  private sirenVoice: Voice | null = null;
  /** Listener: where the camera is and which way it looks. */
  private lx = 0;
  private lz = 0;
  private lyaw = 0;

  constructor() {
    const start = (): void => this.start();
    // Phones count the finger lifting (not touching down) as the tap that allows sound.
    window.addEventListener('pointerdown', start, { passive: true });
    window.addEventListener('pointerup', start, { passive: true });
    window.addEventListener('keydown', start);
    onSettings(() => this.applyVolume());
  }

  /** Download every recording (called at boot). */
  load(): void {
    for (const name of CLIP_NAMES) void this.loadClip(name);
  }

  private async loadClip(name: ClipName): Promise<void> {
    const url = `${import.meta.env.BASE_URL}sounds/${name}.mp3`;
    try {
      let file = this.files.get(name);
      if (!file) {
        file = await fetchClip(url);
        this.files.set(name, file);
      }
      const ctx = this.ctx;
      if (!ctx) return; // decoded when sound starts
      // decodeAudioData empties what it is given, so it gets a copy.
      const buffer = await ctx.decodeAudioData(file.slice(0)).catch(() => {
        throw new Error(`${url} is damaged or this browser cannot play it.`);
      });
      this.buffers.set(name, buffer);
    } catch (e) {
      this.files.delete(name);
      this.failed.set(name, e instanceof Error ? e.message : String(e));
      this.reportFailures();
    }
  }

  private reportFailures(): void {
    const all = [...this.failed.values()];
    const more = all.length > 3 ? ` And ${all.length - 3} more.` : '';
    showNotice('Sound could not load', `${all.slice(0, 3).join(' ')}${more}`, [
      {
        label: 'Retry',
        run: () => {
          const names = [...this.failed.keys()];
          this.failed.clear();
          for (const name of names) void this.loadClip(name);
        },
      },
      { label: 'Close', run: () => {} },
    ]);
  }

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.applyVolume();
    for (const name of this.files.keys()) void this.loadClip(name);
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const s = settings();
    this.master.gain.setTargetAtTime(s.sound ? VOLUME[s.volume] * 0.6 : 0, this.ctx.currentTime, 0.05);
  }

  /** A source for a recording, not yet started; null until it is ready. */
  private voice(name: ClipName, level: number, out: AudioNode | null = this.master): Voice | null {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !out || !buffer) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const loop = clipInfo(name).loop;
    if (loop) {
      src.loop = true;
      [src.loopStart, src.loopEnd] = loop;
    }
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(gain).connect(out);
    return { src, gain };
  }

  /** Fade a playing sound out from time `at`, then stop it. */
  private release(v: Voice, at: number, fade: number): void {
    v.gain.gain.setTargetAtTime(0, at, fade);
    v.src.stop(at + fade * 5);
  }

  setListener(x: number, z: number, yaw: number): void {
    this.lx = x;
    this.lz = z;
    this.lyaw = yaw;
  }

  /** Your engine: the vehicle type you drive (null on foot), speed in m/s, throttle 0..1. */
  engine(type: VehicleType | null, speed: number, throttle: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.engineVoice && this.engineVoice.type !== type) {
      this.release(this.engineVoice, t, 0.08);
      this.engineVoice = null;
    }
    if (!type) return;
    const e = ENGINES[type];
    // Faster than top speed (a boost) goes a little higher still.
    const rate = e.idle + (e.top - e.idle) * Math.min(1.4, Math.abs(speed) / VEHICLES[type].top);
    if (!this.engineVoice) {
      const v = this.voice(e.clip, 0);
      if (!v) return;
      v.src.playbackRate.value = rate;
      v.src.start(t, v.src.loopStart);
      this.engineVoice = { ...v, type };
    }
    this.engineVoice.src.playbackRate.setTargetAtTime(rate, t, 0.08);
    this.engineVoice.gain.gain.setTargetAtTime(0.14 + 0.11 * Math.abs(throttle), t, 0.08);
  }

  /** Your own horn, held down. */
  horn(on: boolean, type: VehicleType | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const held = this.hornVoice;
    if (held && (!on || held.type !== type)) {
      this.release(held, Math.max(t, held.since + MIN_HORN_S), 0.02);
      this.hornVoice = null;
    }
    if (!on || !type || this.hornVoice) return;
    const v = this.voice(HORNS[type].clip, 0.55);
    if (!v) return;
    v.src.start(t);
    this.hornVoice = { ...v, type, since: t };
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

  /** A short honk from a traffic vehicle (the auto and bike recordings are beep-beeps). */
  honkAt(x: number, z: number, type: VehicleType): void {
    const ctx = this.ctx;
    const p = this.place(x, z);
    if (!ctx || !this.master || !p) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    pan.connect(this.master);
    const h = HORNS[type];
    const level = 0.5 * p.gain;
    const v = this.voice(h.clip, level, pan);
    if (!v) return;
    const t = ctx.currentTime;
    v.gain.gain.setValueAtTime(level, t + h.honk);
    v.gain.gain.linearRampToValueAtTime(0, t + h.honk + 0.05);
    v.src.start(t);
    v.src.stop(t + h.honk + 0.06);
  }

  /** Cop sirens: loudness from the nearest cop's distance (Infinity = none). */
  siren(nearestM: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const level = nearestM < SIREN_M ? (1 - nearestM / SIREN_M) ** 1.5 : 0;
    if (level === 0) {
      if (this.sirenVoice) this.release(this.sirenVoice, t, 0.1);
      this.sirenVoice = null;
      return;
    }
    if (!this.sirenVoice) {
      const v = this.voice('siren', 0);
      if (!v) return;
      v.src.start(t, v.src.loopStart);
      this.sirenVoice = v;
    }
    this.sirenVoice.gain.gain.setTargetAtTime(level * 0.16, t, 0.1);
  }

  /** A crash, louder the harder the hit. */
  thud(strength: number): void {
    this.voice('crash', Math.min(0.5, 0.25 * strength + 0.1))?.src.start();
  }

  /** A short beep (getting in or out, a star, boost, busted). */
  cue(which: Cue): void {
    const c = CUES[which];
    const v = this.voice(c.clip, c.gain);
    if (!v) return;
    v.src.playbackRate.value = c.rate;
    v.src.start();
  }
}

export const sound = new Sound();
