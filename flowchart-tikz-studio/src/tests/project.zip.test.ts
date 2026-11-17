import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { LIMITS, ZipError, crc32, inflateRaw, isClutter, normalizePath, openZip, rawData, readEntry } from '../project/zip';
import { buildZip, fileEntry, toDos } from '../project/zipWriter';

const FIX = join(__dirname, 'fixtures', 'project');
const fixture = (name: string) => new Blob([readFileSync(join(FIX, name))]);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function hasPython(): boolean {
  try {
    execFileSync('python3', ['-c', 'import zipfile'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('reading archives', () => {
  it('lists an Overleaf-style project, folders included', async () => {
    const z = await openZip(fixture('overleaf-article.zip'));
    expect(z.entries.map((e) => e.path)).toEqual([
      'MyPaper', 'MyPaper/main.tex', 'MyPaper/sections', 'MyPaper/sections/method.tex', 'MyPaper/figures', 'MyPaper/figures/diagram.png', 'MyPaper/refs.bib',
    ]);
    expect(z.entries.filter((e) => e.dir).length).toBe(3);
    const main = z.entries.find((e) => e.path === 'MyPaper/main.tex')!;
    expect(main.method).toBe(8);
    expect(text(await readEntry(z, main))).toContain('\\documentclass[11pt,a4paper]{article}');
  });

  it('reads stored, deflated and data-descriptor entries and checks their CRC', async () => {
    const z = await openZip(fixture('data-descriptor.zip'));
    const notes = z.entries.find((e) => e.path === 'data/notes.txt')!;
    expect(notes.flags & 8).toBe(8);
    expect(text(await readEntry(z, notes))).toBe('notes\n'.repeat(50));
  });

  it('marks password-protected and unsupported entries unreadable but keeps them', async () => {
    const enc = await openZip(fixture('encrypted-entry.zip'));
    const secret = enc.entries.find((e) => e.path === 'secret.tex')!;
    expect(secret.encrypted).toBe(true);
    expect(secret.unreadable).toBe('password-protected');
    await expect(readEntry(enc, secret)).rejects.toThrow(/password-protected/);
    const bz = await openZip(fixture('bzip2-entry.zip'));
    const photo = bz.entries.find((e) => e.path === 'photo.png')!;
    expect(photo.unreadable).toMatch(/unsupported method \(12\)/);
    expect((await rawData(bz, photo)).size).toBe(photo.compressedSize);
  });

  it('drops unsafe paths and system clutter, and says so', async () => {
    const z = await openZip(fixture('unsafe-paths.zip'));
    expect(z.entries.map((e) => e.path)).toEqual(['main.tex']);
    const reasons = z.skipped.map((s) => `${s.name}:${s.reason}`);
    expect(reasons).toEqual(
      expect.arrayContaining(['../evil.tex:unsafe path (outside the project)', 'C:/win.tex:unsafe path (outside the project)', '__MACOSX/._main.tex:system file', '.DS_Store:system file']),
    );
  });

  it('rejects files that are not zips, empty input, and damaged archives with plain messages', async () => {
    await expect(openZip(fixture('not-a-zip.zip'))).rejects.toThrow('This file is not a zip archive.');
    await expect(openZip(new Blob([new Uint8Array(5)]))).rejects.toThrow(/too small/);
    await expect(openZip(fixture('truncated.zip'))).rejects.toThrow(/incomplete or damaged/);
    const empty = await openZip(fixture('empty.zip'));
    expect(empty.entries).toEqual([]);
  });

  it('detects corrupted contents: wrong checksum and inflated bombs', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIX, 'encrypted-entry.zip')));
    // Flip a byte inside main.tex's stored data.
    const z0 = await openZip(new Blob([bytes]));
    const main = z0.entries.find((e) => e.path === 'main.tex')!;
    const data = await rawData(z0, main);
    const at = bytes.indexOf('\\documentclass'.charCodeAt(1), main.localHeaderOffset + 30);
    const copy = bytes.slice();
    copy[at] ^= 0x20;
    const z1 = await openZip(new Blob([copy]));
    await expect(readEntry(z1, z1.entries.find((e) => e.path === 'main.tex')!)).rejects.toThrow(/checksum/);
    expect(data.size).toBeGreaterThan(0);
    // A tiny deflate stream that expands far past its claimed size.
    const bomb = await fileEntry('bomb.txt', new Uint8Array(4 * 1024 * 1024));
    await expect(inflateRaw(bomb.data as Uint8Array, 1024, 'bomb.txt')).rejects.toThrow(/expands to more than/);
  });

  it('refuses archives over the entry limit before reading them', async () => {
    const saved = LIMITS.maxEntries;
    LIMITS.maxEntries = 3;
    try {
      await expect(openZip(fixture('overleaf-article.zip'))).rejects.toThrow(/lists 7 files; the limit is 3/);
    } finally {
      LIMITS.maxEntries = saved;
    }
  });

  it('normalises paths and recognises clutter', () => {
    expect(normalizePath('a\\b\\c.tex')).toBe('a/b/c.tex');
    expect(normalizePath('./a//b/./c.tex')).toBe('a/b/c.tex');
    expect(normalizePath('a/../../b')).toBeNull();
    expect(normalizePath('/etc/passwd')).toBeNull();
    expect(normalizePath('D:/x')).toBeNull();
    expect(normalizePath('a/\u0001b')).toBeNull();
    expect(isClutter('__MACOSX/x')).toBe(true);
    expect(isClutter('p/.DS_Store')).toBe(true);
    expect(isClutter('p/._x.tex')).toBe(true);
    expect(isClutter('p/x.tex')).toBe(false);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('writing archives', () => {
  it('round-trips new files and raw copies through our reader', async () => {
    const src = await openZip(fixture('overleaf-article.zip'));
    const png = src.entries.find((e) => e.path.endsWith('.png'))!;
    const entries = [
      await fileEntry('main.tex', new TextEncoder().encode('\\documentclass{article}\n'.repeat(20))),
      { path: 'figures/diagram.png', data: await rawData(src, png), method: png.method, crc32: png.crc32, compressedSize: png.compressedSize, size: png.size },
      { path: 'empty-dir', data: new Uint8Array(0), method: 0, crc32: 0, compressedSize: 0, size: 0, dir: true },
    ];
    const out = await openZip(buildZip(entries));
    expect(out.entries.map((e) => e.path)).toEqual(['main.tex', 'figures/diagram.png', 'empty-dir']);
    expect(text(await readEntry(out, out.entries[0]))).toBe('\\documentclass{article}\n'.repeat(20));
    const a = await readEntry(src, png);
    const b = await readEntry(out, out.entries[1]);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(out.entries[2].dir).toBe(true);
  });

  it('writes Zip64 records that our reader and Python both accept', async () => {
    const e = await fileEntry('a.tex', new TextEncoder().encode('zip64 '.repeat(100)));
    const blob = buildZip([e, await fileEntry('b/c.txt', new TextEncoder().encode('hi'))], { forceZip64: true });
    const z = await openZip(blob);
    expect(z.zip64).toBe(true);
    expect(text(await readEntry(z, z.entries[0]))).toBe('zip64 '.repeat(100));
    if (hasPython()) {
      const dir = mkdtempSync(join(tmpdir(), 'ftz-'));
      const f = join(dir, 'z64.zip');
      writeFileSync(f, Buffer.from(await blob.arrayBuffer()));
      const outText = execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('a.tex').decode()[:12])`, f]).toString();
      expect(outText.trim().split('\n')).toEqual(['None', 'zip64 zip64']);
    }
  });

  it('produces archives Python validates (names in UTF-8, CRCs right)', async () => {
    if (!hasPython()) return;
    const blob = buildZip([await fileEntry('kapitel/über.tex', new TextEncoder().encode('Grüße\n'.repeat(30)))]);
    const dir = mkdtempSync(join(tmpdir(), 'ftz-'));
    const f = join(dir, 'u.zip');
    writeFileSync(f, Buffer.from(await blob.arrayBuffer()));
    const out = execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.namelist()[0])`, f]).toString();
    expect(out.trim().split('\n')).toEqual(['None', 'kapitel/über.tex']);
  });

  it('switches to Zip64 by itself past 65,535 entries', async () => {
    const tiny = await fileEntry('x', new Uint8Array([1]));
    const many = Array.from({ length: 65_600 }, (_, i) => ({ ...tiny, path: `f/${i}.txt` }));
    const z = await openZip(buildZip(many));
    expect(z.zip64).toBe(true);
    expect(z.entries.length).toBe(65_600);
    expect(z.entries[65_599].path).toBe('f/65599.txt');
  }, 30_000);

  it('encodes DOS dates', () => {
    const { time, date } = toDos(new Date(2026, 10, 16, 13, 30, 10));
    expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 16);
    expect(time).toBe((13 << 11) | (30 << 5) | 5);
  });

  it('ZipError is a proper Error', () => {
    const e = new ZipError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ZipError');
  });
});
