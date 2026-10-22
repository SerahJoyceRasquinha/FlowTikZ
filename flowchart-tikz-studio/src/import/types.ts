import type { Diagram, Rect } from '../model/types';
import type { IRDiagram } from './ir/types';
import type { ImportReport } from './report';

/**
 * Public contracts of the import subsystem.
 *
 * Kept free of React and of the DOM so the whole pipeline can run inside a Web
 * Worker, in the main thread as a fallback, and under test in plain Node.
 */

/** What a file turned out to be, after looking at its bytes and not just its name. */
export type ImportFormat =
  | 'raster'
  | 'svg'
  | 'drawio'
  | 'excalidraw'
  | 'studio-json'
  | 'ir-json';

export type RasterType = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'avif' | 'ico';

export interface DetectedFormat {
  format: ImportFormat;
  /** Human-readable name, e.g. "PNG image" or "draw.io diagram". */
  label: string;
  raster?: RasterType;
  /** MIME type derived from the content. */
  mime: string;
  /**
   * For images and SVGs exported by draw.io, the embedded source diagram.
   * When present it is used instead of the pixels or the vector paths, since
   * it is strictly more faithful.
   */
  embeddedDrawio?: string;
}

export type ImportErrorCode =
  | 'unsupported-format'
  | 'file-too-large'
  | 'read-failed'
  | 'invalid-file'
  | 'no-diagram'
  | 'recognition-failed'
  | 'cancelled'
  | 'internal';

/** Default wording for each failure; specific callers may be more precise. */
export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  'unsupported-format': 'Unsupported file format.',
  'file-too-large': 'File is too large.',
  'read-failed': 'Could not read the selected file.',
  'invalid-file': 'The file is damaged or not in the format its name suggests.',
  'no-diagram': 'Could not identify a valid diagram.',
  'recognition-failed': 'The image could not be converted.',
  cancelled: 'Import cancelled.',
  internal: 'The import failed unexpectedly.',
};

/**
 * A failure the user should see. `message` is written for people; `detail`
 * carries diagnostic context for the report's "details" disclosure and is
 * never a stack trace.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly detail?: string;

  constructor(
    code: ImportErrorCode,
    message?: string,
    opts: { detail?: string } = {},
  ) {
    super(message ?? IMPORT_ERROR_MESSAGES[code]);
    this.name = 'ImportError';
    this.code = code;
    this.detail = opts.detail;
  }
}

/** Plain-object form of an ImportError, for crossing the worker boundary. */
export interface SerializedImportError {
  code: ImportErrorCode;
  message: string;
  detail?: string;
}

export function serializeError(err: unknown): SerializedImportError {
  if (err instanceof ImportError) {
    return {
      code: err.code,
      message: err.message,
      detail: err.detail,
    };
  }
  if (isAbortError(err)) {
    return { code: 'cancelled', message: IMPORT_ERROR_MESSAGES.cancelled };
  }
  return {
    code: 'internal',
    message: IMPORT_ERROR_MESSAGES.internal,
    // The message only - never the stack.
    detail: err instanceof Error ? err.message : undefined,
  };
}

export function reviveError(e: SerializedImportError): ImportError {
  return new ImportError(e.code, e.message, { detail: e.detail });
}

export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    ((err as { name?: string }).name === 'AbortError' ||
      (err instanceof ImportError && err.code === 'cancelled'))
  );
}

/* ------------------------------------------------------------- progress */

export type ImportStage =
  | 'read'
  | 'detect'
  | 'decode'
  | 'background'
  | 'analyze'
  | 'extract'
  | 'svg'
  | 'sanitize'
  | 'convert'
  | 'latex'
  | 'finalize';

export const STAGE_LABELS: Record<ImportStage, string> = {
  read: 'Reading file…',
  detect: 'Detecting format…',
  decode: 'Decoding image…',
  background: 'Removing background…',
  analyze: 'Analyzing diagram…',
  extract: 'Extracting objects…',
  svg: 'Generating SVG…',
  sanitize: 'Validating and sanitising…',
  convert: 'Converting to editable diagram…',
  latex: 'Generating LaTeX…',
  finalize: 'Finalizing…',
};

export type ProgressEvent =
  /** The stages this particular import will go through, announced once. */
  | { type: 'plan'; stages: ImportStage[] }
  | { type: 'stage'; stage: ImportStage; detail?: string }
  /** Free-text detail within the current stage (e.g. "Reading text"). */
  | { type: 'note'; detail: string };

export type ProgressListener = (e: ProgressEvent) => void;

/* --------------------------------------------------------------- result */

/** Where the source image sits in diagram units, for the comparison overlay. */
export interface ReferencePlacement {
  /** Source pixels -> diagram units. */
  scale: number;
  /** Diagram-space position of the source image's top-left corner. */
  offsetX: number;
  offsetY: number;
  /** Source image size in pixels. */
  width: number;
  height: number;
}

export interface ImportResult {
  diagram: Diagram;
  report: ImportReport;
  detected: DetectedFormat;
  /** The normalised intermediate representation the diagram was built from. */
  ir: IRDiagram;
  /** Deterministic SVG reconstruction, for image imports (debug / download). */
  svg?: string;
  /** Placement of the source image, for image imports. */
  reference?: ReferencePlacement;
  /** Content bounds of the imported diagram in diagram units. */
  bounds: Rect;
}

export type ImportMode = 'replace' | 'insert' | 'new';

