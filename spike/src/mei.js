// The MEI DOM is the source of truth; Verovio only renders a serialisation of it.

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export class MeiDoc {
  /** @param {string} text */
  constructor(text) {
    this.doc = new DOMParser().parseFromString(text, 'application/xml');
    if (this.doc.querySelector('parsererror')) throw new Error('Not well-formed XML');
    /** @type {Map<string, Element>} */
    this.byId = new Map();
    this.ephemeral = 0;
    /** incremented on every edit, so caches built from the DOM (the time index) know they are stale */
    this.version = 0;
    /** called after every edit; the app uses it to keep the edited copy */
    this.onChanged = null;
    // A saved copy carries its ephemeral ids; new ones must not collide with them.
    for (const m of text.matchAll(/xml:id="eph-[A-Za-z0-9]+-(\d+)"/g)) this.ephemeral = Math.max(this.ephemeral, +m[1]);
    this.assignIds();
  }

  /**
   * Gives every element inside <music> without an xml:id an ephemeral one, so each rendered SVG
   * element maps to exactly one DOM node (Verovio would otherwise invent new ids on every load).
   */
  assignIds() {
    const music = this.doc.querySelector('music') ?? this.doc.documentElement;
    for (const el of [music, ...music.querySelectorAll('*')]) {
      let id = el.getAttributeNS(XML_NS, 'id');
      if (!id) {
        id = `eph-${el.localName}-${++this.ephemeral}`;
        el.setAttributeNS(XML_NS, 'xml:id', id);
      }
      this.byId.set(id, el);
    }
  }

  /** Ids of the measures in <music>, in document order (header incipits are not music). */
  measureIds() {
    const music = this.doc.querySelector('music');
    return music ? [...music.querySelectorAll('measure')].map((m) => m.getAttributeNS(XML_NS, 'id')) : [];
  }

  /** Gives a new element an ephemeral id and indexes it. */
  register(el) {
    const id = `eph-${el.localName}-${++this.ephemeral}`;
    el.setAttributeNS(XML_NS, 'xml:id', id);
    this.byId.set(id, el);
    return id;
  }

  /** Marks the DOM as edited. */
  changed() {
    this.version++;
    this.onChanged?.();
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  serialize() {
    return new XMLSerializer().serializeToString(this.doc);
  }
}
