// Stages the fixtures into public/fixtures/ with their folder structure intact, so MEI files and the
// facsimile images they reference by relative path stay side by side in dev and in the build.
// Also writes the app icons. Run by the predev and prebuild hooks.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
