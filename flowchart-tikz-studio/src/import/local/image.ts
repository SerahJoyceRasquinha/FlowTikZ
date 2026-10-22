/**
 * Pixel-level helpers for the offline recogniser.
 *
 * Everything works on flat typed arrays indexed `y * width + x`, so it runs
 * the same in a Web Worker, on the main thread and under Node.
 */

export interface RGBImage {
  width: number;
  height: number;
  /** 3 bytes per pixel, alpha already composited. */
  rgb: Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  /** Inclusive. */
  x1: number;
  y1: number;
}

export const boxW = (b: Box) => b.x1 - b.x0 + 1;
export const boxH = (b: Box) => b.y1 - b.y0 + 1;

/** Composite RGBA over `matte` (the page colour) into packed RGB. */
export function toRGB(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, matte: [number, number, number]): RGBImage {
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + matte[c] * (1 - a));
  }
  return { width, height, rgb };
}

export function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function dist3(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function pixelDist(img: RGBImage, i: number, c: readonly number[]): number {
  const o = i * 3;
  return dist3(img.rgb[o], img.rgb[o + 1], img.rgb[o + 2], c[0], c[1], c[2]);
}

/**
 * Distance of colour `p` from the straight line between colours `a` and `b`
 * in RGB space, and where along it (0 at a, 1 at b). Anti-aliased edge pixels
 * are mixtures of the two colours they separate, so they sit on that line.
 */
export function mixDistance(p: readonly number[], a: readonly number[], b: readonly number[]): { d: number; t: number } {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  const q = [a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1], a[2] + ab[2] * t - p[2]];
  return { d: Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]), t };
}

/** Binary PGM (P5): the simplest format Tesseract's image reader accepts. */
export function encodePGM(gray: Uint8Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + gray.length);
  out.set(header, 0);
  out.set(gray, header.length);
  return out;
}

/** Bilinear resize of a greyscale image. */
export function resizeGray(src: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(h - 1, Math.floor(fy));
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(w - 1, Math.floor(fx));
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx;
      const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx;
      out[y * nw + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}
