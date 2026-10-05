// Verovio rendering and an index of the navigable elements on the rendered page.

// Mirrors mei-friend's navElsArray (app/static/lib/dom-utils.js).
const MEI_NS = 'http://www.music-encoding.org/ns/mei';

const NAV_CLASSES = ['note', 'rest', 'mRest', 'beatRpt', 'halfmRpt', 'mRpt', 'clef'];
const NAV_SELECTOR = NAV_CLASSES.map((c) => `g.${c}`).join(',');

export const SCALES = [25, 30, 35, 40, 45, 50, 60, 70, 80, 100, 120];

/**
 * @typedef {object} Item
 * @property {SVGGElement} el
 * @property {string} id
 * @property {number} order   document order on the page
 * @property {Element} system
 * @property {Element} measure
 * @property {number} measureIndex
 * @property {number} staffN
 * @property {number} layerN
 * @property {string|null} chordId
 * @property {DOMRect} rect   client rect of the notehead (notes) or the element (everything else)
 * @property {number} cx
 * @property {number} cy
 * @property {number} t       page-local onset: measure index × 1000 + quarters into the measure
 */

export class Score {
  /** @param {import('verovio/esm').VerovioToolkit} tk @param {HTMLElement} container */
  constructor(tk, container) {
    this.tk = tk;
    this.container = container;
    this.scale = 45;
    this.page = 1;
    this.pageCount = 0;
    /** @type {Item[]} */
    this.items = [];
    /** @type {Map<string, Item>} */
    this.byId = new Map();
    this.measures = [];
    this.systems = [];
    /** @type {import('./mei.js').MeiDoc | null} */
    this.doc = null;
    /** @type {[string, string][]} each page's first and last measure id under the last full layout */
    this.ranges = [];
    /** true while the toolkit holds only the current page's measures (Verovio's select()) */
    this.selected = false;
  }

  /** @param {import('./mei.js').MeiDoc} doc */
  load(doc) {
    this.doc = doc;
    this.page = 1;
    this.fullLayout(null, doc.serialize());
  }

  /** Lays out the whole file and records each page's measure range. */
  fullLayout(keepId, mei) {
    this.tk.setOptions(this.options());
    this.tk.loadData(mei);
    this.selected = false;
    this.afterFullLayout(keepId);
  }

  afterFullLayout(keepId) {
    this.pageCount = this.tk.getPageCount();
    this.onsets = null;
    const page = keepId ? this.tk.getPageWithElement(keepId) : 0;
    this.page = page > 0 ? page : Math.min(Math.max(this.page, 1), this.pageCount);
    this.ranges = [];
    for (const id of this.doc.measureIds()) {
      const p = this.tk.getPageWithElement(id);
      if (p < 1) continue;
      this.ranges[p - 1] ??= [id, id];
      this.ranges[p - 1][1] = id;
    }
    /** @type {string[][]} per page, the first measure of each system, recorded when the page is rendered */
    this.systemStarts = [];
  }

  /**
   * The serialisation for loading only the current page, keeping the full layout's line breaks: an
   * <sb> before each system start and before the next page's first measure (added to the DOM only
   * while serialising), with the selection ending at that next measure.
   *
   * Verovio 6.3, with select() and encoded breaks, leaves out the selection's last system, the
   * one after its last <sb>. Ending the selection at the next page's first measure, behind an
   * <sb>, makes that dropped system the one we do not want. On the last page, an end id that does
   * not exist makes the selection run to the end of the piece, and nothing is dropped.
   */
  pageSource() {
    const range = this.ranges[this.page - 1];
    const starts = this.systemStarts[this.page - 1];
    if (!range || !starts) return null;
    const next = this.ranges[this.page]?.[0] ?? null;
    const added = [...starts.slice(1), ...(next ? [next] : [])].map((id) => {
      const sb = this.doc.doc.createElementNS(MEI_NS, 'sb');
      this.doc.get(id).before(sb);
      return sb;
    });
    const mei = this.doc.serialize();
    for (const sb of added) sb.remove();
    return { mei, start: range[0], end: next ?? 'simple-editor-to-the-end' };
  }

  /** @returns {boolean} false if the passage did not come out as one page */
  loadSelection(src) {
    this.tk.setOptions({ ...this.options(), breaks: 'encoded' });
    this.tk.select({ start: src.start, end: src.end });
    this.tk.loadData(src.mei);
    this.onsets = null;
    this.selected = this.tk.getPageCount() === 1;
    return this.selected;
  }

  /**
   * Serialises the DOM, loads it and renders. With `scope` 'page' only the current page's measures
   * are loaded, falling back to the whole file when that is not possible.
   * @returns {{ser: number, load: number, render: number, scope: string}} milliseconds
   */
  reload(keepId, scope) {
    const t0 = performance.now();
    const src = scope === 'page' ? this.pageSource() : null;
    const mei = src ? null : this.doc.serialize();
    const t1 = performance.now();
    let how = 'full';
    if (src) how = this.loadSelection(src) ? 'page' : 'full: page overflowed';
    else if (scope === 'page') how = 'full: no line breaks recorded for this page';
    if (how !== 'page') this.fullLayout(keepId, mei ?? this.doc.serialize());
    const t2 = performance.now();
    this.render();
    const ms = (a, b) => Math.round(b - a);
    return { ser: ms(t0, t1), load: ms(t1, t2), render: ms(t2, performance.now()), scope: how };
  }

  /** First-occurrence onsets (in quarter notes) of notes, rests and measures, from Verovio's timemap. */
  readOnsets() {
    /** @type {Map<string, number>} */
    this.onsets = new Map();
    for (const e of this.tk.renderToTimemap({ includeMeasures: true, includeRests: true })) {
      for (const id of [...(e.on ?? []), ...(e.restsOn ?? []), ...(e.measureOn ? [e.measureOn] : [])]) {
        if (!this.onsets.has(id)) this.onsets.set(id, e.qstamp);
      }
    }
  }

  options() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const k = 100 / this.scale;
    return {
      scale: this.scale,
      // Page size in Verovio units equals CSS pixels times 100 / scale, so one page fills the stage.
      pageWidth: Math.max(Math.round(w * k), 100),
      pageHeight: Math.max(Math.round(h * k), 100),
      pageMarginTop: 40,
      pageMarginBottom: 40,
      pageMarginLeft: 30,
      pageMarginRight: 30,
      adjustPageHeight: false,
      breaks: 'auto',
      header: 'none',
      footer: 'none',
      svgAdditionalAttribute: ['layer@n', 'staff@n'],
    };
  }

  /** Lays the score out again for the current stage size and scale, keeping `keepId` on screen. */
  relayout(keepId) {
    if (this.selected) this.fullLayout(keepId, this.doc.serialize());
    else {
      this.tk.setOptions(this.options());
      this.tk.redoLayout();
      this.afterFullLayout(keepId);
    }
    this.render();
  }

  render() {
    this.container.innerHTML = this.tk.renderToSVG(this.selected ? 1 : this.page);
    if (!this.selected) {
      this.systemStarts[this.page - 1] = [...this.container.querySelectorAll('g.system')]
        .map((sy) => sy.querySelector('g.measure')?.id)
        .filter(Boolean);
    }
    this.index();
  }

  turnPage(delta) {
    const next = Math.min(Math.max(this.page + delta, 1), this.pageCount);
    if (next === this.page) return false;
    this.page = next;
    if (this.selected) {
      const src = this.pageSource();
      if (!src || !this.loadSelection(src)) this.fullLayout(null, this.doc.serialize());
    }
    this.render();
    return true;
  }

  index() {
    const svg = this.container.querySelector('svg');
    this.systems = [...svg.querySelectorAll('g.system')];
    this.measures = [...svg.querySelectorAll('g.measure')];
    const measureIndex = new Map(this.measures.map((m, i) => [m, i]));
    this.items = [];
    this.byId = new Map();
    for (const el of svg.querySelectorAll(NAV_SELECTOR)) {
      const layer = el.closest('g.layer');
      const staff = el.closest('g.staff');
      const measure = el.closest('g.measure');
      if (!layer || !staff || !measure) continue;
      const head = el.classList.contains('note') ? el.querySelector('g.notehead') : null;
      const rect = (head ?? el).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const chord = el.classList.contains('note') ? el.closest('g.chord') : null;
      const item = {
        el,
        id: el.id,
        order: this.items.length,
        system: el.closest('g.system'),
        measure,
        measureIndex: measureIndex.get(measure),
        staffN: Number(staff.dataset.n ?? 0),
        layerN: Number(layer.dataset.n ?? 1),
        chordId: chord ? chord.id : null,
        rect,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
      };
      this.items.push(item);
      this.byId.set(item.id, item);
    }
    this.timed = false;
  }

  /**
   * Sets `t`, a page-local score time: measure index × 1000 + onset within the measure in quarters.
   * Measuring from the measure's own onset keeps `t` in page order even when repeats are expanded.
   * Elements the timemap omits (clefs) take the time of the next timed element in their lane.
   * Computed on demand, since the timemap costs a full timing pass after every edit.
   */
  assignTimes() {
    if (this.timed) return;
    this.timed = true;
    if (!this.onsets) this.readOnsets();
    for (const it of this.items) {
      const q = this.onsets.get(it.id);
      const mq = this.onsets.get(it.measure.id);
      it.t = q !== undefined && mq !== undefined ? it.measureIndex * 1000 + (q - mq) : null;
    }
    const lanes = new Map();
    for (const it of this.items) {
      const k = `${it.measureIndex}/${it.staffN}/${it.layerN}`;
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(it);
    }
    for (const lane of lanes.values()) {
      let next = null;
      for (let i = lane.length - 1; i >= 0; i--) {
        if (lane[i].t === null) lane[i].t = next ?? lane[i].measureIndex * 1000 + 999;
        else next = lane[i].t;
      }
    }
  }

  /** The navigable item nearest to a client point, if within `reach` px of its glyph. */
  hit(x, y, reach) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.items) {
      const r = it.rect;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return bestD <= reach ? best : null;
  }

  /** Items whose glyph centre lies inside a client rectangle. */
  inRect(r) {
    return this.items.filter((it) => it.cx >= r.left && it.cx <= r.right && it.cy >= r.top && it.cy <= r.bottom);
  }

  describe(id) {
    const it = this.byId.get(id);
    const el = this.doc?.get(id);
    const accidChild = el && [...el.children].find((c) => c.localName === 'accid');
    const attr = el
      ? { pname: el.getAttribute('pname'), oct: el.getAttribute('oct'), accid: el.getAttribute('accid') ?? accidChild?.getAttribute('accid'), 'accid.ges': el.getAttribute('accid.ges') ?? accidChild?.getAttribute('accid.ges') }
      : (this.tk.getElementAttr(id) ?? {});
    const kind = it?.el.classList[0] ?? 'element';
    let what = kind;
    if (kind === 'note' && attr.pname) {
      const accid = { s: '♯', f: '♭', n: '♮', ss: '𝄪', ff: '𝄫' }[attr.accid ?? attr['accid.ges']] ?? '';
      what = `${attr.pname.toUpperCase()}${accid}${attr.oct ?? ''}`;
    }
    const m = it ? this.tk.getElementAttr(it.measure.id)?.n : undefined;
    return it ? `${what} · bar ${m ?? '?'} · staff ${it.staffN} · layer ${it.layerN}` : what;
  }
}
