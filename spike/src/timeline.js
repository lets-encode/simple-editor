// A score-time index of every navigable element in the MEI DOM, independent of what is rendered.
// Selections may hold elements on other pages, so growing them (ruling 6) cannot rely on the
// rendered page's SVG or on Verovio's timemap, which covers only the page while a page-only
// load is in the toolkit. Onsets are summed from the DOM's durations instead.

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NAV = new Set(['note', 'rest', 'mRest', 'beatRpt', 'halfmRpt', 'mRpt', 'clef']);
// Events that take time in a layer; a note inside a chord takes the chord's.
const TIMED = new Set(['note', 'rest', 'space', 'chord']);
const WHOLE_BAR = new Set(['mRest', 'mRpt', 'mSpace', 'multiRest']);
const STEPS = 'cdefgab';

/**
 * @typedef {object} Entry
 * @property {string} id
 * @property {Element} el
 * @property {string} kind      the element's name, or 'slot' for an empty layer
 * @property {string} measureId
 * @property {number} gm        global measure index, in document order within <music>
 * @property {number} staffN
 * @property {number} layerN
 * @property {string|null} chordId
 * @property {number} q         onset in quarter notes from the start of the measure
 * @property {number} t         gm × 1000 + q (ruling 6, global)
 * @property {number} order     document order
 * @property {number|null} pitch diatonic step number (octave × 7 + step), notes only
 */

const idOf = (el) => el.getAttributeNS(XML_NS, 'id') ?? el.getAttribute('xml:id');

/** Quarter notes of an element's written duration, or null when it has none. */
function quarters(el) {
  const dur = el.getAttribute('dur');
  if (!dur || Number.isNaN(Number(dur))) {
    if (dur === 'breve') return 8;
    if (dur === 'long') return 16;
    return null;
  }
  const dots = Number(el.getAttribute('dots') ?? 0);
  return (4 / Number(dur)) * (2 - 0.5 ** dots);
}

/**
 * Whether `el` lies in a reading Verovio does not render: a <choice>'s later children, or an
 * <app>'s readings other than its <lem> (else its first <rdg>).
 */
function unrendered(el, layer) {
  for (let a = el; a && a !== layer; a = a.parentElement) {
    const p = a.parentElement;
    if (p?.localName === 'choice' && a !== p.firstElementChild) return true;
    if (p?.localName === 'app' && a !== (p.querySelector(':scope > lem') ?? p.firstElementChild)) return true;
  }
  return false;
}

function isGrace(el) {
  return el.hasAttribute('grace') || !!el.closest('graceGrp') || (el.localName === 'note' && !!el.closest('chord')?.hasAttribute('grace'));
}

function tupletFactor(el, layer) {
  let f = 1;
  for (let a = el.parentElement; a && a !== layer; a = a.parentElement) {
    if (a.localName === 'tuplet') f *= Number(a.getAttribute('numbase') ?? 2) / Number(a.getAttribute('num') ?? 3);
  }
  return f;
}

// Verovio places a grace note this many quarters before the next grace note or main note.
const GRACE_LEAD = 1 / 16;

/**
 * Tuplets encoded as <tupletSpan> in the measure: the factor for each span's first element and
 * the element it ends at. Verovio reads a missing @numbase as 1 (Chopin, bar 2: three sixteenths
 * under num="3" take a sixteenth), so this does too.
 */
function tupletSpans(measure, meiDoc) {
  const spans = new Map();
  for (const ts of measure.querySelectorAll('tupletSpan')) {
    const start = meiDoc.get(ts.getAttribute('startid')?.replace(/^#/, ''));
    const end = meiDoc.get(ts.getAttribute('endid')?.replace(/^#/, ''));
    if (!start || !end) continue;
    spans.set(start, { end, f: Number(ts.getAttribute('numbase') ?? 1) / Number(ts.getAttribute('num') ?? 3) });
  }
  return spans;
}

/** Onsets within a layer, in quarter notes from the start of the bar. */
function layerOnsets(layer, spans) {
  /** @type {Map<Element, number>} */
  const at = new Map();
  let now = 0;
  let last = 1;
  let graces = [];
  const active = [];
  const placeGraces = () => {
    graces.forEach((g, i) => at.set(g, now - (graces.length - i) * GRACE_LEAD));
    graces = [];
  };
  for (const el of layer.querySelectorAll('*')) {
    const name = el.localName;
    if (unrendered(el, layer)) continue;
    if (spans.has(el)) active.push(spans.get(el));
    if (WHOLE_BAR.has(name)) {
      at.set(el, 0);
      continue;
    }
    if (name === 'note' && el.parentElement.closest('chord')) {
      at.set(el, at.get(el.parentElement.closest('chord')) ?? now);
      continue;
    }
    if (!TIMED.has(name) && name !== 'beatRpt' && name !== 'halfmRpt') {
      at.set(el, now);
      continue;
    }
    if (isGrace(el)) {
      graces.push(el);
      continue;
    }
    placeGraces();
    at.set(el, now);
    let q = quarters(el);
    if (q === null && name === 'chord') q = quarters(el.querySelector('note[dur]') ?? el);
    if (q === null) q = last;
    last = q;
    now += q * tupletFactor(el, layer) * active.reduce((f, s) => f * s.f, 1);
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end === el || el.contains(active[i].end)) active.splice(i, 1);
    }
  }
  placeGraces();
  return at;
}

/** Builds the index; `version` is the document's edit counter it was built for. */
export function buildTimeline(meiDoc) {
  const music = meiDoc.doc.querySelector('music');
  /** @type {Map<string, Entry>} */
  const byId = new Map();
  /** @type {Entry[]} */
  const entries = [];
  if (!music) return { byId, entries, version: meiDoc.version };
  let order = 0;
  [...music.querySelectorAll('measure')].forEach((measure, gm) => {
    const measureId = idOf(measure);
    const spans = tupletSpans(measure, meiDoc);
    for (const staff of measure.querySelectorAll(':scope > staff')) {
      const staffN = Number(staff.getAttribute('n') ?? 0);
      for (const layer of staff.querySelectorAll(':scope > layer')) {
        const layerN = Number(layer.getAttribute('n') ?? 1);
        const base = { measureId, gm, staffN, layerN };
        const navs = [...layer.querySelectorAll('*')].filter((el) => NAV.has(el.localName) && !unrendered(el, layer));
        if (!navs.length) {
          const e = { ...base, id: idOf(layer), el: layer, kind: 'slot', chordId: null, q: 0, t: gm * 1000, order: order++, pitch: null };
          entries.push(e);
          byId.set(e.id, e);
          continue;
        }
        const at = layerOnsets(layer, spans);
        for (const el of navs) {
          const chord = el.localName === 'note' ? el.closest('chord') : null;
          const q = at.get(el) ?? 0;
          const pname = el.getAttribute('pname');
          const oct = el.getAttribute('oct');
          const pitch = pname && oct !== null ? Number(oct) * 7 + STEPS.indexOf(pname) : null;
          const e = { ...base, id: idOf(el), el, kind: el.localName, chordId: chord ? idOf(chord) : null, q, t: gm * 1000 + q, order: order++, pitch };
          entries.push(e);
          byId.set(e.id, e);
        }
      }
    }
  });
  return { byId, entries, version: meiDoc.version };
}

/** The document's time index, rebuilt after any edit. */
export function timeline(meiDoc) {
  if (meiDoc.timeline?.version !== meiDoc.version) meiDoc.timeline = buildTimeline(meiDoc);
  return meiDoc.timeline;
}
