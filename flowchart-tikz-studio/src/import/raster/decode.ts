/**
 * Raster decoding, behind an interface so the
 * pipeline can run in a Worker (OffscreenCanvas), on the main thread (a
 * detached <canvas>), or under test with an injected decoder.
 */

export interface DecodedImage {
  /** RGBA pixels at `width` x `height` (possibly downscaled from the source). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** decoded px per source px (<= 1). */
  scale: number;
}

export interface RasterDecoder {
  /** Decode, downscaling so the longest edge is at most `maxEdge`. Null if unsupported here. */
  decode(bytes: Uint8Array, mime: string, maxEdge: number): Promise<DecodedImage | null>;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/** The platform decoder: createImageBitmap + canvas. Works in workers. */
export const platformDecoder: RasterDecoder = {
  async decode(bytes, mime, maxEdge) {
    if (typeof createImageBitmap === 'undefined') return null;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    } catch {
      return null;
    }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const img = ctx.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h, scale };
  },
};
