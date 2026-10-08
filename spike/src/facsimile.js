// The facsimile sheet (simple-editor-meta docs/facsimile.md, F1–F5).
//
// One sheet slides over the score from the top, with three resting heights: closed (the handle
// only), strip and full. Dragging the handle covers the score without re-laying it out; once the
// sheet settles at closed or strip the stage shrinks to what is left, and the score re-lays out
// once (main.js's ResizeObserver). At full the stage keeps its layout underneath. Holding the
// facsimile button flips to full until it is released.
//
// The view follows the score: the zones of the measures on screen are highlighted (the selection's
// more strongly), and the view frames them all, or only the selection's focus measure (⚙). The
// focus measure's zone is at most as tall as its rendered system (like for like). Zones are
// highlighted, never clipped. Panning or zooming by hand unlinks the view and shows Sync; tapping
// a zone selects in its measure.

const HANDLE_PX = 17; // the handle's height plus its border (style.css)
const FLICK_SPEED = 0.4; // px/ms: a faster release goes on to the next height in its direction
const PAN_SLOP_PX = 4;

/** @typedef {{x: number, y: number, w: number, h: number}} Box  in image pixels */

export class Facsimile {
  /**
   * @param {{main: HTMLElement, stage: HTMLElement, sheet: HTMLElement, settings: object,
   *   onChange?: (text: string) => void, onTap?: (hit: ReturnType<Facsimile['measureAt']>) => void}} opts
   */
  constructor({ main, stage, sheet, settings, onChange, onTap }) {
    this.main = main;
    this.stage = stage;
    this.sheet = sheet;
    this.settings = settings;
    this.onChange = onChange ?? (() => {});
    this.onTap = onTap ?? (() => {});
    this.view = sheet.querySelector('#fac-view');
    this.content = sheet.querySelector('#fac-content');
    this.img = sheet.querySelector('#fac-img');
    this.zonesEl = sheet.querySelector('#fac-zones');
    this.syncBtn = sheet.querySelector('#fac-sync');
    this.handle = sheet.querySelector('#fac-handle');
    this.available = false;
    /** @type {'closed'|'strip'|'full'} */
    this.rest = 'closed';
    this.flipping = null;
    this.linked = true;
    this.t = { s: 0.2, x: 0, y: 0 };
    /** @type {{frame: Box, like: number|null, key: string} | null} what the view frames, and the like-for-like scale */
    this.target = null;
    this.surface = null;
    this.wireHandle();
    this.wireView();
    this.syncBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.syncBtn.addEventListener('click', () => this.sync());
    new ResizeObserver(() => this.available && this.settle(this.rest, false)).observe(main);
    // Keeps the zone centred while the sheet is dragged or animates, frame by frame.
    new ResizeObserver(() => this.linked && this.centre(false)).observe(this.view);
  }

  /** @param {import('./mei.js').MeiDoc} doc @param {string} url the MEI file's URL, for relative image paths */
  load(doc, url) {
    this.doc = doc;
    this.base = new URL(url, location.href);
    this.available = !!doc.doc.querySelector('facsimile surface graphic[target]');
    this.sheet.hidden = !this.available;
    this.target = null;
    this.surface = null;
    this.img.removeAttribute('src');
    this.zonesEl.replaceChildren();
    this.linked = true;
    this.syncBtn.hidden = true;
    this.settle('closed', false);
  }

  // Heights and settling.

  heights() {
    const h = this.main.clientHeight;
    return { closed: HANDLE_PX, strip: Math.round((h * this.settings.stripPct) / 100), full: h };
  }

  setHeight(px, animate) {
    this.sheet.classList.toggle('animate', animate);
    this.sheet.style.height = `${px}px`;
    this.height = px;
  }

  /** Snaps to a resting height; the stage takes the room left once the animation is over. */
  settle(rest, animate = true) {
    if (!this.available) {
      this.stage.style.top = '0px';
      return;
    }
    this.rest = rest;
    const h = this.heights()[rest];
    this.setHeight(h, animate);
    clearTimeout(this.settleTimer);
    if (rest === 'full') return;
    const shrink = () => {
      this.stage.style.top = `${h}px`;
    };
    if (animate) this.settleTimer = setTimeout(shrink, 200);
    else shrink();
  }

  toggle() {
    this.settle(this.rest === 'closed' ? 'strip' : 'closed');
    this.onChange(`facsimile ${this.rest}`);
  }

  /** The facsimile button: a tap toggles closed and strip; holding it shows the sheet at full. */
  buttonDown() {
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.flipping = { back: this.rest };
      navigator.vibrate?.(12);
      this.setHeight(this.heights().full, true);
      this.onChange('facsimile: flipped to full while held');
    }, this.settings.flipHoldMs);
  }

  buttonUp(cancelled = false) {
    clearTimeout(this.holdTimer);
    if (this.flipping) {
      const back = this.flipping.back;
      this.flipping = null;
      this.setHeight(this.heights()[back], true);
      this.onChange(`facsimile: back to ${back}`);
    } else if (!cancelled) this.toggle();
  }

  wireHandle() {
    let d = null;
    const h = this.handle;
    h.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        h.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests) carry pointer ids the browser does not know.
      }
      d = { id: e.pointerId, y0: e.clientY, h0: this.height, moved: false, samples: [[e.timeStamp, e.clientY]] };
      this.sheet.classList.add('dragging');
    });
    h.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dy) < PAN_SLOP_PX) return;
      d.moved = true;
      d.samples.push([e.timeStamp, e.clientY]);
      if (d.samples.length > 6) d.samples.shift();
      this.setHeight(Math.min(Math.max(d.h0 + dy, HANDLE_PX), this.heights().full), false);
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const drag = d;
      d = null;
      this.sheet.classList.remove('dragging');
      if (!drag.moved) return this.toggle();
      const [t0, y0] = drag.samples[0];
      const v = (e.clientY - y0) / Math.max(e.timeStamp - t0, 1);
      const hs = this.heights();
      const order = ['closed', 'strip', 'full'];
      let rest;
      if (Math.abs(v) >= FLICK_SPEED) {
        // On to the next resting height in the direction of the flick.
        const ahead = order.filter((k) => (v > 0 ? hs[k] > this.height + 1 : hs[k] < this.height - 1));
        rest = ahead.length ? (v > 0 ? ahead[0] : ahead.at(-1)) : v > 0 ? 'full' : 'closed';
      } else rest = order.reduce((a, b) => (Math.abs(hs[b] - this.height) < Math.abs(hs[a] - this.height) ? b : a));
      this.settle(rest);
      this.onChange(`facsimile ${rest}${Math.abs(v) >= FLICK_SPEED ? ` (flick ${v.toFixed(2)} px/ms)` : ''}`);
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  // Following the selection.

  /** The zones a measure's @facs names, their union in image pixels, and their surface. */
  zonesFor(measureId) {
    const m = measureId && this.doc?.get(measureId);
    const refs = (m?.getAttribute('facs') ?? '').split(/\s+/).filter(Boolean);
    const zones = refs.map((r) => this.doc.get(r.replace(/^#/, ''))).filter((z) => z?.localName === 'zone');
    if (!zones.length) return null;
    const surface = zones[0].closest('surface');
    const k = this.imageScale(surface);
    const num = (z, a) => Number(z.getAttribute(a) ?? 0);
    // The page image comes from the first zone's surface; zones on other surfaces are left out.
    const own = zones.filter((z) => z.closest('surface') === surface);
    const x0 = Math.min(...own.map((z) => num(z, 'ulx')));
    const y0 = Math.min(...own.map((z) => num(z, 'uly')));
    const x1 = Math.max(...own.map((z) => num(z, 'lrx')));
    const y1 = Math.max(...own.map((z) => num(z, 'lry')));
    const box = { x: (x0 - k.ox) * k.x, y: (y0 - k.oy) * k.y, w: (x1 - x0) * k.x, h: (y1 - y0) * k.y };
    return { box, surface, zones: own.map((z) => z.getAttribute('xml:id')) };
  }

  /** Surface coordinates to image pixels, from the surface's extent and its graphic's size. */
  imageScale(surface) {
    const g = surface.querySelector('graphic');
    const n = (el, a) => (el?.hasAttribute(a) ? Number(el.getAttribute(a)) : null);
    const ox = n(surface, 'ulx') ?? 0;
    const oy = n(surface, 'uly') ?? 0;
    const sw = n(surface, 'lrx') !== null ? n(surface, 'lrx') - ox : null;
    const sh = n(surface, 'lry') !== null ? n(surface, 'lry') - oy : null;
    const gw = n(g, 'width');
    const gh = n(g, 'height');
    return { ox, oy, x: sw && gw ? gw / sw : 1, y: sh && gh ? gh / sh : 1 };
  }

  /**
   * Follows the score: highlights the zones of every measure on screen (the selection's measures
   * more strongly), and frames either all of them or only the focus measure (⚙ "Facsimile fits").
   * @param {{focus: Element|undefined, onScreen: Element[], selected: Set<string>}} what
   *   rendered <g class="measure"> elements: the selection's focus measure (or the first on
   *   screen), every measure on screen, and the ids of the measures holding selected elements
   */
  follow({ focus, onScreen, selected }) {
    if (!this.available) return;
    const fz = this.zonesFor(focus?.id);
    // A measure without a zone: the view stays where it was, and nothing is highlighted.
    if (!fz) {
      this.zonesEl.replaceChildren();
      this.target = null;
      return;
    }
    // Only zones on the focus measure's page image can be shown together.
    const shown = onScreen
      .map((m) => ({ id: m.id, z: this.zonesFor(m.id) }))
      .filter((m) => m.z && m.z.surface === fz.surface);
    this.showSurface(fz.surface);
    this.highlight(shown, selected);
    const frame = this.settings.facFit === 'screen' && shown.length ? union(shown.map((m) => m.z.box)) : fz.box;
    const renderedH = measureFrame(focus)?.height ?? null;
    // Like for like: the focus measure's zone as tall as its rendered system.
    const like = renderedH ? renderedH / fz.box.h : null;
    const key = `${frame.x},${frame.y},${frame.w},${frame.h},${like},${this.settings.facFit}`;
    const same = this.target?.key === key;
    this.target = { frame, like, key };
    if (!same && this.linked) this.centre(true);
  }

  showSurface(surface) {
    if (surface === this.surface) return;
    this.surface = surface;
    const g = surface.querySelector('graphic[target]');
    this.img.src = new URL(g.getAttribute('target'), this.base).href;
    const w = g.getAttribute('width');
    const h = g.getAttribute('height');
    if (w && h) Object.assign(this.img.style, { width: `${w}px`, height: `${h}px` });
    else this.img.addEventListener('load', () => this.linked && this.centre(false), { once: true });
  }

  /** One box per zone (measures may share one); a zone of a selected measure is drawn strongly. */
  highlight(shown, selected) {
    const boxes = new Map();
    for (const m of shown) {
      const k = m.z.zones.join();
      const b = boxes.get(k) ?? { box: m.z.box, sel: false };
      b.sel ||= selected.has(m.id);
      boxes.set(k, b);
    }
    this.zonesEl.replaceChildren(
      ...[...boxes.values()].map(({ box, sel }) => {
        const r = document.createElement('div');
        r.className = sel ? 'fac-zone selected' : 'fac-zone';
        Object.assign(r.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
        return r;
      }),
    );
  }

  /**
   * Centres the view on the target frame. Fitting the measures on screen never zooms in past like
   * for like; fitting the focus measure is like for like.
   */
  centre(animate) {
    const tg = this.target;
    const vw = this.view.clientWidth;
    const vh = this.view.clientHeight;
    if (!tg || !vw || !vh) return;
    const f = tg.frame;
    let s = tg.like ?? this.t.s;
    if (this.settings.facFit === 'screen') s = Math.min(s, (vw - 12) / f.w, (vh - 8) / f.h);
    this.setTransform({ s, x: vw / 2 - (f.x + f.w / 2) * s, y: vh / 2 - (f.y + f.h / 2) * s }, animate);
  }

  /**
   * The measure under a point of the view, for a tap on the facsimile: the smallest zone on the
   * shown page image containing it, and where in that zone the point lies (0–1 across and down).
   * @returns {{measureIds: string[], fx: number, fy: number} | null}
   */
  measureAt(vx, vy) {
    if (!this.surface) return null;
    const ix = (vx - this.t.x) / this.t.s;
    const iy = (vy - this.t.y) / this.t.s;
    let best = null;
    for (const m of this.doc.doc.querySelectorAll('music measure[facs]')) {
      const id = m.getAttribute('xml:id');
      const z = this.zonesFor(id);
      if (!z || z.surface !== this.surface) continue;
      const b = z.box;
      if (ix < b.x || ix > b.x + b.w || iy < b.y || iy > b.y + b.h) continue;
      const area = b.w * b.h;
      if (best && area > best.area) continue;
      // Measures sharing a zone (expansions) are all candidates.
      if (best && area === best.area) best.measureIds.push(id);
      else best = { area, measureIds: [id], fx: (ix - b.x) / b.w, fy: (iy - b.y) / b.h };
    }
    return best;
  }

  setTransform(t, animate) {
    this.t = t;
    this.content.classList.toggle('animate', animate);
    this.content.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.s})`;
    this.content.style.setProperty('--s', String(t.s));
  }

  unlink() {
    if (!this.linked) return;
    this.linked = false;
    this.syncBtn.hidden = false;
    this.onChange('facsimile unlinked — Sync to follow the selection again');
  }

  sync() {
    this.linked = true;
    this.syncBtn.hidden = true;
    this.centre(true);
    this.onChange('facsimile follows the selection');
  }

  // Panning and zooming by hand.

  wireView() {
    const v = this.view;
    const pts = new Map();
    let g = null;
    // A tap is one finger down and up without moving, with no second finger in between.
    let multi = false;
    const local = (e) => {
      const r = v.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const start = () => {
      const ps = [...pts.values()];
      const t = { ...this.t };
      if (ps.length === 1) g = { kind: 'pan', p0: ps[0], t, moved: false };
      else if (ps.length === 2) {
        const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        g = { kind: 'pinch', d0: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, mid, t };
      } else g = null;
    };
    v.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        v.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events.
      }
      pts.set(e.pointerId, local(e));
      if (pts.size > 1) multi = true;
      start();
    });
    v.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, local(e));
      const ps = [...pts.values()];
      if (g.kind === 'pan') {
        const dx = ps[0].x - g.p0.x;
        const dy = ps[0].y - g.p0.y;
        if (!g.moved && Math.hypot(dx, dy) < PAN_SLOP_PX) return;
        g.moved = true;
        this.unlink();
        this.setTransform({ s: g.t.s, x: g.t.x + dx, y: g.t.y + dy }, false);
      } else {
        const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        const s = g.t.s * (d / g.d0);
        // Keep the image point under the starting midpoint under the current one.
        const ix = (g.mid.x - g.t.x) / g.t.s;
        const iy = (g.mid.y - g.t.y) / g.t.s;
        this.unlink();
        this.setTransform({ s, x: mid.x - ix * s, y: mid.y - iy * s }, false);
      }
    });
    const end = (e) => {
      const tap = e.type === 'pointerup' && pts.size === 1 && g?.kind === 'pan' && !g.moved && !multi;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (!pts.size) multi = false;
      start();
      if (tap && p) this.onTap(this.measureAt(p.x, p.y));
    };
    v.addEventListener('pointerup', end);
    v.addEventListener('pointercancel', end);
    v.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        const k = Math.exp(-e.deltaY * 0.002);
        const t = this.t;
        this.unlink();
        this.setTransform({ s: t.s * k, x: p.x - (p.x - t.x) * k, y: p.y - (p.y - t.y) * k }, false);
      },
      { passive: false },
    );
  }
}

/** The union of boxes. @param {Box[]} boxes @returns {Box} */
function union(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A rendered measure's staff lines in client px: from the first staff's top line to the last
 * staff's bottom line, across the measure's width.
 * @param {Element|undefined} measureEl a <g class="measure">
 */
export function measureFrame(measureEl) {
  if (!measureEl) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const staff of measureEl.querySelectorAll('g.staff')) {
    for (const line of staff.children) {
      if (line.tagName !== 'path') continue;
      const r = line.getBoundingClientRect();
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
  }
  return bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
