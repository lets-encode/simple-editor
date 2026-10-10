// Note-mode edits on the MEI DOM: duration steps, and the key signature in force.
//
// The key logic is ported from mei-friend (app/static/lib/editor.js and base40.js; AGPL-3.0), with
// one change: the key signature is also read from MEI 5's @keysig, which mei-friend's
// getKeySigForNote() does not look for. Pitch steps used to be mei-friend's pitchMover(), which
// moves within the key and drops the note's accidentals; since 2026-10-10 they move the staff
// position and keep the written accidental (accid.js, movePitch).

const PNAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

// Base-40 pitch: octave × 40 + chroma (https://wiki.ccarh.org/wiki/Base_40).
const B40 = 40;
const DIATONIC = [2, 8, 14, 19, 25, 31, 37];
const P5 = 23;
const ALTERATION = { s: 1, f: -1, ss: 2, x: 2, ff: -2, ts: 3, xs: 3, sx: 3, tf: -3, n: 0, nf: -1, ns: 1 };

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

// data.DURATION.cmn from whole note to 64th (breve and long left out for now).
export const DURATIONS = ['1', '2', '4', '8', '16', '32', '64'];
const toB40 = (pname, accid, oct) => B40 * oct + DIATONIC[PNAMES.indexOf(pname)] + (ALTERATION[accid] ?? 0);

/** The key signature in force at `el`, e.g. '3s', from the last @key.sig, @keysig or @sig before it. */
export function keySigFor(doc, el) {
  let sig = '0';
  const id = el.getAttributeNS(XML_NS, 'id');
  for (const s of doc.querySelectorAll(`[key\\.sig],[keysig],[sig],[*|id="${CSS.escape(id)}"]`)) {
    if (s === el) break;
    sig = s.getAttribute('key.sig') || s.getAttribute('keysig') || s.getAttribute('sig') || '0';
  }
  return sig;
}

export function keyScale(sig) {
  const m = /^(\d+)([sf])$/.exec(sig);
  const count = m ? Number(m[1]) : 0;
  const accid = m ? m[2] : 'n';
  const affected = accid === 's' ? SHARPS.slice(0, count) : accid === 'f' ? FLATS.slice(0, count) : [];
  const shift = count * P5 * (accid === 'f' ? -1 : 1);
  const steps = DIATONIC.map((v) => (((v + shift) % B40) + B40) % B40).sort((a, b) => a - b);
  const inKey = affected.map((p) => toB40(p, accid, 0));
  return { affected, steps, inKey };
}

function removeWithWhitespace(el) {
  const prev = el.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE && !prev.textContent.trim()) prev.remove();
  el.remove();
}

/**
 * Sets the duration `steps` along DURATIONS from `from` (positive is shorter), clamped at the ends.
 * @returns {number} the signed number of steps actually taken
 */
export function setDurationSteps(el, from, steps) {
  const i = DURATIONS.indexOf(from);
  if (i < 0) return 0;
  const j = Math.min(Math.max(i + steps, 0), DURATIONS.length - 1);
  el.setAttribute('dur', DURATIONS[j]);
  return j - i;
}

/** The element whose @dur a selected note, rest or chord member stands for (a chord member's chord). */
export function durationCarrier(el) {
  if (el.localName === 'note') {
    const chord = el.parentElement?.closest('chord');
    if (chord && !el.hasAttribute('dur')) return chord;
  }
  return ['note', 'rest', 'chord'].includes(el.localName) && el.hasAttribute('dur') ? el : null;
}

/** A restorable copy of what a pitch or duration edit can change on `el`. */
export function snapshot(el) {
  return {
    attrs: ['pname', 'oct', 'accid', 'accid.ges', 'dur'].map((a) => [a, el.getAttribute(a)]),
    accids: [...el.children].filter((c) => c.localName === 'accid').map((c) => c.cloneNode(true)),
  };
}

export function restore(el, snap) {
  for (const [a, v] of snap.attrs) {
    if (v === null) el.removeAttribute(a);
    else el.setAttribute(a, v);
  }
  for (const c of [...el.children]) if (c.localName === 'accid') removeWithWhitespace(c);
  for (const c of snap.accids) el.appendChild(c.cloneNode(true));
}
