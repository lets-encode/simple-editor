// The modal control bar. The top level lists modes; each mode level starts with Home.
// Some mode is always active (Note by default) and stays highlighted on the top level, so its
// two-finger gestures work without opening its level. Only Note's commands work in this spike.

import { noteIcon, facsimileIcon } from './icons.js';

export const NOTE_COMMANDS = [
  { key: 'longer', arrow: '←', icon: { dur: 4 }, title: 'Longer duration' },
  { key: 'shorter', arrow: '→', icon: { dur: 16 }, title: 'Shorter duration' },
  { key: 'down', arrow: '↓', icon: { dur: 8, pos: 'bottom' }, title: 'Pitch down a step' },
  { key: 'up', arrow: '↑', icon: { dur: 8, pos: 'top' }, title: 'Pitch up a step' },
];

const MODES = {
  note: { label: 'Note', icon: { dur: 8 } },
  beam: { label: 'Beam', commands: ['Beam', 'Unbeam'] },
  slur: { label: 'Slur', commands: ['Add slur', 'Flip', 'Remove'] },
  clef: { label: 'Clef', commands: ['Treble', 'Bass', 'Alto'] },
};

/**
 * @param {HTMLElement} bar
 * @param {{ page: (d: number) => void, zoom: (d: number) => void, settings: () => void, status: () => string,
 *   note: (command: string) => void, facsimile: {available: () => boolean, down: () => void, up: (cancelled: boolean) => void} }} actions
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

  const modeFace = (m) => (m.icon ? noteIcon(m.icon) : m.label);

  const render = () => {
    bar.replaceChildren();
    if (open) {
      const m = MODES[active];
      const label = document.createElement('span');
      label.className = 'mode-label';
      label.setAttribute('aria-label', m.label);
      label.append(modeFace(m));
      const commands =
        active === 'note'
          ? NOTE_COMMANDS.map((c) =>
              button([c.arrow, noteIcon(c.icon)], () => actions.note(c.key), { title: c.title, className: 'icon' }),
            )
          : m.commands.map((c) => button(c, null, { disabled: true, title: 'Not part of this spike' }));
      bar.append(group(button('Home', () => ((open = false), render())), label, ...commands));
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
    const pageLabel = document.createElement('span');
    pageLabel.className = 'mode-label';
    pageLabel.id = 'page-label';
    pageLabel.textContent = actions.status();
    bar.append(
      spacer,
      group(
        button('◀', () => actions.page(-1), { title: 'Previous page' }),
        pageLabel,
        button('▶', () => actions.page(1), { title: 'Next page' }),
      ),
      group(
        button('−', () => actions.zoom(-1), { title: 'Smaller' }),
        button('+', () => actions.zoom(1), { title: 'Larger' }),
      ),
      group(
        ...(actions.facsimile.available() ? [facsimileButton()] : []),
        button('⚙', () => actions.settings(), { title: 'Gesture settings' }),
      ),
    );
  };

  // A tap toggles the facsimile strip; holding shows the facsimile at full until released.
  const facsimileButton = () => {
    const b = button(facsimileIcon(), null, { title: 'Source facsimile (hold to flip)', className: 'icon hold' });
    let down = false;
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true;
      b.setPointerCapture?.(e.pointerId);
      actions.facsimile.down();
    });
    const up = (cancelled) => () => {
      if (!down) return;
      down = false;
      actions.facsimile.up(cancelled);
    };
    b.addEventListener('pointerup', up(false));
    b.addEventListener('pointercancel', up(true));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };

  render();
  return {
    get mode() {
      return active;
    },
    /** Rebuilds the bar, for buttons that depend on the score (the facsimile button). */
    refresh() {
      render();
    },
    refreshStatus() {
      const el = bar.querySelector('#page-label');
      if (el) el.textContent = actions.status();
    },
  };
}
