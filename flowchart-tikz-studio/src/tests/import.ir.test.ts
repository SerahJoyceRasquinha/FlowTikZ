import { describe, expect, it } from 'vitest';
import { validateIR } from '../import/ir/validate';
import { ReportBuilder } from '../import/report';
import { ImportError } from '../import/types';

/**
 * 15. IR validation   16. malformed input   18. missing fields
 *
 * The intermediate representation reaches the pipeline from IR JSON files and
 * from the offline recogniser; either way, every field is checked.
 */

const report = () => new ReportBuilder();

describe('validation of structured IR input (never trusted)', () => {
  it('accepts a well-formed answer and fills defaults', () => {
    const ir = validateIR(
      { objects: [{ id: 'a', shape: 'rectangle', x: 1, y: 2, w: 30, h: 20 }], connectors: [] },
      { report: report() },
    );
    expect(ir.objects[0].style.fill).toBe('#ffffff');
    expect(ir.objects[0].rotation).toBe(0);
    expect(ir.canvas).toEqual({ width: 31, height: 22 });
  });

  it('drops NaN / Infinity / enormous coordinates and zero-size objects, keeping the rest', () => {
    const r = report();
    const ir = validateIR(
      {
        canvas: { width: 500, height: 400 },
        objects: [
          { id: 'ok', shape: 'rectangle', x: 10, y: 10, w: 50, h: 20 },
          { id: 'nan', shape: 'rectangle', x: 'NaN', y: 10, w: 50, h: 20 },
          { id: 'inf', shape: 'rectangle', x: Infinity, y: 10, w: 50, h: 20 },
          { id: 'far', shape: 'rectangle', x: 1e9, y: 10, w: 50, h: 20 },
          { id: 'zero', shape: 'rectangle', x: 1, y: 1, w: 0, h: 0 },
          'not an object',
        ],
        connectors: [],
      },
      { report: r },
    );
    expect(ir.objects.map((o) => o.id)).toEqual(['ok']);
    expect(r.entries.filter((e) => e.category === 'unsupported').length).toBe(5);
  });

  it('coerces bad colours, unknown enums and out-of-range numbers, reporting each', () => {
    const r = report();
    const ir = validateIR(
      {
        objects: [
          {
            id: 'a',
            shape: 'hexagram-of-doom',
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            rotation: 725,
            style: { fill: 'not-a-colour', stroke: 'rgb(255, 0, 0)', strokeWidth: 9999, opacity: 7, dash: 'wiggly' },
            text: { content: 'Hi\u0000\u0007 there', fontSize: -4, align: 'justify', color: 'hsl(120, 100%, 25%)' },
          },
        ],
        connectors: [{ id: 'c', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], arrowEnd: 'harpoon', routing: 'spiral' }],
      },
      { report: r },
    );
    const o = ir.objects[0];
    expect(o.shape).toBe('rectangle');
    expect(o.rotation).toBe(5);
    expect(o.style.fill).toBeNull();
    expect(o.style.stroke).toBe('#ff0000');
    expect(o.style.strokeWidth).toBe(100);
    expect(o.style.opacity).toBe(1);
    expect(o.style.dash).toBe('solid');
    expect(o.text!.content).toBe('Hi there');
    expect(o.text!.fontSize).toBe(1);
    expect(o.text!.align).toBe('center');
    expect(o.text!.color).toBe('#008000');
    expect(ir.connectors[0].arrowEnd).toBe('stealth');
    expect(ir.connectors[0].routing).toBe('straight');
    expect(r.entries.some((e) => /Unknown shape type "hexagram-of-doom"/.test(e.message))).toBe(true);
    expect(r.entries.some((e) => /Unknown arrowhead "harpoon"/.test(e.message))).toBe(true);
    expect(r.entries.some((e) => /Unreadable fill colour/.test(e.message))).toBe(true);
  });

  it('handles missing fields: connector without points but with two objects is kept; otherwise skipped', () => {
    const r = report();
    const ir = validateIR(
      {
        objects: [
          { id: 'a', shape: 'rectangle', x: 0, y: 0, w: 10, h: 10 },
          { id: 'b', shape: 'rectangle', x: 50, y: 0, w: 10, h: 10 },
          { shape: 'ellipse', x: 0, y: 50, w: 10, h: 10 },
        ],
        connectors: [
          { id: 'c1', source: { objectId: 'a' }, target: { objectId: 'b' } },
          { id: 'c2', source: { objectId: 'a' } },
          { id: 'c3', source: { objectId: 'ghost' }, target: { objectId: 'b' }, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        ],
      },
      { report: r },
    );
    expect(ir.objects.map((o) => o.id)).toEqual(['a', 'b', 'o3']);
    expect(ir.connectors.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(ir.connectors[1].source).toBeUndefined();
    expect(r.entries.some((e) => /unknown object "ghost"/.test(e.message))).toBe(true);
  });

  it('refuses answers with no usable structure', () => {
    expect(() => validateIR(null, { report: report() })).toThrow(ImportError);
    expect(() => validateIR({ hello: 1 }, { report: report() })).toThrow(ImportError);
    expect(() => validateIR({ objects: [], connectors: [] }, { report: report() })).toThrow(/valid diagram/);
  });

  it('keeps text as data: markup and TeX in labels are plain strings', () => {
    const ir = validateIR(
      { objects: [{ id: 'a', shape: 'text', x: 0, y: 0, w: 10, h: 10, text: { content: '<script>x</script> \\input{/etc/passwd} 50%' } }], connectors: [] },
      { report: report() },
    );
    expect(ir.objects[0].text!.content).toBe('<script>x</script> \\input{/etc/passwd} 50%');
  });
});
