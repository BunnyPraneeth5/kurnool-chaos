import { roomLink } from '../net/ids';
import { cssColour, playerColour, type PlayerInfo, type RoomStatus } from '../net/roomTypes';

// In-room HUD: room code with a Share button, the player list, and a
// "Reconnecting" banner. Nicknames are set with textContent only.

export class RoomHud {
  private readonly panel = document.createElement('div');
  private readonly list = document.createElement('ul');
  private readonly banner = document.createElement('div');

  constructor(
    private readonly code: string,
    private readonly myId: string,
    private readonly toast: (msg: string) => void,
  ) {
    this.panel.id = 'room';
    const head = document.createElement('div');
    head.className = 'head';
    const label = Object.assign(document.createElement('span'), { textContent: `Room ${code}` });
    const share = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Share' });
    share.addEventListener('click', () => void this.share());
    head.append(label, share);
    this.panel.append(head, this.list);
    this.banner.id = 'netbanner';
    this.banner.hidden = true;
    this.banner.textContent = 'Reconnecting…';
    document.body.append(this.panel, this.banner);
  }

  setPlayers(players: PlayerInfo[]): void {
    const items = players.map((p) => {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = cssColour(playerColour(p.slot));
      const name = document.createElement('span');
      name.textContent = p.id === this.myId ? `${p.nick} (you)` : p.nick;
      li.append(dot, name);
      return li;
    });
    this.list.replaceChildren(...items);
  }

  setStatus(s: RoomStatus): void {
    this.banner.hidden = s === 'online';
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
      this.toast('Link copied');
    } catch {
      this.toast(url); // no clipboard access (http on a phone): show the link to copy by hand
    }
  }
}
