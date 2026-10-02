// Tunable gesture thresholds, kept per browser in localStorage.

import chopin from '../fixtures/Chopin_Mazurka_Op6_No1.mei?url';
import beethoven from '../fixtures/Beethoven_WoOAnh5_Nr1_1-Breitkopf.mei?url';

export const FIXTURES = [
  { key: 'chopin', label: 'Chopin, Mazurka op. 6 no. 1', url: chopin },
  { key: 'beethoven', label: 'Beethoven, Sonatina in G, WoO Anh. 5 no. 1', url: beethoven },
];

export const DEFAULTS = {
  fixture: 'chopin',
  dragStart: 'timing',
  swipeWindowMs: 220,
  holdMs: 350,
  swipeMinPx: 35,
  slopPx: 10,
  tapReachPx: 16,
};

const KEY = 'simple-editor-spike-settings';

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode); settings last for this page load.
  }
}

/** Binds the settings dialog to `s`; calls `onFixture` when the score choice changes. */
export function bindSettingsDialog(dialog, s, onFixture) {
  const form = dialog.querySelector('form');
  const fixture = form.elements.fixture;
  for (const f of FIXTURES) fixture.add(new Option(f.label, f.key));

  const sync = () => {
    for (const [name, value] of Object.entries(s)) {
      const input = form.elements[name];
      if (!input) continue;
      input.value = value;
      const out = input.closest('label')?.querySelector('output');
      if (out) out.textContent = value;
    }
    for (const label of form.querySelectorAll('label[data-for]')) label.hidden = label.dataset.for !== s.dragStart;
  };

  form.addEventListener('input', (e) => {
    const { name, value, type } = e.target;
    if (!(name in s)) return;
    const prev = s[name];
    s[name] = type === 'range' ? Number(value) : value;
    save(s);
    sync();
    if (name === 'fixture' && prev !== value) onFixture(value);
  });

  dialog.querySelector('#settings-reset').addEventListener('click', () => {
    const fixtureBefore = s.fixture;
    Object.assign(s, DEFAULTS, { fixture: fixtureBefore });
    save(s);
    sync();
  });

  sync();
}
