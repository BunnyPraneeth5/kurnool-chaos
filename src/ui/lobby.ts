import { NICK_MAX, cleanNick, loadNick, newRoomCode, parseRoomCode, saveNick } from '../net/ids';

// Start screen (Bunny's pick, 2026-11-25). Without a room link: nickname plus
// Create room / Join with code / Play alone. With a room link: nickname and Join.
// Drawn in the #status overlay; all player text goes through textContent.

export type LobbyChoice = { kind: 'solo' } | { kind: 'room'; code: string; nick: string };

const el = document.getElementById('status');
if (!el) throw new Error('#status element missing from index.html');
const box: HTMLElement = el;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

export function runLobby(linkCode: string | null, openGuide: () => void): Promise<LobbyChoice> {
  return new Promise((resolve) => {
    box.hidden = false;
    box.className = 'lobby';
    const title = make('h1', { textContent: 'Kurnool Chaos' });
    const err = make('p', { className: 'err' });
    err.setAttribute('role', 'alert');
    const nick = make('input', {
      type: 'text',
      value: loadNick(),
      maxLength: NICK_MAX,
      placeholder: 'Your nickname',
      autocomplete: 'off',
      enterKeyHint: 'go',
    });
    nick.setAttribute('aria-label', 'Nickname');
    nick.spellcheck = false;

    const readNick = (): string | null => {
      const n = cleanNick(nick.value);
      if (!n) {
        err.textContent = 'Type a nickname first.';
        nick.focus();
        return null;
      }
      saveNick(n);
      return n;
    };
    const done = (c: LobbyChoice): void => {
      box.replaceChildren();
      resolve(c);
    };
    const enterRoom = (code: string): void => {
      const n = readNick();
      if (n) done({ kind: 'room', code, nick: n });
    };
    const solo = make('button', { type: 'button', className: 'link', textContent: 'Play alone' });
    solo.addEventListener('click', () => done({ kind: 'solo' }));
    const guide = make('button', { type: 'button', className: 'link', textContent: 'How to play (guide)' });
    guide.addEventListener('click', openGuide);

    if (linkCode) {
      const sub = make('p', { textContent: `Join room ${linkCode}` });
      const join = make('button', { type: 'button', textContent: 'Join' });
      join.addEventListener('click', () => enterRoom(linkCode));
      nick.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') enterRoom(linkCode);
      });
      solo.textContent = 'Play alone instead';
      box.replaceChildren(title, sub, nick, join, err, solo, guide);
    } else {
      const create = make('button', { type: 'button', textContent: 'Create room' });
      create.addEventListener('click', () => enterRoom(newRoomCode()));
      nick.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') enterRoom(newRoomCode());
      });
      const code = make('input', { type: 'text', maxLength: 7, placeholder: 'Room code', autocomplete: 'off', enterKeyHint: 'go' });
      code.setAttribute('aria-label', 'Room code');
      code.spellcheck = false;
      code.autocapitalize = 'characters';
      const join = make('button', { type: 'button', className: 'second', textContent: 'Join' });
      const tryJoin = (): void => {
        const c = parseRoomCode(code.value);
        if (!c) {
          err.textContent = 'Room codes are 6 letters and digits, like K7MPQ2.';
          code.focus();
          return;
        }
        enterRoom(c);
      };
      join.addEventListener('click', tryJoin);
      code.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryJoin();
      });
      const row = make('div', { className: 'row' });
      row.append(code, join);
      box.replaceChildren(title, nick, create, make('p', { className: 'or', textContent: 'or join a friend' }), row, err, solo, guide);
    }
    // Phones pop the keyboard over the game; only autofocus where there is a real keyboard.
    if (!window.matchMedia?.('(pointer: coarse)').matches && !nick.value) nick.focus();
  });
}
