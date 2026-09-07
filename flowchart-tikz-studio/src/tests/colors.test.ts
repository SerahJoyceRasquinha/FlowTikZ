import { describe, expect, it } from 'vitest';
import { ColorRegistry, normalizeHex } from '../latex/colors';
import { coord, cm, toPt, makeUnitContext, fmt } from '../latex/units';

describe('normalizeHex', () => {
  it('accepts long and short hex, with or without a hash', () => {
    expect(normalizeHex('#ff8800')).toBe('FF8800');
    expect(normalizeHex('ff8800')).toBe('FF8800');
    expect(normalizeHex('#f80')).toBe('FF8800');
  });

  it('rejects anything else', () => {
    expect(normalizeHex('rebeccapurple')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});

describe('ColorRegistry', () => {
  it('defines a custom colour once no matter how often it is used', () => {
    const r = new ColorRegistry();
    const a = r.use('#3366cc');
    const b = r.use('#3366CC');
    const c = r.use('3366cc');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(r.definitions()).toHaveLength(1);
    expect(r.render()).toEqual(['\\definecolor{fc3366CC}{HTML}{3366CC}']);
  });

  it('reuses xcolor built-ins instead of redefining them', () => {
    const r = new ColorRegistry();
    expect(r.use('#ffffff')).toBe('white');
    expect(r.use('#000000')).toBe('black');
    expect(r.use('#ff0000')).toBe('red');
    expect(r.render()).toHaveLength(0);
  });

  it('names colours from their value, so output is order independent', () => {
    const a = new ColorRegistry();
    a.use('#111111');
    a.use('#222222');
    const b = new ColorRegistry();
    b.use('#222222');
    b.use('#111111');
    expect(a.render()).toEqual(b.render());
  });

  it('falls back to black for unparseable colours', () => {
    const r = new ColorRegistry();
    expect(r.use('not a colour')).toBe('black');
    expect(r.render()).toHaveLength(0);
  });
});

describe('unit conversion', () => {
  const ctx = makeUnitContext(50);

  it('converts diagram units to centimetres at the configured scale', () => {
    expect(cm(50, ctx)).toBe(1);
    expect(cm(25, ctx)).toBe(0.5);
  });

  it('converts to TeX points via centimetres', () => {
    expect(toPt(50, ctx)).toBeCloseTo(28.453, 2);
  });

  it('flips the y axis so screen-down becomes TikZ-up', () => {
    expect(coord({ x: 100, y: 100 }, ctx)).toBe('(2,-2)');
  });

  it('applies the origin offset', () => {
    const shifted = makeUnitContext(50, 100, 100);
    expect(coord({ x: 100, y: 100 }, shifted)).toBe('(0,0)');
  });

  it('scales inversely with units per centimetre', () => {
    const big = makeUnitContext(25);
    expect(cm(50, big)).toBe(2);
  });

  it('formats numbers without exponents or negative zero', () => {
    expect(fmt(-0)).toBe('0');
    expect(fmt(0.00001)).toBe('0');
    expect(fmt(1.5)).toBe('1.5');
    expect(fmt(2)).toBe('2');
  });
});
