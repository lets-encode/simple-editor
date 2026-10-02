// Neighbour finding over the indexed page, modelled on mei-friend's arrow-key navigation.
// Navigation never leaves the rendered page: at the first or last element it returns null.

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

const EPS = 1e-6;
const laneKey = (it) => `${it.staffN}/${it.layerN}`;

/**
 * Grows a selection one step in a direction; it never shrinks. An element is added only if its
 * onset falls within the grown selection's time span.
 * Left/right: the span extends to the nearest onset before its start / after its end in any of the
 *   selection's (staff, layer) lanes, and every element of those lanes starting in the new stretch is added.
 * Up/down: the span stays; each selected element's vertical neighbour is found, a neighbour in the
 *   same chord is added, and a neighbour in another lane brings in that lane's elements starting
 *   within the span (entering each chord at its near edge).
 * @param {Score} score @param {Set<string>} ids @param {'left'|'right'|'up'|'down'} dir
 * @returns {Item[]} the items to add
 */
export function expansion(score, ids, dir) {
  const sel = [...ids].map((id) => score.byId.get(id)).filter(Boolean);
  if (!sel.length) return [];
  const lo = Math.min(...sel.map((it) => it.t));
  const hi = Math.max(...sel.map((it) => it.t));
  const fresh = (it) => !ids.has(it.id);
  const add = [];

  if (dir === 'left' || dir === 'right') {
    const lanes = new Set(sel.map(laneKey));
    const pool = score.items.filter((o) => lanes.has(laneKey(o)) && fresh(o));
    if (dir === 'left') {
      const before = pool.filter((o) => o.t < lo - EPS);
      if (!before.length) return [];
      const from = Math.max(...before.map((o) => o.t));
      add.push(...before.filter((o) => o.t >= from - EPS));
    } else {
      const after = pool.filter((o) => o.t > hi + EPS);
      if (!after.length) return [];
      const to = Math.min(...after.map((o) => o.t));
      add.push(...after.filter((o) => o.t <= to + EPS));
    }
  } else {
    const d = dir === 'up' ? -1 : 1;
    const inSpan = (o) => o.t >= lo - EPS && o.t <= hi + EPS;
    // Lanes already in the selection are not filled again, so elements tapped out stay out.
    const own = new Set(sel.map(laneKey));
    const reached = new Set();
    for (const it of sel) {
      const n = vertical(score, it, d);
      if (!n) continue;
      if (n.chordId && n.chordId === it.chordId) add.push(n);
      else if (!own.has(laneKey(n))) reached.add(laneKey(n));
    }
    const seen = new Set();
    for (const o of score.items) {
      if (!reached.has(laneKey(o)) || !inSpan(o)) continue;
      const key = eventKey(o);
      if (seen.has(key)) continue;
      seen.add(key);
      add.push(pickInEvent(score, o, o.cy, d < 0 ? 'bottom' : 'top'));
    }
  }
  return [...new Map(add.filter(fresh).map((it) => [it.id, it])).values()];
}
