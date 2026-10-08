import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { Score, SCALES } from './score.js';
import { horizontal, vertical, expansion } from './nav.js';
import { attachGestures } from './gestures.js';
import { createBar } from './bar.js';
import { FIXTURES, loadSettings, bindSettingsDialog } from './settings.js';
import { MeiDoc } from './mei.js';
import { stepPitch, setDurationSteps, durationCarrier, snapshot, restore } from './edit.js';
import { Ghosts, harvestGlyphs, baseOf } from './ghost.js';
import { Facsimile, measureFrame } from './facsimile.js';

const stage = document.getElementById('stage');
const scoreEl = document.getElementById('score');
const boxEl = document.getElementById('box');
const hudGesture = document.getElementById('hud-gesture');
const hudSelection = document.getElementById('hud-selection');
const settingsDialog = document.getElementById('settings');

const settings = loadSettings();

// Selection state. `fromDrag` marks a selection made by drag-box (or Shift+arrow), which swipes
// grow instead of replace. `cursor` is the element single-step navigation starts from.
const sel = { ids: new Set(), fromDrag: false, cursor: null };

let score;
let bar;
/** @type {Ghosts} */
let ghosts;
/** @type {MeiDoc} */
let doc;
/** @type {Facsimile} */
let fac;

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
  if (ids.size === 0) hudSelection.textContent = 'nothing selected';
  else if (ids.size === 1) hudSelection.textContent = score.describe([...ids][0]);
  else hudSelection.textContent = `${ids.size} selected${sel.fromDrag ? ' (drag selection)' : ''}`;
  followSelection();
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
  apply();
}

function clearSelection() {
  sel.ids = new Set();
  sel.fromDrag = false;
  sel.cursor = null;
  apply();
}

const DIR_SIGN = { left: -1, right: 1, up: -1, down: 1 };

function navigate(dir) {
  const cur = sel.cursor && score.byId.get(sel.cursor);
  if (!cur) {
    const items = score.items;
    if (!items.length) return 'no elements on this page';
    selectOnly(DIR_SIGN[dir] > 0 ? items[0] : items[items.length - 1]);
    return 'started from the page edge';
  }
  const n = dir === 'left' || dir === 'right' ? horizontal(score, cur, DIR_SIGN[dir]) : vertical(score, cur, DIR_SIGN[dir]);
  if (!n) return 'no neighbour on this page; stayed put';
  selectOnly(n);
  return '';
}

function grow(dir) {
  const add = expansion(score, sel.ids, dir);
  for (const it of add) sel.ids.add(it.id);
  if (add.length) sel.cursor = add[add.length - 1].id;
  sel.fromDrag = true;
  apply();
  return add.length ? `added ${add.length}` : 'nothing further to add on this page';
}

// A scrub walks along a path of states from where it started. States are built lazily and kept,
// so moving the finger back returns to exactly the earlier state; a grown selection therefore never
// shrinks below its size at the start of the scrub.
let scrub = null;

function walkState(prev, sign, axis) {
  if (!prev.item) {
    const it = sign > 0 ? score.items[0] : score.items.at(-1);
    return it ? { item: it } : null;
  }
  const n = (axis === 'h' ? horizontal : vertical)(score, prev.item, sign);
  return n ? { item: n } : null;
}

const GROW_DIR = { h: { 1: 'right', '-1': 'left' }, v: { 1: 'down', '-1': 'up' } };

function growState(prev, sign, axis) {
  const add = expansion(score, prev.ids, GROW_DIR[axis][sign]);
  if (!add.length) return null;
  const ids = new Set(prev.ids);
  for (const it of add) ids.add(it.id);
  return { ids, cursor: add.at(-1).id };
}

// A turn onto the other axis starts a new segment from the current state; `initial` is the state
// before the gesture, restored on cancel, and `trail` the steps reached in earlier segments.
function startScrub(axis) {
  const grow = sel.fromDrag && sel.ids.size > 0;
  const origin = grow
    ? { ids: new Set(sel.ids), cursor: sel.cursor }
    : { item: (sel.cursor && score.byId.get(sel.cursor)) || null };
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
    apply();
  } else if (state.item) selectOnly(state.item);
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
  const edge = reached !== steps ? ' — no further neighbour on this page' : '';
  hud(`${scrub.grow ? 'grow' : 'walk'} ${parts.join(', ')}${edge}${done ? ' (done)' : ''}`);
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
      const baseDur = (pending.get(carrier) ?? baseOf(carrier)).dur;
      const dur = carrier.getAttribute('dur');
      const now = baseOf(n);
      if (now.pname !== base.pname || now.oct !== base.oct || now.accid !== base.accid || dur !== baseDur) {
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

/** Applies `steps` to each target: pitch in diatonic steps (±7 an octave), duration along DURATIONS. */
function applySteps(kind, el, steps) {
  if (kind === 'dur') return setDurationSteps(el, el.getAttribute('dur'), steps) === steps;
  const unit = Math.abs(steps) === 7 ? steps : Math.sign(steps);
  for (let i = 0; i < Math.abs(steps / unit); i++) if (!stepPitch(doc.doc, el, unit)) return false;
  return true;
}

const EDIT_TEXT = { pitch: ['↓', '↑'], dur: ['longer', 'shorter'] };

/** One step (or an octave) on the whole selection; `steps` is signed: pitch up and shorter are positive. */
function editOnce(kind, steps, how) {
  if (bar.mode !== 'note') return hud(`${how} — ${bar.mode} mode is not part of this spike`);
  const { targets, skipped } = editTargets(kind);
  if (!targets.length) return hud(`${how} — nothing to change${sel.ids.size ? ' in the selection' : ' (nothing selected)'}`);
  notePending(targets);
  let limited = 0;
  for (const el of targets) if (!applySteps(kind, el, steps)) limited++;
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
  edit = { kind, axis, skipped, targets: targets.map((el) => ({ el, snap: snapshot(el) })), shown: 0 };
  showEditScrub(0, false);
}

function showEditScrub(fingerSteps, done) {
  if (!edit) return;
  // Up and left are negative finger steps; up raises the pitch, left lengthens the duration.
  const steps = edit.kind === 'pitch' ? -fingerSteps : fingerSteps;
  let limited = 0;
  for (const t of edit.targets) {
    restore(t.el, t.snap);
    if (steps && !applySteps(edit.kind, t.el, steps)) limited++;
  }
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
  for (const t of edit.targets) restore(t.el, t.snap);
  edit = null;
  showEdits();
}

const NOTE_COMMAND_STEPS = { longer: ['dur', -1], shorter: ['dur', 1], down: ['pitch', -1], up: ['pitch', 1] };

function noteCommand(key) {
  const [kind, steps] = NOTE_COMMAND_STEPS[key];
  editOnce(kind, steps, 'button');
}

function toStage(r) {
  const s = stage.getBoundingClientRect();
  return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
}

function wireGestures() {
  attachGestures(stage, () => settings, {
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
    onBox(r, done) {
      const b = toStage(r);
      Object.assign(boxEl.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
      boxEl.hidden = done;
      const ids = new Set(score.inRect(r).map((it) => it.id));
      if (!done) {
        apply(ids);
        hud(`drag box — ${ids.size} inside`);
        return;
      }
      sel.ids = ids;
      sel.fromDrag = ids.size > 0;
      sel.cursor = ids.size ? [...ids].at(-1) : null;
      apply();
      hud(`drag box — selected ${ids.size}`);
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
      twoDown = true;
      clearTimeout(idleTimer);
      boxEl.hidden = true;
      apply();
      hud('two fingers');
    },
    onTwoSwipe(dir, { dist, ms, speed }) {
      twoDown = false;
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
      twoDown = false;
      showEditScrub(steps, true);
      armIdleReload();
    },
    onTwoCancel(reason) {
      twoDown = false;
      cancelEditScrub();
      armIdleReload();
      hud(`ignored: ${reason}`);
    },
  });

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

async function loadFixture(key) {
  const f = FIXTURES.find((x) => x.key === key) ?? FIXTURES[0];
  doc = new MeiDoc(await (await fetch(f.url)).text());
  // Before the first layout, so the score is laid out for the stage the closed sheet leaves.
  fac.load(doc, f.url);
  reloads.length = 0;
  pending.clear();
  faking = false;
  const t0 = performance.now();
  score.load(doc);
  score.render();
  initialLoadMs = Math.round(performance.now() - t0);
  clearSelection();
  bar.refreshStatus();
  hud(f.label);
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
  // Exposed for inspection from the browser console.
  window.spike = { score, sel, settings, fac, get doc() { return doc; } };
  bar = createBar(document.getElementById('bar'), {
    page: turnPage,
    zoom,
    settings: () => {
      showStats();
      settingsDialog.showModal();
    },
    status: () => (score.pageCount ? `${score.page}/${score.pageCount}` : ''),
    note: noteCommand,
  });
  bindSettingsDialog(settingsDialog, settings, loadFixture);
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
