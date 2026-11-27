// The menu screen (TASKS H.2): a Menu button (and Esc) opens it over the game. Pages are
// added by whoever owns them (guide, settings, room, stats, about); Resume and Leave/Exit
// are always there. All text is set with textContent.

export interface MenuPage {
  id: string;
  title: string;
  /** Build the page each time it is shown (stats change, the room list changes). */
  render(): HTMLElement | HTMLElement[];
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function btn(text: string, cls = '', onClick?: () => void): HTMLButtonElement {
  const b = h('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export class Menu {
  readonly root = h('div');
  private readonly tabs = h('nav', 'tabs');
  private readonly body = h('div', 'mbody');
  private readonly pages: MenuPage[] = [];
  private current = '';
  private readonly openBtn = btn('☰ Menu', '', () => this.open());
  /** Changes when the menu opens or closes. */
  onToggle: (open: boolean) => void = () => {};

  private leave: { label: string; armed: string; run: () => void } | null = null;

  constructor() {
    this.root.id = 'menu';
    this.root.hidden = true;
    this.openBtn.id = 'menubtn';
    this.openBtn.title = 'Menu (Esc)';
    this.openBtn.hidden = true; // shown once the game is running
    const head = h('div', 'mhead');
    head.append(h('b', '', 'Kurnool Chaos'), btn('Resume ✕', 'resume', () => this.close()));
    this.root.append(head, this.tabs, this.body);
    document.body.append(this.openBtn, this.root);
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.isOpen) this.close();
        else this.open();
      } else if (e.code === 'KeyG' && !e.repeat) {
        if (this.isOpen && this.current === 'guide') this.close();
        else this.open('guide');
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  add(page: MenuPage, before?: string): void {
    const i = before ? this.pages.findIndex((p) => p.id === before) : -1;
    if (i >= 0) this.pages.splice(i, 0, page);
    else this.pages.push(page);
  }

  /** The game is running: show the Menu button and the Leave/Exit entry. */
  start(leave: { label: string; armed: string; run: () => void }): void {
    this.leave = leave;
    this.openBtn.hidden = false;
  }

  open(id?: string): void {
    const wasOpen = this.isOpen;
    this.root.hidden = false;
    document.body.classList.add('menuopen');
    this.show(id ?? (this.current || this.pages[0]?.id || ''));
    if (!wasOpen) this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.body.classList.remove('menuopen');
    this.onToggle(false);
  }

  /** Re-draw the open page (its data changed). */
  refresh(id?: string): void {
    if (this.isOpen && (!id || id === this.current)) this.show(this.current);
  }

  show(id: string): void {
    const page = this.pages.find((p) => p.id === id) ?? this.pages[0];
    if (!page) return;
    this.current = page.id;
    const tabs = this.pages.map((p) => {
      const b = btn(p.title, p.id === page.id ? 'on' : '', () => this.show(p.id));
      b.setAttribute('aria-pressed', String(p.id === page.id));
      return b;
    });
    if (this.leave) tabs.push(this.leaveButton(this.leave));
    this.tabs.replaceChildren(...tabs);
    const out = page.render();
    this.body.replaceChildren(...(Array.isArray(out) ? out : [out]));
    this.body.scrollTop = 0;
  }

  private leaveButton(leave: { label: string; armed: string; run: () => void }): HTMLButtonElement {
    const b = btn(leave.label, 'leave');
    let timer = 0;
    b.addEventListener('click', () => {
      if (b.classList.contains('armed')) {
        clearTimeout(timer);
        leave.run();
        return;
      }
      b.classList.add('armed');
      b.textContent = leave.armed;
      timer = window.setTimeout(() => {
        b.classList.remove('armed');
        b.textContent = leave.label;
      }, 3000);
    });
    return b;
  }
}
