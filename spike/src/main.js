import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { Score, SCALES } from './score.js';
import { horizontal, vertical, expansion } from './nav.js';
import { attachGestures } from './gestures.js';
import { createBar } from './bar.js';
import { FIXTURES, loadSettings, bindSettingsDialog } from './settings.js';

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

function hud(text) {
  hudGesture.textContent = text;
}

function apply(ids = sel.ids) {
  for (const el of scoreEl.querySelectorAll('g.selected')) el.classList.remove('selected');
  for (const id of ids) score.byId.get(id)?.el.classList.add('selected');
  if (ids.size === 0) hudSelection.textContent = 'nothing selected';
  else if (ids.size === 1) hudSelection.textContent = score.describe([...ids][0]);
  else hudSelection.textContent = `${ids.size} selected${sel.fromDrag ? ' (drag selection)' : ''}`;
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

const ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

function handleDirection(dir, expand, detail) {
  const note = expand ? grow(dir) : navigate(dir);
  hud(`${expand ? 'grow' : 'swipe'} ${ARROWS[dir]}${detail ? ` (${detail})` : ''}${note ? ` — ${note}` : ''}`);
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
    onIgnored(reason) {
      hud(`ignored: ${reason}`);
    },
    onMulti() {
      boxEl.hidden = true;
      apply();
      hud('two-finger gesture (reserved for modes)');
    },
  });

  window.addEventListener('keydown', (e) => {
    if (settingsDialog.open) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir) {
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
  score.scale = next;
  score.relayout(keepId());
  apply();
  bar.refreshStatus();
  hud(`scale ${next}`);
}

async function loadFixture(key) {
  const f = FIXTURES.find((x) => x.key === key) ?? FIXTURES[0];
  const mei = await (await fetch(f.url)).text();
  score.load(mei);
  score.render();
  clearSelection();
  bar.refreshStatus();
  hud(f.label);
}

async function main() {
  const VerovioModule = await createVerovioModule();
  const tk = new VerovioToolkit(VerovioModule);
  score = new Score(tk, scoreEl);
  // Exposed for inspection from the browser console.
  window.spike = { score, sel, settings };
  bar = createBar(document.getElementById('bar'), {
    page: turnPage,
    zoom,
    settings: () => settingsDialog.showModal(),
    status: () => (score.pageCount ? `${score.page}/${score.pageCount}` : ''),
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
      score.relayout(keepId());
      apply();
      bar.refreshStatus();
    }, 150);
  }).observe(scoreEl);
}

main();
