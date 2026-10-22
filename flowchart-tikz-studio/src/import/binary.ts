import type { RasterType } from './types';

/**
 * Byte-level helpers shared by the detector and the importers. No DOM: every
 * function here works in a Worker and in Node.
 */

export function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

export function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < Math.min(bytes.length, start + len); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Magic-number identification of raster formats. */
export function sniffRaster(bytes: Uint8Array): RasterType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length > 26) return 'bmp';
  if (ascii(bytes, 4, 4) === 'ftyp' && /avif|avis/.test(ascii(bytes, 8, 4))) return 'avif';
  if (startsWith(bytes, [0, 0, 1, 0]) && bytes.length > 22) return 'ico';
  return null;
}

export const RASTER_MIME: Record<RasterType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}
function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function i32le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}
function u24le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

/**
 * Pixel dimensions read from the file header, without decoding the image.
 * Used to reject decompression bombs before anything allocates a bitmap, and
 * as the fallback when no decoder is available.
 */
export function rasterDimensions(bytes: Uint8Array, type: RasterType): { width: number; height: number } | null {
  try {
    switch (type) {
      case 'png':
        if (ascii(bytes, 12, 4) !== 'IHDR') return null;
        return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
      case 'gif':
        return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
      case 'bmp': {
        const w = i32le(bytes, 18);
        const h = i32le(bytes, 22);
        return { width: Math.abs(w), height: Math.abs(h) };
      }
      case 'webp': {
        const chunk = ascii(bytes, 12, 4);
        if (chunk === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
        if (chunk === 'VP8 ') return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
        if (chunk === 'VP8L') {
          const b0 = bytes[21];
          const b1 = bytes[22];
          const b2 = bytes[23];
          const b3 = bytes[24];
          return {
            width: 1 + (((b1 & 0x3f) << 8) | b0),
            height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
          };
        }
        return null;
      }
      case 'jpeg': {
        let o = 2;
        while (o + 9 < bytes.length) {
          if (bytes[o] !== 0xff) {
            o++;
            continue;
          }
          const marker = bytes[o + 1];
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            o += 2;
            continue;
          }
          const len = u16be(bytes, o + 2);
          // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: u16be(bytes, o + 5), width: u16be(bytes, o + 7) };
          }
          o += 2 + len;
        }
        return null;
      }
      case 'ico': {
        const w = bytes[6] || 256;
        const h = bytes[7] || 256;
        return { width: w, height: h };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- base64 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ---------------------------------------------------------- compression */

/**
 * Raw DEFLATE decompression through the platform's `DecompressionStream`
 * (browsers, workers and Node 18+). No bundled inflater is needed.
 */
export async function inflate(bytes: Uint8Array, format: 'deflate-raw' | 'deflate' = 'deflate-raw', maxBytes = 50 * 1024 * 1024): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the file (DecompressionStream is unavailable).');
  }
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // A compression bomb is stopped here rather than allowed to fill memory.
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('The compressed content expands beyond the import size limit.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/* ------------------------------------------------------ PNG text chunks */

/**
 * Text chunks of a PNG (tEXt, zTXt, iTXt). draw.io stores the full diagram in
 * one of these when it exports a PNG, which lets such a PNG be imported
 * losslessly without any image analysis at all.
 */
export async function pngTextChunks(bytes: Uint8Array): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (sniffRaster(bytes) !== 'png') return out;
  let o = 8;
  let guard = 0;
  while (o + 12 <= bytes.length && guard++ < 10_000) {
    const len = u32be(bytes, o);
    const type = ascii(bytes, o + 4, 4);
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (o + 12 + len > bytes.length) break;
    try {
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        if (z > 0) out[ascii(data, 0, z)] = latin1(data.subarray(z + 1));
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        if (z > 0) {
          const inflated = await inflate(data.subarray(z + 2), 'deflate');
          out[ascii(data, 0, z)] = latin1(inflated);
        }
      } else if (type === 'iTXt') {
        const z = data.indexOf(0);
        if (z > 0) {
          const key = ascii(data, 0, z);
          const compressed = data[z + 1] === 1;
          let p = z + 3;
          p = data.indexOf(0, p) + 1; // language tag
          p = data.indexOf(0, p) + 1; // translated keyword
          const payload = data.subarray(p);
          out[key] = utf8Decode(compressed ? await inflate(payload, 'deflate') : payload);
        }
      } else if (type === 'IEND') {
        break;
      }
    } catch {
      // A damaged text chunk is not a reason to reject the image.
    }
    o += 12 + len;
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
