/**
 Visible event trace for debugging on devices where devtools are out of
 reach (phones, remote machines). Enabled by opening the page with #debug
 in the URL; renders as a fixed overlay and never interferes with input.
 */

let logImpl: ((msg: string) => void) | undefined;

function createOverlay(): (msg: string) => void {
  if (!window.location.hash.includes('debug')) return () => {};
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;' +
    'background:rgba(0,0,0,.85);color:#0f0;font:11px/1.4 monospace;' +
    'padding:4px;pointer-events:none;white-space:pre-wrap;';
  document.body.appendChild(overlay);
  const lines: string[] = ['wetty debug tv4'];
  const log = (msg: string): void => {
    lines.push(`${(performance.now() / 1000).toFixed(2)} ${msg}`);
    while (lines.length > 16) lines.shift();
    overlay.textContent = lines.join('\n');
  };
  const describe = (t: EventTarget | null): string => {
    if (!(t instanceof HTMLElement)) return 'non-element';
    const base = t.className === '' ? t.tagName : t.className;
    return t instanceof HTMLTextAreaElement
      ? `${base} im=${t.inputMode} ro=${String(t.readOnly)}`
      : base;
  };
  document.addEventListener('focusin', (e) => {
    log(`focusin ${describe(e.target)}`);
  });
  document.addEventListener('focusout', (e) => {
    log(`focusout ${describe(e.target)}`);
  });
  // The virtual keyboard shrinks the visual viewport — log it so keyboard
  // appearances can be correlated with the events that caused them.
  window.visualViewport?.addEventListener('resize', () => {
    log(`viewport h=${String(Math.round(window.visualViewport?.height ?? 0))}`);
  });
  return log;
}

export function debugLog(msg: string): void {
  logImpl ??= createOverlay();
  logImpl(msg);
}
