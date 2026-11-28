// A small pop-up wheel of choices (tasks M.6 and M.9): the emote wheel and the weapon wheel.
// Tap a choice, or press its number key; tapping outside or Esc closes it. Text by textContent.

export interface WheelItem {
  /** short text under the symbol */
  label: string;
  /** an emoji or short symbol */
  symbol: string;
  /** shown but cannot be picked (no ammo) */
  off?: boolean;
}

export class Wheel {
  private readonly root = document.createElement('div');
  private onPick: ((i: number) => void) | null = null;
  private items: WheelItem[] = [];

  constructor() {
    this.root.id = 'wheel';
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.append(this.root);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape' && this.isOpen) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(title: string, items: WheelItem[], onPick: (i: number) => void): void {
    this.items = items;
    this.onPick = onPick;
    const box = document.createElement('div');
    box.className = 'wbox';
    const head = document.createElement('b');
    head.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'wgrid';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !!it.off;
      const sym = document.createElement('i');
      sym.textContent = it.symbol;
      const lab = document.createElement('span');
      lab.textContent = `${i + 1} ${it.label}`;
      b.append(sym, lab);
      b.addEventListener('click', () => this.pick(i + 1));
      grid.append(b);
    });
    box.append(head, grid);
    this.root.replaceChildren(box);
    this.root.hidden = false;
  }

  /** Pick choice number n (1 = first); false if there is none or it is off. */
  pick(n: number): boolean {
    const it = this.items[n - 1];
    if (!this.isOpen || !it || it.off) return false;
    const f = this.onPick;
    this.close();
    f?.(n - 1);
    return true;
  }

  close(): void {
    this.root.hidden = true;
    this.onPick = null;
  }
}
