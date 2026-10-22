import { describe, expect, it } from 'vitest';
import { detectFormat, embeddedDrawioFromSvg, extensionOf } from '../import/detector';
import { validateFileMeta, validateRasterDimensions, validateSizeForFormat, MB } from '../import/validation';
import { rasterDimensions, sniffRaster } from '../import/binary';
import { ImportError } from '../import/types';
import { BYTES } from './helpers/importFixtures';

/**
 * 1. File type detection   2. Unsupported file rejection   11. validation
 */

const enc = (s: string) => new TextEncoder().encode(s);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ImportError ? e.code : 'other';
  }
}

describe('format detection by content', () => {
  it('recognises every raster fixture by its magic bytes, not its name', async () => {
    expect((await detectFormat({ name: 'a.png', bytes: BYTES.simplePng })).raster).toBe('png');
    expect((await detectFormat({ name: 'a.jpg', bytes: BYTES.flowJpg })).raster).toBe('jpeg');
    // Misnamed: a PNG called .jpg is still a PNG.
    const misnamed = await detectFormat({ name: 'photo.jpg', bytes: BYTES.simplePng });
    expect(misnamed.format).toBe('raster');
    expect(misnamed.raster).toBe('png');
    expect(misnamed.mime).toBe('image/png');
  });

  it('recognises GIF, WEBP, BMP and AVIF headers', () => {
    expect(sniffRaster(enc('GIF89a\x01\x00\x01\x00'))).toBe('gif');
    const webp = new Uint8Array([...enc('RIFF'), 0, 0, 0, 0, ...enc('WEBPVP8 ')]);
    expect(sniffRaster(webp)).toBe('webp');
    const bmp = new Uint8Array(40);
    bmp.set(enc('BM'));
    expect(sniffRaster(bmp)).toBe('bmp');
    const avif = new Uint8Array([0, 0, 0, 0x1c, ...enc('ftypavif')]);
    expect(sniffRaster(avif)).toBe('avif');
  });

  it('reads pixel dimensions from headers without decoding', () => {
    expect(rasterDimensions(BYTES.simplePng, 'png')).toEqual({ width: 480, height: 520 });
    expect(rasterDimensions(BYTES.flowJpg, 'jpeg')).toEqual({ width: 420, height: 360 });
    const gif = new Uint8Array([...enc('GIF89a'), 0x20, 0x01, 0x10, 0x00]);
    expect(rasterDimensions(gif, 'gif')).toEqual({ width: 288, height: 16 });
  });

  it('identifies SVG, draw.io, Excalidraw, app JSON and IR JSON', async () => {
    expect((await detectFormat({ name: 'x.svg', bytes: BYTES.flowchartSvg })).format).toBe('svg');
    expect((await detectFormat({ name: 'x.drawio', bytes: BYTES.flowchartDrawio })).format).toBe('drawio');
    // draw.io files saved as .xml are still draw.io files.
    expect((await detectFormat({ name: 'x.xml', bytes: BYTES.compressedDrawio })).format).toBe('drawio');
    expect((await detectFormat({ name: 'x.excalidraw', bytes: enc('{"type":"excalidraw","elements":[]}') })).format).toBe('excalidraw');
    expect((await detectFormat({ name: 'x.json', bytes: enc('{"format":"flowchart-tikz-studio","diagram":{"nodes":{}}}') })).format).toBe('studio-json');
    expect((await detectFormat({ name: 'x.json', bytes: enc('{"objects":[],"connectors":[]}') })).format).toBe('ir-json');
  });

  it('finds the draw.io source embedded in an exported SVG and PNG', async () => {
    const svg = await detectFormat({ name: 'export.svg', bytes: BYTES.drawioEmbeddedSvg });
    expect(svg.format).toBe('svg');
    expect(svg.embeddedDrawio).toContain('<mxfile');
    const png = await detectFormat({ name: 'export.png', bytes: BYTES.drawioPng });
    expect(png.format).toBe('raster');
    expect(png.embeddedDrawio).toContain('<mxfile');
    // A plain draw.io SVG export without the source is a normal SVG.
    expect((await detectFormat({ name: 'p.svg', bytes: BYTES.drawioPlainSvg })).embeddedDrawio).toBeUndefined();
    expect(embeddedDrawioFromSvg('<svg content="hello"></svg>')).toBeUndefined();
  });
});

describe('rejecting what cannot be imported', () => {
  it('rejects unsupported extensions before reading anything', () => {
    expect(() => validateFileMeta({ name: 'report.docx', size: 10, type: '' })).toThrow(/Unsupported file format/);
    expect(() => validateFileMeta({ name: 'app.exe', size: 10, type: 'application/x-msdownload' })).toThrow(ImportError);
  });

  it('rejects empty and oversized files with a size in the message', () => {
    expect(() => validateFileMeta({ name: 'a.png', size: 0, type: 'image/png' })).toThrow(/empty/);
    expect(() => validateFileMeta({ name: 'a.png', size: 40 * MB, type: 'image/png' })).toThrow(/too large \(40\.0 MB/);
    expect(() => validateSizeForFormat(12 * MB, 'svg')).toThrow(/limit for this format is 10\.0 MB/);
    expect(() => validateSizeForFormat(12 * MB, 'raster')).not.toThrow();
  });

  it('rejects decompression bombs from their header, before decoding', () => {
    expect(() => validateRasterDimensions({ width: 30000, height: 30000 })).toThrow(/too large to analyse/);
    expect(() => validateRasterDimensions({ width: 0, height: 10 })).toThrow(/invalid size/);
    expect(() => validateRasterDimensions({ width: 4000, height: 3000 })).not.toThrow();
  });

  it('rejects binary garbage, PDFs, HTML and unknown JSON with specific errors', async () => {
    expect(await codeOf(detectFormat({ name: 'x.png', bytes: new Uint8Array([1, 2, 0, 3, 4, 0, 9]) }))).toBe('invalid-file');
    expect(await codeOf(detectFormat({ name: 'x.bin', bytes: new Uint8Array([0, 0, 0, 7]) }))).toBe('unsupported-format');
    expect(await codeOf(detectFormat({ name: 'x.svg', bytes: enc('%PDF-1.7 ...') }))).toBe('unsupported-format');
    expect(await codeOf(detectFormat({ name: 'x.svg', bytes: enc('<html><body></body></html>') }))).toBe('unsupported-format');
    expect(await codeOf(detectFormat({ name: 'x.json', bytes: enc('{"hello":1}') }))).toBe('no-diagram');
    expect(await codeOf(detectFormat({ name: 'x.xml', bytes: enc('<note>hi</note>') }))).toBe('no-diagram');
    expect(await codeOf(detectFormat({ name: 'x.svg', bytes: new Uint8Array() }))).toBe('invalid-file');
  });

  it('reports errors as plain sentences, never stack traces', async () => {
    try {
      await detectFormat({ name: 'x.bin', bytes: new Uint8Array([0, 0, 0, 7]) });
    } catch (e) {
      expect((e as Error).message).toBe('Unsupported file format.');
      expect((e as Error).message).not.toMatch(/at \w+ \(/);
    }
  });

  it('reads extensions case-insensitively', () => {
    expect(extensionOf('Flow.DRAWIO')).toBe('drawio');
    expect(extensionOf('noext')).toBe('');
  });
});
