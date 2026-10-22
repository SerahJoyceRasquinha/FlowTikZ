import { describe, expect, it } from 'vitest';
import { analyzeBackground, backgroundShare, removeBackgroundPixels } from '../import/raster/background';
import { applyBackgroundAnalysis, normalizeIR, transformIR } from '../import/ir/normalize';
import { validateIR } from '../import/ir/validate';
import { ReportBuilder } from '../import/report';
import { decodePng } from './helpers/pngDecoder';
import { BYTES } from './helpers/importFixtures';

/**
 * 7. Background removal logic   39. transparent background   40. white-filled shapes survive
 * 32. large image handling (downscale bookkeeping)
 */

type RGB = [number, number, number];

/** A synthetic canvas: fill, then rectangles with an outline and a fill. */
function canvas(w: number, h: number, bg: RGB | 'transparent') {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (bg === 'transparent') continue;
    data.set([...bg, 255], i * 4);
  }
  const px = (x: number, y: number, c: RGB) => data.set([...c, 255], (y * w + x) * 4);
  return {
    data,
    rect(x: number, y: number, rw: number, rh: number, fill: RGB, stroke: RGB, sw = 2) {
      for (let yy = y; yy < y + rh; yy++)
        for (let xx = x; xx < x + rw; xx++) {
          const edge = xx < x + sw || yy < y + sw || xx >= x + rw - sw || yy >= y + rh - sw;
          px(xx, yy, edge ? stroke : fill);
        }
    },
    dashedRect(x: number, y: number, rw: number, rh: number, stroke: RGB) {
      for (let xx = x; xx < x + rw; xx++) if (Math.floor(xx / 6) % 2 === 0) { px(xx, y, stroke); px(xx, y + rh - 1, stroke); }
      for (let yy = y; yy < y + rh; yy++) if (Math.floor(yy / 6) % 2 === 0) { px(x, yy, stroke); px(x + rw - 1, yy, stroke); }
    },
    noise(amount: number, seed = 7) {
      let s = seed;
      for (let i = 0; i < w * h; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const d = (s % (amount * 2 + 1)) - amount;
        for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.max(0, Math.min(255, data[i * 4 + k] + d));
      }
    },
  };
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

describe('background detection by connectivity', () => {
  it('keeps a white shape on a white page: only border-connected white is background (40)', () => {
    const c = canvas(200, 150, WHITE);
    c.rect(40, 40, 80, 50, WHITE, BLACK);
    const a = analyzeBackground(c.data, 200, 150);
    expect(a.color).toBe('#ffffff');
    expect(a.confidence).toBe(1);
    // Inside the box: not background, though exactly the same colour.
    expect(a.mask[60 * 200 + 80]).toBe(0);
    // Outside the box: background.
    expect(a.mask[10 * 200 + 10]).toBe(1);
    expect(a.enclosedPixels).toBeGreaterThan(70 * 40);
    expect(a.contentBox).toEqual({ x: 40, y: 40, w: 80, h: 50 });
  });

  it('works on coloured pages and scanned paper noise', () => {
    const c = canvas(240, 160, [238, 241, 245]);
    c.rect(30, 30, 90, 60, WHITE, [31, 41, 51]);
    c.rect(150, 60, 60, 60, [213, 232, 212], [130, 179, 102]);
    c.noise(6);
    const a = analyzeBackground(c.data, 240, 160);
    expect(a.color).not.toBeNull();
    expect(a.mask[5 * 240 + 5]).toBe(1);
    expect(a.mask[60 * 240 + 70]).toBe(0);
    expect(a.mask[90 * 240 + 180]).toBe(0);
    expect(a.contentBox.x).toBeGreaterThanOrEqual(28);
    expect(a.contentBox.x).toBeLessThanOrEqual(31);
  });

  it('recognises an already transparent background (39)', () => {
    const c = canvas(100, 100, 'transparent');
    c.rect(20, 20, 40, 30, WHITE, BLACK);
    const a = analyzeBackground(c.data, 100, 100);
    expect(a.transparent).toBe(true);
    expect(a.color).toBeNull();
    expect(a.mask[0]).toBe(1);
    expect(a.mask[35 * 100 + 40]).toBe(0);
  });

  it('treats the inside of a dashed outline as page (it is connected through the gaps)', () => {
    const c = canvas(120, 120, WHITE);
    c.dashedRect(20, 20, 80, 80, BLACK);
    const a = analyzeBackground(c.data, 120, 120);
    expect(backgroundShare(a, { x: 20, y: 20, w: 80, h: 80 })).toBeGreaterThan(0.9);
  });

  it('does not guess when the border has no dominant colour', () => {
    const c = canvas(60, 60, WHITE);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) c.data.set([(x * 37) % 256, (y * 53) % 256, (x * y) % 256, 255], (y * 60 + x) * 4);
    const a = analyzeBackground(c.data, 60, 60);
    expect(a.backgroundPixels).toBe(0);
  });

  it('produces a background-free copy of the image, leaving shapes opaque', () => {
    const c = canvas(80, 80, WHITE);
    c.rect(20, 20, 40, 40, WHITE, BLACK);
    const a = analyzeBackground(c.data, 80, 80);
    const out = removeBackgroundPixels(c.data, a);
    expect(out[3]).toBe(0);
    expect(out[(40 * 80 + 40) * 4 + 3]).toBe(255);
  });

  it('runs on the real fixtures', async () => {
    const img = await decodePng(BYTES.whitePng);
    const a = analyzeBackground(img.data, img.width, img.height);
    expect(a.color).toBe('#ffffff');
    expect(a.enclosedPixels).toBeGreaterThan(1000);
    const complex = await decodePng(BYTES.complexPng);
    expect(analyzeBackground(complex.data, complex.width, complex.height).color).toBe('#eef1f5');
  });
});

describe('background decisions on the recognised IR', () => {
  const c = canvas(300, 200, WHITE);
  c.rect(20, 20, 100, 60, WHITE, BLACK); // a real white box
  c.dashedRect(160, 20, 100, 60, BLACK); // a dashed frame: page shows through
  const a = analyzeBackground(c.data, 300, 200);

  it('keeps enclosed white fills, clears see-through fills, removes phantom shapes', () => {
    const r = new ReportBuilder();
    const ir = validateIR(
      {
        canvas: { width: 300, height: 200 },
        objects: [
          { id: 'box', shape: 'rectangle', x: 20, y: 20, w: 100, h: 60, style: { fill: '#ffffff', stroke: '#000000' } },
          { id: 'frame', shape: 'rectangle', x: 160, y: 20, w: 100, h: 60, style: { fill: '#ffffff', stroke: '#000000', dash: 'dashed' } },
          { id: 'ghost', shape: 'rectangle', x: 60, y: 120, w: 80, h: 50, style: { fill: '#ffffff', stroke: 'none' } },
        ],
        connectors: [],
      },
      { report: r },
    );
    const out = applyBackgroundAnalysis(ir, a, 1, r);
    expect(out.objects.map((o) => o.id)).toEqual(['box', 'frame']);
    expect(out.objects[0].style.fill).toBe('#ffffff');
    expect(out.objects[1].style.fill).toBeNull();
    expect(r.entries.some((e) => /kept: its interior is enclosed/.test(e.message))).toBe(true);
  });
});

describe('normalising the recognised IR', () => {
  it('drops a page-sized rectangle, dedupes, and attaches stray text to shapes and lines', () => {
    const r = new ReportBuilder();
    const ir = validateIR(
      {
        canvas: { width: 400, height: 300 },
        objects: [
          { id: 'page', shape: 'rectangle', x: 0, y: 0, w: 400, h: 300, z: 0 },
          { id: 'a', shape: 'rectangle', x: 20, y: 20, w: 120, h: 60, z: 1 },
          { id: 'a2', shape: 'rectangle', x: 20, y: 20, w: 120, h: 60, z: 2 },
          { id: 'b', shape: 'rectangle', x: 240, y: 20, w: 120, h: 60, z: 3 },
          { id: 't1', shape: 'text', x: 50, y: 40, w: 60, h: 20, z: 4, text: { content: 'Inside' } },
          { id: 't2', shape: 'text', x: 175, y: 30, w: 30, h: 14, z: 5, text: { content: 'Yes', fontSize: 11 } },
        ],
        connectors: [{ id: 'c', source: { objectId: 'a' }, target: { objectId: 'b' }, points: [{ x: 140, y: 50 }, { x: 240, y: 50 }], z: 6 }],
      },
      { report: r },
    );
    const out = normalizeIR(ir, { report: r, attachText: true, removeCanvasBackground: true });
    expect(out.objects.map((o) => o.id)).toEqual(['a', 'b']);
    expect(out.objects[0].text?.content).toBe('Inside');
    expect(out.connectors[0].label?.text).toBe('Yes');
    expect(out.connectors[0].label?.position).toBeCloseTo(0.5, 2); // label centre x=190 on a 140..240 line
    // ...and 13 px above it: kept beside the line (negative = right of travel = up here).
    expect(out.connectors[0].label?.offset).toBeCloseTo(-13, 1);
  });

  it('maps coordinates from a cropped, downscaled image back to source pixels (32)', () => {
    const ir = validateIR(
      {
        canvas: { width: 1000, height: 500 },
        objects: [{ id: 'a', shape: 'rectangle', x: 100, y: 50, w: 200, h: 100, style: { strokeWidth: 2 }, text: { content: 'x', fontSize: 10 } }],
        connectors: [{ id: 'c', points: [{ x: 0, y: 0 }, { x: 10, y: 20 }], style: { strokeWidth: 1 } }],
      },
      { report: new ReportBuilder() },
    );
    // The sent image was a 4000x2000 crop at (500, 300), downscaled 4x.
    const back = transformIR(ir, 4, 500, 300, { width: 5000, height: 3000 });
    expect(back.objects[0]).toMatchObject({ x: 900, y: 500, w: 800, h: 400 });
    expect(back.objects[0].style.strokeWidth).toBe(8);
    expect(back.objects[0].text!.fontSize).toBe(40);
    expect(back.connectors[0].points).toEqual([{ x: 500, y: 300 }, { x: 540, y: 380 }]);
    expect(back.canvas).toEqual({ width: 5000, height: 3000 });
  });
});
