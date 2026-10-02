// The modal control bar. The top level lists modes; each mode level starts with Home.
// Mode commands are placeholders in this spike.

const MODES = {
  note: { label: 'Note', commands: ['Pitch', 'Duration', 'Accidental', 'Delete'] },
  beam: { label: 'Beam', commands: ['Beam', 'Unbeam'] },
  slur: { label: 'Slur', commands: ['Add slur', 'Flip', 'Remove'] },
  clef: { label: 'Clef', commands: ['Treble', 'Bass', 'Alto'] },
};

/**
 * @param {HTMLElement} bar
 * @param {{ page: (d: number) => void, zoom: (d: number) => void, settings: () => void, status: () => string }} actions
 */
export function createBar(bar, actions) {
  let mode = null;

  const button = (label, onClick, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (opts.title) b.title = opts.title;
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

  const render = () => {
    bar.replaceChildren();
    if (mode) {
      const label = document.createElement('span');
      label.className = 'mode-label';
      label.textContent = MODES[mode].label;
      bar.append(
        group(
          button('Home', () => ((mode = null), render())),
          label,
          ...MODES[mode].commands.map((c) => button(c, null, { disabled: true, title: 'Not part of this spike' })),
        ),
      );
    } else {
      bar.append(group(...Object.entries(MODES).map(([k, m]) => button(m.label, () => ((mode = k), render())))));
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
      group(button('⚙', () => actions.settings(), { title: 'Gesture settings' })),
    );
  };

  render();
  return {
    refreshStatus() {
      const el = bar.querySelector('#page-label');
      if (el) el.textContent = actions.status();
    },
  };
}
