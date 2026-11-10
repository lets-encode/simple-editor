// The drawer bar: a prototype of the layout proposed on 2026-11-10, to be judged on a phone.
// A strip that never moves lists the modes, undo, redo and one more button. A drawer slides out of
// it with three resting sizes, like the facsimile sheet: closed (the strip alone), pad and full.
// Closed and pad resize the stage; full covers the score, so it never re-lays out.
// The pad has twelve slots, one per two-finger gesture, in the same place in every mode; a slot is
// dashed where the gesture does nothing. Only the Note pad works: every other button says in the
// HUD what it stands for.

import { noteIcon } from './icons.js';

const noteSlot = (key, arrow, icon, title, extra = {}) => ({ key, face: () => [arrow, noteIcon(icon)], title, cls: 'icon', ...extra });
const slot = (label, title, extra = {}) => ({ face: () => label, title, ...extra });
const none = (gesture) => ({ face: () => '', title: `${gesture}: nothing in this mode`, dead: true });
const pair = (gesture) => [none(gesture), none(gesture)];

const ACROSS = 'Two fingers left / right';
const UPDOWN = 'Two fingers up / down';
const FLICK = 'Fast two-finger flick up / down';
const SIDE = 'One-sided slide';

// The one-sided slide outside Note mode: the left finger owns the start, the right finger the end.
const START = [slot('|←', 'Start one note earlier'), slot('|→', 'Start one note later')];
const END = [slot('←|', 'End one note earlier'), slot('→|', 'End one note later')];
const PLACE = [slot('below', 'Below (then auto, then above)'), slot('above', 'Above (then auto, then below)')];
// Filled in when the pad is drawn: the mode's current kind, and Delete or the view button.
const KIND = { kindSlot: true };
const LAST = { lastSlot: true };

const MODES = {
  note: {
    label: 'Note',
    pad: () => [
      noteSlot('longer', '←', { dur: 4 }, 'Longer duration'),
      noteSlot('shorter', '→', { dur: 16 }, 'Shorter duration'),
      noteSlot('down', '↓', { dur: 8, pos: 'bottom' }, 'Pitch down a step'),
      noteSlot('up', '↑', { dur: 8, pos: 'top' }, 'Pitch up a step'),
      slot('8↓', 'Octave down', { key: 'octaveDown' }),
      slot('8↑', 'Octave up', { key: 'octaveUp' }),
      slot('♭', 'Flat (again to remove)', { key: 'flat', cls: 'accid' }),
      slot('♮', 'Natural (again to remove)', { key: 'natural', cls: 'accid' }),
      slot('♯', 'Sharp (again to remove)', { key: 'sharp', cls: 'accid' }),
      noteSlot('insert', '', { dur: 4, sparkle: true }, 'Insert notes (entry pane)', { toggle: true }),
      slot('•', 'Dots: none, one, two', { key: 'dots', cls: 'accid' }),
      LAST,
    ],
    more: [
      slot('rest', 'Note ↔ rest'),
      slot('tie', 'Tie to the next note'),
      slot('grace', 'Grace note'),
      slot('x ♭♭', 'Double sharp and double flat'),
      slot('swap←', 'Swap with the note before'),
      slot('swap→', 'Swap with the note after'),
    ],
  },
  beam: {
    label: 'Beam',
    kinds: [
      ['beam', 'beam'],
      ['tuplet', 'tuplet'],
    ],
    pad: (kind) => [
      ...(kind === 'tuplet' ? [slot('−', 'Tuplet ratio: fewer'), slot('+', 'Tuplet ratio: more')] : pair(ACROSS)),
      slot('stem↓', kind === 'tuplet' ? 'Number below' : 'Stems down (then auto, then up)'),
      slot('stem↑', kind === 'tuplet' ? 'Number above' : 'Stems up (then auto, then down)'),
      ...(kind === 'beam' ? [slot('staff↓', 'Move to the staff below'), slot('staff↑', 'Move to the staff above')] : pair(FLICK)),
      ...START,
      ...END,
      KIND,
      LAST,
    ],
    more: [slot('chord', 'Notes ↔ chord'), slot('graces', 'Grace group')],
  },
  slur: {
    label: 'Slur',
    kinds: [
      ['slur', 'slur'],
      ['tie', 'tie'],
      ['8va', '8va'],
      ['pedal', 'pedal'],
    ],
    pad: (kind) => [
      ...pair(ACROSS),
      ...(kind === 'pedal' ? pair(UPDOWN) : PLACE),
      ...pair(FLICK),
      ...(kind === 'tie' ? [...pair(SIDE), ...pair(SIDE)] : [...START, ...END]),
      KIND,
      LAST,
    ],
    more: [slot('gliss', 'Glissando'), slot('- - -', 'Dashed or dotted line')],
  },
  marks: {
    label: 'Marks',
    kinds: [
      ['staccato', 'stacc'],
      ['accent', 'acc'],
      ['tenuto', 'ten'],
      ['marcato', 'marc'],
      ['staccatissimo', 'stmo'],
      ['spiccato', 'spicc'],
      ['fermata', 'ferm'],
      ['trill', 'tr'],
      ['mordent', 'mord'],
      ['turn', 'turn'],
      ['arpeggio', 'arp'],
    ],
    pad: (kind, api) => [
      slot('‹', 'The mark before this one in the palette', { run: () => api.stepKind(-1) }),
      slot('›', 'The mark after this one in the palette', { run: () => api.stepKind(1) }),
      ...PLACE,
      ...pair(FLICK),
      ...pair(SIDE),
      ...(kind === 'trill' ? END : pair(SIDE)),
      KIND,
      LAST,
    ],
    more: [],
  },
};

const RESTS = ['closed', 'pad', 'full'];
const FLICK_SPEED = 0.5; // px per ms: faster than this, the drawer goes on to the next size that way
const TAP_PX = 6;

/**
 * @param {HTMLElement} bar
 * @param {{ page: (d: number) => void, zoom: (d: number) => void, settings: () => void, pages: () => {page: number, count: number}, goto: (page: number) => void,
 *   note: (command: string) => void, pressed: (command: string) => boolean, hud: (text: string) => void,
 *   prefs: {barRest: string, barStripLast: string}, savePrefs: () => void }} actions
 */
export function createDrawerBar(bar, actions) {
  const app = bar.parentElement;
  const portrait = matchMedia('(orientation: portrait)');
  const kinds = Object.fromEntries(Object.entries(MODES).filter(([, m]) => m.kinds).map(([k, m]) => [k, m.kinds[0][0]]));
  let active = 'note';
  let rest = RESTS.includes(actions.prefs.barRest) ? actions.prefs.barRest : 'pad';
  let view = false;
  let sizes = { closed: 0, pad: 0, full: 0 };
  let timer;

  const el = (tag, className) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  };
  const panel = el('div');
  panel.id = 'drawer';
  const more = el('div', 'sec more');
  const pad = el('div', 'sec pad');
  const strip = el('div', 'sec strip');
  const handle = el('div');
  handle.id = 'drawer-handle';
  handle.title = 'Drag, or tap for the next size';
  handle.append(el('span', 'grip'));
  panel.append(more, pad, strip, handle);
  app.classList.add('drawer');
  bar.replaceChildren(panel);

  const button = (s) => {
    const b = el('button', s.cls);
    b.type = 'button';
    b.append(...[s.face()].flat());
    b.title = s.title;
    b.setAttribute('aria-label', s.title);
    if (s.dead) {
      b.classList.add('dead');
      b.setAttribute('aria-disabled', 'true');
    }
    if (s.pressed !== undefined) b.setAttribute('aria-pressed', String(s.pressed));
    b.addEventListener('click', () => {
      if (s.dead) return actions.hud(s.title);
      if (s.run) return s.run();
      if (s.key && active === 'note') {
        actions.note(s.key);
        if (s.toggle) b.setAttribute('aria-pressed', String(actions.pressed(s.key)));
        return;
      }
      actions.hud(`${s.title} — not built in this prototype`);
    });
    return b;
  };

  const deleteSlot = () => slot('⌫', 'Delete', { cls: 'glyph' });
  const viewSlot = () => slot('⋯', 'Page, size and settings', { cls: 'glyph', pressed: view, run: () => ((view = !view), draw()) });
  const stripLast = () => (actions.prefs.barStripLast === 'delete' ? deleteSlot() : viewSlot());
  const padLast = () => (actions.prefs.barStripLast === 'delete' ? viewSlot() : deleteSlot());

  const kindLabel = (mode) => MODES[mode].kinds.find(([k]) => k === kinds[mode])[1];
  const setKind = (k) => {
    kinds[active] = k;
    actions.hud(`${MODES[active].label}: ${k} is the current kind — applying it is not built in this prototype`);
    draw();
  };
  const api = {
    stepKind(d) {
      const all = MODES[active].kinds.map(([k]) => k);
      setKind(all[(all.indexOf(kinds[active]) + d + all.length) % all.length]);
    },
  };

  /** Page, size and settings, in the pad's place and at the pad's size. */
  const viewRow = () => {
    const pageSelect = el('select');
    pageSelect.id = 'page-select';
    pageSelect.title = 'Go to page';
    pageSelect.setAttribute('aria-label', 'Go to page');
    pageSelect.addEventListener('change', () => actions.goto(Number(pageSelect.value)));
    const label = el('span', 'view-label');
    label.textContent = 'Page, size, settings';
    return [
      button(slot('◀', 'Previous page', { run: () => actions.page(-1) })),
      pageSelect,
      button(slot('▶', 'Next page', { run: () => actions.page(1) })),
      button(slot('−', 'Smaller', { run: () => actions.zoom(-1) })),
      button(slot('+', 'Larger', { run: () => actions.zoom(1) })),
      button(slot('⚙', 'Gesture settings', { run: () => actions.settings() })),
      label,
    ];
  };

  const refreshPages = () => {
    const select = bar.querySelector('#page-select');
    if (!select) return;
    const { page, count } = actions.pages();
    if (select.options.length !== count) {
      select.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(`${i + 1}/${count}`, String(i + 1))));
    }
    select.value = String(page);
  };

  const draw = () => {
    const m = MODES[active];
    strip.replaceChildren(
      ...Object.entries(MODES).map(([k, mode]) =>
        button(
          slot(mode.label, k === active ? `${mode.label}: open or close the drawer` : mode.label, {
            cls: 'tab',
            pressed: k === active,
            run: () => {
              if (k === active) return settle(rest === 'closed' ? 'pad' : 'closed');
              active = k;
              view = false;
              draw();
            },
          }),
        ),
      ),
      button(slot('↶', 'Undo')),
      button(slot('↷', 'Redo')),
      button(stripLast()),
    );
    pad.classList.toggle('view', view);
    pad.replaceChildren(
      ...(view
        ? viewRow()
        : m.pad(kinds[active], api).map((s) => {
            if (s === LAST) return button(padLast());
            if (s === KIND) return button(slot(kindLabel(active), `${kinds[active]}: on / off`, { cls: 'kind' }));
            return button(s.key === 'insert' ? { ...s, pressed: actions.pressed('insert') } : s);
          })),
    );
    const palette = [...(m.kinds ?? []).map(([k, label]) => slot(label, k, { pressed: k === kinds[active], run: () => setKind(k) })), ...m.more];
    more.style.setProperty('--more-cols', String(Math.ceil(palette.length / 6)));
    more.replaceChildren(...palette.map(button));
    refreshPages();
    settle(rest, false);
  };

  /** The three resting sizes, along the axis the drawer slides on. */
  const measure = () => {
    const css = getComputedStyle(panel);
    const px = (name) => parseFloat(css[name]) || 0;
    const dim = (e) => (portrait.matches ? e.offsetHeight : e.offsetWidth);
    const chrome = portrait.matches ? px('paddingTop') + px('paddingBottom') + px('borderTopWidth') : px('paddingLeft') + px('paddingRight') + px('borderRightWidth');
    const closed = chrome + dim(strip);
    sizes = { closed, pad: closed + dim(pad), full: closed + dim(pad) + dim(more) };
  };

  const show = (size) => panel.style.setProperty('--bar-size-now', `${size}px`);

  /** Snaps to a resting size. The stage takes the room left once the animation is over; full only covers. */
  function settle(to, animate = true) {
    rest = to;
    measure();
    panel.dataset.rest = rest;
    panel.classList.toggle('animate', animate);
    // The view row shows over the score while the drawer is closed, without resizing the stage.
    show(view && rest === 'closed' ? sizes.pad : sizes[rest]);
    const flow = () => app.style.setProperty('--bar-flow', `${rest === 'closed' ? sizes.closed : sizes.pad}px`);
    clearTimeout(timer);
    if (animate) timer = setTimeout(flow, 200);
    else flow();
    if (actions.prefs.barRest !== rest) {
      actions.prefs.barRest = rest;
      actions.savePrefs();
    }
  }

  // The handle: a drag follows the finger and snaps on lift; a fast drag goes on to the next size
  // that way; a tap steps closed → pad → full → closed (the route without dragging, WCAG 2.5.7).
  let drag = null;
  const along = (e) => (portrait.matches ? -e.clientY : e.clientX);
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) carry pointer ids the browser does not know.
    }
    measure();
    const from = view && rest === 'closed' ? sizes.pad : sizes[rest];
    drag = { id: e.pointerId, start: along(e), from, size: from, moved: false, t: e.timeStamp, lastAt: along(e), v: 0 };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const at = along(e);
    if (Math.abs(at - drag.start) > TAP_PX) drag.moved = true;
    if (!drag.moved) return;
    const dt = e.timeStamp - drag.t;
    if (dt > 0) drag.v = (at - drag.lastAt) / dt;
    drag.t = e.timeStamp;
    drag.lastAt = at;
    drag.size = Math.min(Math.max(drag.from + at - drag.start, sizes.closed), sizes.full);
    panel.classList.remove('animate');
    show(drag.size);
  });
  const lift = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return settle(RESTS[(RESTS.indexOf(rest) + 1) % RESTS.length]);
    let to;
    if (Math.abs(d.v) >= FLICK_SPEED) {
      const ahead = RESTS.filter((r) => (d.v > 0 ? sizes[r] > d.size : sizes[r] < d.size));
      to = ahead.length ? (d.v > 0 ? ahead[0] : ahead.at(-1)) : d.v > 0 ? 'full' : 'closed';
    } else to = RESTS.reduce((a, b) => (Math.abs(sizes[b] - d.size) < Math.abs(sizes[a] - d.size) ? b : a));
    settle(to);
  };
  handle.addEventListener('pointerup', lift);
  handle.addEventListener('pointercancel', lift);

  // Turning the phone swaps rows for columns, so the sizes have to be read again.
  const turned = () => setTimeout(() => settle(rest, false), 0);
  portrait.addEventListener('change', turned);

  draw();
  return {
    get mode() {
      return active;
    },
    refreshStatus() {
      refreshPages();
    },
    destroy() {
      clearTimeout(timer);
      portrait.removeEventListener('change', turned);
      app.classList.remove('drawer');
      app.style.removeProperty('--bar-flow');
      bar.replaceChildren();
    },
  };
}
