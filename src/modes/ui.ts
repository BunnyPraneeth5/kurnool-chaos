import * as THREE from 'three';
import type { Room } from '../net/room';
import type { RoundController } from './round';
import { ROUND_MINUTES, type ModeId, type RoundState } from './types';

// Game-round screens (TASKS G.2): the lobby card (mode, length, Ready, Start),
// the 3-2-1-GO countdown, the round bar (timer, role, goal, arrow to the target)
// and the results card. All player text goes through textContent.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

export class GameUi {
  private readonly card = el('div');
  private readonly countdown = el('div');
  private readonly bar = el('div');
  private readonly timer = el('div', 'timer');
  private readonly role = el('div', 'role');
  private readonly goal = el('div', 'goal');
  private readonly arrowBox = el('div', 'arrowbox');
  private readonly arrow = el('div', 'arrow');
  private readonly dist = el('span', 'dist');
  private readonly results = el('div');
  private collapsed = false;
  private readonly fwd = new THREE.Vector3();

  constructor(
    private readonly ctrl: RoundController,
    private readonly room: Room,
    private readonly camera: THREE.Camera,
  ) {
    this.card.id = 'gamecard';
    this.countdown.id = 'countdown';
    this.countdown.hidden = true;
    this.bar.id = 'gamebar';
    this.bar.hidden = true;
    this.arrowBox.append(this.arrow, this.dist);
    this.bar.append(this.timer, this.role, this.goal, this.arrowBox);
    this.results.id = 'results';
    this.results.hidden = true;
    document.body.append(this.card, this.countdown, this.bar, this.results);
    this.renderCard();
  }

  /** Rebuild the lobby card and results (on state changes). */
  refresh(): void {
    this.renderCard();
    this.renderResults();
  }

  /** Per frame: countdown number, timer, goal and arrow. */
  update(): void {
    const c = this.ctrl;
    const s = c.state;
    const now = performance.now();
    const left = c.leftMs(now);
    const inRound = s.players.includes(this.room.myId);

    // Countdown: 3, 2, 1, GO!
    const showCount = inRound && (s.phase === 'countdown' || (s.phase === 'playing' && c.elapsedMs(now) < 900));
    this.countdown.hidden = !showCount;
    if (showCount) setText(this.countdown, s.phase === 'countdown' && left > 500 ? String(Math.ceil((left - 500) / 1000)) : 'GO!');

    // Round bar.
    const playing = s.phase === 'playing';
    this.bar.hidden = !playing;
    if (!playing) return;
    setText(this.timer, clock(left));
    const hud = c.mode.hud({ ...s, elapsedMs: c.elapsedMs(now) }, this.room.myId, c.ctx, c.elapsedMs(now));
    setText(this.role, inRound ? (hud.role ?? c.mode.name) : `${c.mode.name}: you'll join the next round`);
    setText(this.goal, hud.goal);
    const me = c.ctx.posOf(this.room.myId);
    const t = inRound ? hud.target : undefined;
    this.arrowBox.hidden = !t || !me;
    if (t && me) {
      const vx = t.x - me.x;
      const vz = t.z - me.z;
      this.camera.getWorldDirection(this.fwd);
      // Headings: forward = (sin a, cos a); a bigger angle is further left.
      let diff = Math.atan2(vx, vz) - Math.atan2(this.fwd.x, this.fwd.z);
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.arrow.style.transform = `rotate(${(-diff * 180) / Math.PI}deg)`;
      const d = Math.hypot(vx, vz);
      setText(this.dist, d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
    }
  }

  /** The target to ring on the minimap (any mode), or null. */
  mapTarget(): { x: number; z: number } | null {
    const c = this.ctrl;
    const s = c.state;
    if (s.phase !== 'playing' || !s.players.includes(this.room.myId)) return null;
    return c.mode.hud(s, this.room.myId, c.ctx, c.elapsedMs()).target ?? null;
  }

  /** A second marker in the world (a challenge's bonus gate), or null. */
  marker(): { x: number; z: number } | null {
    const c = this.ctrl;
    const s = c.state;
    if (s.phase !== 'playing' || !s.players.includes(this.room.myId)) return null;
    return c.mode.hud(s, this.room.myId, c.ctx, c.elapsedMs()).marker ?? null;
  }

  /** What the world should show this frame (beacon target). */
  beaconTarget(): { x: number; z: number } | null {
    const c = this.ctrl;
    const s = c.state;
    if (s.phase !== 'playing' || !s.players.includes(this.room.myId)) return null;
    const hud = c.mode.hud(s, this.room.myId, c.ctx, c.elapsedMs());
    return hud.beacon && hud.target ? hud.target : null;
  }

  private renderCard(): void {
    const c = this.ctrl;
    const s = c.state;
    this.card.hidden = s.phase !== 'lobby';
    if (this.card.hidden) return;
    const host = this.room.isHost;
    const head = el('button', 'cardhead', `${this.collapsed ? '▸' : '▾'} Next game: ${c.mode.name} · ${s.mins} min`);
    head.type = 'button';
    head.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.renderCard();
    });
    const parts: HTMLElement[] = [head];
    if (!this.collapsed) {
      if (host) {
        const modes = el('div', 'choices');
        for (const m of Object.values(c.modes)) {
          const b = el('button', m.id === s.mode ? 'on' : '', m.name);
          b.type = 'button';
          if (m.available === false) {
            b.disabled = true;
            b.title = m.blurb;
          }
          b.addEventListener('click', () => c.setMode(m.id as ModeId));
          modes.append(b);
        }
        const mins = el('div', 'choices');
        for (const n of ROUND_MINUTES) {
          const b = el('button', n === s.mins ? 'on' : '', `${n} min`);
          b.type = 'button';
          b.addEventListener('click', () => c.setMins(n));
          mins.append(b);
        }
        parts.push(modes, mins);
      }
      parts.push(el('p', 'blurb', c.mode.blurb));
      const n = this.room.players.length;
      const ready = this.room.players.filter((p) => c.isReady(p.id)).length;
      const row = el('div', 'actions');
      const meReady = c.isReady(this.room.myId);
      const readyBtn = el('button', meReady ? 'on' : '', meReady ? 'Ready ✓' : "I'm ready");
      readyBtn.type = 'button';
      readyBtn.addEventListener('click', () => c.toggleReady());
      row.append(el('span', 'count', `${ready}/${n} ready`), readyBtn);
      if (host) {
        const allReady = ready >= n;
        const start = el('button', 'start', n < 2 ? 'Need 2 players' : 'Start');
        start.type = 'button';
        start.disabled = n < 2;
        start.addEventListener('click', () => {
          if (!allReady && !start.classList.contains('armed')) {
            start.classList.add('armed');
            start.textContent = 'Start anyway?';
            window.setTimeout(() => {
              start.classList.remove('armed');
              start.textContent = 'Start';
            }, 3000);
            return;
          }
          c.start();
        });
        row.append(start);
      }
      parts.push(row);
      if (!host) {
        const hostNick = this.room.players.find((p) => p.id === this.room.hostId)?.nick ?? 'the host';
        parts.push(el('p', 'wait', `Waiting for ${hostNick} to start. Drive around meanwhile!`));
      }
    }
    this.card.replaceChildren(...parts);
  }

  private renderResults(): void {
    const s = this.ctrl.state;
    this.results.hidden = s.phase !== 'results';
    if (this.results.hidden) return;
    this.results.replaceChildren(...this.resultsRows(s));
  }

  private resultsRows(s: RoundState): HTMLElement[] {
    const c = this.ctrl;
    const rows: HTMLElement[] = [el('h3', '', `Round over: ${c.mode.name}`)];
    const ranked = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
    const ol = el('ul');
    ranked.forEach((id, i) => {
      const li = el('li');
      const name = el('span', 'name', `${i + 1}. ${c.ctx.nickOf(id)}${id === this.room.myId ? ' (you)' : ''}`);
      const role = s.roles[id] ? el('span', 'tag', s.roles[id]) : null;
      li.append(name);
      if (role) li.append(role);
      li.append(el('b', '', String(s.scores[id] ?? 0)));
      ol.append(li);
    });
    rows.push(ol, el('p', 'wait', 'Back to the lobby in a few seconds'));
    return rows;
  }
}
