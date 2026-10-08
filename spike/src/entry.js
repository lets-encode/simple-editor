// Note entry on the MEI DOM (simple-editor-meta docs/modes.md, N3–N6): what is in force at the
// insertion point (clef, key, meter), whether a bar is full, and the insertion itself.
//
// Spike-level MEI: new notes copy their neighbour's indentation, carry @accid.ges where the key
// alters them, and nothing else of the file's idiom profile (A5) is followed.

import { keySigFor, keyScale } from './edit.js';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';
export const PNAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

/** A diatonic number: octave × 7 + step (C4 = 28). */
export const diatonic = (pname, oct) => Number(oct) * 7 + PNAMES.indexOf(pname);
export const fromDiatonic = (d) => ({ pname: PNAMES[((d % 7) + 7) % 7], oct: Math.floor(d / 7) });

const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * The clef in force at `el` on staff `staffN`: the last staffDef clef or <clef> of that staff
 * before it in document order.
 * @returns {{shape: string, line: number, dis: number, bottom: number} | null}
 *   `dis` in diatonic steps (±7 per octave), `bottom` the diatonic number of the bottom line
 */
export function clefAt(doc, el, staffN) {
  const music = doc.querySelector('music');
  let clef = null;
  for (const x of music.querySelectorAll('staffDef, clef')) {
    if (!before(x, el) && x !== el) break;
    if (x.localName === 'staffDef') {
      if (x.getAttribute('n') !== String(staffN) || !x.hasAttribute('clef.shape')) continue;
      clef = {
        shape: x.getAttribute('clef.shape'),
        line: Number(x.getAttribute('clef.line') ?? 2),
        dis: x.getAttribute('clef.dis'),
        place: x.getAttribute('clef.dis.place'),
      };
    } else {
      const owner = x.parentElement.closest('staffDef, staff');
      if (owner?.getAttribute('n') !== String(staffN)) continue;
      clef = { shape: x.getAttribute('shape'), line: Number(x.getAttribute('line') ?? 2), dis: x.getAttribute('dis'), place: x.getAttribute('dis.place') };
    }
  }
  if (!clef) return null;
  const anchor = { G: 32, F: 24, C: 28 }[clef.shape];
  if (anchor === undefined) return null;
  const dis = clef.dis ? (Number(clef.dis) === 15 ? 14 : 7) * (clef.place === 'below' ? -1 : 1) : 0;
  return { shape: clef.shape, line: clef.line, dis, bottom: anchor + dis - 2 * (clef.line - 1) };
}

/** The SMuFL glyph for a clef, plain or with its octave 8 or 15. */
export function clefGlyph({ shape, dis }) {
  const key = `${shape}${dis}`;
  return { G0: 'E050', 'G-7': 'E052', G7: 'E053', 'G-14': 'E051', G14: 'E054', F0: 'E062', 'F-7': 'E064', F7: 'E065', C0: 'E05C', 'C-7': 'E05D' }[key] ?? null;
}

/** The pitch name with the key's accidental, as the ghost shows it (F♯, never F♯4). */
export function pitchName(doc, el, d) {
  const { pname } = fromDiatonic(d);
  const sig = keySigFor(doc, el);
  const key = keyScale(sig);
  const sign = key.affected.includes(pname) ? (sig.endsWith('s') ? '♯' : '♭') : '';
  return `${pname.toUpperCase()}${sign}`;
}

/** The bar's length in whole notes from the meter in force at `measure`, or null. */
export function meterAt(doc, measure, staffN) {
  const music = doc.querySelector('music');
  let m = null;
  const read = (count, unit, sym) => {
    if (count && unit) return { count, unit };
    if (sym === 'common') return { count: '4', unit: '4' };
    if (sym === 'cut') return { count: '2', unit: '2' };
    return null;
  };
  for (const x of music.querySelectorAll('scoreDef, staffDef, meterSig')) {
    if (!before(x, measure)) break;
    if (x.localName === 'staffDef' && x.getAttribute('n') !== String(staffN)) continue;
    if (x.localName === 'meterSig') {
      const owner = x.parentElement.closest('staffDef, scoreDef');
      if (owner?.localName === 'staffDef' && owner.getAttribute('n') !== String(staffN)) continue;
      m = read(x.getAttribute('count'), x.getAttribute('unit'), x.getAttribute('sym')) ?? m;
    } else m = read(x.getAttribute('meter.count'), x.getAttribute('meter.unit'), x.getAttribute('meter.sym')) ?? m;
  }
  if (!m) return null;
  const count = m.count.split('+').reduce((a, b) => a + Number(b), 0);
  return count / Number(m.unit);
}

const length = (el) => {
  const dur = Number(el.getAttribute('dur'));
  const dots = Number(el.getAttribute('dots') ?? 0);
  return dur ? (1 / dur) * (2 - 1 / 2 ** dots) : 0;
};

/** The written length of a layer's events in whole notes; Infinity for a whole-bar rest or space. */
export function layerLength(layer) {
  let total = 0;
  const walk = (parent, ratio) => {
    for (const c of parent.children) {
      const n = c.localName;
      if (n === 'mRest' || n === 'mSpace' || n === 'multiRest') total = Infinity;
      else if ((n === 'note' || n === 'chord') && !c.hasAttribute('grace')) total += length(c) * ratio;
      else if (n === 'rest' || n === 'space') total += length(c) * ratio;
      else if (n === 'tuplet') walk(c, (ratio * Number(c.getAttribute('numbase') ?? 2)) / Number(c.getAttribute('num') ?? 3));
      else if (n === 'beam' || n === 'graceGrp' || n === 'ftrem' || n === 'bTrem') walk(c, ratio);
    }
  };
  walk(layer, 1);
  return total;
}

/** The event a note, rest or chord member stands in: the chord for a chord member. */
export const eventOf = (el) => (el.localName === 'note' && el.parentElement?.closest('chord')) || el;

/** A layer whose only content is one mRest or mSpace counts as empty (N6). */
export function placeholderOf(layer) {
  const kids = [...layer.children];
  return kids.length === 1 && ['mRest', 'mSpace'].includes(kids[0].localName) ? kids[0] : null;
}

function layerFor(doc, measure, staffN, layerN) {
  const staff = [...measure.children].find((c) => c.localName === 'staff' && c.getAttribute('n') === String(staffN));
  if (!staff) return null;
  let layer = [...staff.children].find((c) => c.localName === 'layer' && c.getAttribute('n') === String(layerN));
  if (!layer) {
    // A staff without that layer gets one.
    layer = doc.createElementNS(MEI_NS, 'layer');
    layer.setAttribute('n', String(layerN));
    staff.append(layer);
  }
  return layer;
}

/**
 * Inserts a note (N3–N6). `focus` is the MEI element the selection's focus stands for: a note,
 * rest or chord member to insert after, or a <layer> (a slot) to start. With `advance`, a note
 * after a full bar goes to the start of the same staff and layer in the next bar (N5).
 * @param {import('./mei.js').MeiDoc} meiDoc
 * @param {{focus: Element, before?: boolean, d: number, dur: string, dots: number, advance: boolean}} opts
 * @returns {{note: Element, moved: boolean}}
 */
export function insertNote(meiDoc, { focus, before: insertBefore = false, d, dur, dots, advance }) {
  const doc = meiDoc.doc;
  const note = doc.createElementNS(MEI_NS, 'note');
  meiDoc.register(note);
  const { pname, oct } = fromDiatonic(d);
  note.setAttribute('pname', pname);
  note.setAttribute('oct', String(oct));
  note.setAttribute('dur', dur);
  if (dots) note.setAttribute('dots', String(dots));

  let moved = false;
  let layer = focus.localName === 'layer' ? focus : focus.closest('layer');
  if (advance && focus.localName !== 'layer') {
    const measure = layer.closest('measure');
    const full = layerLength(layer) >= (meterAt(doc, measure, layer.closest('staff').getAttribute('n')) ?? Infinity) - 1e-9;
    if (full && measure.getAttribute('metcon') !== 'false') {
      const measures = [...doc.querySelector('music').querySelectorAll('measure')];
      const next = measures[measures.indexOf(measure) + 1];
      const nextLayer = next && layerFor(doc, next, layer.closest('staff').getAttribute('n'), layer.getAttribute('n') ?? '1');
      if (nextLayer) {
        layer = nextLayer;
        moved = true;
      }
    }
  }

  const placeholder = placeholderOf(layer);
  if (placeholder && (moved || focus === layer || focus === placeholder)) placeholder.replaceWith(note);
  else if (moved || focus === layer) layer.prepend(note);
  else {
    const ev = eventOf(focus);
    // Copy the neighbour's indentation, so the file still reads as formatted.
    const ws = ev.previousSibling?.nodeType === Node.TEXT_NODE ? ev.previousSibling.cloneNode() : null;
    if (insertBefore) ev.before(...[note, ws].filter(Boolean));
    else ev.after(...[ws, note].filter(Boolean));
  }
  const sig = keyScale(keySigFor(doc, note));
  if (sig.affected.includes(pname)) note.setAttribute('accid.ges', keySigFor(doc, note).endsWith('s') ? 's' : 'f');
  return { note, moved };
}

/** The duration and dots a new note copies from the event it follows (N4); a quarter otherwise. */
export function durationAfter(focus, fallback) {
  const ev = focus && focus.localName !== 'layer' ? eventOf(focus) : null;
  const dur = ev?.getAttribute('dur');
  if (ev && dur && ev.localName !== 'mRest') return { dur, dots: Number(ev.getAttribute('dots') ?? 0) };
  return fallback ?? { dur: '4', dots: 0 };
}
