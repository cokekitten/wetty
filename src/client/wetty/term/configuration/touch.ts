import { debugLog } from './debug';
import type { Term } from '../../term';

// Primary pointer is a finger (phones/tablets) — touch-screen laptops keep
// their physical-keyboard behavior.
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

/**
 Deliberately summon the soft keyboard. On coarse-pointer devices the
 helper textarea is kept at inputmode="none" AND unfocused, so that no
 browser-initiated focus (synthesized clicks, tap-target snapping) can
 ever raise the keyboard. Summoning flips inputmode to "text" and focuses
 from the clean unfocused state — mobile browsers only re-evaluate the
 keyboard on a fresh focus, not on a blur()/focus() dance inside one task.
 @param term - the wetty terminal to focus
 */
export function summonKeyboard(term: Term): void {
  const { textarea } = term;
  if (textarea && coarsePointer) {
    // Rare: a stray focus survived. Blur first (the blur listener re-arms
    // the dormant state), then set what the focus below should honor.
    // readOnly is the belt to inputmode's suspenders: Android never raises
    // the IME for a readonly textarea, however focus reached it.
    if (document.activeElement === textarea) textarea.blur();
    textarea.dataset.kbWanted = '1';
    textarea.dataset.kbWantedAt = String(Date.now());
    textarea.readOnly = false;
    textarea.inputMode = 'text';
  }
  term.focus();
}

/**
 Forward soft-keyboard text to the terminal. iOS keyboards emit keydown
 events with keyCode 229 for character keys, which xterm ignores; the
 characters only surface as `input` events on the helper textarea, which
 xterm never listens to. Forwarding them here is safe from double-sends:
 any key xterm does handle gets preventDefault'ed on keydown and therefore
 never mutates the textarea, so no `input` event fires for it. IME
 composition is left to xterm's own composition helper.
 @param term - the wetty terminal whose textarea to watch
 */
function setupSoftKeyboardInput(term: Term): void {
  const { textarea } = term;
  if (!textarea) return;

  let composing = false;
  let keydownIgnored = false;
  textarea.addEventListener('compositionstart', () => {
    composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    // xterm's composition helper reads the textarea value on a timeout;
    // wait it out before resuming, then drop the leftover value so it
    // doesn't leak into later composition snapshots.
    setTimeout(() => {
      composing = false;
      textarea.value = '';
    }, 100);
  });
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    // 229 in the deprecated keyCode is the only reliable marker for
    // soft-keyboard input that xterm will drop.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    keydownIgnored = e.keyCode === 229;
  });
  textarea.addEventListener('input', (e: Event) => {
    const ev = e as InputEvent;
    if (composing || ev.isComposing) return;
    // xterm's own `_inputEvent` already forwards events that never saw a
    // keydown; only pick up the ones it drops — soft keyboards (iOS) fire
    // keydown 229 before each character, which makes xterm skip them.
    if (!ev.composed || !keydownIgnored) return;
    keydownIgnored = false;
    if (ev.inputType === 'insertText' && ev.data !== null) {
      term.input(ev.data, true);
      textarea.value = '';
    } else if (
      ev.inputType === 'insertLineBreak' ||
      ev.inputType === 'insertParagraph'
    ) {
      term.input('\r', true);
      textarea.value = '';
    } else if (ev.inputType === 'deleteContentBackward') {
      term.input('\x7F', true);
      textarea.value = '';
    }
  });
}

/**
 xterm.js has no built-in touch support: on phones a swipe pans nothing and
 taps don't reliably summon the soft keyboard. Translate touch gestures
 ourselves, mirroring what desktop terminals do with the mouse wheel:
 - app enabled mouse tracking (tmux & co): synthesize wheel events so xterm
   emits wheel reports and the app scrolls its own buffer;
 - alternate buffer without mouse tracking (vim, less): send arrow keys,
   since the alternate buffer has no scrollback;
 - otherwise: scroll the scrollback buffer directly.
 Taps: a single tap is a plain click (delivered to mouse-aware apps, never
 summons the soft keyboard); a double tap focuses the terminal to open it.
 @param term - the wetty terminal to attach touch handlers to
 */
export function setupTouch(term: Term): void {
  const screen = term.element?.querySelector('.xterm-screen');
  if (!(screen instanceof HTMLElement)) return;

  setupSoftKeyboardInput(term);
  const debug = debugLog;

  const { textarea } = term;
  if (textarea && coarsePointer) {
    // Default state on finger-first devices: readonly, inputmode="none",
    // unfocused. Only summonKeyboard() (double tap / on-screen keyboard
    // button) lifts it.
    const arm = (): void => {
      delete textarea.dataset.kbWanted;
      textarea.inputMode = 'none';
      textarea.readOnly = true;
    };
    arm();
    // Take over the focus method: Android re-evaluates the IME on focus()
    // calls that produce NO focus event (element already focused), which
    // is invisible to every listener. Swallow all programmatic focus —
    // from xterm's internals and wetty alike — unless deliberately
    // summoned via summonKeyboard().
    const nativeFocus = textarea.focus.bind(textarea);
    textarea.focus = (options?: FocusOptions): void => {
      if (textarea.dataset.kbWanted === '1') {
        nativeFocus(options);
      } else {
        debug('focus swallowed');
      }
    };
    textarea.addEventListener('blur', () => {
      arm();
      debug('blur: re-armed');
    });
    textarea.addEventListener('focus', () => {
      if (textarea.dataset.kbWanted !== '1') {
        // Stray native focus (tap-target snapping) while dormant: drop it
        // so a later summon starts from a clean unfocused state.
        setTimeout(() => {
          if (
            textarea.dataset.kbWanted !== '1' &&
            document.activeElement === textarea
          ) {
            debug('stray focus: blurred');
            textarea.blur();
          }
        }, 0);
      }
    });
    // Android's back button hides the IME without blurring the textarea,
    // leaving it armed — the next tap would then re-raise the keyboard.
    // A large visual-viewport growth means the keyboard closed: re-arm.
    // Ignore growth during the first moments after a summon: the opening
    // animation makes the viewport oscillate (iOS reports intermediate
    // heights) and must not be mistaken for a dismissal.
    let lastViewportHeight = window.visualViewport?.height ?? 0;
    window.visualViewport?.addEventListener('resize', () => {
      const height = window.visualViewport?.height ?? 0;
      if (
        height - lastViewportHeight > 150 &&
        textarea.dataset.kbWanted === '1' &&
        Date.now() - Number(textarea.dataset.kbWantedAt ?? 0) > 1500
      ) {
        debug('keyboard dismissed: re-arm');
        arm();
        if (document.activeElement === textarea) textarea.blur();
      }
      lastViewportHeight = height;
    });
  }

  let touchId: number | undefined;
  let startY = 0;
  let startTime = 0;
  let lastY = 0;
  let scrolling = false;
  let lastTapAt = 0;

  screen.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touchId = undefined;
        return;
      }
      const touch = e.touches[0];
      touchId = touch.identifier;
      startY = touch.clientY;
      lastY = touch.clientY;
      startTime = Date.now();
      scrolling = false;
    },
    { passive: true },
  );

  screen.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const touch = Array.from(e.touches).find((t) => t.identifier === touchId);
      if (touch === undefined) return;
      const cellHeight = screen.clientHeight / term.rows;
      if (!scrolling && Math.abs(touch.clientY - startY) > cellHeight) {
        scrolling = true;
      }
      if (!scrolling) return;
      // Keep the browser from panning/refreshing the page while we scroll
      // the terminal (requires the listener to be non-passive).
      e.preventDefault();
      const lines = Math.trunc((lastY - touch.clientY) / cellHeight);
      if (lines === 0) return;
      lastY -= lines * cellHeight;
      if (term.modes.mouseTrackingMode !== 'none') {
        // The app owns the mouse: hand xterm wheel events so it encodes
        // proper wheel reports (position included, for panes), one per cell
        // of finger travel. Note apps may scroll several lines per report
        // (tmux defaults to 5; herdr does 1).
        for (let i = 0; i < Math.abs(lines); i += 1) {
          screen.dispatchEvent(
            new WheelEvent('wheel', {
              // One line per event in DOM_DELTA_LINE mode: xterm damps and
              // quantizes small DOM_DELTA_PIXEL deltas (trackpad smoothing),
              // which would swallow most of the gesture.
              deltaY: Math.sign(lines),
              deltaMode: WheelEvent.DOM_DELTA_LINE,
              clientX: touch.clientX,
              clientY: touch.clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      } else if (term.buffer.active.type === 'alternate') {
        // No scrollback in the alternate buffer — send arrow keys instead,
        // like native terminal emulators do.
        const app = term.modes.applicationCursorKeysMode;
        let seq: string;
        if (lines > 0) {
          seq = app ? '\x1bOB' : '\x1b[B';
        } else {
          seq = app ? '\x1bOA' : '\x1b[A';
        }
        term.input(seq.repeat(Math.abs(lines)), true);
      } else {
        term.scrollLines(lines);
      }
    },
    { passive: false },
  );

  screen.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      if (touchId === undefined || e.touches.length > 0) return;
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      touchId = undefined;
      if (scrolling || touch === undefined || Date.now() - startTime >= 500) {
        let reason = 'long';
        if (scrolling) reason = 'scroll';
        else if (touch === undefined) reason = 'id';
        debug(`tap-reject ${reason}`);
        return;
      }
      debug(
        `tap mode=${term.modes.mouseTrackingMode}` +
          ` cancelable=${String(e.cancelable)}` +
          ` focused=${String(document.activeElement === term.textarea)}` +
          ` wanted=${String(term.textarea?.dataset.kbWanted === '1')}`,
      );
      // Single taps never summon the soft keyboard — only a double tap or
      // the on-screen keyboard button does, in every context. Suppress the
      // browser's synthesized click (it would focus the terminal).
      e.preventDefault();
      debug(`prevented=${String(e.defaultPrevented)}`);
      const now = Date.now();
      if (now - lastTapAt < 350) {
        lastTapAt = 0;
        debug('double-tap: summon keyboard');
        summonKeyboard(term);
        return;
      }
      lastTapAt = now;
      if (term.modes.mouseTrackingMode !== 'none') {
        // Mouse-aware apps (tmux, herdr…) get the tap as a plain click:
        // hand xterm the mouse events so it emits the click report.
        for (const type of ['mousedown', 'mouseup']) {
          screen.dispatchEvent(
            new MouseEvent(type, {
              button: 0,
              buttons: type === 'mousedown' ? 1 : 0,
              clientX: touch.clientX,
              clientY: touch.clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }
    },
    { passive: false },
  );
}
