import { copySelected } from './clipboard';
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
 Mobile input mirror. Soft keyboards — voice dictation above all — don't
 type append-only: they REVISE earlier words by range-replacing text in
 the field. A terminal only accepts appends and backspaces, so per-event
 forwarding turns every revision into garbage appended at the prompt.
 Instead, treat the textarea value as the source of truth: after every
 change, diff it against a shadow of what the terminal has received and
 emit `backspace × N + retyped tail`. Appends, deletions and mid-text
 revisions all reduce to the same sync.

 Exclusivity: xterm has three internal paths that would double-send
 (`_inputEvent`, the 229-keydown textarea diff, the composition helper).
 All three read events on the textarea itself; capture-phase listeners on
 an ancestor run first and stopPropagation() starves them. The field is
 never programmatically mutated mid-session (that restarts the IME
 connection and kills dictation) — it drains on blur and after Enter,
 when no utterance can still be revising.
 @param term - the wetty terminal whose textarea to mirror
 */
function setupMobileInput(term: Term): void {
  const { textarea, element } = term;
  if (!textarea || !element) return;

  let synced = '';
  const drain = (): void => {
    synced = '';
    textarea.value = '';
  };
  // Session-over cleanup: keep the field from growing without bound.
  textarea.addEventListener('blur', drain);
  if (!coarsePointer) return;

  let composing = false;

  const sync = (): void => {
    const { value } = textarea;
    if (value === synced) return;
    // Code-point arrays: one backspace erases one code point at the line
    // editor, and surrogate pairs must never be split by the diff.
    const before = Array.from(synced);
    const after = Array.from(value);
    let prefix = 0;
    while (
      prefix < before.length &&
      prefix < after.length &&
      before[prefix] === after[prefix]
    ) {
      prefix += 1;
    }
    const backspaces = before.length - prefix;
    const insert = after.slice(prefix).join('');
    if (backspaces > 0) term.input('\x7F'.repeat(backspaces), true);
    if (insert !== '') term.input(insert, true);
    synced = value;
    debugLog(
      `mirror -${String(backspaces)} +${String(Array.from(insert).length)}`,
    );
    // A committed newline ends the line at the shell: it cannot be
    // revised any more, so start the next utterance from a clean field.
    if (insert.includes('\n')) setTimeout(drain, 0);
  };

  element.addEventListener(
    'input',
    (e) => {
      e.stopPropagation();
      if (composing || e.isComposing) return;
      sync();
    },
    true,
  );
  const suppressComposition = (type: string, onEvent?: () => void): void => {
    element.addEventListener(
      type,
      (e) => {
        e.stopPropagation();
        onEvent?.();
      },
      true,
    );
  };
  suppressComposition('compositionstart', () => {
    composing = true;
  });
  suppressComposition('compositionupdate');
  suppressComposition('compositionend', () => {
    composing = false;
    // The browser applies the committed text to the field right after
    // this event; sync once it has landed.
    setTimeout(sync, 0);
  });
  element.addEventListener(
    'keydown',
    (e) => {
      const ke = e;
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const code = ke.keyCode;
      if (code === 229) {
        // IME-processed keys carry no usable key; hide them from xterm,
        // whose 229 handler diff-sends the textarea and would double.
        e.stopPropagation();
      } else if (code === 8 && textarea.value !== '') {
        // Let the browser edit the field; the mirror forwards the
        // deletion. (With an empty field xterm handles Backspace, so
        // erasing text typed before a drain still works.)
        e.stopPropagation();
      } else if (code === 13) {
        // xterm sends \r itself; the submitted line cannot be revised
        // any more, so reset the mirror.
        setTimeout(drain, 0);
      }
    },
    true,
  );
}

/**
 Scroll the terminal by whole lines with the semantics native emulators
 use: wheel reports for mouse-tracking apps (tmux, herdr), arrow keys in
 the alternate buffer (vim, less), scrollback otherwise.
 @param term - the terminal to scroll
 @param screen - the .xterm-screen element (wheel dispatch target)
 @param lines - line count, positive scrolls towards newer content
 @param clientX - pointer x for the wheel report cell position
 @param clientY - pointer y for the wheel report cell position
 */
function scrollTermLines(
  term: Term,
  screen: HTMLElement,
  lines: number,
  clientX: number,
  clientY: number,
): void {
  if (term.modes.mouseTrackingMode !== 'none') {
    // The app owns the mouse: hand xterm wheel events so it encodes proper
    // wheel reports (position included, for panes), one per line. Note
    // apps may scroll several lines per report (tmux defaults to 5).
    for (let i = 0; i < Math.abs(lines); i += 1) {
      screen.dispatchEvent(
        new WheelEvent('wheel', {
          // One line per event in DOM_DELTA_LINE mode: xterm damps and
          // quantizes small DOM_DELTA_PIXEL deltas (trackpad smoothing),
          // which would swallow most of the gesture.
          deltaY: Math.sign(lines),
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          clientX,
          clientY,
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
}

/**
 Trackpads emit streams of small DOM_DELTA_PIXEL wheel events, and xterm
 damps deltas under 50px to 30% ("trackpad smoothing"). Combined with
 one-line-per-report apps (herdr) that makes two-finger scrolling crawl.
 Intercept pixel wheels for the mouse-tracking and alternate-buffer cases
 and emit whole lines ourselves; the normal buffer keeps xterm's native
 smooth scrolling.
 @param term - the wetty terminal
 @param screen - the .xterm-screen element to intercept wheels on
 */
function setupTrackpadWheel(term: Term, screen: HTMLElement): void {
  let remainder = 0;
  screen.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // LINE/PAGE deltas (wheel mice on some platforms, our own synthetic
      // events) already scroll acceptably through xterm.
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
      const mouseApp = term.modes.mouseTrackingMode !== 'none';
      if (!mouseApp && term.buffer.active.type !== 'alternate') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const cellHeight = screen.clientHeight / term.rows;
      // Wheel mice send large discrete ticks (~100-120px); classic
      // terminals scroll about 3 lines per tick, so scale ticks down.
      // Trackpads stream small deltas; slightly under finger distance
      // feels right.
      const scaled =
        Math.abs(e.deltaY) >= 50 ? e.deltaY * 0.45 : e.deltaY * 0.75;
      const delta = scaled + remainder;
      const lines = Math.trunc(delta / cellHeight);
      remainder = delta - lines * cellHeight;
      if (lines !== 0) {
        scrollTermLines(term, screen, lines, e.clientX, e.clientY);
      }
    },
    { capture: true, passive: false },
  );
}

/**
 Transient bottom-center toast confirming a long-press copy.
 */
function showCopyToast(): void {
  const el = document.createElement('div');
  el.textContent = '已复制 · Copied';
  el.style.cssText =
    'position:fixed;left:50%;bottom:15%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,.75);color:#fff;padding:6px 14px;' +
    'border-radius:14px;font:13px sans-serif;z-index:9998;' +
    'pointer-events:none;transition:opacity .3s;';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
  }, 900);
  setTimeout(() => {
    el.remove();
  }, 1300);
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

  setupMobileInput(term);
  setupTrackpadWheel(term, screen);
  const debug = debugLog;

  // No browser context menu over the terminal: on Android it interrupts
  // long-press selection, on desktop it covers the right-click
  // interactions of mouse-aware apps (herdr gets the click as a button-2
  // report instead). Paste still works via Ctrl+Shift+V / ⌘V.
  screen.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

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
  // Long-press selection: word-select under the finger, drag to extend,
  // release to copy. This replaces the native selection action bar, which
  // never appears for xterm's custom-drawn selection.
  let selecting = false;
  let selectAnchor: { col: number; row: number } | undefined;
  let longPressTimer = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;

  const cellFromPoint = (
    x: number,
    y: number,
  ): { col: number; row: number } => {
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    const clamp = (v: number, max: number): number =>
      Math.min(max, Math.max(0, v));
    return {
      col: clamp(Math.floor((x - rect.left) / cellW), term.cols - 1),
      row:
        term.buffer.active.viewportY +
        clamp(Math.floor((y - rect.top) / cellH), term.rows - 1),
    };
  };

  const extendSelection = (to: { col: number; row: number }): void => {
    if (selectAnchor === undefined) return;
    let start = selectAnchor;
    let end = to;
    const pos = (c: { col: number; row: number }): number =>
      c.row * term.cols + c.col;
    if (pos(end) < pos(start)) [start, end] = [end, start];
    term.select(start.col, start.row, pos(end) - pos(start) + 1);
  };

  const beginSelection = (): void => {
    const cell = cellFromPoint(lastTouchX, lastTouchY);
    const line =
      term.buffer.active.getLine(cell.row)?.translateToString(false) ?? '';
    let s = cell.col;
    let e = cell.col;
    if ((line[cell.col] ?? ' ') !== ' ') {
      while (s > 0 && line[s - 1] !== ' ') s -= 1;
      while (e < line.length - 1 && line[e + 1] !== ' ') e += 1;
    }
    selectAnchor = { col: s, row: cell.row };
    term.select(s, cell.row, e - s + 1);
    selecting = true;
    debug('long-press: selection mode');
  };

  const cancelLongPress = (): void => {
    if (longPressTimer !== 0) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  // Two-finger long-press = right-click for mouse-aware apps (herdr menus
  // and the like); the browser context menu is suppressed anyway.
  let twoFingerTimer = 0;
  let twoFingerMid: { x: number; y: number } | undefined;

  const cancelTwoFinger = (): void => {
    if (twoFingerTimer !== 0) {
      clearTimeout(twoFingerTimer);
      twoFingerTimer = 0;
    }
  };

  const beginTwoFinger = (a: Touch, b: Touch): void => {
    twoFingerMid = {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    };
    twoFingerTimer = window.setTimeout(() => {
      twoFingerTimer = 0;
      if (term.modes.mouseTrackingMode === 'none' || !twoFingerMid) return;
      debug('two-finger long-press: right-click');
      for (const [type, buttons] of [
        ['mousedown', 2],
        ['mouseup', 0],
      ] as const) {
        screen.dispatchEvent(
          new MouseEvent(type, {
            button: 2,
            buttons,
            clientX: twoFingerMid.x,
            clientY: twoFingerMid.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }, 500);
  };
  // Flick state: velocity in px/ms (positive = finger moving up), sampled
  // as an exponential moving average over the drag.
  let velocity = 0;
  let rawLastY = 0;
  let lastMoveAt = 0;
  let momentumFrame = 0;

  const cancelMomentum = (): void => {
    if (momentumFrame !== 0) {
      cancelAnimationFrame(momentumFrame);
      momentumFrame = 0;
    }
  };

  // Keep gliding after a flick, decaying exponentially like native apps.
  const startMomentum = (clientX: number, clientY: number): void => {
    let v = velocity;
    let acc = 0;
    let lastFrameAt = performance.now();
    const step = (now: number): void => {
      const dt = now - lastFrameAt;
      lastFrameAt = now;
      v *= Math.exp(-0.002 * dt);
      acc += v * dt;
      const cellHeight = screen.clientHeight / term.rows;
      const lines = Math.trunc(acc / cellHeight);
      if (lines !== 0) {
        acc -= lines * cellHeight;
        scrollTermLines(term, screen, lines, clientX, clientY);
      }
      momentumFrame = Math.abs(v) > 0.05 ? requestAnimationFrame(step) : 0;
    };
    momentumFrame = requestAnimationFrame(step);
  };

  screen.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      cancelMomentum();
      cancelLongPress();
      cancelTwoFinger();
      selecting = false;
      if (term.hasSelection()) term.clearSelection();
      if (e.touches.length !== 1) {
        touchId = undefined;
        if (e.touches.length === 2) {
          beginTwoFinger(e.touches[0], e.touches[1]);
        }
        return;
      }
      const touch = e.touches[0];
      touchId = touch.identifier;
      startY = touch.clientY;
      lastY = touch.clientY;
      rawLastY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      startTime = Date.now();
      lastMoveAt = performance.now();
      velocity = 0;
      scrolling = false;
      longPressTimer = window.setTimeout(() => {
        longPressTimer = 0;
        if (touchId !== undefined && !scrolling) beginSelection();
      }, 500);
    },
    { passive: true },
  );

  screen.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (twoFingerTimer !== 0 && twoFingerMid && e.touches.length === 2) {
        // Holding still keeps the pending right-click; drifting fingers
        // mean a pinch or two-finger scroll, so call it off.
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (Math.hypot(midX - twoFingerMid.x, midY - twoFingerMid.y) > 15) {
          cancelTwoFinger();
        }
        return;
      }
      const touch = Array.from(e.touches).find((t) => t.identifier === touchId);
      if (touch === undefined) return;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      if (selecting) {
        // Dragging while in selection mode extends the selection instead
        // of scrolling.
        e.preventDefault();
        extendSelection(cellFromPoint(touch.clientX, touch.clientY));
        return;
      }
      const cellHeight = screen.clientHeight / term.rows;
      if (!scrolling && Math.abs(touch.clientY - startY) > cellHeight) {
        scrolling = true;
        cancelLongPress();
      }
      if (!scrolling) return;
      // Keep the browser from panning/refreshing the page while we scroll
      // the terminal (requires the listener to be non-passive).
      e.preventDefault();
      const now = performance.now();
      const dt = now - lastMoveAt;
      if (dt > 0) {
        velocity = 0.8 * ((rawLastY - touch.clientY) / dt) + 0.2 * velocity;
        lastMoveAt = now;
      }
      rawLastY = touch.clientY;
      const lines = Math.trunc((lastY - touch.clientY) / cellHeight);
      if (lines === 0) return;
      lastY -= lines * cellHeight;
      scrollTermLines(term, screen, lines, touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  screen.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      // Any finger lifting below two ends a pending two-finger right-click.
      if (e.touches.length < 2) cancelTwoFinger();
      if (touchId === undefined || e.touches.length > 0) return;
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      touchId = undefined;
      cancelLongPress();
      cancelTwoFinger();
      if (selecting) {
        // Release ends selection mode: the selected text goes straight to
        // the clipboard (we are inside a user gesture here, so the
        // execCommand fallback works even over plain HTTP).
        selecting = false;
        e.preventDefault();
        const text = term.getSelection();
        if (text !== '') {
          copySelected(text);
          showCopyToast();
        }
        return;
      }
      if (scrolling || touch === undefined || Date.now() - startTime >= 500) {
        let reason = 'long';
        if (scrolling) reason = 'scroll';
        else if (touch === undefined) reason = 'id';
        debug(`tap-reject ${reason}`);
        // A flick released with speed keeps gliding.
        if (scrolling && touch !== undefined && Math.abs(velocity) > 0.25) {
          startMomentum(touch.clientX, touch.clientY);
        }
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
