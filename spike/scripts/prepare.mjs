// The About page is the repository's README, rendered here, so the two can never drift apart.
// Stages the fixtures into public/fixtures/ with their folder structure intact, so MEI files and the
// facsimile images they reference by relative path stay side by side in dev and in the build.
// Also writes the app icons. Run by the predev and prebuild hooks.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(spike, '..');
const out = join(spike, 'public');

rmSync(join(out, 'fixtures'), { recursive: true, force: true });
const copy = (from, to) => cpSync(from, join(out, 'fixtures', to), { recursive: true });
copy(join(spike, 'fixtures'), '.');
copy(join(repo, 'fixtures/demo'), 'demo');
copy(join(repo, 'fixtures/le/la-espero/img'), 'le/la-espero/img');
for (const f of ['score@1dd5630.mei', 'score@ec3585b.mei']) {
  copy(join(repo, 'fixtures/le/la-espero/piece-01', f), `le/la-espero/piece-01/${f}`);
}

// Icons: a dark rounded square with a light stem-and-notehead mark, drawn per pixel.
function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : size * 0.06;
  const r = maskable ? 0 : size * 0.2;
  const inRound = (x, y) => {
    const a = pad, b = size - pad;
    if (x < a || x >= b || y < a || y >= b) return false;
    const cx = Math.min(Math.max(x, a + r), b - r);
    const cy = Math.min(Math.max(y, a + r), b - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const s = size;
  const head = (x, y) => {
    // tilted ellipse
    const dx = x - s * 0.42, dy = y - s * 0.68;
    const c = Math.cos(-0.45), sn = Math.sin(-0.45);
    const u = dx * c - dy * sn, v = dx * sn + dy * c;
    return (u / (s * 0.17)) ** 2 + (v / (s * 0.115)) ** 2 <= 1;
  };
  const stem = (x, y) => x >= s * 0.55 && x <= s * 0.595 && y >= s * 0.2 && y <= s * 0.68;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      if (!inRound(x, y)) continue;
      const ink = head(x, y) || stem(x, y);
      px[i] = ink ? 240 : 28;
      px[i + 1] = ink ? 240 : 34;
      px[i + 2] = ink ? 235 : 48;
      px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) px.copy(raw, y * (s * 4 + 1) + 1, y * s * 4, (y + 1) * s * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), png(192, false));
writeFileSync(join(out, 'icon-512.png'), png(512, false));
writeFileSync(join(out, 'icon-maskable-512.png'), png(512, true));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180, true));

// About page: ../README.md rendered to a self-contained page (offline-safe, precached like the rest).
// Links to files in the repository point at GitHub, since only the app is published.
const REPO = 'https://github.com/lets-encode/simple-editor';
const html = marked
  .parse(readFileSync(join(repo, 'README.md'), 'utf8'))
  .replace(/href="(?![a-z]+:|#)([^"]+)"/g, (_, path) => {
    const p = path.replace(/^\.\//, '');
    return `href="${REPO}/${p.endsWith('/') ? 'tree' : 'blob'}/main/${p}"`;
  })
  .replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener" href="$1');
cpSync(join(repo, 'simple-editor.svg'), join(out, 'simple-editor.svg'));
writeFileSync(
  join(out, 'about.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1c2230">
<title>About the simple editor prototype</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1a17; --bg: #fff; --quiet: #5c5a55; --edge: #d8d6d0; --code: #f2f1ee; --link: #0b57d0; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #ecebe7; --bg: #16181d; --quiet: #a3a199; --edge: #3a3d45; --code: #23262d; --link: #8ab4f8; }
  }
  body { margin: 0 auto; max-width: 42rem; padding: 16px 16px 48px; font: 16px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  h1 { font-size: 1.6rem; margin: 1.4rem 0 .6rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
  a { color: var(--link); }
  blockquote { margin: 1rem 0; padding: .1rem 1rem; border-left: 4px solid var(--edge); color: var(--quiet); }
  code, pre { background: var(--code); border-radius: 4px; font-size: .9em; }
  code { padding: .1em .3em; }
  pre { padding: .6rem .8rem; overflow-x: auto; }
  pre code { padding: 0; }
  li { margin: .25rem 0; }
  /* The logo's ink is dark: give it a light plate so it reads in dark mode too. */
  p[align] { text-align: center; }
  p[align] img { max-width: 100%; height: auto; background: #fff; padding: 10px 14px; border-radius: 8px; box-sizing: border-box; }
  .back { font-size: .9rem; color: var(--quiet); }
</style>
</head>
<body>
<p class="back">Generated from the repository's README.</p>
${html}
</body>
</html>
`,
);
