// Single-pointer gesture recogniser: tap, swipe (four directions) and drag-box.
// A second simultaneous pointer cancels the gesture; two-finger gestures are reserved.
//
// Swipe and drag both start as a moving finger. Two ways of telling them apart are offered:
//   timing: a move still in progress after `swipeWindowMs` becomes a drag-box; lifting earlier is a swipe.
//   hold:   holding still for `holdMs` first arms a drag-box; moving straight away is a swipe.

/**
 * @typedef {object} GestureHandlers
 * @property {(x: number, y: number) => void} onTap
 * @property {(dir: 'left'|'right'|'up'|'down', info: {dist: number, ms: number}) => void} onSwipe
 * @property {(rect: DOMRect, done: boolean) => void} onBox
 * @property {() => void} onBoxCancel
 * @property {() => void} onArmed
 * @property {(reason: string) => void} onIgnored
 * @property {() => void} onMulti
 */

/** @param {HTMLElement} el @param {() => object} getSettings @param {GestureHandlers} h */
export function attachGestures(el, getSettings, h) {
  const down = new Set();
  let p = null;

  const clear = () => {
    if (!p) return;
    clearTimeout(p.timer);
    if (p.mode === 'drag') h.onBoxCancel();
    el.classList.remove('armed');
    p = null;
  };

  const box = () =>
    new DOMRect(Math.min(p.x0, p.x), Math.min(p.y0, p.y), Math.abs(p.x - p.x0), Math.abs(p.y - p.y0));

  const startDrag = () => {
    p.mode = 'drag';
    el.classList.remove('armed');
    h.onBox(box(), false);
  };

  el.addEventListener('pointerdown', (e) => {
    down.add(e.pointerId);
    if (down.size > 1) {
      clear();
      h.onMulti();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) carry pointer ids the browser does not know.
    }
    const s = getSettings();
    p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, moved: false, mode: 'pending', s };
    if (s.dragStart === 'hold') {
      p.timer = setTimeout(() => {
        if (p && !p.moved) {
          p.mode = 'armed';
          el.classList.add('armed');
          navigator.vibrate?.(12);
          h.onArmed();
        }
      }, s.holdMs);
    } else {
      p.timer = setTimeout(() => {
        if (p && p.moved && p.mode === 'pending') startDrag();
      }, s.swipeWindowMs);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > p.s.slopPx) p.moved = true;
    if (!p.moved) return;
    if (p.mode === 'armed') startDrag();
    else if (p.mode === 'pending' && p.s.dragStart === 'timing' && e.timeStamp - p.t0 >= p.s.swipeWindowMs) startDrag();
    else if (p.mode === 'drag') h.onBox(box(), false);
  });

  const end = (e) => {
    down.delete(e.pointerId);
    if (!p || e.pointerId !== p.id) return;
    const { mode, moved, s } = p;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    const ms = Math.round(e.timeStamp - p.t0);
    clearTimeout(p.timer);
    el.classList.remove('armed');
    const r = mode === 'drag' ? box() : null;
    p = null;

    if (mode === 'drag') return h.onBox(r, true);
    if (!moved) return h.onTap(e.clientX, e.clientY);
    if (dist < s.swipeMinPx) return h.onIgnored(`move too short (${Math.round(dist)} px)`);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 1.5 * Math.min(ax, ay)) return h.onIgnored('diagonal swipe');
    const dir = ax > ay ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    h.onSwipe(dir, { dist: Math.round(dist), ms });
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', (e) => {
    down.delete(e.pointerId);
    if (p && e.pointerId === p.id) clear();
  });
}
