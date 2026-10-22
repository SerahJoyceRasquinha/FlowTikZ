import { SUPPORTED_EXTENSIONS, extensionOf } from './detector';
import { ImportError, ImportFormat } from './types';

/**
 * Up-front file checks, run before a single byte is parsed.
 *
 * Size limits are per format family: a raster is decoded (and downscaled)
 * for the offline recogniser, vector and XML sources are parsed in memory.
 */

export const MB = 1024 * 1024;

export const SIZE_LIMITS: Record<ImportFormat, number> = {
  raster: 25 * MB,
  svg: 10 * MB,
  drawio: 20 * MB,
  excalidraw: 20 * MB,
  'studio-json': 20 * MB,
  'ir-json': 10 * MB,
};

/** Any file larger than this is refused before it is even read. */
export const ABSOLUTE_MAX_BYTES = 25 * MB;

/** Largest raster we will decode, in pixels (guards against decompression bombs). */
export const MAX_RASTER_PIXELS = 60_000_000;
export const MAX_RASTER_EDGE = 20_000;

const MIME_OK = /^(image\/|text\/|application\/(json|xml|octet-stream|vnd\.jgraph)|$)/;

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Cheap checks on name, size and declared MIME type. Throws ImportError. */
export function validateFileMeta(file: FileLike): void {
  if (!file || typeof file.name !== 'string') {
    throw new ImportError('read-failed');
  }
  const ext = extensionOf(file.name);
  if (ext && !SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ImportError(
      'unsupported-format',
      `Unsupported file format (.${ext}).`,
    );
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new ImportError('invalid-file', 'The selected file is empty.');
  }
  if (file.size > ABSOLUTE_MAX_BYTES) {
    throw new ImportError(
      'file-too-large',
      `File is too large (${formatBytes(file.size)}; the limit is ${formatBytes(ABSOLUTE_MAX_BYTES)}).`,
    );
  }
  if (file.type && !MIME_OK.test(file.type)) {
    throw new ImportError('unsupported-format', `Unsupported file format (${file.type}).`);
  }
}

/** Per-format size limit, applied once the content has been identified. */
export function validateSizeForFormat(size: number, format: ImportFormat): void {
  const limit = SIZE_LIMITS[format];
  if (size > limit) {
    throw new ImportError(
      'file-too-large',
      `File is too large (${formatBytes(size)}; the limit for this format is ${formatBytes(limit)}).`,
    );
  }
}

export function validateRasterDimensions(dim: { width: number; height: number } | null): void {
  if (!dim) return;
  const { width, height } = dim;
  if (!(width > 0) || !(height > 0)) {
    throw new ImportError('invalid-file', 'The image reports an invalid size.');
  }
  if (width > MAX_RASTER_EDGE || height > MAX_RASTER_EDGE || width * height > MAX_RASTER_PIXELS) {
    throw new ImportError(
      'file-too-large',
      `The image is too large to analyse (${width} × ${height} px). Crop or downscale it below ${MAX_RASTER_EDGE} px per side.`,
    );
  }
}
