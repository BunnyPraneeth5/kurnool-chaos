// Full-screen loading and error messages. Errors always say what went wrong and
// offer a retry, never a blank screen (ARCHITECTURE: Errors).

const el = document.getElementById('status');
if (!el) throw new Error('#status element missing from index.html');
const box: HTMLElement = el;

export function showLoading(text: string): void {
  box.hidden = false;
  box.className = 'loading';
  box.replaceChildren(Object.assign(document.createElement('p'), { textContent: text }));
}

export interface StatusAction {
  label: string;
  run: () => void;
}

/** Error screen. Without actions it offers Retry (reload the page). */
export function showError(title: string, detail: string, actions?: StatusAction[]): void {
  box.hidden = false;
  box.className = 'error';
  const h = Object.assign(document.createElement('h2'), { textContent: title });
  const p = Object.assign(document.createElement('p'), { textContent: detail });
  const list = actions ?? [{ label: 'Retry', run: () => location.reload() }];
  const row = document.createElement('div');
  row.className = 'actions';
  for (const a of list) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: a.label });
    btn.addEventListener('click', a.run);
    row.append(btn);
  }
  box.replaceChildren(h, p, row);
}

/** A problem that does not stop the game: a box at the top, over every screen, until a
 * button is tapped. A newer notice replaces the one showing. */
export function showNotice(title: string, detail: string, actions: StatusAction[]): void {
  document.getElementById('notice')?.remove();
  const note = Object.assign(document.createElement('div'), { id: 'notice' });
  note.setAttribute('role', 'alert');
  const row = document.createElement('div');
  row.className = 'actions';
  for (const a of actions) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: a.label });
    btn.addEventListener('click', () => {
      note.remove();
      a.run();
    });
    row.append(btn);
  }
  note.append(Object.assign(document.createElement('b'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: detail }), row);
  document.body.append(note);
}

export function hideStatus(): void {
  box.hidden = true;
  box.replaceChildren();
}
