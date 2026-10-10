// The modal control bar. The top level lists modes; each mode level starts with Home.
// Some mode is always active (Note by default) and stays highlighted on the top level, so its
// two-finger gestures work without opening its level. Only Note's commands work in this spike.

import { noteIcon } from './icons.js';

export const NOTE_COMMANDS = [
  { key: 'insert', arrow: '', icon: { dur: 4, sparkle: true }, title: 'Insert notes (entry pane)', toggle: true },
  { key: 'longer', arrow: '←', icon: { dur: 4 }, title: 'Longer duration' },
  { key: 'shorter', arrow: '→', icon: { dur: 16 }, title: 'Shorter duration' },
  { key: 'down', arrow: '↓', icon: { dur: 8, pos: 'bottom' }, title: 'Pitch down a step' },
  { key: 'up', arrow: '↑', icon: { dur: 8, pos: 'top' }, title: 'Pitch up a step' },
  // Written accidentals (N8): tapping the same one again removes it.
  { key: 'sharp', group: 'accid', text: '♯', title: 'Sharp (again to remove)' },
  { key: 'flat', group: 'accid', text: '♭', title: 'Flat (again to remove)' },
  { key: 'natural', group: 'accid', text: '♮', title: 'Natural (again to remove)' },
];

const MODES = {
  note: { label: 'Note', icon: { dur: 8 } },
  beam: { label: 'Beam', commands: ['Beam', 'Unbeam'] },
  slur: { label: 'Slur', commands: ['Add slur', 'Flip', 'Remove'] },
  clef: { label: 'Clef', commands: ['Treble', 'Bass', 'Alto'] },
};

/**
 * @param {HTMLElement} bar
 * @param {{ page: (d: number) => void, zoom: (d: number) => void, settings: () => void, pages: () => {page: number, count: number}, goto: (page: number) => void,
 *   note: (command: string) => void, pressed: (command: string) => boolean }} actions
 */
export function createBar(bar, actions) {
  let active = 'note';
  let open = false;

  const button = (content, onClick, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.append(...[content].flat());
    if (opts.title) {
      b.title = opts.title;
      b.setAttribute('aria-label', opts.title);
    }
    if (opts.className) b.className = opts.className;
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
    if (opts.disabled) b.disabled = true;
    else b.addEventListener('click', onClick);
    return b;
  };

  const group = (...children) => {
    const g = document.createElement('div');
    g.className = 'group';
    g.append(...children);
    return g;
  };

  // A group drawn with a hairline frame, like a fieldset, around controls that belong together.
  const framed = (...children) => {
    const g = group(...children);
    g.classList.add('framed');
    return g;
  };

  const modeFace = (m) => (m.icon ? noteIcon(m.icon) : m.label);

  const render = () => {
    bar.replaceChildren();
    if (open) {
      const m = MODES[active];
      const label = document.createElement('span');
      label.className = 'mode-label';
      label.setAttribute('aria-label', m.label);
      label.append(modeFace(m));
      const noteButton = (c) => {
        const b = button(
          c.icon ? [c.arrow, noteIcon(c.icon)] : c.text,
          () => {
            actions.note(c.key);
            if (c.toggle) b.setAttribute('aria-pressed', String(actions.pressed(c.key)));
          },
          { title: c.title, className: c.icon ? 'icon' : 'accid', pressed: c.toggle ? actions.pressed(c.key) : undefined },
        );
        return b;
      };
      const home = button('Home', () => ((open = false), render()));
      if (active === 'note') {
        // The accidentals get a framed group of their own, which wraps onto its own row on a phone.
        const main = NOTE_COMMANDS.filter((c) => !c.group).map(noteButton);
        const accid = NOTE_COMMANDS.filter((c) => c.group === 'accid').map(noteButton);
        const accidGroup = framed(...accid);
        accidGroup.classList.add('accid-group');
        bar.append(group(home, framed(label, ...main), accidGroup));
      } else {
        bar.append(group(home, framed(label, ...m.commands.map((c) => button(c, null, { disabled: true, title: 'Not part of this spike' })))));
      }
    } else {
      bar.append(
        group(
          ...Object.entries(MODES).map(([k, m]) =>
            button(modeFace(m), () => ((active = k), (open = true), render()), {
              title: m.label,
              pressed: k === active,
              className: m.icon ? 'icon' : '',
            }),
          ),
        ),
      );
    }
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    // The page number opens a list of the pages, to jump straight to one.
    const pageSelect = document.createElement('select');
    pageSelect.id = 'page-select';
    pageSelect.title = 'Go to page';
    pageSelect.setAttribute('aria-label', 'Go to page');
    pageSelect.addEventListener('change', () => actions.goto(Number(pageSelect.value)));
    const magnifier = document.createElement('span');
    magnifier.className = 'magnifier';
    magnifier.setAttribute('aria-hidden', 'true');
    magnifier.innerHTML =
      '<svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 10 L14.5 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    bar.append(
      spacer,
      framed(
        button('◀', () => actions.page(-1), { title: 'Previous page' }),
        pageSelect,
        button('▶', () => actions.page(1), { title: 'Next page' }),
      ),
      framed(
        button('−', () => actions.zoom(-1), { title: 'Smaller' }),
        magnifier,
        button('+', () => actions.zoom(1), { title: 'Larger' }),
      ),
      group(button('⚙', () => actions.settings(), { title: 'Gesture settings' })),
    );
    refreshPages();
  };

  /** Fills the page list for the current page count and shows the current page. */
  const refreshPages = () => {
    const el = bar.querySelector('#page-select');
    if (!el) return;
    const { page, count } = actions.pages();
    if (el.options.length !== count) {
      el.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(`${i + 1}/${count}`, String(i + 1))));
    }
    el.value = String(page);
  };

  render();
  return {
    get mode() {
      return active;
    },
    refreshStatus() {
      refreshPages();
    },
  };
}
