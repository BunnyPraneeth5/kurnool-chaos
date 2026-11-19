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

export function showError(title: string, detail: string): void {
  box.hidden = false;
  box.className = 'error';
  const h = Object.assign(document.createElement('h2'), { textContent: title });
  const p = Object.assign(document.createElement('p'), { textContent: detail });
  const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Retry' });
  btn.addEventListener('click', () => location.reload());
  box.replaceChildren(h, p, btn);
}

export function hideStatus(): void {
  box.hidden = true;
  box.replaceChildren();
}
