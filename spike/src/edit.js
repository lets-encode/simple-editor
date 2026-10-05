// Note-mode edits on the MEI DOM: diatonic pitch steps within the key and duration steps.
//
// The pitch logic is ported from mei-friend (app/static/lib/editor.js, pitchMover(), and
// base40.js; AGPL-3.0), with one change: the key signature is also read from MEI 5's @keysig,
// which mei-friend's getKeySigForNote() does not look for.

const PNAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

// Base-40 pitch: octave × 40 + chroma (https://wiki.ccarh.org/wiki/Base_40).
const B40 = 40;
const DIATONIC = [2, 8, 14, 19, 25, 31, 37];
const P5 = 23;
const ALTERATION = { s: 1, f: -1, ss: 2, x: 2, ff: -2, ts: 3, xs: 3, sx: 3, tf: -3, n: 0, nf: -1, ns: 1 };
const ACCID_GES = { 1: 's', '-1': 'f', 2: 'ss', '-2': 'ff', 3: 'ts', '-3': 'tf', 0: 'n' };

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MEI_NS = 'http://www.music-encoding.org/ns/mei';

// data.DURATION.cmn from whole note to 64th (breve and long left out for now).
export const DURATIONS = ['1', '2', '4', '8', '16', '32', '64'];
export const OCTAVE_RANGE = [0, 9];

const toB40 = (pname, accid, oct) => B40 * oct + DIATONIC[PNAMES.indexOf(pname)] + (ALTERATION[accid] ?? 0);

function fromB40(n) {
  const oct = Math.floor(n / B40);
  const chroma = n - oct * B40;
  const i = DIATONIC.findIndex((step) => chroma < step + 3);
  return { oct, pname: PNAMES[i], accidGes: ACCID_GES[chroma - DIATONIC[i]] };
}

/** The key signature in force at `el`, e.g. '3s', from the last @key.sig, @keysig or @sig before it. */
function keySigFor(doc, el) {
  let sig = '0';
  const id = el.getAttributeNS(XML_NS, 'id');
  for (const s of doc.querySelectorAll(`[key\\.sig],[keysig],[sig],[*|id="${CSS.escape(id)}"]`)) {
    if (s === el) break;
    sig = s.getAttribute('key.sig') || s.getAttribute('keysig') || s.getAttribute('sig') || '0';
  }
  return sig;
}

function keyScale(sig) {
  const m = /^(\d+)([sf])$/.exec(sig);
  const count = m ? Number(m[1]) : 0;
  const accid = m ? m[2] : 'n';
  const affected = accid === 's' ? SHARPS.slice(0, count) : accid === 'f' ? FLATS.slice(0, count) : [];
  const shift = count * P5 * (accid === 'f' ? -1 : 1);
  const steps = DIATONIC.map((v) => (((v + shift) % B40) + B40) % B40).sort((a, b) => a - b);
  const inKey = affected.map((p) => toB40(p, accid, 0));
  return { affected, steps, inKey };
}

/**
 * Moves a note `delta` diatonic steps within the key (±7 is an octave), as mei-friend does: the
 * note's accidentals are removed, then the new pitch is written with @accid.ges when the key
 * signature supplies it, or with an <accid> child otherwise.
 * @returns {boolean} false when the result would leave the octave range
 */
export function stepPitch(doc, el, delta) {
  let oct = Number(el.getAttribute('oct') ?? 4);
  const pname = el.getAttribute('pname') ?? 'c';
  const accidChild = [...el.children].find((c) => c.localName === 'accid');
  const accid =
    el.getAttribute('accid') || accidChild?.getAttribute('accid') || el.getAttribute('accid.ges') || accidChild?.getAttribute('accid.ges') || 'n';

  const key = keyScale(keySigFor(doc, el));
  let step = toB40(pname, accid, 0) % B40;
  const sign = Math.sign(delta);

  if (Math.abs(delta) === 7) {
    oct += sign;
  } else {
    const i = key.steps.indexOf(step);
    if (i >= 0) {
      let next = i + sign;
      if (next < 0) {
        next = key.steps.length - 1;
        oct -= 1;
      } else if (next >= key.steps.length) {
        next = 0;
        oct += 1;
      }
      step = key.steps[next];
    } else {
      // A chromatically altered note: go to the nearest scale step in the direction of travel.
      let next = sign > 0 ? key.steps.findIndex((s) => s > step) : key.steps.findLastIndex((s) => s < step);
      if (next < 0) {
        next = sign > 0 ? 0 : key.steps.length - 1;
        oct += sign;
      }
      step = key.steps[next];
    }
  }
  if (oct < OCTAVE_RANGE[0] || oct > OCTAVE_RANGE[1]) return false;

  el.removeAttribute('accid');
  el.removeAttribute('accid.ges');
  for (const c of [...el.children]) if (c.localName === 'accid') removeWithWhitespace(c);

  const p = fromB40(step);
  if (key.inKey.includes(step)) {
    el.setAttribute('accid.ges', p.accidGes);
  } else if ((p.accidGes && p.accidGes !== 'n') || key.affected.includes(p.pname)) {
    const a = doc.createElementNS(MEI_NS, 'accid');
    a.setAttribute('accid', p.accidGes);
    el.appendChild(a);
  }
  el.setAttribute('oct', String(oct));
  el.setAttribute('pname', p.pname);
  return true;
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
