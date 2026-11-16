// Generates the app icons in public/ with no dependencies:
//   node scripts/make-icons.mjs
// Design: a sage ring (partly drained, like the timer dial) around a small clay
// dot, on warm sand. Colors match the light-mode tokens in src/style.css.
// The artwork stays inside the central 80% so it survives "maskable" cropping.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SAND = [0xf3, 0xee, 0xe6];
const SAGE = [0x7f, 0x94, 0x79];
const CLAY = [0xc0, 0x8a, 0x6c];

// Geometry in units of the icon size (0..1), centered at 0.5, 0.5.
const R = 0.3;          // ring radius
const STROKE = 0.055;   // ring thickness
const DOT = 0.06;       // center dot radius
const ARC_DEG = 290;    // how much of the ring is drawn, clockwise from 12 o'clock
const START = -Math.PI / 2;
const END = START + (ARC_DEG * Math.PI) / 180;

/** Signed distance (in icon units) from a point to the ring arc's stroke edge. */
function ringDistance(x, y) {
  let a = Math.atan2(y, x);
  while (a < START) a += 2 * Math.PI;
  if (a <= END) return Math.abs(Math.hypot(x, y) - R) - STROKE / 2;
  // Outside the arc: distance to the round end caps.
  const caps = [START, END].map((t) => Math.hypot(x - R * Math.cos(t), y - R * Math.sin(t)));
  return Math.min(...caps) - STROKE / 2;
}

function render(size) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size - 0.5;
      const y = (py + 0.5) / size - 0.5;
      let color = [...SAND];
      // Anti-aliased coverage: ~1px soft edge.
      for (const [dist, fill] of [
        [ringDistance(x, y), SAGE],
        [Math.hypot(x, y) - DOT, CLAY],
      ]) {
        const cover = Math.min(1, Math.max(0, 0.5 - dist * size));
        color = color.map((c, i) => c + (fill[i] - c) * cover);
      }
      rgb.set(color.map(Math.round), (py * size + px) * 3);
    }
  }
  return encodePng(size, rgb);
}

function encodePng(size, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const p = (t) => [50 + 100 * R * Math.cos(t), 50 + 100 * R * Math.sin(t)].map((v) => v.toFixed(2)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${hex(SAND)}"/>
  <path d="M ${p(START)} A ${100 * R} ${100 * R} 0 1 1 ${p(END)}" fill="none" stroke="${hex(SAGE)}" stroke-width="${100 * STROKE}" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="${100 * DOT}" fill="${hex(CLAY)}"/>
</svg>
`;
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/apple-touch-icon.png', render(180));
writeFileSync('public/icons/icon-192.png', render(192));
writeFileSync('public/icons/icon-512.png', render(512));
writeFileSync('public/favicon.svg', svg());
console.log('Wrote public/icons/*.png and public/favicon.svg');
