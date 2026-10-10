import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { Score, SCALES, slotRect } from './score.js';
import { horizontal, vertical, expansion, departure, enterLane, enterSystem } from './nav.js';
import { attachGestures } from './gestures.js';
import { createBar } from './bar.js';
import { FIXTURES, loadSettings, bindSettingsDialog, loadEdits, saveEdits, discardEdits } from './settings.js';
import { MeiDoc } from './mei.js';
import { setDurationSteps, durationCarrier, snapshot, restore } from './edit.js';
import { Ghosts, harvestGlyphs, baseOf, staffLines } from './ghost.js';
import { Facsimile, measureFrame } from './facsimile.js';
import { EntryPane } from './pane.js';
import { clefAt, pitchName, insertNote, durationAfter } from './entry.js';
import { applyAccidental, accidSnapshot, movePitch, PitchKeeper } from './accid.js';

const stage = document.getElementById('stage');
const scoreEl = document.getElementById('score');
const boxEl = document.getElementById('box');
const hudGesture = document.getElementById('hud-gesture');
const hudSelection = document.getElementById('hud-selection');
const settingsDialog = document.getElementById('settings');
const mainEl = document.getElementById('main');
const paneEl = document.getElementById('pane');
const caretEl = document.getElementById('caret');
const slotsEl = document.getElementById('slots');
const edgePrev = document.getElementById('edge-prev');
const edgeNext = document.getElementById('edge-next');

const settings = loadSettings();

// Selection state. `fromDrag` marks a selection made by drag-box (or Shift+arrow), which swipes
// grow instead of replace. `cursor` is the element single-step navigation starts from. `before`
// marks the position before a bar's first element in a lane (note entry): nothing is selected,
// and the caret stands before `cursor`.
const sel = { ids: new Set(), fromDrag: false, cursor: null, before: false };

let score;
let bar;
/** @type {Ghosts} */
let ghosts;
/** @type {MeiDoc} */
let doc;
/** @type {Facsimile} */
let fac;
/** @type {EntryPane} */
let pane;
// Note entry: whether the pane is open, the note just entered (for moving on to the next bar
// only within a run of entry, N5), and the duration of the last note entered.
const entry = { open: false, run: null, last: null };

let hudText = '';
let timing = '';

// Reload timings since the score was loaded or the statistics were reset: one entry per reload
// actually run (merged steps count once), as [serialise, load, render] in ms.
const reloads = [];

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

function reloadStats() {
  const total = reloads.map((r) => r[0] + r[1] + r[2]).sort((a, b) => a - b);
  const phase = (k) => Math.round(quantile(reloads.map((r) => r[k]).sort((a, b) => a - b), 0.5));
  return {
    n: reloads.length,
    median: Math.round(quantile(total, 0.5)),
    p90: Math.round(quantile(total, 0.9)),
    max: total.at(-1),
    phases: `${phase(0)} + ${phase(1)} + ${phase(2)}`,
  };
}

function statsText(long = false) {
  const st = reloadStats();
  if (!st.n) return 'no reloads yet';
  const base = `n ${st.n}, median ${st.median}, p90 ${st.p90}`;
  return long ? `${base}, max ${st.max} ms; median per phase (serialise + load + render) ${st.phases} ms` : `${base} ms`;
}

/** `edit` keeps the last reload timing on show; other messages drop it. */
function hud(text, edit = false) {
  hudText = text;
  if (!edit) timing = '';
  hudGesture.textContent = timing ? `${text} · ${timing}` : text;
}

function apply(ids = sel.ids) {
  for (const el of scoreEl.querySelectorAll('g.selected')) el.classList.remove('selected');
  for (const id of ids) score.byId.get(id)?.el.classList.add('selected');
  const away = drawEdges(ids);
  const where = away ? ` (${ids.size - away} on this page)` : '';
  if (sel.before && sel.cursor) hudSelection.textContent = `before ${score.describe(sel.cursor)}`;
  else if (ids.size === 0) hudSelection.textContent = 'nothing selected';
  else if (ids.size === 1) hudSelection.textContent = away ? `1 selected on page ${score.pageOf([...ids][0])}` : score.describe([...ids][0]);
  else hudSelection.textContent = `${ids.size} selected${where}${sel.fromDrag ? ' (drag selection)' : ''}`;
  drawSlots(ids);
  followSelection();
  updateCaret();
}

/**
 * Chevrons at the stage's edges count the selected elements on earlier and later pages.
 * @returns {number} how many selected elements are off this page
 */
function drawEdges(ids) {
  let before = 0;
  let after = 0;
  for (const id of ids) {
    if (score.byId.has(id)) continue;
    const p = score.pageOf(id);
    if (p && p < score.page) before++;
    else if (p > score.page) after++;
  }
  edgePrev.hidden = !before;
  edgeNext.hidden = !after;
  edgePrev.textContent = `‹ ${before}`;
  edgeNext.textContent = `${after} ›`;
  return before + after;
}

/** Selected slots are drawn as boxes over their stretch of staff. */
function drawSlots(ids) {
  const s = stage.getBoundingClientRect();
  slotsEl.replaceChildren(
    ...[...ids]
      .map((id) => score.byId.get(id))
      .filter((it) => it?.slot)
      .map((it) => {
        const d = document.createElement('div');
        d.className = 'slot-box';
        const pad = it.rect.height / 4;
        Object.assign(d.style, { left: `${it.rect.left - s.left}px`, top: `${it.rect.top - s.top - pad}px`, width: `${it.rect.width}px`, height: `${it.rect.height + 2 * pad}px` });
        return d;
      }),
  );
}

// Note entry (modes.md N1–N7).

/** After the selection's focus; with nothing selected, before the first element on screen (N3). */
function insertionPoint() {
  const it = sel.cursor && score.byId.get(sel.cursor);
  if (it) return { item: it, before: sel.before };
  const first = score.items.find((i) => !i.el.classList.contains('clef'));
  return first ? { item: first, before: !first.slot } : null;
}

/** Where the caret goes, in client px, with the staff it belongs to. */
function caretGeometry() {
  const ip = insertionPoint();
  if (!ip) return null;
  const { item, before } = ip;
  const staffG = item.el.closest('g.staff');
  const lines = slotRect(staffG);
  if (!lines) return null;
  let x;
  if (item.slot) x = item.rect.left + 3;
  else {
    const b = (item.el.closest('g.chord') ?? item.el).getBoundingClientRect();
    x = before ? b.left - 4 : b.right + 4;
  }
  return { ip, staffG, x, top: lines.top, bottom: lines.bottom, focusEl: doc.get(item.id) };
}

function updateCaret() {
  const c = entry.open && caretGeometry();
  caretEl.hidden = !c;
  if (!c) return;
  const s = stage.getBoundingClientRect();
  const pad = (c.bottom - c.top) / 4;
  Object.assign(caretEl.style, { left: `${c.x - s.left}px`, top: `${c.top - s.top - pad}px`, height: `${c.bottom - c.top + 2 * pad}px` });
  pane.setClef(clefAt(doc.doc, c.focusEl, c.ip.item.staffN), (d, accid) => entryName(c.focusEl, d, accid));
}

function toggleEntry() {
  entry.open = !entry.open;
  mainEl.classList.toggle('pane-open', entry.open);
  paneEl.hidden = !entry.open;
  if (!entry.open) {
    // The position before the first note exists only while entering.
    if (sel.before && score.byId.get(sel.cursor)) selectOnly(score.byId.get(sel.cursor));
    ghosts.clearInsert();
    document.getElementById('pane-label').hidden = true;
  }
  updateCaret();
  hud(entry.open ? 'entry pane open — touch it to enter a note at the caret' : 'entry pane closed');
}

function setPaneSide() {
  mainEl.classList.toggle('pane-right', settings.paneSide !== 'left');
  mainEl.classList.toggle('pane-left', settings.paneSide === 'left');
}

/**
 * The new note's duration: the note it follows (N4), or before the first note the one it
 * precedes; else the last note entered, else a quarter.
 */
const entryLength = (c) => durationAfter(c.focusEl, entry.last);

const SIGNS = { s: '♯', f: '♭', n: '♮' };

/** The ghost's name: with a slid accidental, the letter and that accidental; else the key's (N7). */
function entryName(focusEl, d, accid) {
  return accid ? `${pitchName(doc.doc, focusEl, d).charAt(0)}${SIGNS[accid]}` : pitchName(doc.doc, focusEl, d);
}

function entryScrub(d, accid) {
  const c = caretGeometry();
  const clef = c && clefAt(doc.doc, c.focusEl, c.ip.item.staffN);
  if (!clef) return;
  const lines = staffLines(c.staffG);
  const space = (lines.at(-1) - lines[0]) / (lines.length - 1);
  const p = score.toPage(c.x, c.top);
  // No horizontal position exists yet: just after the focus, overlapping the next note if need be.
  const x = c.ip.before ? p.x - 1.6 * space : p.x + 0.3 * space;
  const { dur, dots } = entryLength(c);
  ghosts.showInsert(c.staffG, x, d - clef.bottom, { dur: Number(dur), dots, accid });
  hud(`entry: ${entryName(c.focusEl, d, accid)}`);
}

function entryLift(d, accid) {
  ghosts.clearInsert();
  const c = caretGeometry();
  if (!c) return;
  flush();
  const len = entryLength(c);
  const advance = !c.ip.before && entry.run === c.ip.item.id;
  const { note, moved } = insertNote(doc, { focus: c.focusEl, before: c.ip.before, d, dur: len.dur, dots: len.dots, advance });
  doc.changed();
  const ripple = accid ? applyAccidental(doc, [note], accid).rippled : 0;
  const id = note.getAttribute('xml:id');
  entry.run = id;
  entry.last = len;
  sel.ids = new Set([id]);
  sel.fromDrag = false;
  sel.cursor = id;
  sel.before = false;
  const t = score.reload(id, settings.reloadScope);
  // Moved on to a bar on the next page: lay out afresh around the new note.
  if (!score.byId.has(id)) {
    score.fullLayout(id, doc.serialize());
    score.render();
  }
  apply();
  bar.refreshStatus();
  const bar_ = note.closest('measure')?.getAttribute('n') ?? '?';
  const follow = ripple ? `, ${plural(ripple, 'later note')} in the bar follow` : '';
  hud(`inserted ${entryName(note, d, accid)} in bar ${bar_}${moved ? ' (on into the next bar)' : ''}${follow} · ${t.ser + t.load + t.render} ms ${t.scope}`);
}


/** Points the facsimile at the measures on screen and the selection's focus measure. */
function followSelection() {
  if (!fac?.available) return;
  const id = sel.cursor ?? [...sel.ids][0];
  const selected = new Set([...sel.ids].map((i) => score.byId.get(i)?.measure.id).filter(Boolean));
  fac.follow({ focus: (id && score.byId.get(id)?.measure) || score.measures[0], onScreen: score.measures, selected });
}

/**
 * A tap on a zone in the facsimile: turns to the measure's page if need be, and selects the element
 * of that measure nearest the corresponding point of the rendered measure.
 */
function selectFromFacsimile(hit) {
  if (!hit) return hud('facsimile tap outside any measure zone');
  flush();
  const ids = doc.measureIds();
  const pageOf = (mid) => {
    const i = ids.indexOf(mid);
    return score.ranges.findIndex(([a, b]) => ids.indexOf(a) <= i && i <= ids.indexOf(b)) + 1;
  };
  // Of measures sharing the zone, the first on this page, else the first.
  const mid = hit.measureIds.find((m) => pageOf(m) === score.page) ?? hit.measureIds[0];
  const page = pageOf(mid);
  if (page > 0 && page !== score.page) {
    score.turnPage(page - score.page);
    bar.refreshStatus();
  }
  const m = score.measures.find((x) => x.id === mid);
  const n = doc.get(mid)?.getAttribute('n') ?? '?';
  const items = m ? score.items.filter((it) => it.measure === m && !it.el.classList.contains('clef')) : [];
  const f = m && measureFrame(m);
  if (!items.length || !f) {
    clearSelection();
    return hud(`facsimile tap — bar ${n}${m ? ', nothing to select in it' : ' is not on screen'}`);
  }
  const px = f.left + hit.fx * f.width;
  const py = f.top + hit.fy * f.height;
  // Height decides the staff; across counts for less, since source and render are spaced differently.
  const best = items.reduce((a, b) => (Math.hypot((b.cx - px) / 3, b.cy - py) < Math.hypot((a.cx - px) / 3, a.cy - py) ? b : a));
  selectOnly(best);
  pulse(best);
  hud(`facsimile tap — bar ${n}`);
}

/** Briefly enlarges an item's notehead (or glyph), so a tap elsewhere visibly lands on it. */
function pulse(it) {
  const g = it.el.querySelector('g.notehead') ?? it.el;
  g.classList.remove('pulse');
  // Restarts the animation when the same element is pulsed twice in a row.
  void g.getBoundingClientRect();
  g.classList.add('pulse');
  setTimeout(() => g.classList.remove('pulse'), 600);
}

function selectOnly(it) {
  sel.ids = new Set([it.id]);
  sel.fromDrag = false;
  sel.cursor = it.id;
  sel.before = false;
  apply();
}

function clearSelection() {
  sel.ids = new Set();
  sel.fromDrag = false;
  sel.cursor = null;
  sel.before = false;
  apply();
}

/** The caret before `it`, with nothing selected. */
function showBefore(it) {
  sel.ids = new Set();
  sel.fromDrag = false;
  sel.cursor = it.id;
  sel.before = true;
  apply();
}

/** Whether `it` is the first event of its lane in its bar (a chord counts as one event). */
function barStart(it) {
  if (it.slot) return false;
  const key = it.chordId ?? it.id;
  return !score.items.some(
    (o) => o.measure === it.measure && o.staffN === it.staffN && o.layerN === it.layerN && o.order < it.order && (o.chordId ?? o.id) !== key,
  );
}

/**
 * One step left (sign −1) or right (+1) from a navigation state {item, before}. While entering
 * notes, crossing a barline in either direction passes the position before the bar's first
 * element, so a note can go in at the start of a bar.
 * @returns {{item: object, before?: boolean} | null}
 */
function stepH(state, sign) {
  const it = state.item;
  if (state.before) {
    if (sign > 0) return { item: it };
    const n = horizontalX(it, -1);
    return n ? { item: n } : null;
  }
  if (sign < 0 && entry.open && barStart(it)) return { item: it, before: true };
  const n = horizontalX(it, sign);
  if (!n) return null;
  if (sign > 0 && entry.open && n.measure !== it.measure && barStart(n)) return { item: n, before: true };
  return { item: n };
}

// Navigation carries on across page limits (the page-only ruling is lifted): a single step that
// finds nothing on the rendered page turns the page and enters the next one, and growing a
// selection turns to its front.

/** The measure just beyond the rendered page's last (sign +1) or before its first (−1), in document order. */
function measureBeyondPage(sign) {
  const ids = doc.measureIds();
  const edge = sign > 0 ? score.measures.at(-1) : score.measures[0];
  const i = edge ? ids.indexOf(edge.id) : -1;
  return i < 0 ? null : (ids[i + sign] ?? null);
}

/** Renders the page holding `id` if it is not the one on screen. @returns whether the page turned */
function turnTo(id) {
  const p = score.pageOf(id);
  if (!p || p === score.page) return false;
  flush();
  if (!score.showPageOf(id)) return false;
  bar.refreshStatus();
  return true;
}

/** The item for an id, turning to its page first if it is not on screen. */
function itemFor(id) {
  if (!score.byId.has(id)) turnTo(id);
  return score.byId.get(id) ?? null;
}

/** horizontal(), carrying on into the same lane on the next or previous page. */
function horizontalX(it, sign) {
  const n = horizontal(score, it, sign);
  if (n) return n;
  const from = departure(it);
  for (let mid = measureBeyondPage(sign); mid; mid = measureBeyondPage(sign)) {
    if (!turnTo(mid)) return null;
    const e = enterLane(score, from, sign, mid);
    if (e) return e;
  }
  return null;
}

/** vertical(), carrying on from the page's top or bottom system into the previous or next page's. */
function verticalX(it, sign) {
  const n = vertical(score, it, sign);
  if (n) return n;
  const mid = measureBeyondPage(sign);
  if (!mid) return null;
  const from = departure(it);
  if (!turnTo(mid)) return null;
  return enterSystem(score, from, sign, mid);
}

const DIR_SIGN = { left: -1, right: 1, up: -1, down: 1 };

function navigate(dir) {
  const cur = sel.cursor && score.byId.get(sel.cursor);
  // Ruling 7, revised: with nothing selected on this page, start from its edge.
  if (!cur) {
    const items = score.items;
    if (!items.length) return 'no elements on this page';
    selectOnly(DIR_SIGN[dir] > 0 ? items[0] : items[items.length - 1]);
    return 'started from the page edge';
  }
  const page = score.page;
  const turned = () => (score.page !== page ? `turned to page ${score.page}` : '');
  if (dir === 'left' || dir === 'right') {
    const st = stepH({ item: cur, before: sel.before }, DIR_SIGN[dir]);
    if (!st) return 'no neighbour before the end of the piece; stayed put';
    (st.before ? showBefore : selectOnly)(st.item);
    return [st.before ? 'before the first note of the bar' : '', turned()].filter(Boolean).join(', ');
  }
  const n = verticalX(cur, DIR_SIGN[dir]);
  if (!n) return 'no neighbour; stayed put';
  selectOnly(n);
  return turned();
}

/** Grows the whole selection, wherever it lies (ruling 6), and turns to the growth's front. */
function grow(dir) {
  const { ids, cursor } = expansion(score, sel.ids, dir, sel.cursor);
  for (const id of ids) sel.ids.add(id);
  if (cursor) sel.cursor = cursor;
  sel.fromDrag = true;
  const turned = cursor && turnTo(cursor);
  apply();
  return ids.length ? `added ${ids.length}${turned ? `, turned to page ${score.page}` : ''}` : 'nothing further to add';
}

// A scrub walks along a path of states from where it started. States are built lazily and kept,
// so moving the finger back returns to exactly the earlier state; a grown selection therefore never
// shrinks below its size at the start of the scrub.
let scrub = null;

// Walk states hold ids, not page items, since a scrub may turn the page and come back: showing or
// stepping from a state turns to its page first.
function walkState(prev, sign, axis) {
  const it = prev.id && itemFor(prev.id);
  if (!it) {
    const first = sign > 0 ? score.items[0] : score.items.at(-1);
    return first ? { id: first.id } : null;
  }
  const st = axis === 'h' ? stepH({ item: it, before: prev.before }, sign) : { item: verticalX(it, sign) };
  return st?.item ? { id: st.item.id, before: !!st.before } : null;
}

const GROW_DIR = { h: { 1: 'right', '-1': 'left' }, v: { 1: 'down', '-1': 'up' } };

function growState(prev, sign, axis) {
  const { ids: add, cursor } = expansion(score, prev.ids, GROW_DIR[axis][sign], prev.cursor);
  if (!add.length) return null;
  const ids = new Set(prev.ids);
  for (const id of add) ids.add(id);
  return { ids, cursor };
}

// A turn onto the other axis starts a new segment from the current state; `initial` is the state
// before the gesture, restored on cancel, and `trail` the steps reached in earlier segments.
function startScrub(axis) {
  const grow = sel.fromDrag && sel.ids.size > 0;
  const origin = grow
    ? { ids: new Set(sel.ids), cursor: sel.cursor }
    : { id: sel.cursor && score.byId.has(sel.cursor) ? sel.cursor : null, before: sel.before };
  const initial = scrub?.initial ?? { grow, state: origin };
  const trail = scrub?.trail ?? [];
  scrub = { axis, grow, paths: { 1: [origin], '-1': [origin] }, shown: 0, initial, trail };
}

function turnScrub(axis) {
  if (scrub.shown) scrub.trail.push({ axis: scrub.axis, reached: scrub.shown });
  startScrub(axis);
}

function showState(grow, state) {
  if (grow) {
    sel.ids = new Set(state.ids);
    sel.fromDrag = true;
    sel.cursor = state.cursor;
    if (state.cursor) turnTo(state.cursor);
    apply();
    return;
  }
  const it = state.id && itemFor(state.id);
  if (it) (state.before ? showBefore : selectOnly)(it);
  else clearSelection();
}

/** Shows the state `steps` along the scrub path; returns the signed number of steps actually reached. */
function showScrub(steps) {
  const sign = steps < 0 ? -1 : 1;
  const path = scrub.paths[sign];
  while (path.length <= Math.abs(steps)) {
    const next = (scrub.grow ? growState : walkState)(path.at(-1), sign, scrub.axis);
    if (!next) break;
    path.push(next);
  }
  const reached = Math.min(Math.abs(steps), path.length - 1);
  showState(scrub.grow, path[reached]);
  if (reached * sign !== scrub.shown) {
    scrub.shown = reached * sign;
    navigator.vibrate?.(4);
  }
  return reached * sign;
}

const segmentText = (axis, reached) => {
  const arrows = axis === 'h' ? ['←', '→'] : ['↑', '↓'];
  return reached ? `${reached < 0 ? arrows[0] : arrows[1]} ${Math.abs(reached)}` : '·';
};

function scrubHud(steps, reached, done) {
  const parts = [...scrub.trail.map((t) => segmentText(t.axis, t.reached)), segmentText(scrub.axis, reached)];
  const edge = reached !== steps ? ' — no further' : '';
  hud(`${scrub.grow ? 'grow' : 'walk'} ${parts.join(', ')}${edge} · page ${score.page}${done ? ' (done)' : ''}`);
}

const ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

function handleDirection(dir, expand, detail) {
  const note = expand ? grow(dir) : navigate(dir);
  hud(`${expand ? 'grow' : 'swipe'} ${ARROWS[dir]}${detail ? ` (${detail})` : ''}${note ? ` — ${note}` : ''}`);
}

// Note-mode edits change the MEI DOM; Verovio then reloads its serialisation. Two ways to show them:
//   real: reload on the next frame, merging steps made while a reload blocks the main thread;
//   fake: draw ghost notes at once, and reload only when editing pauses (no two-finger gesture
//         down, and `fakeIdleMs` since the last change).
// Auto fakes while the median of recent reloads (or, before three reloads, the initial load) is over
// `autoFakeMs`, switching at 20 % either side of it so that it does not flip back and forth.

/** @type {Map<Element, ReturnType<typeof baseOf>>} what the rendered SVG shows of each element changed since the last reload */
const pending = new Map();
let renderQueued = false;
let idleTimer = null;
let twoDown = false;
let faking = false;
let initialLoadMs = null;

function recentMedian() {
  const last = reloads.slice(-8).map((r) => r[0] + r[1] + r[2]).sort((a, b) => a - b);
  return last.length >= 3 ? quantile(last, 0.5) : initialLoadMs;
}

function useFake() {
  if (settings.renderMode !== 'auto') return settings.renderMode === 'fake';
  const m = recentMedian();
  if (m !== null && (faking ? m < settings.autoFakeMs * 0.8 : m > settings.autoFakeMs * 1.2)) faking = !faking;
  return faking;
}

function modeLabel() {
  const m = recentMedian();
  return settings.renderMode === 'auto' ? `auto → ${faking ? 'ghost' : 'real'}${m !== null ? `, median ${Math.round(m)} ms` : ''}` : settings.renderMode;
}

/** Records what the SVG shows of `els` (and a chord's notes) before their first unrendered change. */
function notePending(els) {
  for (const el of els) {
    for (const x of el.localName === 'chord' ? [el, ...el.querySelectorAll('note')] : [el]) {
      if (!pending.has(x)) pending.set(x, baseOf(x));
    }
  }
}

/** Ghost entries for the notes and rests whose drawing differs from the rendered SVG. */
function ghostEntries() {
  const out = [];
  const seen = new Set();
  for (const el of pending.keys()) {
    for (const n of el.localName === 'chord' ? el.querySelectorAll('note') : [el]) {
      if (seen.has(n)) continue;
      seen.add(n);
      const chord = n.localName === 'note' ? n.parentElement?.closest('chord') : null;
      const carrier = chord && !n.hasAttribute('dur') ? chord : n;
      const base = pending.get(n);
      const baseCarrier = pending.get(carrier) ?? baseOf(carrier);
      const baseDur = baseCarrier.dur;
      const dur = carrier.getAttribute('dur');
      const now = baseOf(n);
      if (now.pname !== base.pname || now.oct !== base.oct || now.accid !== base.accid || dur !== baseDur || carrier.getAttribute('dots') !== baseCarrier.dots) {
        out.push({ el: n, base, dur });
      }
    }
  }
  return out;
}

function reloadNow() {
  clearTimeout(idleTimer);
  renderQueued = false;
  const t = score.reload(keepId(), settings.reloadScope);
  pending.clear();
  reloads.push([t.ser, t.load, t.render]);
  timing = `reload ${t.ser} + ${t.load} + ${t.render} ms [${t.scope}] (${statsText()})`;
  apply();
  bar.refreshStatus();
  hud(hudText, true);
}

/** Brings the rendering up to date before anything else re-renders (page turns, zoom). */
function flush() {
  if (pending.size || renderQueued) reloadNow();
}

function armIdleReload() {
  clearTimeout(idleTimer);
  if (!pending.size || twoDown) return;
  idleTimer = setTimeout(() => {
    if (twoDown) return;
    if (ghostEntries().length) reloadNow();
    else {
      // Everything is back where the SVG shows it; nothing to reload.
      pending.clear();
      ghosts.clear();
    }
  }, settings.fakeIdleMs);
}

/** Shows the DOM's current state: ghost notes now and a reload later, or a reload next frame. */
function showEdits() {
  doc.changed();
  if (useFake()) {
    const n = ghosts.show(ghostEntries());
    timing = `${n ? `${plural(n, 'ghost')}, reload on pause` : 'no change to draw'} [${modeLabel()}]`;
    armIdleReload();
    return;
  }
  ghosts.clear();
  if (renderQueued) return;
  renderQueued = true;
  // After this frame is painted, so the HUD and highlight update before a slow reload blocks.
  requestAnimationFrame(() => setTimeout(() => renderQueued && reloadNow(), 0));
}

/** The DOM elements a pitch or duration edit applies to, given the selection. */
function editTargets(kind) {
  const els = [...sel.ids].map((id) => doc.get(id)).filter(Boolean);
  if (kind === 'pitch') {
    const notes = els.filter((el) => el.localName === 'note');
    return { targets: notes, skipped: els.length - notes.length };
  }
  const carriers = new Set();
  let skipped = 0;
  for (const el of els) {
    const c = durationCarrier(el);
    if (c) carriers.add(c);
    else skipped++;
  }
  return { targets: [...carriers], skipped };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function editSummary(kind, n, skipped, limited) {
  const what = kind === 'pitch' ? plural(n, 'note') : plural(n, 'duration');
  const extra = [skipped ? `${skipped} skipped` : '', limited ? `${limited} at the limit` : ''].filter(Boolean);
  return `${what}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

/**
 * Applies `steps` to the targets: pitch in staff positions (±7 an octave), keeping written
 * accidentals (since 2026-10-10; before, mei-friend's pitchMover dropped them); duration along
 * DURATIONS. @returns how many targets hit a limit
 */
function applySteps(kind, targets, steps, keeper = null) {
  if (kind === 'pitch') return movePitch(doc, targets, steps, keeper).limited;
  return targets.filter((el) => setDurationSteps(el, el.getAttribute('dur'), steps) !== steps).length;
}

const EDIT_TEXT = { pitch: ['↓', '↑'], dur: ['longer', 'shorter'] };

/** One step (or an octave) on the whole selection; `steps` is signed: pitch up and shorter are positive. */
function editOnce(kind, steps, how) {
  if (bar.mode !== 'note') return hud(`${how} — ${bar.mode} mode is not part of this spike`);
  const { targets, skipped } = editTargets(kind);
  if (!targets.length) return hud(`${how} — nothing to change${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(targets);
  const limited = applySteps(kind, targets, steps);
  const label = kind === 'pitch' ? `pitch ${EDIT_TEXT.pitch[steps > 0 ? 1 : 0]}${Math.abs(steps) === 7 ? ' octave' : ''}` : `duration ${EDIT_TEXT.dur[steps > 0 ? 1 : 0]}`;
  showEdits();
  hud(`${how}: ${label} — ${editSummary(kind, targets.length, skipped, limited)}`, true);
}

// A two-finger scrub restores each target to its state at the start of the gesture and applies the
// signed step count from there, so sliding back returns exactly to earlier values.
let edit = null;

function startEditScrub(axis) {
  if (bar.mode !== 'note') return hud(`two-finger scrub — ${bar.mode} mode is not part of this spike`);
  const kind = axis === 'h' ? 'dur' : 'pitch';
  const { targets, skipped } = editTargets(kind);
  if (!targets.length) return hud(`two-finger scrub — nothing to change${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(targets);
  // Pitch moves also change other notes' @accid.ges in the bar; the keeper puts all of them back.
  const keeper = kind === 'pitch' ? new PitchKeeper(doc) : null;
  edit = { kind, axis, skipped, keeper, targets: targets.map((el) => ({ el, snap: keeper ? null : snapshot(el) })), shown: 0 };
  showEditScrub(0, false);
}

function showEditScrub(fingerSteps, done) {
  if (!edit) return;
  // Up and left are negative finger steps; up raises the pitch, left lengthens the duration.
  const steps = edit.kind === 'pitch' ? -fingerSteps : fingerSteps;
  if (edit.keeper) edit.keeper.restore();
  else for (const t of edit.targets) restore(t.el, t.snap);
  const limited = steps ? applySteps(edit.kind, edit.targets.map((t) => t.el), steps, edit.keeper) : 0;
  if (steps !== edit.shown) {
    edit.shown = steps;
    navigator.vibrate?.(4);
    showEdits();
  }
  const dir = edit.kind === 'pitch' ? EDIT_TEXT.pitch[steps > 0 ? 1 : 0] : EDIT_TEXT.dur[steps > 0 ? 1 : 0];
  const amount = steps ? `${dir} ${Math.abs(steps)}` : '·';
  const what = edit.kind === 'pitch' ? 'pitch' : 'duration';
  hud(`two-finger scrub: ${what} ${amount} — ${editSummary(edit.kind, edit.targets.length, edit.skipped, limited)}${done ? ' (done)' : ''}`, true);
  if (done) edit = null;
}

function cancelEditScrub() {
  if (!edit) return;
  if (edit.keeper) edit.keeper.restore();
  else for (const t of edit.targets) restore(t.el, t.snap);
  edit = null;
  showEdits();
}

const NOTE_COMMAND_STEPS = { longer: ['dur', -1], shorter: ['dur', 1], down: ['pitch', -1], up: ['pitch', 1] };

const ACCID_KEYS = { sharp: 's', flat: 'f', natural: 'n' };

/** Sets or removes a written accidental on the selection's notes (N8), with the bar's ripple. */
function accidentalCommand(value, how) {
  if (bar.mode !== 'note') return hud(`${how} — ${bar.mode} mode is not part of this spike`);
  const els = [...sel.ids].map((id) => doc.get(id)).filter(Boolean);
  const notes = els.filter((el) => el.localName === 'note');
  const skipped = els.length - notes.length;
  if (!notes.length) return hud(`${how} — no notes${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(notes);
  const { removed, rippled } = applyAccidental(doc, notes, value);
  showEdits();
  const follow = rippled ? `; ${plural(rippled, 'later note')} in the bar follow` : '';
  hud(`${how}: ${SIGNS[value]} ${removed ? 'removed from' : 'on'} ${plural(notes.length, 'note')}${follow}${skipped ? ` (${skipped} skipped)` : ''}`, true);
}

// The one-sided two-finger slide (accidentals): one finger holds still while the other slides
// sideways. Out to the left gives ♭, out to the right ♯, in towards the still finger ♮. Tried out
// live from a snapshot of the notes it can touch, kept on lift, put back exactly on cancel.
let side = null;

function sideValue(mover, out, current) {
  const px = settings.sideAccidPx;
  const outward = mover === 'left' ? 'f' : 's';
  const keep = px - 6;
  if (out >= px || (current === outward && out >= keep)) return outward;
  if (out <= -px || (current === 'n' && out <= -keep)) return 'n';
  return null;
}

function sideHud(done) {
  const what = side.value
    ? `${SIGNS[side.value]} ${side.res.removed ? 'removed from' : 'on'} ${plural(side.notes.length, 'note')}${side.res.rippled ? `; ${plural(side.res.rippled, 'later note')} in the bar follow` : ''}`
    : `slide ${side.mover === 'left' ? 'left for ♭' : 'right for ♯'}, inwards for ♮`;
  hud(`one-sided slide (${side.mover} finger): ${what}${side.skipped ? ` (${side.skipped} skipped)` : ''}${done ? ' (done)' : ''}`, true);
}

function startSide(mover) {
  if (bar.mode !== 'note') return hud(`one-sided slide — ${bar.mode} mode is not part of this spike`);
  const els = [...sel.ids].map((id) => doc.get(id)).filter(Boolean);
  const notes = els.filter((el) => el.localName === 'note');
  if (!notes.length) return hud(`one-sided slide — no notes${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(notes);
  side = { mover, notes, skipped: els.length - notes.length, snap: accidSnapshot(doc, notes), value: null, res: null };
  sideHud(false);
}

function showSide(out, done) {
  if (!side) return;
  const v = sideValue(side.mover, out, side.value);
  if (v !== side.value) {
    side.value = v;
    navigator.vibrate?.(12);
    side.snap.restore();
    side.res = v ? applyAccidental(doc, side.notes, v) : null;
    showEdits();
  }
  sideHud(done);
}

function cancelSide() {
  if (!side) return;
  side.snap.restore();
  side = null;
  showEdits();
}

/** Cycles the dots on the selection's notes, chords and rests: 0 → 1 → 2 → 0 (N11), all to the same count. */
function cycleDots(how) {
  if (bar.mode !== 'note') return hud(`${how} — ${bar.mode} mode is not part of this spike`);
  const { targets, skipped } = editTargets('dur');
  if (!targets.length) return hud(`${how} — nothing to dot${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(targets);
  const next = (Number(targets[0].getAttribute('dots') ?? 0) + 1) % 3;
  for (const el of targets) {
    if (next) el.setAttribute('dots', String(next));
    else el.removeAttribute('dots');
  }
  navigator.vibrate?.(next ? [6, 40, 6].slice(0, 2 * next - 1) : 20);
  showEdits();
  const what = next ? `${next} dot${next > 1 ? 's' : ''}` : 'no dots';
  hud(`${how}: ${what} — ${plural(targets.length, 'duration')}${skipped ? ` (${skipped} skipped)` : ''}`, true);
}

function noteCommand(key) {
  if (key === 'insert') return toggleEntry();
  if (ACCID_KEYS[key]) return accidentalCommand(ACCID_KEYS[key], 'button');
  const [kind, steps] = NOTE_COMMAND_STEPS[key];
  editOnce(kind, steps, 'button');
}

function toStage(r) {
  const s = stage.getBoundingClientRect();
  return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
}

function wireGestures() {
  attachGestures(document.getElementById('work'), () => settings, {
    // The path, not the target: the pane redraws on touch, detaching the element touched.
    claims: (e) => !e.composedPath().some((n) => n === paneEl || n === edgePrev || n === edgeNext),
    onTap(x, y) {
      const it = score.hit(x, y, settings.tapReachPx);
      if (!it) {
        clearSelection();
        hud('tap on empty space — selected none');
      } else if (sel.fromDrag && sel.ids.has(it.id)) {
        sel.ids.delete(it.id);
        if (sel.ids.size === 0) sel.fromDrag = false;
        else if (sel.cursor === it.id) sel.cursor = [...sel.ids].at(-1);
        apply();
        hud('tap on a drag-selected element — removed it');
      } else {
        selectOnly(it);
        hud('tap — selected');
      }
    },
    onSwipe(dir, { dist, ms }) {
      handleDirection(dir, sel.fromDrag && sel.ids.size > 0, `${dist} px, ${ms} ms`);
    },
    // A box always adds to the selection, on this page or others; only a tap clears it.
    onBox(r, done) {
      const b = toStage(r);
      Object.assign(boxEl.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
      boxEl.hidden = done;
      const boxed = score.inRect(r).map((it) => it.id);
      const keep = sel.ids;
      const ids = new Set([...keep, ...boxed]);
      const adding = keep.size ? `, adding to ${keep.size} selected` : '';
      if (!done) {
        apply(ids);
        hud(`drag box — ${boxed.length} inside${adding}`);
        return;
      }
      sel.ids = ids;
      sel.fromDrag = ids.size > 0;
      sel.cursor = boxed.length ? boxed.at(-1) : keep.size ? sel.cursor : null;
      sel.before = false;
      apply();
      hud(`drag box — selected ${boxed.length}${adding}`);
    },
    onBoxCancel() {
      boxEl.hidden = true;
      apply();
    },
    onArmed() {
      hud('held — drag to select');
    },
    onScrubStart(axis) {
      startScrub(axis);
    },
    onScrub(steps) {
      scrubHud(steps, showScrub(steps), false);
    },
    onScrubEnd(steps) {
      scrubHud(steps, showScrub(steps), true);
      scrub = null;
    },
    onScrubTurn(axis) {
      turnScrub(axis);
    },
    onScrubCancel() {
      showState(scrub.initial.grow, scrub.initial.state);
      scrub = null;
    },
    onIgnored(reason) {
      hud(`ignored: ${reason}`);
    },
    onTwoStart() {
      pane.cancel('two fingers');
      twoDown = true;
      clearTimeout(idleTimer);
      // Only a drag box cut short by the second finger needs the highlight put back; every other
      // touch (each dots tap among them) skips the redraw.
      if (!boxEl.hidden) {
        boxEl.hidden = true;
        apply();
      }
      hud('two fingers');
    },
    onTwoSwipe(dir, { dist, ms, speed }) {
      const how = `two-finger flick ${ARROWS[dir]} (${dist} px, ${ms} ms, ${speed.toFixed(2)} px/ms)`;
      if (dir === 'left' || dir === 'right') return editOnce('dur', dir === 'left' ? -1 : 1, how);
      const octave = dist >= settings.octaveMinPx && speed >= settings.octaveSpeed;
      editOnce('pitch', (dir === 'up' ? 1 : -1) * (octave ? 7 : 1), how);
    },
    onTwoScrubStart(axis) {
      startEditScrub(axis);
    },
    onTwoScrub(steps) {
      showEditScrub(steps, false);
    },
    onTwoScrubEnd(steps) {
      showEditScrub(steps, true);
      armIdleReload();
    },
    onHoldArmed() {
      armIdleReload();
      hud('one finger holding — tap with another to cycle the dots');
    },
    onHoldTap() {
      cycleDots('hold and tap');
      armIdleReload();
    },
    onHoldEnd() {},
    onHoldMiss(reason) {
      armIdleReload();
      hud(`dots: not counted — ${reason}`);
    },
    onSideStart(mover) {
      startSide(mover);
    },
    onSide(mover, out) {
      showSide(out, false);
    },
    onSideEnd(mover, out) {
      showSide(out, true);
      side = null;
      armIdleReload();
    },
    // Two-finger sessions keep their edits pending (ghosts, no reload) until the last finger lifts.
    onTwoAllUp() {
      twoDown = false;
      armIdleReload();
    },
    onTwoCancel(reason) {
      cancelEditScrub();
      cancelSide();
      armIdleReload();
      hud(`ignored: ${reason}`);
    },
  });

  // A chevron turns to the nearest page holding more of the selection, keeping the selection.
  for (const [chev, sign] of [[edgePrev, -1], [edgeNext, 1]]) {
    chev.addEventListener('click', () => {
      const pages = [...sel.ids].map((id) => score.pageOf(id)).filter((p) => p && Math.sign(p - score.page) === sign);
      if (!pages.length) return;
      const target = sign < 0 ? Math.max(...pages) : Math.min(...pages);
      turnPage(target - score.page);
      hud(`chevron — turned to page ${score.page}`);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (settingsDialog.open) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir && e.altKey) {
      // Alt+arrows stand in for two-finger flicks; Alt+Shift+up/down jumps an octave.
      e.preventDefault();
      const how = `Alt+${e.shiftKey ? 'Shift+' : ''}arrow`;
      if (dir === 'left' || dir === 'right') editOnce('dur', dir === 'left' ? -1 : 1, how);
      else editOnce('pitch', (dir === 'up' ? 1 : -1) * (e.shiftKey ? 7 : 1), how);
    } else if (dir) {
      e.preventDefault();
      handleDirection(dir, e.shiftKey && sel.ids.size > 0, e.shiftKey ? 'Shift+arrow' : 'arrow key');
    } else if (e.key === '.') {
      cycleDots('. key');
    } else if (e.key === 'Escape') {
      clearSelection();
      hud('Escape — selected none');
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      turnPage(e.key === 'PageDown' ? 1 : -1);
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      zoom(e.key === '-' ? -1 : 1);
    }
  });
}

function turnPage(d) {
  flush();
  if (score.turnPage(d)) apply();
  bar.refreshStatus();
}

function keepId() {
  return sel.cursor ?? [...sel.ids][0];
}

function zoom(d) {
  const i = SCALES.indexOf(score.scale);
  const next = SCALES[Math.min(Math.max(i + d, 0), SCALES.length - 1)];
  if (next === score.scale) return;
  flush();
  score.scale = next;
  score.relayout(keepId());
  apply();
  bar.refreshStatus();
  hud(`scale ${next}`);
}

const statsEl = document.getElementById('reload-stats');

function showStats() {
  statsEl.textContent = statsText(true);
}

document.getElementById('reload-stats-reset').addEventListener('click', () => {
  reloads.length = 0;
  showStats();
});

let fixtureKey = null;
let saveTimer = null;
let editsOk = true;

const editsState = document.getElementById('edits-state');
function showKept() {
  editsState.textContent = !editsOk ? 'not kept (storage refused)' : loadEdits(fixtureKey) ? 'edited copy kept' : 'original';
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!doc) return;
  editsOk = saveEdits(fixtureKey, doc.serialize());
  showKept();
}

// Edits are kept shortly after they settle, and at once when the page is hidden or closed.
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
addEventListener('pagehide', () => saveTimer && saveNow());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && saveTimer) saveNow();
});

document.getElementById('edits-revert').addEventListener('click', () => {
  if (!confirm('Discard all edits to this score and start again from the original?')) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  discardEdits(fixtureKey);
  editsOk = true;
  loadFixture(fixtureKey, true);
});

async function loadFixture(key, original = false) {
  // Edits to the score being left must be kept before the next one replaces it.
  if (saveTimer && key !== fixtureKey) saveNow();
  const f = FIXTURES.find((x) => x.key === key) ?? FIXTURES[0];
  fixtureKey = f.key;
  const kept = original ? null : loadEdits(f.key);
  let text = kept;
  if (text) {
    try {
      doc = new MeiDoc(text);
    } catch {
      discardEdits(f.key);
      text = null;
    }
  }
  if (!text) doc = new MeiDoc(await (await fetch(f.url)).text());
  doc.onChanged = scheduleSave;
  showKept();
  entry.run = null;
  entry.last = null;
  // Before the first layout, so the score is laid out for the stage the closed sheet leaves.
  fac.load(doc, f.url);
  reloads.length = 0;
  pending.clear();
  faking = false;
  score.load(doc);
  score.render();
  // Auto's first guess, before three edits have been timed: one reload as an edit would do it. The
  // initial full layout is several times slower than a page reload, so judging by it made Auto start
  // with ghosts on fast phones.
  const t = score.reload(null, settings.reloadScope);
  initialLoadMs = t.ser + t.load + t.render;
  clearSelection();
  bar.refreshStatus();
  hud(text ? `${f.label} (your edited copy)` : f.label);
}

async function main() {
  const VerovioModule = await createVerovioModule();
  const tk = new VerovioToolkit(VerovioModule);
  harvestGlyphs(tk);
  score = new Score(tk, scoreEl);
  ghosts = new Ghosts(scoreEl);
  fac = new Facsimile({
    main: document.getElementById('main'),
    stage,
    sheet: document.getElementById('sheet'),
    settings,
    onChange: (text) => hud(text),
    onTap: selectFromFacsimile,
  });
  pane = new EntryPane({
    el: paneEl,
    label: document.getElementById('pane-label'),
    settings,
    onScrub: entryScrub,
    onLift: entryLift,
    onCancel: (reason) => {
      ghosts.clearInsert();
      hud(`entry cancelled: ${reason}`);
    },
  });
  setPaneSide();
  // Exposed for inspection from the browser console.
  window.spike = { score, sel, settings, fac, pane, entry, get doc() { return doc; } };
  bar = createBar(document.getElementById('bar'), {
    page: turnPage,
    zoom,
    settings: () => {
      showStats();
      settingsDialog.showModal();
    },
    pages: () => ({ page: score?.page ?? 1, count: score?.pageCount ?? 0 }),
    goto: (p) => turnPage(p - score.page),
    note: noteCommand,
    pressed: (key) => key === 'insert' && entry.open,
  });
  bindSettingsDialog(settingsDialog, settings, loadFixture, (name) => {
    if (name === 'paneSide') setPaneSide();
    if (name === 'paneStepPx') pane.draw();
  });
  await loadFixture(settings.fixture);
  document.getElementById('loading').remove();
  wireGestures();

  let timer;
  let last = `${scoreEl.clientWidth}x${scoreEl.clientHeight}`;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const size = `${scoreEl.clientWidth}x${scoreEl.clientHeight}`;
      if (size === last) return;
      last = size;
      flush();
      score.relayout(keepId());
      apply();
      bar.refreshStatus();
    }, 150);
  }).observe(scoreEl);
}

main();

// Offline: the service worker precaches the whole build (see vite.config.js). Production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
