// Hand-drawn control-bar pictures: a note on a two-line staff fragment.

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINES = [18, 26];
const POS = { between: 22, bottom: 26, top: 18 };

/**
 * @param {{dur: 2|4|8|16, pos?: 'between'|'bottom'|'top'}} spec
 * @returns {SVGSVGElement}
 */
export function noteIcon({ dur, pos = 'between' }) {
  const cx = 11;
  const cy = POS[pos];
  const stemX = cx + 4.1;
  const top = cy - 15;
  const flag = (y) => `<path d="M${stemX} ${y} c0.5 3 5.2 4 4.6 8.4" />`;
  const flags = dur >= 8 ? flag(top) + (dur >= 16 ? flag(top + 4) : '') : '';
  const head =
    dur <= 2
      ? `<ellipse cx="${cx}" cy="${cy}" rx="4.1" ry="2.8" transform="rotate(-20 ${cx} ${cy})" fill="none" stroke-width="1.6" />`
      : `<ellipse cx="${cx}" cy="${cy}" rx="4.4" ry="3.1" transform="rotate(-20 ${cx} ${cy})" stroke="none" />`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 26 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('note-icon');
  svg.innerHTML = `
    <g stroke="currentColor" fill="currentColor" stroke-linecap="round">
      ${LINES.map((y) => `<line x1="1" x2="25" y1="${y}" y2="${y}" stroke-width="1" opacity="0.7" />`).join('')}
      ${head}
      <line x1="${stemX}" x2="${stemX}" y1="${cy - 0.8}" y2="${top}" stroke-width="1.3" />
      <g fill="none" stroke-width="1.6">${flags}</g>
    </g>`;
  return svg;
}

