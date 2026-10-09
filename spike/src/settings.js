// Tunable gesture thresholds, kept per browser in localStorage.

import chopin from '../fixtures/Chopin_Mazurka_Op6_No1.mei?url';
import beethoven from '../fixtures/Beethoven_WoOAnh5_Nr1_1-Breitkopf.mei?url';
// From the repo's fixtures/ (served through Vite's fs.allow); facsimile images resolve against these URLs.
import baumann from '../../fixtures/demo/Baumann-Ludwig_Mondnacht-am-Meer.mei?url';
import esperoFacs from '../../fixtures/le/la-espero/piece-01/score@1dd5630.mei?url';
import esperoSetup from '../../fixtures/le/la-espero/piece-01/score@ec3585b.mei?url';

export const FIXTURES = [
  { key: 'chopin', label: 'Chopin, Mazurka op. 6 no. 1', url: chopin },
  { key: 'beethoven', label: 'Beethoven, Sonatina in G, WoO Anh. 5 no. 1', url: beethoven },
  { key: 'baumann', label: 'Baumann, Mondnacht am Meer (facsimile)', url: baumann },
  { key: 'espero-facs', label: 'La Espero, encoded stage 1dd5630 (facsimile)', url: esperoFacs },
  { key: 'espero-setup', label: 'La Espero, score-setup stage ec3585b (empty bars, facsimile)', url: esperoSetup },
];

export const DEFAULTS = {
  fixture: 'baumann',
  swipeWindowMs: 220,
  holdMs: 300,
  axisPx: 20,
  scrubStepPx: 24,
  scrubBackPx: 6,
  turnPx: 30,
  swipeMinPx: 35,
  slopPx: 10,
  tapReachPx: 16,
  twoStepPx: 24,
  octaveMinPx: 100,
  octaveSpeed: 1.2,
  renderMode: 'auto',
  autoFakeMs: 150,
  fakeIdleMs: 350,
  reloadScope: 'page',
  stripPct: 40,
  facFit: 'screen',
  paneSide: 'right',
  paneStepPx: 16,
  paneGhostDelayMs: 70,
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

/** Binds the settings dialog to `s`; calls `onFixture` when the score choice changes, `onChange` for anything else. */
export function bindSettingsDialog(dialog, s, onFixture, onChange = () => {}) {
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
  };

  form.addEventListener('input', (e) => {
    const { name, value, type } = e.target;
    if (!(name in s)) return;
    const prev = s[name];
    s[name] = type === 'range' ? Number(value) : value;
    save(s);
    sync();
    if (name === 'fixture' && prev !== value) onFixture(value);
    else if (name !== 'fixture') onChange(name);
  });

  dialog.querySelector('#settings-reset').addEventListener('click', () => {
    const fixtureBefore = s.fixture;
    Object.assign(s, DEFAULTS, { fixture: fixtureBefore });
    save(s);
    sync();
  });

  sync();
}
