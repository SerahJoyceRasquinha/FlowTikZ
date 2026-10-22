import type { RasterDecoder } from '../../import/raster/decode';
import { inflate } from '../../import/binary';

/**
 * A minimal PNG decoder for tests (8-bit, non-interlaced, colour types
 * 0/2/4/6), so the Node test run can exercise the real background analysis on
 * the real fixture images without a canvas.
 */

function u32(b: Uint8Array, o: number) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

export async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  let o = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let depth = 0;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported by the test decoder');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error('only 8-bit PNG supported by the test decoder');
  const total = idat.reduce((n, a) => n + a.length, 0);
  const joined = new Uint8Array(total);
  let p = 0;
  for (const a of idat) {
    joined.set(a, p);
    p += a.length;
  }
  const raw = await inflate(joined, 'deflate');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6];
  if (!channels) throw new Error('unsupported colour type');
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const s = x * channels;
      if (channels === 1 || channels === 2) {
        out[i] = out[i + 1] = out[i + 2] = cur[s];
        out[i + 3] = channels === 2 ? cur[s + 1] : 255;
      } else {
        out[i] = cur[s];
        out[i + 1] = cur[s + 1];
        out[i + 2] = cur[s + 2];
        out[i + 3] = channels === 4 ? cur[s + 3] : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

export const testDecoder: RasterDecoder = {
  async decode(bytes, mime) {
    if (mime !== 'image/png') return null;
    const img = await decodePng(bytes);
    return { ...img, scale: 1 };
  },
};
