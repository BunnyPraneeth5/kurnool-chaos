import { CHAT_MAX, EMOTES } from '../net/roomTypes';

// Room chat: a bar with quick emotes and a short text box (T or Enter opens it on
// a keyboard, the Chat button on phones), and a feed of recent lines in the top
// left that fade out. Also shows "joined / left / removed" notices.
// All text goes through textContent.

const LINE_MS = 9000;
const MAX_LINES = 6;

export interface ChatSender {
  /** Returns false if the message could not be sent (too fast or offline). */
  send(text: string, emote: boolean): boolean;
}

export class ChatUi {
  private readonly feed = document.createElement('div');
  private readonly bar = document.createElement('div');
  private readonly input = document.createElement('input');

  constructor(private readonly sender: ChatSender) {
    this.feed.id = 'chatfeed';
    this.feed.setAttribute('aria-live', 'polite');
    this.bar.id = 'chatbar';
    this.bar.hidden = true;

    const emotes = document.createElement('div');
    emotes.className = 'emotes';
    for (const e of EMOTES) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: e });
      b.addEventListener('click', () => {
        if (this.sendOrWarn(e, true)) this.close();
      });
      emotes.append(b);
    }
    const row = document.createElement('div');
    row.className = 'row';
    Object.assign(this.input, { type: 'text', maxLength: CHAT_MAX, placeholder: 'Say something…', autocomplete: 'off', enterKeyHint: 'send' });
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.spellcheck = false;
    const send = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Send' });
    const close = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕', className: 'x' });
    close.setAttribute('aria-label', 'Close chat');
    send.addEventListener('click', () => this.sendText());
    close.addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendText();
      else if (e.key === 'Escape') this.close();
    });
    row.append(this.input, send, close);
    this.bar.append(emotes, row);
    document.body.append(this.feed, this.bar);

    window.addEventListener('keydown', (e) => {
      if (!this.bar.hidden || document.body.classList.contains('mapview')) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter' || e.code === 'KeyT') {
        e.preventDefault();
        this.open();
      }
    });
  }

  open(): void {
    this.bar.hidden = false;
    // On phones, focusing pops the keyboard over the game; let them tap the box (or just an emote).
    if (!window.matchMedia?.('(pointer: coarse)').matches) this.input.focus();
  }

  close(): void {
    this.bar.hidden = true;
    this.input.value = '';
    this.input.blur();
  }

  /** A message from someone (or ourselves). */
  line(nick: string, colour: string, text: string): void {
    const div = document.createElement('div');
    const who = Object.assign(document.createElement('b'), { textContent: nick });
    who.style.color = colour;
    div.append(who, document.createTextNode(` ${text}`));
    this.add(div);
  }

  /** A notice: joined, left, removed, host changes. */
  notice(text: string): void {
    this.add(Object.assign(document.createElement('div'), { className: 'notice', textContent: text }));
  }

  private add(div: HTMLElement): void {
    this.feed.append(div);
    while (this.feed.children.length > MAX_LINES) this.feed.firstElementChild?.remove();
    window.setTimeout(() => div.classList.add('fade'), LINE_MS);
    window.setTimeout(() => div.remove(), LINE_MS + 1200);
  }

  private sendText(): void {
    const t = this.input.value.trim();
    if (!t) {
      this.close();
      return;
    }
    if (this.sendOrWarn(t, false)) this.close();
  }

  private sendOrWarn(text: string, emote: boolean): boolean {
    if (this.sender.send(text, emote)) return true;
    this.notice('Not sent: wait a moment (or you are reconnecting)');
    return false;
  }
}
