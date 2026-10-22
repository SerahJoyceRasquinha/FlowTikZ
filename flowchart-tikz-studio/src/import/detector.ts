import { RASTER_MIME, ascii, pngTextChunks, sniffRaster, utf8Decode } from './binary';
import { decodeEntities } from './xml/parser';
import { DetectedFormat, ImportError } from './types';

/**
 * File-type detection.
 *
 * The decision is made from the file's *content*. The extension and the MIME
 * type the browser reports are only hints: a PNG renamed to .jpg is still a
 * PNG, and a draw.io file saved as .xml is still a draw.io file. When the
 * content contradicts a supported extension outright the file is rejected
 * rather than guessed at.
 */

const TEXT_SNIFF_BYTES = 64 * 1024;

const RASTER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'dib', 'avif', 'ico'];
const VECTOR_EXTENSIONS = ['svg'];
const DIAGRAM_EXTENSIONS = ['drawio', 'dio', 'xml', 'excalidraw', 'json'];

export const SUPPORTED_EXTENSIONS = [...RASTER_EXTENSIONS, ...VECTOR_EXTENSIONS, ...DIAGRAM_EXTENSIONS];

/** Value for the file picker's `accept` attribute. */
export const IMPORT_ACCEPT = [
  ...SUPPORTED_EXTENSIONS.map((e) => `.${e}`),
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
  'application/xml',
  'text/xml',
  'application/json',
].join(',');

/** Human-readable list for the UI. */
export const SUPPORTED_SUMMARY =
  'PNG, JPG, WEBP, BMP, GIF, AVIF images · SVG · draw.io / diagrams.net (.drawio, .xml, draw.io SVG/PNG) · Excalidraw · Flowchart Studio JSON';

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / n < 0.02;
}

/** Pull the draw.io source out of an SVG exported by draw.io, if it is there. */
export function embeddedDrawioFromSvg(svgHead: string): string | undefined {
  const m = /<svg\b[^>]*?\scontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(svgHead);
  if (!m) return undefined;
  const raw = decodeEntities(m[2] ?? m[3] ?? '');
  return /<mxfile\b|<mxGraphModel\b/.test(raw) ? raw : undefined;
}

function decodePngPayload(v: string): string {
  const t = v.trim();
  if (t.startsWith('%3C') || t.startsWith('%3c')) {
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }
  return t;
}

export interface DetectInput {
  name: string;
  /** MIME type as reported by the browser; may be empty or wrong. */
  mime?: string;
  bytes: Uint8Array;
}

export async function detectFormat(input: DetectInput): Promise<DetectedFormat> {
  const { bytes, name } = input;
  const ext = extensionOf(name);
  if (bytes.length === 0) throw new ImportError('invalid-file', 'The selected file is empty.');

  /* ---------------------------------------------------------- raster */
  const raster = sniffRaster(bytes);
  if (raster) {
    const detected: DetectedFormat = {
      format: 'raster',
      raster,
      mime: RASTER_MIME[raster],
      label: `${raster === 'jpeg' ? 'JPEG' : raster.toUpperCase()} image`,
    };
    if (raster === 'png') {
      const chunks = await pngTextChunks(bytes);
      const payload = chunks.mxfile ?? chunks.mxGraphModel;
      if (payload) {
        const xml = decodePngPayload(payload);
        if (/<mxfile\b|<mxGraphModel\b/.test(xml)) {
          detected.embeddedDrawio = xml;
          detected.label = 'PNG exported from draw.io (editable source embedded)';
        }
      }
    }
    return detected;
  }

  if (!looksLikeText(bytes)) {
    if (RASTER_EXTENSIONS.includes(ext)) {
      throw new ImportError(
        'invalid-file',
        `The file is named .${ext} but its contents are not a recognisable image.`,
      );
    }
    throw new ImportError('unsupported-format');
  }

  const head = utf8Decode(bytes.subarray(0, TEXT_SNIFF_BYTES));
  const trimmed = head.replace(/^﻿/, '').trimStart();

  /* ------------------------------------------------------------ JSON */
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (/"type"\s*:\s*"excalidraw"/.test(head)) {
      return { format: 'excalidraw', mime: 'application/json', label: 'Excalidraw drawing' };
    }
    if (/"format"\s*:\s*"flowchart-tikz-studio"/.test(head) || /"nodes"\s*:/.test(head)) {
      return { format: 'studio-json', mime: 'application/json', label: 'Flowchart Studio diagram' };
    }
    if (/"objects"\s*:/.test(head) && /"connectors"\s*:/.test(head)) {
      return { format: 'ir-json', mime: 'application/json', label: 'Structured diagram JSON' };
    }
    throw new ImportError(
      'no-diagram',
      'This JSON file is not a diagram format the importer understands.',
    );
  }

  /* ------------------------------------------------------------- XML */
  if (trimmed.startsWith('<')) {
    if (/<mxfile\b|<mxGraphModel\b/.test(head) && !/<svg\b/i.test(head.slice(0, 2000))) {
      return { format: 'drawio', mime: 'application/xml', label: 'draw.io / diagrams.net diagram' };
    }
    if (/<svg\b/i.test(head)) {
      const embedded = embeddedDrawioFromSvg(head.length < bytes.length ? utf8Decode(bytes) : head);
      if (embedded) {
        return {
          format: 'svg',
          mime: 'image/svg+xml',
          label: 'SVG exported from draw.io (editable source embedded)',
          embeddedDrawio: embedded,
        };
      }
      return { format: 'svg', mime: 'image/svg+xml', label: 'SVG drawing' };
    }
    if (/<html\b/i.test(head)) {
      throw new ImportError('unsupported-format', 'HTML pages cannot be imported as diagrams.');
    }
    throw new ImportError('no-diagram', 'This XML file is not a draw.io diagram or an SVG.');
  }

  if (ascii(bytes, 0, 5) === '%PDF-') {
    throw new ImportError(
      'unsupported-format',
      'PDF files are not supported. Export the page as SVG or PNG and import that.',
    );
  }
  throw new ImportError('unsupported-format');
}
