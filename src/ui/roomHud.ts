import { NICK_MAX, roomLink } from '../net/ids';
import { cssColour, playerColour, type PlayerInfo, type RoomStatus } from '../net/roomTypes';

// In-room HUD: room code, Share, chat and Leave buttons, the player list with a
// menu per player (go to, block, kick for the host, rename yourself), and the
// "Reconnecting" banner. All player text is set with textContent.

export interface RoomHudActions {
  hostId(): string;
  goTo(id: string): void;
  setBlocked(id: string, blocked: boolean): void;
  kick(id: string): void;
  rename(nick: string): Promise<boolean>;
  leave(): void;
  openChat(): void;
  toast(msg: string): void;
}

function button(text: string, cls = ''): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
  if (cls) b.className = cls;
  return b;
}

/** A button that asks once more before acting: first tap arms it for 3 s. */
export function confirmButton(label: string, armedLabel: string, onConfirm: () => void, cls = ''): HTMLButtonElement {
  const b = button(label, cls);
  let timer = 0;
  b.addEventListener('click', () => {
    if (b.classList.contains('armed')) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    b.classList.add('armed');
    b.textContent = armedLabel;
    timer = window.setTimeout(() => {
      b.classList.remove('armed');
      b.textContent = label;
    }, 3000);
  });
  return b;
}

/** Exit button for solo play (back to the start screen). */
export function addSoloExit(onExit: () => void): void {
  const bar = document.createElement('div');
  bar.id = 'room';
  bar.className = 'solo';
  const head = document.createElement('div');
  head.className = 'head';
  head.append(Object.assign(document.createElement('span'), { textContent: 'Playing alone' }), confirmButton('Exit', 'Exit?', onExit, 'leave'));
  bar.append(head);
  document.body.append(bar);
}

export class RoomHud {
  private readonly panel = document.createElement('div');
  private readonly list = document.createElement('ul');
  private readonly banner = document.createElement('div');
  private players: PlayerInfo[] = [];
  private readonly blocked = new Set<string>();
  /** Whose menu is open. */
  private menuFor: string | null = null;
  /** The rename box survives list updates, so typing is not lost. */
  private selfMenuEl: HTMLElement | null = null;

  constructor(
    private readonly code: string,
    private readonly myId: string,
    private readonly act: RoomHudActions,
  ) {
    this.panel.id = 'room';
    const head = document.createElement('div');
    head.className = 'head';
    const label = Object.assign(document.createElement('span'), { textContent: `Room ${code}` });
    const share = button('Share');
    share.addEventListener('click', () => void this.share());
    const chat = button('Chat');
    chat.title = 'Chat (T or Enter)';
    chat.addEventListener('click', () => act.openChat());
    const leave = confirmButton('Leave', 'Leave?', () => act.leave(), 'leave');
    head.append(label, share, chat, leave);
    this.panel.append(head, this.list);
    this.banner.id = 'netbanner';
    this.banner.hidden = true;
    this.banner.textContent = 'Reconnecting…';
    document.body.append(this.panel, this.banner);
    // Tap anywhere else closes a player menu.
    document.addEventListener('pointerdown', (e) => {
      if (this.menuFor && !(e.target instanceof Node && this.list.contains(e.target))) {
        this.menuFor = null;
        this.render();
      }
    });
  }

  isBlocked(id: string): boolean {
    return this.blocked.has(id);
  }

  setPlayers(players: PlayerInfo[]): void {
    this.players = players;
    if (this.menuFor && !players.some((p) => p.id === this.menuFor)) this.menuFor = null;
    this.render();
  }

  setStatus(s: RoomStatus): void {
    this.banner.hidden = s === 'online';
  }

  private render(): void {
    const host = this.act.hostId();
    if (this.menuFor !== this.myId) this.selfMenuEl = null;
    const items: HTMLElement[] = [];
    for (const p of this.players) {
      const me = p.id === this.myId;
      const li = document.createElement('li');
      li.className = 'player';
      if (this.blocked.has(p.id)) li.classList.add('blocked');
      const row = button('', 'prow');
      const dot = document.createElement('i');
      dot.style.background = cssColour(playerColour(p.slot));
      const name = document.createElement('span');
      let text = p.nick;
      if (me) text += ' (you)';
      if (this.blocked.has(p.id)) text += ' (blocked)';
      name.textContent = text;
      row.append(dot, name);
      if (p.id === host) row.append(Object.assign(document.createElement('b'), { textContent: 'HOST', className: 'host' }));
      row.addEventListener('click', () => {
        this.menuFor = this.menuFor === p.id ? null : p.id;
        this.render();
      });
      li.append(row);
      if (this.menuFor === p.id) {
        if (me) li.append((this.selfMenuEl ??= this.selfMenu(p)));
        else li.append(this.playerMenu(p, host === this.myId));
      }
      items.push(li);
    }
    this.list.replaceChildren(...items);
  }

  private playerMenu(p: PlayerInfo, iAmHost: boolean): HTMLElement {
    const m = document.createElement('div');
    m.className = 'pmenu';
    const goTo = button('Go to');
    goTo.addEventListener('click', () => {
      this.menuFor = null;
      this.act.goTo(p.id);
      this.render();
    });
    const isBlocked = this.blocked.has(p.id);
    const block = button(isBlocked ? 'Unblock' : 'Block');
    block.title = 'Hide this player on your screen only';
    block.addEventListener('click', () => {
      if (isBlocked) this.blocked.delete(p.id);
      else this.blocked.add(p.id);
      this.act.setBlocked(p.id, !isBlocked);
      this.menuFor = null;
      this.render();
    });
    m.append(goTo, block);
    if (iAmHost) {
      m.append(
        confirmButton('Kick', 'Kick?', () => {
          this.menuFor = null;
          this.act.kick(p.id);
        }, 'leave'),
      );
    }
    return m;
  }

  private selfMenu(p: PlayerInfo): HTMLElement {
    const m = document.createElement('div');
    m.className = 'pmenu';
    const input = Object.assign(document.createElement('input'), { type: 'text', value: p.nick, maxLength: NICK_MAX, autocomplete: 'off' });
    input.setAttribute('aria-label', 'New nickname');
    input.spellcheck = false;
    const save = button('Rename');
    const go = async (): Promise<void> => {
      save.disabled = true;
      const ok = await this.act.rename(input.value);
      if (!ok) {
        this.act.toast('Could not rename');
        save.disabled = false;
        return;
      }
      this.menuFor = null;
      this.render();
    };
    save.addEventListener('click', () => void go());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void go();
      if (e.key === 'Escape') {
        this.menuFor = null;
        this.render();
      }
    });
    m.append(input, save);
    if (!window.matchMedia?.('(pointer: coarse)').matches) queueMicrotask(() => input.select());
    return m;
  }

  private async share(): Promise<void> {
    const url = roomLink(this.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Kurnool Chaos', text: `Join my Kurnool Chaos room ${this.code}`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.act.toast('Link copied');
    } catch {
      this.act.toast(url); // no clipboard access (http on a phone): show the link to copy by hand
    }
  }
}
