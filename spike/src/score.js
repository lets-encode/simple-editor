// Verovio rendering and an index of the navigable elements on the rendered page.

// Mirrors mei-friend's navElsArray (app/static/lib/dom-utils.js).
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
  }

  load(mei) {
    this.tk.setOptions(this.options());
    this.tk.loadData(mei);
    this.pageCount = this.tk.getPageCount();
    this.page = 1;
    this.readOnsets();
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
    this.tk.setOptions(this.options());
    this.tk.redoLayout();
    this.pageCount = this.tk.getPageCount();
    const page = keepId ? this.tk.getPageWithElement(keepId) : 0;
    this.page = page > 0 ? page : Math.min(this.page, this.pageCount);
    this.render();
  }

  render() {
    this.container.innerHTML = this.tk.renderToSVG(this.page);
    this.index();
  }

  turnPage(delta) {
    const next = Math.min(Math.max(this.page + delta, 1), this.pageCount);
    if (next === this.page) return false;
    this.page = next;
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
    this.assignTimes();
  }

  /**
   * Sets `t`, a page-local score time: measure index × 1000 + onset within the measure in quarters.
   * Measuring from the measure's own onset keeps `t` in page order even when repeats are expanded.
   * Elements the timemap omits (clefs) take the time of the next timed element in their lane.
   */
  assignTimes() {
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
    const attr = this.tk.getElementAttr(id) ?? {};
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
