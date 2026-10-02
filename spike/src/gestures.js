// Single-pointer gesture recogniser: tap, flick, scrub and drag-box.
// A second simultaneous pointer cancels the gesture; two-finger gestures are reserved.
//
//   no movement:                    tap;
//   still for `holdMs`, then moving: drag-box;
//   moving straight away:           the dominant direction over the first `axisPx` fixes the axis, then
//     lifted within `swipeWindowMs`: a flick, one step;
//     still down after that:         a scrub along that axis, one step per `scrubStepPx` of travel
//                                    from the segment's start (moving back walks back).
// A scrub turns onto the other axis, starting a new segment, when the recent movement runs across
// the current axis and the finger is `turnPx` across it from the segment's start. The travel across
// counts towards the new segment's steps.

/**
 * @typedef {'h'|'v'} Axis
 * @typedef {object} GestureHandlers
 * @property {(x: number, y: number) => void} onTap
 * @property {(dir: 'left'|'right'|'up'|'down', info: {dist: number, ms: number}) => void} onSwipe
 * @property {(axis: Axis) => void} onScrubStart
 * @property {(steps: number) => void} onScrub      signed: negative is leftwards / upwards
 * @property {(axis: Axis) => void} onScrubTurn    a new segment starts from the current state
 * @property {(steps: number) => void} onScrubEnd
 * @property {() => void} onScrubCancel
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

  const stopTimers = () => {
    clearTimeout(p.timer);
    clearTimeout(p.holdTimer);
    el.classList.remove('armed');
  };

  const clear = () => {
    if (!p) return;
    stopTimers();
    if (p.mode === 'drag') h.onBoxCancel();
    if (p.mode === 'scrub') h.onScrubCancel();
    p = null;
  };

  const box = () =>
    new DOMRect(Math.min(p.x0, p.x), Math.min(p.y0, p.y), Math.abs(p.x - p.x0), Math.abs(p.y - p.y0));

  const RECENT_PX = 12;

  const scrubSteps = () => {
    const travel = p.axis === 'h' ? p.x - p.ax : p.y - p.ay;
    return Math.trunc(travel / p.s.scrubStepPx);
  };

  // Tracks the dominant axis of the last RECENT_PX of movement.
  const trackRecent = () => {
    const rx = p.x - p.rx;
    const ry = p.y - p.ry;
    if (Math.hypot(rx, ry) < RECENT_PX) return;
    p.recent = Math.abs(rx) >= Math.abs(ry) ? 'h' : 'v';
    p.rx = p.x;
    p.ry = p.y;
  };

  const maybeTurn = () => {
    const across = p.axis === 'h' ? p.y - p.ay : p.x - p.ax;
    if (!p.recent || p.recent === p.axis || Math.abs(across) < p.s.turnPx) return;
    // The new segment starts here along the old axis; across the old axis it keeps the old start,
    // so the travel already made counts as steps.
    if (p.axis === 'h') p.ax = p.x;
    else p.ay = p.y;
    p.axis = p.recent;
    p.steps = 0;
    h.onScrubTurn(p.axis);
  };

  const updateScrub = () => {
    const steps = scrubSteps();
    if (steps !== p.steps) {
      p.steps = steps;
      h.onScrub(steps);
    }
  };

  const startScrub = () => {
    p.mode = 'scrub';
    p.steps = 0;
    h.onScrubStart(p.axis);
    updateScrub();
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
    const x = e.clientX;
    const y = e.clientY;
    p = { id: e.pointerId, x0: x, y0: y, x, y, ax: x, ay: y, rx: x, ry: y, recent: null, t0: e.timeStamp, moved: false, axis: null, mode: 'pending', s };
    p.timer = setTimeout(() => {
      if (p && p.axis && p.mode === 'pending') startScrub();
    }, s.swipeWindowMs);
    p.holdTimer = setTimeout(() => {
      if (p && !p.moved && p.mode === 'pending') {
        p.mode = 'armed';
        el.classList.add('armed');
        navigator.vibrate?.(12);
        h.onArmed();
      }
    }, s.holdMs);
  });

  el.addEventListener('pointermove', (e) => {
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    if (!p.moved) {
      if (dist <= p.s.slopPx) return;
      p.moved = true;
      clearTimeout(p.holdTimer);
    }
    if (p.mode === 'armed') {
      p.mode = 'drag';
      el.classList.remove('armed');
    }
    if (p.mode === 'drag') return h.onBox(box(), false);
    if (!p.axis) {
      if (dist < Math.max(p.s.axisPx, p.s.slopPx)) return;
      p.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    trackRecent();
    if (p.mode === 'pending' && e.timeStamp - p.t0 >= p.s.swipeWindowMs) startScrub();
    else if (p.mode === 'scrub') {
      maybeTurn();
      updateScrub();
    }
  });

  const end = (e) => {
    down.delete(e.pointerId);
    if (!p || e.pointerId !== p.id) return;
    const { mode, moved, s } = p;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    const ms = Math.round(e.timeStamp - p.t0);
    stopTimers();
    const r = mode === 'drag' ? box() : null;
    const steps = p.steps;
    p = null;

    if (mode === 'drag') return h.onBox(r, true);
    if (mode === 'scrub') return h.onScrubEnd(steps);
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
