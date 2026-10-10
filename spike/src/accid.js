// Written accidentals (modes.md N8): the user records what is printed in front of the note; the
// sounding pitch (@accid.ges) follows from the key, accidentals earlier in the bar and the written
// accidental, and is worked out here.
//
// Spike-level simplifications (to be replaced by a port of mei-friend's checkAccidGes):
// - ties are not followed: a note tied on from a changed note keeps its @accid.ges;
// - an accidental carries to later notes of the same pitch and octave on the same staff, in any
//   layer, by onset within the bar; notes at the same onset in another layer are not affected;
// - double sharps and flats are not offered (N8: behind a "more" option, later).

import { keySigFor, keyScale } from './edit.js';
import { timeline } from './timeline.js';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';
const ALTERATION = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0, nf: -1, ns: 1 };
const GES = { 1: 's', '-1': 'f', 2: 'ss', '-2': 'ff', 0: 'n' };

const accidChild = (note) => [...note.children].find((c) => c.localName === 'accid') ?? null;

/** The written accidental of a note (attribute or <accid> child), or null. */
export function writtenAccid(note) {
  return note.getAttribute('accid') ?? accidChild(note)?.getAttribute('accid') ?? null;
}

/**
 * How the file writes accidentals, so edits follow its habits (A5, spike-level):
 * written as an <accid> child or @accid; whether @accid.ges is written at all, on the note or on
 * the <accid> child, and whether a sounding natural is written as accid.ges="n".
 */
function idiom(doc) {
  const music = doc.querySelector('music') ?? doc;
  const childWritten = !!music.querySelector('accid[accid]');
  const attrWritten = !!music.querySelector('note[accid]');
  return {
    child: childWritten || !attrWritten,
    ges: !!music.querySelector('[accid\\.ges]'),
    gesOnChild: !!music.querySelector('accid[accid\\.ges]'),
    gesNatural: !!music.querySelector('[accid\\.ges="n"]'),
    // Some files write @accid.ges only where nothing is written (Baumann), others on every altered note.
    gesWithWritten: [...music.querySelectorAll('note')].some((n) => writtenAccid(n) !== null && (n.hasAttribute('accid.ges') || !!accidChild(n)?.hasAttribute('accid.ges'))),
    // OMR drafts give every note an empty <accid>; such a file keeps them when one is cleared.
    keepEmpty: [...music.querySelectorAll('accid')].some((a) => ![...a.attributes].some((x) => x.name !== 'xml:id')),
  };
}

function removeWithWhitespace(el) {
  const prev = el.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE && !prev.textContent.trim()) prev.remove();
  el.remove();
}

const isBare = (a) => [...a.attributes].every((x) => x.name === 'xml:id');

/** A new <accid> child, indented like the note's other children, so removing it restores the text. */
function addAccidChild(doc, note) {
  const a = doc.createElementNS(MEI_NS, 'accid');
  const last = note.lastChild;
  if (last?.nodeType === Node.TEXT_NODE && !last.textContent.trim()) {
    const before = note.firstElementChild?.previousSibling;
    const indent = before?.nodeType === Node.TEXT_NODE && !before.textContent.trim() ? before.textContent : last.textContent + ' '.repeat(indentUnit(note));
    note.insertBefore(doc.createTextNode(indent), last);
    note.insertBefore(a, last);
  } else note.appendChild(a);
  return a;
}

/** The file's indentation step: how much deeper a note's closing tag sits than its parent's. */
function indentUnit(note) {
  const lastLine = (t) => (t?.nodeType === Node.TEXT_NODE ? t.textContent.split('\n').at(-1).length : null);
  const own = lastLine(note.lastChild);
  const parent = lastLine(note.parentElement?.lastChild);
  return own !== null && parent !== null && own > parent ? own - parent : 3;
}

/** Drops an <accid> child left with nothing to say, unless the file keeps empty ones. */
function tidy(note, id) {
  const child = accidChild(note);
  if (child && isBare(child) && !id.keepEmpty) removeWithWhitespace(child);
}

function setWritten(doc, note, value, id) {
  const child = accidChild(note);
  if (value === null) {
    note.removeAttribute('accid');
    child?.removeAttribute('accid');
  } else if (note.hasAttribute('accid') || (!child && !id.child)) note.setAttribute('accid', value);
  else (child ?? addAccidChild(doc, note)).setAttribute('accid', value);
}

/**
 * Writes the sounding alteration as @accid.ges, where the file writes it at all: on the note or
 * on its <accid>, as the note or else the file does; a natural only where the key alters the
 * pitch name and the file writes accid.ges="n".
 */
function setGes(doc, note, alter, keyAlters, id) {
  if (!id.ges) return;
  let value = alter === 0 ? (keyAlters && id.gesNatural ? 'n' : null) : GES[alter];
  if (writtenAccid(note) !== null && !id.gesWithWritten) value = null;
  const child = accidChild(note);
  const current = note.getAttribute('accid.ges') ?? child?.getAttribute('accid.ges') ?? null;
  if (current === value) return;
  if (value === null) {
    note.removeAttribute('accid.ges');
    child?.removeAttribute('accid.ges');
  } else if (note.hasAttribute('accid.ges')) note.setAttribute('accid.ges', value);
  else if (child?.hasAttribute('accid.ges') || id.gesOnChild) (child ?? addAccidChild(doc, note)).setAttribute('accid.ges', value);
  else note.setAttribute('accid.ges', value);
}

/** The key's alteration of a pitch name at `note` (−1, 0, 1). */
function keyAlter(doc, note) {
  const sig = keySigFor(doc, note);
  const affected = keyScale(sig).affected.includes(note.getAttribute('pname'));
  return affected ? (sig.endsWith('f') ? -1 : 1) : 0;
}

/**
 * The alteration in force for a note: its own written accidental, else the latest written one on
 * an earlier note of the same pitch and octave on the same staff in the bar, else the key's.
 */
function soundingAlter(doc, tl, e) {
  const own = writtenAccid(e.el);
  if (own !== null) return ALTERATION[own] ?? 0;
  let best = null;
  for (const o of tl.entries) {
    if (o.measureId !== e.measureId || o.staffN !== e.staffN || o.kind !== 'note' || o.pitch !== e.pitch || o.q >= e.q) continue;
    if (writtenAccid(o.el) === null) continue;
    if (!best || o.q > best.q || (o.q === best.q && o.order > best.order)) best = o;
  }
  return best ? (ALTERATION[writtenAccid(best.el)] ?? 0) : keyAlter(doc, e.el);
}

/**
 * The notes an accidental on `notes` can affect: the notes themselves and later notes of the same
 * pitch on the same staff in the bar, up to the next one with its own written accidental (or all
 * of them, with `stop` false).
 */
function scopeOf(tl, notes, stop) {
  const scope = new Set(notes);
  for (const n of notes) {
    const e = tl.byId.get(n.getAttribute('xml:id'));
    if (!e || e.pitch === null) continue;
    const later = tl.entries
      .filter((o) => o.measureId === e.measureId && o.staffN === e.staffN && o.kind === 'note' && o.pitch === e.pitch && o.q > e.q)
      .sort((a, b) => a.q - b.q || a.order - b.order);
    for (const o of later) {
      if (stop && writtenAccid(o.el) !== null) break;
      scope.add(o.el);
    }
  }
  return scope;
}

/**
 * Records, node for node, what an accidental on `notes` can change, so a gesture that tries
 * accidentals out can put the text back exactly as it was: each note's attributes in order, and
 * its <accid> child (the same node, with its indentation and attributes).
 * @returns {{restore: () => void}}
 */
export function accidSnapshot(meiDoc, notes) {
  const attrs = (el) => [...el.attributes].map((a) => [a.namespaceURI, a.name, a.value]);
  const setAttrs = (el, list) => {
    const now = attrs(el);
    if (now.length === list.length && now.every((a, i) => a[1] === list[i][1] && a[2] === list[i][2])) return;
    for (const a of [...el.attributes]) el.removeAttributeNS(a.namespaceURI, a.localName);
    for (const [ns, name, value] of list) el.setAttributeNS(ns, name, value);
  };
  const saved = [...scopeOf(timeline(meiDoc), notes, false)].map((n) => {
    const child = accidChild(n);
    const ws = child?.previousSibling?.nodeType === Node.TEXT_NODE && !child.previousSibling.textContent.trim() ? child.previousSibling : null;
    return { n, attrs: attrs(n), child, childAttrs: child && attrs(child), ws, next: child?.nextSibling ?? null };
  });
  return {
    restore() {
      for (const x of saved) {
        setAttrs(x.n, x.attrs);
        const now = accidChild(x.n);
        if (now && now !== x.child) removeWithWhitespace(now);
        if (x.child && x.child.parentNode !== x.n) {
          if (x.ws) x.n.insertBefore(x.ws, x.next);
          x.n.insertBefore(x.child, x.next);
        }
        if (x.child) setAttrs(x.child, x.childAttrs);
      }
      meiDoc.changed();
    },
  };
}

/**
 * Sets (or, when every note already has it, removes) the written accidental `value` on `notes`,
 * then brings @accid.ges up to date for them and for later notes of the same pitch on the same
 * staff in the bar, up to the next note with its own written accidental (the ripple).
 * @param {import('./mei.js').MeiDoc} meiDoc @param {Element[]} notes @param {'s'|'f'|'n'} value
 * @returns {{removed: boolean, rippled: number}}
 */
export function applyAccidental(meiDoc, notes, value) {
  const doc = meiDoc.doc;
  const id = idiom(doc);
  const removed = notes.every((n) => writtenAccid(n) === value);
  for (const n of notes) setWritten(doc, n, removed ? null : value, id);
  meiDoc.changed();

  const tl = timeline(meiDoc);
  const scope = scopeOf(tl, notes, true);
  for (const n of scope) {
    const e = tl.byId.get(n.getAttribute('xml:id'));
    if (e) setGes(doc, n, soundingAlter(doc, tl, e), keyAlter(doc, n) !== 0, id);
  }
  // Only now, so an <accid> emptied of one attribute and given another keeps its id.
  for (const n of scope) tidy(n, id);
  return { removed, rippled: scope.size - notes.length };
}
