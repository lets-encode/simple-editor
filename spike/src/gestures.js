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
//
// Two-finger sessions (2026-10-10, an experiment): no mode locks while fingers stay on the glass.
// A session lasts until both fingers are up and is made of segments, each building on the last:
//   - a scrub turns onto the other axis as a one-finger scrub does (a new segment);
//   - both fingers resting still for `twoRestMs` closes a segment, and the next movement is
//     classified afresh (scrub, or one-sided slide), starting at once without a flick window;
//   - lifting one finger closes the segment and arms the dots tap; putting it back starts a new one.
// Only the session's first segment can be a flick. With `twoModeLock` set, none of this applies:
// a two-finger scrub keeps its axis, rests do nothing, and dots arm only from a still hold.
//
// A two-finger hold (N11, dots): both fingers still for `dotHoldMs`, then one lifts. While the other
// stays down and still, a quick tap anywhere (within `dotTapMs` of the lift or of the previous
// tap) is a hold-tap; each one cycles the dots. A re-placed finger
// that slides instead starts an ordinary two-finger gesture (a one-sided slide, say).

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

/**
 * Two-finger hold handlers (dots).
 * @typedef {object} HoldHandlers
 * @property {() => void} onHoldArmed   one finger lifted from a still two-finger hold
 * @property {() => void} onHoldTap     a finger tapped while the other held
 * @property {() => void} onHoldEnd     the held finger lifted or moved, or the window passed
 * @property {(reason: string) => void} onHoldMiss  what looked like an attempt did not count, and why
 * @property {() => void} onTwoAllUp   the last finger of a two-finger session lifted
 */

/** @param {HTMLElement} el @param {() => object} getSettings @param {GestureHandlers} h */
export function attachGestures(el, getSettings, h) {
  const down = new Set();
  /** @type {Map<number, {x: number, y: number}>} */
  const pts = new Map();
  let p = null;
  let two = null;
  let blocked = false;
  // An armed two-finger hold: the finger still down, where the lifted one was, and until when a tap counts.
  let hold = null;
  // The last hold that ran out, so a tap just too late can say so.
  let expired = null;
  const TAP_MAX_MS = 350;
  const miss = (reason) => h.onHoldMiss?.(reason);

  const endHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
    h.onHoldEnd?.();
  };

  const armHold = (anchor, tapper, now, s, announce = false) => {
    if (announce) h.onHoldArmed?.();
    clearTimeout(hold?.timer);
    const a = pts.get(anchor);
    hold = { anchor, ax: a.x, ay: a.y, tx: tapper.x, ty: tapper.y, at: now, until: now + s.dotTapMs, s };
    hold.timer = setTimeout(() => {
      expired = { anchor, tx: hold.tx, ty: hold.ty, at: hold.at };
      endHold();
    }, s.dotTapMs);
  };

  /** How far each finger of the two-finger gesture has moved since it touched down, at most. */
  const drift = (t) => Math.max(...t.ids.map((id, i) => {
    const q = pts.get(id);
    return q ? Math.hypot(q.x - t.p0[i].x, q.y - t.p0[i].y) : 0;
  }));

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
    if (hold && e.pointerId === hold.anchor) {
      const d = Math.hypot(e.clientX - hold.ax, e.clientY - hold.ay);
      if (d > hold.s.dotStillPx) {
        miss(`the holding finger moved ${Math.round(d)} px (allowed ${hold.s.dotStillPx})`);
        endHold();
      }
    }
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
    if (hold && e.pointerId === hold.anchor) endHold();
    down.delete(e.pointerId);
    pts.delete(e.pointerId);
    if (down.size === 0) {
      if (blocked) h.onTwoAllUp?.();
      blocked = false;
    }
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
    // The lifted finger coming back near where it lifted, while the hold is armed: maybe a hold-tap.
    // Where the tap lands does not matter: nothing else uses a tap while a finger holds.
    if (hold && two.ids.includes(hold.anchor) && e.timeStamp <= hold.until) {
      clearTimeout(hold.timer);
      two.tapper = e.pointerId;
    } else {
      if (expired && two.ids.includes(expired.anchor)) miss(`the tap came ${Math.round(e.timeStamp - expired.at)} ms after the lift (window ${s.dotTapMs})`);
      endHold();
    }
    expired = null;
    const m = midpoint();
    Object.assign(two, { x0: m.x, y0: m.y, x: m.x, y: m.y, rx: m.x, ry: m.y, recent: null, rested: false });
    two.restRef = two.p0.map((q) => ({ ...q }));
    two.timer = setTimeout(() => {
      if (two && !two.dead && two.axis && two.mode === 'pending') startTwoScrub();
    }, s.swipeWindowMs);
    h.onTwoStart();
  }

  function cancelTwo(reason) {
    clearTimeout(two.timer);
    clearTimeout(two.restTimer);
    two.dead = true;
    h.onTwoCancel(reason);
  }

  const twoSteps = () => {
    const travel = two.axis === 'h' ? two.x - two.x0 : two.y - two.y0;
    return Math.trunc(travel / two.s.twoStepPx);
  };

  /** Closes the open scrub or one-sided slide, keeping its result. */
  function closeSegment() {
    if (two.mode === 'scrub') h.onTwoScrubEnd(two.steps);
    else if (two.mode === 'side') h.onSideEnd(two.side.mover, sideOut());
  }

  /** After a rest: the next movement is classified afresh, from where the fingers are now. */
  function reopen() {
    closeSegment();
    two.p0 = two.ids.map((id) => ({ ...pts.get(id) }));
    const m = midpoint();
    Object.assign(two, { mode: 'pending', axis: null, moved: false, steps: 0, side: null, x0: m.x, y0: m.y, x: m.x, y: m.y, rx: m.x, ry: m.y, recent: null, rested: true });
    navigator.vibrate?.(4);
  }

  /** Both fingers still for `twoRestMs` closes the open segment. */
  function trackRest() {
    if (two.s.twoModeLock) return;
    const REST_PX = 4;
    const far = two.ids.some((id, i) => {
      const q = pts.get(id);
      return q && Math.hypot(q.x - two.restRef[i].x, q.y - two.restRef[i].y) > REST_PX;
    });
    if (!far && two.restTimer) return;
    two.restRef = two.ids.map((id) => ({ ...pts.get(id) }));
    clearTimeout(two.restTimer);
    two.restTimer = setTimeout(() => {
      if (two && !two.dead && (two.mode === 'scrub' || two.mode === 'side') && two.s.twoRestMs) reopen();
    }, two.s.twoRestMs || 1e9);
  }

  /** A two-finger scrub turns onto the other axis as a one-finger scrub does, as a new segment. */
  function maybeTurnTwo() {
    if (two.s.twoModeLock) return;
    const rx = two.x - two.rx;
    const ry = two.y - two.ry;
    if (Math.hypot(rx, ry) >= RECENT_PX) {
      two.recent = Math.abs(rx) >= Math.abs(ry) ? 'h' : 'v';
      two.rx = two.x;
      two.ry = two.y;
    }
    const across = two.axis === 'h' ? two.y - two.y0 : two.x - two.x0;
    if (!two.recent || two.recent === two.axis || Math.abs(across) < two.s.turnPx) return;
    h.onTwoScrubEnd(two.steps);
    // Along the old axis the new segment starts here; across it keeps its start, so the travel
    // already made counts as steps.
    if (two.axis === 'h') two.x0 = two.x;
    else two.y0 = two.y;
    two.axis = two.recent;
    startTwoScrub();
  }

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
    trackRest();
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
    if (two.mode === 'pending' && (two.rested || e.timeStamp - two.t0 >= two.s.swipeWindowMs)) startTwoScrub();
    else if (two.mode === 'scrub') {
      maybeTurnTwo();
      updateTwoScrub();
    }
  }

  function endTwo(e) {
    const t = two;
    two = null;
    clearTimeout(t.timer);
    clearTimeout(t.restTimer);
    if (t.dead) return;
    const other = t.ids.find((id) => id !== e.pointerId);
    const lifted = pts.get(e.pointerId) ?? { x: e.clientX, y: e.clientY };
    // Each finger's own drift, not the midpoint: a finger leaving the glass often shifts its
    // contact point by 10–30 px as it lifts.
    const moved = drift(t);
    if (t.mode === 'pending' && down.has(other) && h.onHoldArmed && t.s.dotTapMs) {
      const ms = Math.round(e.timeStamp - t.t0);
      const still = moved <= t.s.dotStillPx;
      if (t.tapper === e.pointerId) {
        // A quick still tap of the returning finger: cycle, and stay armed for another.
        if (still && ms <= TAP_MAX_MS && !t.rested) {
          h.onHoldTap?.();
          return armHold(other, lifted, e.timeStamp, t.s);
        }
        miss(still ? `the tap lasted ${ms} ms (at most ${TAP_MAX_MS})` : `a finger moved ${Math.round(moved)} px during the tap (allowed ${t.s.dotStillPx})`);
      } else if (!t.tapper) {
        // One finger lifting from a still hold arms it.
        if (still && ms >= t.s.dotHoldMs) return armHold(other, lifted, e.timeStamp, t.s, true);
        if (moved < t.s.swipeMinPx) {
          miss(still ? `two fingers held only ${ms} ms before one lifted (needs ${t.s.dotHoldMs})` : `a finger moved ${Math.round(moved)} px while holding (allowed ${t.s.dotStillPx})`);
          return;
        }
      }
    }
    if (t.tapper) endHold();
    // Whatever the segment was, a finger still down can tap for dots next, or start a new segment.
    const rearm = () => !t.s.twoModeLock && down.has(other) && t.s.dotTapMs && armHold(other, lifted, e.timeStamp, t.s);
    if (t.mode === 'scrub' || t.mode === 'side') {
      two = t;
      closeSegment();
      two = null;
      return rearm();
    }
    if (t.rested) return rearm();
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
    rearm();
  }
}
