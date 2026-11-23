// A small JPEG encoder, so the galaxy's glow can be stored as a picture inside the SVG
// without installing anything. Takes plain RGB bytes, returns the bytes of a .jpg file.
// Width and height must be multiples of 16.

// The order in which the 64 numbers of a block are stored: low detail first, fine detail last.
const ZIGZAG = [];
for (let s = 0; s < 15; s++) {
  const diag = [];
  for (let y = 0; y <= s; y++) if (y < 8 && s - y < 8) diag.push(y * 8 + s - y);
  ZIGZAG.push(...(s % 2 ? diag : diag.reverse()));
}

// How coarsely each of the 64 numbers is rounded (bigger = rounder = smaller file).
// One table for brightness, one for color. These are the usual starting tables.
const Q_LIGHT = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_COLOR = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...Array(32).fill(99)];

const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => (u ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));

// Shortest codes for the most common values, never longer than 16 bits.
function codeTable(freq) {
  const f = new Float64Array(257), size = new Int32Array(257), next = new Int32Array(257).fill(-1);
  f.set(freq); f[256] = 1; // one spare entry, so no real code is made of ones only
  for (;;) {
    let a = -1, b = -1, low = Infinity;
    for (let i = 0; i <= 256; i++) if (f[i] && f[i] <= low) { low = f[i]; a = i; }
    low = Infinity;
    for (let i = 0; i <= 256; i++) if (f[i] && f[i] <= low && i !== a) { low = f[i]; b = i; }
    if (b < 0) break;
    f[a] += f[b]; f[b] = 0;
    for (size[a]++; next[a] >= 0;) { a = next[a]; size[a]++; }
    next[a] = b;
    for (size[b]++; next[b] >= 0;) { b = next[b]; size[b]++; }
  }
  const counts = new Int32Array(40);
  for (let i = 0; i <= 256; i++) if (size[i]) counts[size[i]]++;
  for (let i = 39; i > 16; i--) {
    while (counts[i] > 0) {
      let j = i - 2;
      while (!counts[j]) j--;
      counts[i] -= 2; counts[i - 1]++; counts[j + 1] += 2; counts[j]--;
    }
  }
  let last = 16;
  while (!counts[last]) last--;
  counts[last]--; // drop the spare entry
  const values = [];
  for (let len = 1; len < 40; len++) for (let s = 0; s < 256; s++) if (size[s] === len) values.push(s);
  const code = new Int32Array(256), bits = new Int32Array(256);
  for (let len = 1, c = 0, k = 0; len <= 16; len++, c <<= 1) for (let i = 0; i < counts[len]; i++, k++) { code[values[k]] = c++; bits[values[k]] = len; }
  return { counts: [...counts.slice(1, 17)], values, code, bits };
}

export function encodeJPEG(rgb, width, height, quality = 80) {
  if (width % 16 || height % 16) throw new Error('JPEG size must be a multiple of 16');
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const table = (base) => base.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  const QT = [table(Q_LIGHT), table(Q_COLOR)];
  // Pure black must come back as exactly black, so the picture's edge can't show against the sky.
  // That needs the brightness table's first entry to divide 1024 evenly.
  QT[0][0] = 2 ** Math.round(Math.log2(Math.min(16, QT[0][0])));

  // Brightness at full size; the two color channels at half size, which the eye doesn't notice.
  const cw = width / 2, ch = height / 2;
  const Y = new Float32Array(width * height), Cb = new Float32Array(cw * ch), Cr = new Float32Array(cw * ch);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2], c = (y >> 1) * cw + (x >> 1);
      Y[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      Cb[c] += (-0.168736 * r - 0.331264 * g + 0.5 * b) / 4;
      Cr[c] += (0.5 * r - 0.418688 * g - 0.081312 * b) / 4;
    }
  }

  // Turn every 8x8 block into its 64 rounded numbers, and note down what has to be written.
  const tokTable = [], tokSymbol = [], tokExtra = [], tokBits = [];
  const freq = [0, 1, 2, 3].map(() => new Float64Array(256));
  const push = (t, symbol, extra, nbits) => { tokTable.push(t); tokSymbol.push(symbol); tokExtra.push(extra); tokBits.push(nbits); freq[t][symbol]++; };
  const tmp = new Float64Array(64), out = new Float64Array(64), q = new Int32Array(64), prev = [0, 0, 0];
  function block(plane, stride, bx, by, comp) {
    const qt = QT[comp ? 1 : 0], t = comp ? 2 : 0;
    for (let y = 0; y < 8; y++) {
      const row = (by * 8 + y) * stride + bx * 8;
      for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += plane[row + x] * COS[u][x]; tmp[y * 8 + u] = s; }
    }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v][y]; out[v * 8 + u] = s; }
    for (let i = 0; i < 64; i++) q[i] = Math.round(out[ZIGZAG[i]] / qt[ZIGZAG[i]]);
    const size = (v) => 32 - Math.clz32(Math.abs(v)), extra = (v, s) => (v < 0 ? v + (1 << s) - 1 : v);
    const diff = q[0] - prev[comp]; prev[comp] = q[0];
    push(t, size(diff), extra(diff, size(diff)), size(diff));
    let run = 0;
    for (let i = 1; i < 64; i++) {
      if (!q[i]) { run++; continue; }
      for (; run > 15; run -= 16) push(t + 1, 0xf0, 0, 0);
      const s = size(q[i]);
      push(t + 1, (run << 4) | s, extra(q[i], s), s);
      run = 0;
    }
    if (run) push(t + 1, 0, 0, 0);
  }
  for (let my = 0; my < height / 16; my++) {
    for (let mx = 0; mx < width / 16; mx++) {
      for (let k = 0; k < 4; k++) block(Y, width, mx * 2 + (k & 1), my * 2 + (k >> 1), 0);
      block(Cb, cw, mx, my, 1);
      block(Cr, cw, mx, my, 2);
    }
  }

  // Write the file.
  const tables = freq.map(codeTable), bytes = [];
  const u16 = (v) => bytes.push(v >> 8, v & 255);
  const section = (marker, body) => { bytes.push(0xff, marker); u16(body.length + 2); bytes.push(...body); };
  bytes.push(0xff, 0xd8);
  section(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  QT.forEach((qt, i) => section(0xdb, [i, ...ZIGZAG.map((z) => qt[z])]));
  section(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  tables.forEach((t, i) => section(0xc4, [((i & 1) << 4) | (i >> 1), ...t.counts, ...t.values]));
  section(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  let acc = 0, filled = 0;
  const write = (value, nbits) => {
    for (let i = nbits - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1);
      if (++filled === 8) { bytes.push(acc); if (acc === 0xff) bytes.push(0); acc = 0; filled = 0; }
    }
  };
  for (let i = 0; i < tokTable.length; i++) {
    const t = tables[tokTable[i]];
    write(t.code[tokSymbol[i]], t.bits[tokSymbol[i]]);
    if (tokBits[i]) write(tokExtra[i], tokBits[i]);
  }
  if (filled) write(0xff, 8 - filled);
  bytes.push(0xff, 0xd9);
  return Buffer.from(bytes);
}
