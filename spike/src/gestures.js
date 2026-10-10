// Gesture recogniser: one finger taps, flicks, scrubs and drags a box; two fingers flick and scrub.
// A second finger cancels the one-finger gesture and starts a two-finger one; a third cancels that.
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
//
// Two fingers: their midpoint flicks and scrubs as one finger does, unless one finger holds still
// while the other slides sideways (a one-sided slide, for accidentals): that is told apart by each
// finger's own movement since touchdown, before the midpoint has gone far enough to fix an axis.

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
 * @property {(dir: 'left'|'right'|'up'|'down', info: {dist: number, ms: number, speed: number}) => void} onTwoSwipe
 * @property {(axis: Axis) => void} onTwoScrubStart
 * @property {(steps: number) => void} onTwoScrub   signed: negative is leftwards / upwards
 * @property {(steps: number) => void} onTwoScrubEnd
 * @property {(reason: string) => void} onTwoCancel
 * @property {() => void} onTwoStart
 * @property {(e: PointerEvent) => boolean} [claims] whether a first finger starts a one-finger gesture
 */

/**
 * One-sided slide handlers, called with the sliding finger ('left' or 'right', by position at
 * touchdown) and its signed travel outward (positive: away from the still finger).
 * @typedef {object} SideHandlers
 * @property {(mover: 'left'|'right') => void} onSideStart
 * @property {(mover: 'left'|'right', out: number) => void} onSide
 * @property {(mover: 'left'|'right', out: number) => void} onSideEnd
 */

/** @param {HTMLElement} el @param {() => object} getSettings @param {GestureHandlers} h */
export function attachGestures(el, getSettings, h) {
  const down = new Set();
  /** @type {Map<number, {x: number, y: number}>} */
  const pts = new Map();
  let p = null;
  let two = null;
  let blocked = false;

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

  // Stepping back towards the start needs `scrubBackPx` more travel than stepping on, so a finger
  // resting on a step boundary does not flicker between two states (or two pages).
  const scrubSteps = () => {
    const travel = p.axis === 'h' ? p.x - p.ax : p.y - p.ay;
    const steps = Math.trunc(travel / p.s.scrubStepPx);
    if (!p.steps || Math.abs(steps) >= Math.abs(p.steps)) return steps;
    const back = Math.trunc((travel + Math.sign(p.steps) * (p.s.scrubBackPx ?? 0)) / p.s.scrubStepPx);
    return Math.abs(back) < Math.abs(p.steps) ? back : p.steps;
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
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size > 1) {
      clear();
      if (two && !two.dead) {
        cancelTwo('a third finger');
      } else if (!two && down.size === 2) {
        startTwo(e);
      }
      return;
    }
    if (blocked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A first finger elsewhere (the entry pane) is tracked for two-finger gestures only.
    if (h.claims && !h.claims(e)) return;
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
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (two) return moveTwo(e);
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

  const release = (e) => {
    down.delete(e.pointerId);
    pts.delete(e.pointerId);
    if (down.size === 0) blocked = false;
  };

  const end = (e) => {
    if (two && two.ids.includes(e.pointerId)) {
      endTwo(e);
      return release(e);
    }
    release(e);
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
    if (two && two.ids.includes(e.pointerId)) cancelTwo('the browser cancelled a pointer');
    release(e);
    if (p && e.pointerId === p.id) clear();
  });

  // Two fingers.

  const midpoint = () => {
    const [a, b] = two.ids.map((id) => pts.get(id));
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  function startTwo(e) {
    blocked = true;
    const s = getSettings();
    two = { ids: [...down], t0: e.timeStamp, moved: false, axis: null, mode: 'pending', steps: 0, s };
    two.p0 = two.ids.map((id) => ({ ...pts.get(id) }));
    const m = midpoint();
    Object.assign(two, { x0: m.x, y0: m.y, x: m.x, y: m.y });
    two.timer = setTimeout(() => {
      if (two && !two.dead && two.axis && two.mode === 'pending') startTwoScrub();
    }, s.swipeWindowMs);
    h.onTwoStart();
  }

  function cancelTwo(reason) {
    clearTimeout(two.timer);
    two.dead = true;
    h.onTwoCancel(reason);
  }

  const twoSteps = () => {
    const travel = two.axis === 'h' ? two.x - two.x0 : two.y - two.y0;
    return Math.trunc(travel / two.s.twoStepPx);
  };

  function updateTwoScrub() {
    const steps = twoSteps();
    if (steps !== two.steps) {
      two.steps = steps;
      h.onTwoScrub(steps);
    }
  }

  function startTwoScrub() {
    two.mode = 'scrub';
    two.steps = 0;
    h.onTwoScrubStart(two.axis);
    updateTwoScrub();
  }

  /** The sliding finger's outward travel: away from the still finger is positive. */
  const sideOut = () => {
    const i = two.side.index;
    const dx = pts.get(two.ids[i]).x - two.p0[i].x;
    return two.side.mover === 'left' ? -dx : dx;
  };

  /**
   * One finger has slid `sideMovePx` sideways while the other stayed within `sideStillPx` (and
   * within a third of the slider's travel): a one-sided slide.
   */
  function maybeSide() {
    if (!h.onSideStart || !two.s.sideMovePx) return false;
    const d = two.ids.map((id, i) => ({ dx: pts.get(id).x - two.p0[i].x, dy: pts.get(id).y - two.p0[i].y }));
    const len = d.map((v) => Math.hypot(v.dx, v.dy));
    const i = Math.abs(d[0].dx) >= Math.abs(d[1].dx) ? 0 : 1;
    const still = len[1 - i];
    const slide = Math.abs(d[i].dx);
    if (slide < two.s.sideMovePx || still > two.s.sideStillPx || still > slide / 3 || slide < 1.5 * Math.abs(d[i].dy)) return false;
    const mover = two.p0[i].x < two.p0[1 - i].x ? 'left' : 'right';
    clearTimeout(two.timer);
    two.mode = 'side';
    two.side = { index: i, mover };
    h.onSideStart(mover);
    h.onSide(mover, sideOut());
    return true;
  }

  function moveTwo(e) {
    if (two.dead || !two.ids.includes(e.pointerId)) return;
    if (two.mode === 'side') return h.onSide(two.side.mover, sideOut());
    if (two.mode === 'pending' && !two.axis && maybeSide()) return;
    const m = midpoint();
    two.x = m.x;
    two.y = m.y;
    const dx = two.x - two.x0;
    const dy = two.y - two.y0;
    const dist = Math.hypot(dx, dy);
    if (!two.moved) {
      if (dist <= two.s.slopPx) return;
      two.moved = true;
    }
    if (!two.axis) {
      if (dist < Math.max(two.s.axisPx, two.s.slopPx)) return;
      two.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    if (two.mode === 'pending' && e.timeStamp - two.t0 >= two.s.swipeWindowMs) startTwoScrub();
    else if (two.mode === 'scrub') updateTwoScrub();
  }

  function endTwo(e) {
    const t = two;
    two = null;
    clearTimeout(t.timer);
    if (t.dead) return;
    if (t.mode === 'scrub') return h.onTwoScrubEnd(t.steps);
    if (t.mode === 'side') {
      two = t;
      const out = sideOut();
      two = null;
      return h.onSideEnd(t.side.mover, out);
    }
    const dx = t.x - t.x0;
    const dy = t.y - t.y0;
    const dist = Math.hypot(dx, dy);
    const ms = Math.max(Math.round(e.timeStamp - t.t0), 1);
    if (!t.moved || dist < t.s.swipeMinPx) return h.onTwoCancel(`two-finger move too short (${Math.round(dist)} px)`);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 1.5 * Math.min(ax, ay)) return h.onTwoCancel('diagonal two-finger swipe');
    const dir = ax > ay ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    h.onTwoSwipe(dir, { dist: Math.round(dist), ms, speed: dist / ms });
  }
}
