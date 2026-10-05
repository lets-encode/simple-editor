// "Ghost" notes: a stand-alone drawing of an edited note's new pitch and duration, laid over
// Verovio's SVG while the real reload is pending. Each ghost carries its own notehead, stem, flags,
// accidental, dots and ledger lines, so it never touches beams; the original is faded.
//
// Glyphs come from a hidden "glyph sheet" rendered once by Verovio, because a page's <defs> hold
// only the glyphs used on that page.

const SVG_NS = 'http://www.w3.org/2000/svg';
const MEI_NS = 'http://www.music-encoding.org/ns/mei';
const PNAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

// SMuFL code points.
const HEAD = { 1: 'E0A2', 2: 'E0A3' };
const BLACK_HEAD = 'E0A4';
const FLAG_UP = { 8: 'E240', 16: 'E242', 32: 'E244', 64: 'E246' };
const FLAG_DOWN = { 8: 'E241', 16: 'E243', 32: 'E245', 64: 'E247' };
const REST = { 1: 'E4E3', 2: 'E4E4', 4: 'E4E5', 8: 'E4E6', 16: 'E4E7', 32: 'E4E8', 64: 'E4E9' };
const ACCID = { s: 'E262', f: 'E260', n: 'E261', x: 'E263', ss: 'E263', ff: 'E264' };
const DOT = 'E1E7';

// Glyph widths in staff spaces (Leipzig).
const HEAD_WIDTH = { 1: 1.69, 2: 1.18, black: 1.18 };

const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="${MEI_NS}" meiversion="5.1"><music><body><mdiv><score>
<scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
<section><measure n="1"><staff n="1"><layer n="1">
${['1', '2', '4', '8', '16', '32', '64'].map((d) => `<note pname="c" oct="5" dur="${d}" stem.dir="up"/><note pname="c" oct="5" dur="${d}" stem.dir="down"/><rest dur="${d}"/>`).join('')}
${Object.keys(ACCID).map((a) => `<note pname="c" oct="5" dur="4" accid="${a}"/>`).join('')}
<note pname="c" oct="5" dur="4" dots="1"/>
</layer></staff></measure></section></score></mdiv></body></music></mei>`;

/** Renders the glyph sheet and keeps its glyphs, renamed `ghost-XXXX`, in a hidden <svg>. */
export function harvestGlyphs(tk) {
  tk.setOptions({ breaks: 'none', adjustPageHeight: true, header: 'none', footer: 'none' });
  tk.loadData(SHEET);
  const sheet = new DOMParser().parseFromString(tk.renderToSVG(1), 'image/svg+xml');
  const host = document.createElementNS(SVG_NS, 'svg');
  host.id = 'ghost-glyphs';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const g of sheet.querySelectorAll('defs > *')) {
    const copy = document.importNode(g, true);
    copy.id = `ghost-${g.id.split('-')[0]}`;
    defs.append(copy);
  }
  host.append(defs);
  document.body.append(host);
  return new Set([...defs.children].map((g) => g.id));
}

const diatonic = (pname, oct) => Number(oct) * 7 + PNAMES.indexOf(pname);

/** The written accidental of an MEI note (attribute or <accid> child), or null. */
function writtenAccid(note) {
  const child = [...note.children].find((c) => c.localName === 'accid');
  return note.getAttribute('accid') ?? child?.getAttribute('accid') ?? null;
}

/** What a pending edit may have changed on a note or rest, to compare against later. */
export function baseOf(el) {
  return { pname: el.getAttribute('pname'), oct: el.getAttribute('oct'), dur: el.getAttribute('dur'), accid: writtenAccid(el) };
}

const parseUse = (use) => {
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)/.exec(use.getAttribute('transform') ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) } : null;
};

function staffLines(staffG) {
  const ys = [...staffG.children]
    .filter((c) => c.tagName === 'path')
    .map((p) => /M[-\d.]+ ([-\d.]+)/.exec(p.getAttribute('d') ?? '')?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  return ys.length >= 2 ? ys : null;
}

export class Ghosts {
  /** @param {HTMLElement} container the element holding Verovio's SVG */
  constructor(container) {
    this.container = container;
  }

  clear() {
    this.container.querySelector('g.ghost-layer')?.remove();
    for (const el of this.container.querySelectorAll('.ghosted')) el.classList.remove('ghosted');
  }

  /**
   * Draws a ghost for each changed note or rest.
   * @param {{el: Element, base: ReturnType<typeof baseOf>, dur: string|null}[]} entries
   *   `el` is the MEI note or rest as it is now, `base` what the rendered SVG shows, `dur` its
   *   duration now (a chord member's is the chord's).
   * @returns {number} how many ghosts were drawn
   */
  show(entries) {
    this.clear();
    const svg = this.container.querySelector('svg');
    const layer = svg?.querySelector('g.page-margin');
    if (!layer) return 0;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ghost-layer');
    let n = 0;
    for (const e of entries) {
      const id = e.el.getAttribute('xml:id');
      const svgEl = id && svg.querySelector(`#${CSS.escape(id)}`);
      if (!svgEl) continue;
      const drawn = e.el.localName === 'rest' ? this.rest(svgEl, e) : this.note(svgEl, e);
      if (drawn) {
        g.append(drawn);
        svgEl.classList.add('ghosted');
        n++;
      }
    }
    layer.append(g);
    return n;
  }

  rest(svgEl, e) {
    const use = svgEl.querySelector('use');
    const p = use && parseUse(use);
    if (!p || !REST[e.dur]) return null;
    const out = document.createElementNS(SVG_NS, 'g');
    out.append(this.use(REST[e.dur], p.x, p.y, p.s));
    return out;
  }

  note(svgEl, e) {
    const use = svgEl.querySelector('g.notehead use');
    const p = use && parseUse(use);
    const lines = staffLines(svgEl.closest('g.staff'));
    if (!p || !lines) return null;
    const space = (lines.at(-1) - lines[0]) / (lines.length - 1);
    const half = space / 2;
    const steps = diatonic(e.el.getAttribute('pname'), e.el.getAttribute('oct')) - diatonic(e.base.pname, e.base.oct);
    const y = p.y - steps * half;
    const dur = Number(e.dur);
    const w = (HEAD_WIDTH[dur] ?? HEAD_WIDTH.black) * space;
    const out = document.createElementNS(SVG_NS, 'g');

    // Ledger lines between the staff and the note.
    const ledger = (ly) => {
      const l = document.createElementNS(SVG_NS, 'path');
      l.setAttribute('d', `M${p.x - 0.35 * space} ${ly} L${p.x + w + 0.35 * space} ${ly}`);
      l.setAttribute('stroke-width', String(space * 0.13));
      out.append(l);
    };
    for (let ly = lines[0] - space; ly >= y - 1; ly -= space) ledger(ly);
    for (let ly = lines.at(-1) + space; ly <= y + 1; ly += space) ledger(ly);

    out.append(this.use(HEAD[dur] ?? BLACK_HEAD, p.x, y, p.s));

    if (dur >= 2) {
      const middle = (lines[0] + lines.at(-1)) / 2;
      const up = y >= middle;
      const sw = space * 0.1;
      const stemX = up ? p.x + w - sw / 2 : p.x + sw / 2;
      const tip = up ? y - 3.5 * space : y + 3.5 * space;
      const stem = document.createElementNS(SVG_NS, 'path');
      stem.setAttribute('d', `M${stemX} ${y + (up ? -0.15 : 0.15) * space} L${stemX} ${tip}`);
      stem.setAttribute('stroke-width', String(sw));
      out.append(stem);
      const flag = (up ? FLAG_UP : FLAG_DOWN)[dur];
      if (flag) out.append(this.use(flag, stemX - sw / 2, tip, p.s));
    }

    const accid = writtenAccid(e.el);
    if (accid && ACCID[accid]) out.append(this.use(ACCID[accid], p.x - 1.3 * space, y, p.s));

    const dots = Number(e.el.getAttribute('dots') ?? e.el.parentElement?.closest('chord')?.getAttribute('dots') ?? 0);
    const onLine = Math.round((y - lines[0]) / half) % 2 === 0;
    for (let i = 0; i < dots; i++) out.append(this.use(DOT, p.x + w + (0.4 + 0.5 * i) * space, onLine ? y - half : y, p.s));
    return out;
  }

  use(code, x, y, s) {
    const u = document.createElementNS(SVG_NS, 'use');
    u.setAttribute('href', `#ghost-${code}`);
    u.setAttribute('transform', `translate(${x}, ${y}) scale(${s}, ${s})`);
    return u;
  }
}
