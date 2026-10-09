// Neighbour finding, modelled on mei-friend's arrow-key navigation.
// Single steps work on the rendered page's index and return null at its edge; the caller turns the
// page and enters the next one with enterLane() or enterSystem(). Growing a selection works on the
// time index of the whole document (timeline.js), so it needs no rendering at all.

import { slotRect } from './score.js';
import { timeline } from './timeline.js';

/** @typedef {import('./score.js').Item} Item */
/** @typedef {import('./score.js').Score} Score */

const eventKey = (it) => it.chordId ?? it.id;

/** All items of the event (chord or single element) that `it` belongs to. */
export function eventOf(score, it) {
  if (!it.chordId) return [it];
  return score.items.filter((o) => o.chordId === it.chordId);
}

/** Picks one note of a chord: the one nearest `y`, or the lowest/highest when `prefer` is set. */
function pickInEvent(score, it, y, prefer) {
  const ev = eventOf(score, it);
  if (ev.length === 1) return ev[0];
  if (prefer === 'bottom') return ev.reduce((a, b) => (b.cy > a.cy ? b : a));
  if (prefer === 'top') return ev.reduce((a, b) => (b.cy < a.cy ? b : a));
  return ev.reduce((a, b) => (Math.abs(b.cy - y) < Math.abs(a.cy - y) ? b : a));
}

function nearestInX(list, x) {
  return list.reduce((a, b) => (Math.abs(b.cx - x) < Math.abs(a.cx - x) ? b : a));
}

/**
 * Previous (dir -1) or next (dir +1) event in the same staff and layer, crossing into
 * neighbouring measures on the page. A measure without the layer falls back to the staff's
 * lowest-numbered layer, as mei-friend does.
 * @returns {Item|null}
 */
export function horizontal(score, it, dir) {
  const items = score.items;
  const key = eventKey(it);
  const inLane = (o, m) => o.measure === m && o.staffN === it.staffN && o.layerN === it.layerN;
  const here = items.filter(
    (o) => inLane(o, it.measure) && eventKey(o) !== key && (dir > 0 ? o.order > it.order : o.order < it.order),
  );
  if (here.length) return pickInEvent(score, dir > 0 ? here[0] : here[here.length - 1], it.cy);

  for (let mi = it.measureIndex + dir; mi >= 0 && mi < score.measures.length; mi += dir) {
    const m = score.measures[mi];
    let lane = items.filter((o) => inLane(o, m));
    if (!lane.length) {
      const staff = items.filter((o) => o.measure === m && o.staffN === it.staffN);
      if (staff.length) {
        const minLayer = Math.min(...staff.map((o) => o.layerN));
        lane = staff.filter((o) => o.layerN === minLayer);
      }
    }
    if (lane.length) return pickInEvent(score, dir > 0 ? lane[0] : lane[lane.length - 1], it.cy);
  }
  return null;
}

/**
 * Upward (dir -1) or downward (dir +1) neighbour, in precedence order:
 * the chord, then the layer, then the staff, then the system.
 * Layer n-1 counts as "above" layer n.
 * @returns {Item|null}
 */
export function vertical(score, it, dir) {
  const items = score.items;
  const enter = dir < 0 ? 'bottom' : 'top';

  // 1. Within the chord.
  if (it.chordId) {
    const others = eventOf(score, it).filter((o) => (dir < 0 ? o.cy < it.cy : o.cy > it.cy));
    if (others.length) return others.reduce((a, b) => (Math.abs(b.cy - it.cy) < Math.abs(a.cy - it.cy) ? b : a));
  }

  // 2. Another layer of the same staff in the same measure.
  const staffItems = items.filter((o) => o.measure === it.measure && o.staffN === it.staffN);
  const layers = [...new Set(staffItems.map((o) => o.layerN))].filter((n) => (dir < 0 ? n < it.layerN : n > it.layerN));
  if (layers.length) {
    const target = dir < 0 ? Math.max(...layers) : Math.min(...layers);
    const lane = staffItems.filter((o) => o.layerN === target);
    return pickInEvent(score, nearestInX(lane, it.cx), it.cy, enter);
  }

  // 3. Another staff in the same measure: enter its nearest layer.
  const measureItems = items.filter((o) => o.measure === it.measure);
  const staves = [...new Set(measureItems.map((o) => o.staffN))].filter((n) => (dir < 0 ? n < it.staffN : n > it.staffN));
  if (staves.length) {
    const target = dir < 0 ? Math.max(...staves) : Math.min(...staves);
    return enterStaff(score, measureItems.filter((o) => o.staffN === target), it, dir);
  }

  // 4. The system above or below, on this page: enter its bottom or top staff.
  const si = score.systems.indexOf(it.system) + dir;
  if (si >= 0 && si < score.systems.length) {
    const sysItems = items.filter((o) => o.system === score.systems[si]);
    if (sysItems.length) {
      const ns = sysItems.map((o) => o.staffN);
      const target = dir < 0 ? Math.max(...ns) : Math.min(...ns);
      return enterStaff(score, sysItems.filter((o) => o.staffN === target), it, dir);
    }
  }
  return null;
}

function enterStaff(score, staffItems, it, dir) {
  const ns = staffItems.map((o) => o.layerN);
  const layer = dir < 0 ? Math.max(...ns) : Math.min(...ns);
  const lane = staffItems.filter((o) => o.layerN === layer);
  return pickInEvent(score, nearestInX(lane, it.cx), it.cy, dir < 0 ? 'bottom' : 'top');
}

/** The top line of an item's staff, in client px. */
function staffTop(it) {
  return slotRect(it.el.closest('g.staff'))?.top ?? it.cy;
}

/** Where a step leaves a page from: its lane, height within the staff, and x. */
export function departure(it) {
  return { staffN: it.staffN, layerN: it.layerN, relY: it.cy - staffTop(it), cx: it.cx, cy: it.cy };
}

/**
 * On a freshly turned page: the first (dir +1) or last (dir −1) event of the departure's lane,
 * searching from measure `measureId` onwards in that direction. A chord is entered at the note
 * nearest the departure's height within the staff.
 * @returns {Item|null}
 */
export function enterLane(score, from, dir, measureId) {
  const start = score.measures.findIndex((m) => m.id === measureId);
  if (start < 0) return null;
  for (let mi = start; mi >= 0 && mi < score.measures.length; mi += dir) {
    const m = score.measures[mi];
    const staff = score.items.filter((o) => o.measure === m && o.staffN === from.staffN);
    if (!staff.length) continue;
    let lane = staff.filter((o) => o.layerN === from.layerN);
    if (!lane.length) {
      const minLayer = Math.min(...staff.map((o) => o.layerN));
      lane = staff.filter((o) => o.layerN === minLayer);
    }
    const it = dir > 0 ? lane[0] : lane[lane.length - 1];
    return pickInEvent(score, it, staffTop(it) + from.relY);
  }
  return null;
}

/**
 * On a freshly turned page: going down (dir +1), the top staff of the system holding `measureId`;
 * going up (−1), its bottom staff. The element nearest the departure's x, as vertical() does.
 * @returns {Item|null}
 */
export function enterSystem(score, from, dir, measureId) {
  const m = score.measures.find((x) => x.id === measureId);
  const sysItems = m ? score.items.filter((o) => o.system === m.closest('g.system')) : [];
  if (!sysItems.length) return null;
  const ns = sysItems.map((o) => o.staffN);
  const target = dir < 0 ? Math.max(...ns) : Math.min(...ns);
  return enterStaff(score, sysItems.filter((o) => o.staffN === target), from, dir);
}

const EPS = 1e-6;
const laneKey = (it) => `${it.staffN}/${it.layerN}`;
const eventKeyT = (e) => e.chordId ?? e.id;

/** Of an event's notes, the lowest ('bottom') or highest ('top') in pitch. */
function chordEdge(tl, e, prefer) {
  if (!e.chordId) return e;
  const ev = tl.entries.filter((o) => o.chordId === e.chordId && o.pitch !== null);
  if (!ev.length) return e;
  return ev.reduce((a, b) => ((prefer === 'bottom' ? b.pitch < a.pitch : b.pitch > a.pitch) ? b : a));
}

/**
 * The vertical neighbour of a timeline entry, structurally (no rendering): within the chord by
 * pitch, else another layer of the staff in the same measure (layer n−1 is above layer n), else
 * the nearest staff in the measure, at its nearest layer. The system above or below is never
 * needed for growing: it holds the same lanes.
 * @returns {{note: object} | {lane: string} | null}
 */
function structuralVertical(tl, e, dir) {
  if (e.chordId && e.pitch !== null) {
    const others = tl.entries.filter((o) => o.chordId === e.chordId && o.pitch !== null && (dir < 0 ? o.pitch > e.pitch : o.pitch < e.pitch));
    if (others.length) return { note: others.reduce((a, b) => (Math.abs(b.pitch - e.pitch) < Math.abs(a.pitch - e.pitch) ? b : a)) };
  }
  const inMeasure = tl.entries.filter((o) => o.gm === e.gm);
  const layers = [...new Set(inMeasure.filter((o) => o.staffN === e.staffN).map((o) => o.layerN))].filter((n) => (dir < 0 ? n < e.layerN : n > e.layerN));
  if (layers.length) return { lane: `${e.staffN}/${dir < 0 ? Math.max(...layers) : Math.min(...layers)}` };
  const staves = [...new Set(inMeasure.map((o) => o.staffN))].filter((n) => (dir < 0 ? n < e.staffN : n > e.staffN));
  if (!staves.length) return null;
  const staffN = dir < 0 ? Math.max(...staves) : Math.min(...staves);
  const ls = inMeasure.filter((o) => o.staffN === staffN).map((o) => o.layerN);
  return { lane: `${staffN}/${dir < 0 ? Math.max(...ls) : Math.min(...ls)}` };
}

/**
 * Grows a selection one step in a direction; it never shrinks. An element is added only if its
 * onset falls within the grown selection's time span (ruling 6, now over the whole piece: onsets
 * are global measure index × 1000 + quarters into the measure, from the DOM, so elements on
 * other pages take part).
 * Left/right: the span extends to the nearest onset before its start / after its end in any of the
 *   selection's (staff, layer) lanes, and every element of those lanes starting in the new stretch is added.
 * Up/down: the span stays; each selected element's vertical neighbour is found, a neighbour in the
 *   same chord is added, and a neighbour in another lane brings in that lane's elements starting
 *   within the span (entering each chord at its near edge).
 * @param {Score} score @param {Set<string>} ids @param {'left'|'right'|'up'|'down'} dir
 * @returns {{ids: string[], cursor: string|null}} the ids to add, and where the cursor goes: the
 *   growth's front (left/right), or the addition nearest in time to `cursor` (up/down)
 */
export function expansion(score, ids, dir, cursor = null) {
  const tl = timeline(score.doc);
  const sel = [...ids].map((id) => tl.byId.get(id)).filter(Boolean);
  if (!sel.length) return { ids: [], cursor: null };
  const lo = Math.min(...sel.map((e) => e.t));
  const hi = Math.max(...sel.map((e) => e.t));
  const fresh = (e) => !ids.has(e.id);
  const add = [];

  if (dir === 'left' || dir === 'right') {
    const lanes = new Set(sel.map(laneKey));
    const pool = tl.entries.filter((o) => lanes.has(laneKey(o)) && fresh(o));
    if (dir === 'left') {
      const before = pool.filter((o) => o.t < lo - EPS);
      if (!before.length) return { ids: [], cursor: null };
      const from = Math.max(...before.map((o) => o.t));
      add.push(...before.filter((o) => o.t >= from - EPS));
    } else {
      const after = pool.filter((o) => o.t > hi + EPS);
      if (!after.length) return { ids: [], cursor: null };
      const to = Math.min(...after.map((o) => o.t));
      add.push(...after.filter((o) => o.t <= to + EPS));
    }
  } else {
    const d = dir === 'up' ? -1 : 1;
    const inSpan = (o) => o.t >= lo - EPS && o.t <= hi + EPS;
    // Lanes already in the selection are not filled again, so elements tapped out stay out.
    const own = new Set(sel.map(laneKey));
    const reached = new Set();
    for (const e of sel) {
      const n = structuralVertical(tl, e, d);
      if (n?.note) add.push(n.note);
      else if (n?.lane && !own.has(n.lane)) reached.add(n.lane);
    }
    const seen = new Set();
    for (const o of tl.entries) {
      if (!reached.has(laneKey(o)) || !inSpan(o)) continue;
      const key = eventKeyT(o);
      if (seen.has(key)) continue;
      seen.add(key);
      add.push(chordEdge(tl, o, d < 0 ? 'bottom' : 'top'));
    }
  }
  const out = [...new Map(add.filter(fresh).map((e) => [e.id, e])).values()];
  if (!out.length) return { ids: [], cursor: null };
  let front;
  if (dir === 'right') front = out.reduce((a, b) => (b.t > a.t ? b : a));
  else if (dir === 'left') front = out.reduce((a, b) => (b.t < a.t ? b : a));
  else {
    const ct = tl.byId.get(cursor)?.t ?? lo;
    front = out.reduce((a, b) => (Math.abs(b.t - ct) < Math.abs(a.t - ct) ? b : a));
  }
  return { ids: out.map((e) => e.id), cursor: front.id };
}
