// The entry pane (simple-editor-meta docs/modes.md, N1, N2, N7): a narrow column of generously
// spaced staff lines beside the score. Touching it shows a ghost at once; sliding scrubs through
// staff positions; lifting inserts. Scrubbing near the top or bottom edge scrolls on by itself.
// The clef in force is drawn faintly behind the lines, and the pitch name shows in a bubble beside
// the pane, where the thumb does not cover it.

import { glyphScale, glyphUse } from './ghost.js';
import { clefGlyph, fromDiatonic } from './entry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE_PX = 44; // autoscroll zone at the top and bottom
const MAX_SCROLL = 0.45; // staff positions per tick at the very edge
const TICK_MS = 30;
// Ledger lines the pane reaches above and below the staff (the space beyond the last included).
// Beyond that, ottava marks would be the way; revisit once real scores ask for more.
const MAX_LEDGERS = 5;

export class EntryPane {
  /**
   * @param {{el: HTMLElement, label: HTMLElement, settings: object,
   *   onScrub: (d: number) => void, onLift: (d: number) => void, onCancel: () => void}} opts
   *   `d` is a diatonic number (C4 = 28)
   */
  constructor({ el, label, settings, onScrub, onLift, onCancel }) {
    this.el = el;
    this.label = label;
    this.settings = settings;
    this.h = { onScrub, onLift, onCancel };
    this.svg = document.createElementNS(SVG_NS, 'svg');
    el.append(this.svg);
    /** @type {ReturnType<typeof import('./entry.js').clefAt>} */
    this.clef = null;
    this.centre = 32; // the diatonic number at the pane's vertical centre
    this.touch = null;
    this.wire();
    new ResizeObserver(() => this.draw()).observe(el);
  }

  get step() {
    return this.settings.paneStepPx;
  }

  /** Sets the clef in force at the insertion point; a different clef recentres the pane on the staff. */
  setClef(clef, name) {
    const changed = !this.clef || !clef || clef.bottom !== this.clef.bottom || clef.shape !== this.clef.shape;
    this.clef = clef;
    this.name = name;
    if (changed && clef) {
      this.centre = clef.bottom + 4;
      if (this.touch === null && this.shownOnce) this.flashClef = true;
      this.shownOnce = true;
    }
    this.draw();
  }

  yOf(d) {
    return this.el.clientHeight / 2 - (d - this.centre) * this.step;
  }

  /** The lowest and highest positions that can be entered, from the clef's bottom line. */
  range() {
    const b = this.clef.bottom;
    return [b - 2 * MAX_LEDGERS - 1, b + 8 + 2 * MAX_LEDGERS + 1];
  }

  dAt(y, clamp = true) {
    const d = Math.round(this.centre + (this.el.clientHeight / 2 - y) / this.step);
    if (!clamp || !this.clef) return d;
    const [lo, hi] = this.range();
    return Math.min(Math.max(d, lo), hi);
  }

  draw(ghost = this.touch?.shown ? this.touch.d : null) {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.svg.replaceChildren();
    const clef = this.clef;
    if (!clef) return;
    const g = (cls) => {
      const x = document.createElementNS(SVG_NS, 'g');
      x.setAttribute('class', cls);
      this.svg.append(x);
      return x;
    };
    const space = 2 * this.step;
    const s = glyphScale(space);

    // The clef, at the pane's staff size, behind the lines and cut off on both sides: its right
    // edge overhangs by 0.2 staff spaces, which keeps the F clef's dots half visible, the G clef's
    // loop and spiral, and the C clef's two curves.
    const code = clefGlyph(clef);
    if (code) {
      const c = g(`pane-clef${this.flashClef ? ' flash' : ''}`);
      const y = this.yOf(clef.bottom + 2 * (clef.line - 1));
      const use = glyphUse(code, 3, y, s);
      c.append(use);
      // getBBox is in glyph units, before the use's own transform.
      const box = use.getBBox();
      if (box?.width) use.setAttribute('transform', `translate(${w + 0.2 * space - (box.x + box.width) * s}, ${y}) scale(${s}, ${s})`);
      this.flashClef = false;
    }

    // Staff lines across the pane; ledger lines, shorter and lighter, beyond.
    const lines = g('pane-lines');
    const [lo, hi] = this.range();
    for (let d = Math.max(this.dAt(h, false) - 1, lo); d <= Math.min(this.dAt(0, false) + 1, hi); d++) {
      const off = d - clef.bottom;
      if (off % 2) continue;
      const staff = off >= 0 && off <= 8;
      const l = document.createElementNS(SVG_NS, 'line');
      const inset = staff ? 0 : w * 0.22;
      const y = this.yOf(d);
      Object.entries({ x1: inset, x2: w - inset, y1: y, y2: y }).forEach(([k, v]) => l.setAttribute(k, v));
      l.setAttribute('class', staff ? 'staff' : 'ledger');
      lines.append(l);
    }

    if (ghost !== null) {
      const gh = g('pane-ghost');
      gh.append(glyphUse('E0A4', w / 2 - 0.59 * space, this.yOf(ghost), s));
      this.showLabel(ghost);
    } else this.label.hidden = true;
  }

  /** The pitch name in a bubble on the score's side of the pane, level with the ghost. */
  showLabel(d) {
    const l = this.label;
    l.textContent = this.name ? this.name(d) : fromDiatonic(d).pname.toUpperCase();
    l.hidden = false;
    const pane = this.el.getBoundingClientRect();
    const main = this.el.offsetParent.getBoundingClientRect();
    const y = pane.top - main.top + this.yOf(d);
    const right = this.settings.paneSide !== 'left';
    l.style.top = `${y - l.offsetHeight / 2}px`;
    l.style.left = right ? `${pane.left - main.left - l.offsetWidth - 8}px` : `${pane.right - main.left + 8}px`;
  }

  wire() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // A second finger, here or on the score, makes it a two-finger gesture (main.js).
      if (this.touch || !e.isPrimary) return this.cancel('a second finger');
      if (!this.clef) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events.
      }
      const y = e.clientY - el.getBoundingClientRect().top;
      // The ghost waits a moment, so the first finger of a slightly staggered two-finger touch
      // does not flash one; a tap within the wait still inserts.
      this.touch = { id: e.pointerId, y, d: this.dAt(y), shown: false };
      this.touch.wait = setTimeout(() => this.show(), this.settings.paneGhostDelayMs);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      this.touch.y = e.clientY - el.getBoundingClientRect().top;
      this.update();
    });
    el.addEventListener('pointerup', (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      const d = this.touch.shown ? this.touch.d : this.dAt(this.touch.y);
      this.end();
      this.h.onLift(d);
    });
    const lost = (e) => {
      if (this.touch && e.pointerId === this.touch.id) this.cancel('the browser cancelled the touch');
    };
    el.addEventListener('pointercancel', lost);
    // A touch whose end never arrives would otherwise block every later one.
    el.addEventListener('lostpointercapture', lost);
  }

  show() {
    const t = this.touch;
    t.shown = true;
    t.d = this.dAt(t.y);
    t.timer = setInterval(() => this.autoscroll(), TICK_MS);
    navigator.vibrate?.(4);
    this.draw();
    this.h.onScrub(t.d);
  }

  update() {
    if (!this.touch.shown) return;
    const d = this.dAt(this.touch.y);
    if (d === this.touch.d) return;
    this.touch.d = d;
    navigator.vibrate?.(4);
    this.draw();
    this.h.onScrub(d);
  }

  /** Near the top or bottom edge the pane scrolls on, faster the nearer the edge. */
  autoscroll() {
    const { y } = this.touch;
    const h = this.el.clientHeight;
    const depth = y < EDGE_PX ? EDGE_PX - y : y > h - EDGE_PX ? -(y - (h - EDGE_PX)) : 0;
    if (!depth) return;
    // Scroll no further than brings the last position to the pane's edge zone.
    const [first, last] = this.range();
    const reach = (this.el.clientHeight / 2 - EDGE_PX) / this.step;
    const lo = Math.min(first + reach, this.clef.bottom + 4);
    const hi = Math.max(last - reach, this.clef.bottom + 4);
    this.centre = Math.min(Math.max(this.centre + (Math.max(Math.min(depth, EDGE_PX), -EDGE_PX) / EDGE_PX) * MAX_SCROLL, lo), hi);
    this.draw();
    this.update();
  }

  end() {
    clearTimeout(this.touch.wait);
    clearInterval(this.touch.timer);
    this.touch = null;
    this.centre = Math.round(this.centre);
    this.draw();
  }

  /** Ends the touch without inserting; silently if its ghost was not shown yet. */
  cancel(reason) {
    if (!this.touch) return;
    const shown = this.touch.shown;
    this.end();
    if (shown) this.h.onCancel(reason);
  }
}
