import type { Action } from '../player/actions';
import { ICONS, type IconName } from './icons';
import { buzz } from './haptics';
import { onSettings, saveSettings, settings } from './settings';
import {
  ANCHOR, CONTROL_IDS, MAX_D, MIN_D, clampSlot, defaultLayout, editableControls, layoutKey, mergeLayout, visibleControls,
  type ControlId, type ControlState, type Layout, type LayoutKey, type Orientation, type Slot,
} from './layout';

// Touch controls (tasks M.2 to M.5): a joystick and round icon buttons that change with what
// you are doing, placed from a layout you can edit (Menu → Settings → Edit controls).
// Shown on touch devices (coarse pointer, or after the first touch). Buttons feed actions.

const STORE = 'kc.controls';

type ButtonId = Exclude<ControlId, 'stick'>;

interface ButtonDef {
  action: Action;
  /** held down (gas, horn) or a tap (get in, unstuck) */
  hold: boolean;
  icon: IconName;
  label: string;
}

const BUTTONS: Record<ButtonId, ButtonDef> = {
  left: { action: 'left', hold: true, icon: 'left', label: 'Left' },
  right: { action: 'right', hold: true, icon: 'right', label: 'Right' },
  gas: { action: 'gas', hold: true, icon: 'gas', label: 'Gas' },
  brake: { action: 'brake', hold: true, icon: 'brake', label: 'Brake' },
  hand: { action: 'hand', hold: true, icon: 'run', label: 'Run' },
  act: { action: 'act', hold: false, icon: 'getIn', label: 'Get in' },
  horn: { action: 'horn', hold: true, icon: 'horn', label: 'Horn' },
  boost: { action: 'boost', hold: false, icon: 'boost', label: 'Boost' },
  unstuck: { action: 'unstuck', hold: false, icon: 'unstuck', label: 'Unstuck' },
  map: { action: 'map', hold: false, icon: 'map', label: 'Map' },
};

/** What the Get in button says. */
export type ActLabel = 'Get in' | 'Ride' | 'Get out';

function orientation(): Orientation {
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

function loadSaved(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class TouchControls {
  /** Joystick, -1..1 each way (down and right positive). */
  readonly stick = { x: 0, y: 0 };
  private readonly heldSet = new Set<Action>();
  private readonly taps = new Map<Action, number>();
  private readonly root = document.createElement('div');
  private readonly els = new Map<ControlId, HTMLElement>();
  private readonly knob = document.createElement('div');
  private joyId: number | null = null;
  private state: ControlState = { mode: 'foot', near: false, boosts: 0, steer: settings().steerMode };
  private saved = loadSaved();
  private layout: Layout;
  private key: LayoutKey;
  // Edit mode (M.4).
  private editPanel: HTMLElement | null = null;
  private selected: ControlId | null = null;
  private sizeInput: HTMLInputElement | null = null;
  private readonly editPointers = new Map<number, { id: ControlId; x: number; y: number }>();
  private dragStart: { id: ControlId; px: number; py: number; slot: Slot; pinch: number } | null = null;
  private onEditEnd: (() => void) | null = null;
  /** The editor shows the on-foot or the driving buttons. */
  private editMode: 'foot' | 'drive' = 'drive';

  constructor() {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (coarse) document.body.classList.add('touch');
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), { passive: true });

    this.root.id = 'ctl';
    for (const id of CONTROL_IDS) {
      const el = id === 'stick' ? this.makeStick() : this.makeButton(id);
      el.dataset.ctl = id;
      el.hidden = true;
      this.wire(el, id);
      this.els.set(id, el);
      this.root.append(el);
    }
    document.body.append(this.root);

    this.key = layoutKey(orientation(), this.state.steer);
    this.layout = mergeLayout(this.key, this.saved[this.key]);
    window.addEventListener('resize', () => this.relayout());
    screen.orientation?.addEventListener?.('change', () => this.relayout());
    onSettings((s) => {
      if (s.steerMode !== this.state.steer) this.setState({ ...this.state, steer: s.steerMode });
      this.root.style.setProperty('--ctl-opacity', String(s.ctlOpacity));
    });
    this.root.style.setProperty('--ctl-opacity', String(settings().ctlOpacity));
    this.relayout();
    this.show();
    // Esc leaves the editor (before the menu sees it and opens).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || !this.editing) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.endEdit();
      },
      true,
    );
  }

  get editing(): boolean {
    return this.editPanel !== null;
  }

  /** An action's button is held down. */
  held(a: Action): boolean {
    return this.heldSet.has(a);
  }

  /** True once per tap. */
  consume(a: Action): boolean {
    const n = this.taps.get(a) ?? 0;
    this.taps.delete(a);
    return n > 0;
  }

  /** What the player is doing changed: show the right buttons and labels. */
  setState(st: ControlState, labels?: { act: ActLabel; boosts: number }): void {
    const steerChanged = st.steer !== this.state.steer;
    this.state = st;
    if (labels) {
      const act = this.els.get('act')!;
      this.label(act, labels.act === 'Get out' ? 'getOut' : labels.act === 'Ride' ? 'ride' : 'getIn', labels.act);
      act.classList.toggle('ready', labels.act !== 'Get out');
      this.label(this.els.get('boost')!, 'boost', `Boost ${labels.boosts}`);
    }
    const driving = st.mode === 'drive';
    this.label(this.els.get('hand')!, driving ? 'drift' : 'run', driving ? 'Drift' : 'Run');
    this.label(this.els.get('map')!, st.mode === 'map' ? 'back' : 'map', st.mode === 'map' ? 'Back' : 'Map');
    if (steerChanged) this.relayout();
    if (!this.editing) this.show();
  }

  /** Open the layout editor (Menu → Settings → Edit controls). */
  startEdit(onEnd: () => void): void {
    if (this.editing) return;
    this.onEditEnd = onEnd;
    document.body.classList.add('ctledit');
    this.releaseAll();
    const panel = document.createElement('div');
    panel.id = 'ctledit';
    const title = document.createElement('b');
    const help = document.createElement('p');
    help.textContent = 'Drag a control to move it. Pinch it, or tap it and use Size, to resize.';
    const size = this.slider('Size', MIN_D, MAX_D, 60, (v) => {
      if (!this.selected) return;
      this.setSlot(this.selected, { ...this.layout[this.selected], d: v });
    });
    this.sizeInput = size.querySelector('input');
    const opacity = this.slider('Opacity', 30, 100, Math.round(settings().ctlOpacity * 100), (v) => saveSettings({ ctlOpacity: v / 100 }));
    const which = document.createElement('div');
    which.className = 'row which';
    const footB = this.panelButton('On foot', () => setMode('foot'));
    const driveB = this.panelButton('Driving', () => setMode('drive'));
    const setMode = (m: 'foot' | 'drive'): void => {
      this.editMode = m;
      footB.classList.toggle('on', m === 'foot');
      driveB.classList.toggle('on', m === 'drive');
      this.select(null);
      this.show();
    };
    which.append(footB, driveB);
    const row = document.createElement('div');
    row.className = 'row';
    const reset = this.panelButton('Reset to default', () => {
      this.layout = defaultLayout(this.key);
      delete this.saved[this.key];
      this.persist();
      this.relayout();
    });
    const done = this.panelButton('Done', () => this.endEdit());
    done.className = 'done';
    row.append(reset, done);
    panel.append(title, which, help, size, opacity, row);
    document.body.append(panel);
    this.editPanel = panel;
    this.updateEditTitle();
    setMode(this.state.mode === 'foot' ? 'foot' : 'drive');
  }

  endEdit(): void {
    if (!this.editPanel) return;
    this.editPanel.remove();
    this.editPanel = null;
    this.selected = null;
    this.sizeInput = null;
    this.editPointers.clear();
    this.dragStart = null;
    document.body.classList.remove('ctledit');
    for (const el of this.els.values()) el.classList.remove('selected');
    this.show();
    this.onEditEnd?.();
    this.onEditEnd = null;
  }

  // --- building --------------------------------------------------------------------------

  private makeStick(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ctl stick';
    this.knob.className = 'knob';
    el.append(this.knob);
    el.setAttribute('aria-label', 'Joystick');
    return el;
  }

  private makeButton(id: ButtonId): HTMLElement {
    const def = BUTTONS[id];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ctl btn b-${id}`;
    this.label(el, def.icon, def.label);
    return el;
  }

  /** Set a button's icon and label (only touches the DOM when they change). */
  private label(el: HTMLElement, icon: IconName, text: string): void {
    if (el.dataset.icon === icon && el.dataset.text === text) return;
    el.dataset.icon = icon;
    el.dataset.text = text;
    el.innerHTML = ICONS[icon]; // our own constant drawings
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    el.setAttribute('aria-label', text);
  }

  private wire(el: HTMLElement, id: ControlId): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort
      }
      if (this.editing) return this.editDown(e, id);
      if (id === 'stick') {
        this.joyId = e.pointerId;
        this.joyMove(e);
        return;
      }
      const def = BUTTONS[id];
      buzz(12);
      if (def.hold) {
        this.heldSet.add(def.action);
        el.classList.add('down');
      } else {
        this.taps.set(def.action, (this.taps.get(def.action) ?? 0) + 1);
        el.classList.add('down');
        setTimeout(() => el.classList.remove('down'), 120);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.editing) return this.editMove(e);
      if (id === 'stick' && e.pointerId === this.joyId) this.joyMove(e);
    });
    const up = (e: PointerEvent): void => {
      if (this.editing) {
        this.editPointers.delete(e.pointerId);
        this.dragStart = null;
        return;
      }
      if (id === 'stick') {
        if (e.pointerId !== this.joyId) return;
        this.joyId = null;
        this.stick.x = this.stick.y = 0;
        this.knob.style.transform = '';
        return;
      }
      const def = BUTTONS[id];
      if (def.hold) {
        this.heldSet.delete(def.action);
        el.classList.remove('down');
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private joyMove(e: PointerEvent): void {
    const el = this.els.get('stick')!;
    const r = el.getBoundingClientRect();
    const reach = r.width * 0.37;
    let dx = (e.clientX - (r.left + r.width / 2)) / reach;
    let dy = (e.clientY - (r.top + r.height / 2)) / reach;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    this.stick.x = dx;
    this.stick.y = dy;
    const travel = r.width * 0.29;
    this.knob.style.transform = `translate(${(dx * travel).toFixed(1)}px, ${(dy * travel).toFixed(1)}px)`;
  }

  // --- showing and placing ---------------------------------------------------------------

  private show(): void {
    const on = this.editing ? editableControls(this.state.steer, this.editMode) : visibleControls(this.state);
    for (const [id, el] of this.els) {
      const vis = on.has(id);
      if (el.hidden === vis) el.hidden = !vis;
      if (!vis && id !== 'stick') {
        // A button that disappears while held (gas when you get out) lets go.
        const def = BUTTONS[id];
        if (def.hold && this.heldSet.delete(def.action)) el.classList.remove('down');
      }
    }
    if (!on.has('stick') && this.joyId !== null) {
      this.joyId = null;
      this.stick.x = this.stick.y = 0;
      this.knob.style.transform = '';
    }
  }

  private relayout(): void {
    const key = layoutKey(orientation(), this.state.steer);
    if (key !== this.key) {
      this.key = key;
      this.layout = mergeLayout(key, this.saved[key]);
      this.updateEditTitle();
      if (this.editing) this.show();
    }
    for (const id of CONTROL_IDS) this.place(id);
    if (this.selected && this.sizeInput) this.sizeInput.value = String(this.layout[this.selected].d);
  }

  private place(id: ControlId): void {
    const el = this.els.get(id)!;
    const slot = clampSlot(this.layout[id], window.innerWidth, window.innerHeight);
    const r = slot.d / 2;
    const st = el.style;
    st.width = st.height = `${slot.d}px`;
    st.left = st.right = st.top = st.bottom = '';
    const a = ANCHOR[id];
    const off = (side: string, v: number): string => `calc(env(safe-area-inset-${side}) + ${(v - r).toFixed(0)}px)`;
    if (a === 'leftBottom') {
      st.left = off('left', slot.x);
      st.bottom = off('bottom', slot.y);
    } else if (a === 'rightBottom') {
      st.right = off('right', slot.x);
      st.bottom = off('bottom', slot.y);
    } else {
      st.right = off('right', slot.x);
      st.top = off('top', slot.y);
    }
    // Icons and labels grow with the button.
    st.setProperty('--s', (slot.d / 70).toFixed(2));
  }

  private releaseAll(): void {
    this.heldSet.clear();
    this.taps.clear();
    this.joyId = null;
    this.stick.x = this.stick.y = 0;
    this.knob.style.transform = '';
    for (const el of this.els.values()) el.classList.remove('down');
  }

  // --- layout editor (M.4) ---------------------------------------------------------------

  private editDown(e: PointerEvent, id: ControlId): void {
    this.editPointers.set(e.pointerId, { id, x: e.clientX, y: e.clientY });
    this.select(id);
    const mine = [...this.editPointers.values()].filter((p) => p.id === id);
    const pinch = mine.length >= 2 ? Math.hypot(mine[0].x - mine[1].x, mine[0].y - mine[1].y) : 0;
    this.dragStart = { id, px: e.clientX, py: e.clientY, slot: { ...this.layout[id] }, pinch };
  }

  private editMove(e: PointerEvent): void {
    const p = this.editPointers.get(e.pointerId);
    const d = this.dragStart;
    if (!p || !d) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const mine = [...this.editPointers.values()].filter((q) => q.id === d.id);
    if (d.pinch > 0 && mine.length >= 2) {
      const now = Math.hypot(mine[0].x - mine[1].x, mine[0].y - mine[1].y);
      this.setSlot(d.id, { ...d.slot, d: (d.slot.d * now) / d.pinch });
      return;
    }
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const a = ANCHOR[d.id];
    this.setSlot(d.id, {
      d: d.slot.d,
      x: a === 'leftBottom' ? d.slot.x + dx : d.slot.x - dx,
      y: a === 'rightTop' ? d.slot.y + dy : d.slot.y - dy,
    });
  }

  private setSlot(id: ControlId, slot: Slot): void {
    this.layout[id] = clampSlot(slot, window.innerWidth, window.innerHeight);
    this.saved[this.key] = this.layout;
    this.persist();
    this.place(id);
    if (id === this.selected && this.sizeInput) this.sizeInput.value = String(Math.round(this.layout[id].d));
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.saved));
    } catch {
      // private browsing: the layout lasts until the page closes
    }
  }

  private select(id: ControlId | null): void {
    this.selected = id;
    for (const [cid, el] of this.els) el.classList.toggle('selected', cid === id);
    if (this.sizeInput) {
      this.sizeInput.disabled = !id;
      if (id) this.sizeInput.value = String(Math.round(this.layout[id].d));
    }
  }

  private updateEditTitle(): void {
    const title = this.editPanel?.querySelector('b');
    if (!title) return;
    const [o, g] = this.key.split('-');
    title.textContent = `Edit controls: ${o}, ${g === 'stick' ? 'joystick steering' : 'pedal buttons'}`;
  }

  private slider(text: string, min: number, max: number, value: number, onInput: (v: number) => void): HTMLLabelElement {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = text;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    label.append(span, input);
    return label;
  }

  private panelButton(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
