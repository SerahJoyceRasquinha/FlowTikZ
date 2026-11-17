/**
 * A zip reader built for large archives.
 *
 * Nothing is read up front except the end-of-archive records and the central
 * directory. Each file is read only when it is needed, straight from a slice
 * of the original Blob/File, so a multi-gigabyte Overleaf export opens without
 * ever being held in memory. Zip64 archives (over 4 GB, or over 65,535
 * entries) are supported, as are stored and deflated entries; anything else
 * (encrypted, bzip2, ...) is listed and carried through an export unchanged,
 * but cannot be opened.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** Normalised path with forward slashes and no leading "./" or "/". */
  path: string;
  /** The name exactly as stored, for diagnostics. */
  rawName: string;
  dir: boolean;
  method: number;
  flags: number;
  encrypted: boolean;
  crc32: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
  externalAttrs: number;
  versionMadeBy: number;
  /** Why the entry cannot be opened, when it cannot. */
  unreadable?: string;
}

export interface ZipArchive {
  blob: Blob;
  entries: ZipEntry[];
  /** Entries left out (unsafe paths, OS clutter), with the reason. */
  skipped: { name: string; reason: string }[];
  zip64: boolean;
  comment: string;
}

export const LIMITS = {
  /** Most entries an archive may list. */
  maxEntries: 500_000,
  /** Largest central directory read into memory. */
  maxCentralDirectory: 256 * 1024 * 1024,
  /** Largest single file decompressed into memory (text, images). */
  maxEntryBytes: 256 * 1024 * 1024,
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const s = Math.max(0, start);
  const e = Math.min(blob.size, end);
  if (e <= s) return new Uint8Array(0);
  const part = blob.slice(s, e);
  return new Uint8Array(await blobToArrayBuffer(part));
}

/** Blob.arrayBuffer where available, FileReader otherwise (older jsdom). */
export function blobToArrayBuffer(b: Blob): Promise<ArrayBuffer> {
  if (typeof (b as Blob & { arrayBuffer?: unknown }).arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsArrayBuffer(b);
  });
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x1_0000_0000;

/* IBM code page 437, upper half: names written without the UTF-8 flag. */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  // Many tools write UTF-8 without setting the flag; prefer it when valid.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const c of bytes) s += c < 128 ? String.fromCharCode(c) : CP437_HIGH[c - 128];
    return s;
  }
}

/**
 * Make a stored name safe to use as a project path. Returns null for names
 * that would escape the project ("../", absolute paths, drive letters).
 */
export function normalizePath(name: string): string | null {
  let p = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(p)) return null;
  if (p.startsWith('/')) return null;
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    if (/[\u0000-\u001f]/.test(part)) return null;
    out.push(part);
  }
  p = out.join('/');
  return p || null;
}

/** Operating-system clutter nobody wants inside a LaTeX project. */
export function isClutter(path: string): boolean {
  return /(^|\/)__MACOSX(\/|$)/.test(path) || /(^|\/)\.DS_Store$/.test(path) || /(^|\/)Thumbs\.db$/i.test(path) || /(^|\/)\._/.test(path);
}

async function findEndRecord(blob: Blob): Promise<{ buf: Uint8Array; at: number; base: number }> {
  if (blob.size < 22) throw new ZipError('This file is too small to be a zip archive.');
  // The record is 22 bytes plus a comment of up to 65,535 bytes.
  const tail = Math.min(blob.size, 22 + 0xffff);
  const base = blob.size - tail;
  const buf = await readBytes(blob, base, blob.size);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (u32(buf, i) === SIG_EOCD) {
      const commentLen = u16(buf, i + 20);
      // A real record's comment runs exactly to the end of the file.
      if (i + 22 + commentLen <= buf.length) return { buf, at: i, base };
    }
  }
  const head = await readBytes(blob, 0, 4);
  if (head.length === 4 && u32(head, 0) === SIG_LOCAL) {
    throw new ZipError('This zip archive is incomplete or damaged (its table of contents is missing). Try downloading it again.');
  }
  throw new ZipError('This file is not a zip archive.');
}

export async function openZip(blob: Blob): Promise<ZipArchive> {
  const { buf, at, base } = await findEndRecord(blob);
  let entryCount = u16(buf, at + 10);
  let cdSize = u32(buf, at + 12);
  let cdOffset = u32(buf, at + 16);
  const comment = decodeName(buf.subarray(at + 22, at + 22 + u16(buf, at + 20)), true);
  let zip64 = false;

  // Zip64: the classic record holds 0xFFFF / 0xFFFFFFFF and a locator precedes it.
  const locAt = base + at - 20;
  if (locAt >= 0) {
    const loc = await readBytes(blob, locAt, locAt + 20);
    if (loc.length === 20 && u32(loc, 0) === SIG_ZIP64_LOCATOR) {
      const recOffset = u64(loc, 8);
      const rec = await readBytes(blob, recOffset, recOffset + 56);
      if (rec.length === 56 && u32(rec, 0) === SIG_ZIP64_EOCD) {
        zip64 = true;
        entryCount = u64(rec, 32);
        cdSize = u64(rec, 40);
        cdOffset = u64(rec, 48);
      }
    }
  }

  if (entryCount > LIMITS.maxEntries) {
    throw new ZipError(`This archive lists ${entryCount.toLocaleString('en-US')} files; the limit is ${LIMITS.maxEntries.toLocaleString('en-US')}.`);
  }
  if (cdSize > LIMITS.maxCentralDirectory) throw new ZipError('This archive\'s table of contents is too large to read.');

  // Some writers prepend data (self-extracting stubs); measure the shift.
  const eocdAbs = base + at;
  let shift = 0;
  if (cdOffset + cdSize !== eocdAbs && !zip64) shift = eocdAbs - (cdOffset + cdSize);
  if (cdOffset + shift < 0 || cdOffset + shift + cdSize > blob.size) {
    throw new ZipError('This zip archive is damaged: its table of contents points outside the file.');
  }

  const cd = await readBytes(blob, cdOffset + shift, cdOffset + shift + cdSize);
  const entries: ZipEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();
  let p = 0;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > cd.length || u32(cd, p) !== SIG_CENTRAL) {
      throw new ZipError(`This zip archive is damaged (entry ${i + 1} of ${entryCount} is unreadable).`);
    }
    const versionMadeBy = u16(cd, p + 4);
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const dosTime = u16(cd, p + 12);
    const dosDate = u16(cd, p + 14);
    const crc = u32(cd, p + 16);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const externalAttrs = u32(cd, p + 38);
    let localHeaderOffset = u32(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const rawName = decodeName(nameBytes, (flags & 0x800) !== 0);
    // Zip64 extended information.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff && q + 8 <= x + 4 + len) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff && q + 8 <= x + 4 + len) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff && q + 8 <= x + 4 + len) {
          localHeaderOffset = u64(cd, q);
        }
      }
      x += 4 + len;
    }
    p = xEnd + commentLen;

    const dir = rawName.endsWith('/') || rawName.endsWith('\\');
    const path = normalizePath(rawName);
    if (!path) {
      if (rawName.replace(/[\\/.]/g, '') !== '') skipped.push({ name: rawName, reason: 'unsafe path (outside the project)' });
      continue;
    }
    if (isClutter(path)) {
      skipped.push({ name: rawName, reason: 'system file' });
      continue;
    }
    const key = path.toLowerCase() + (dir ? '/' : '');
    if (seen.has(key)) {
      skipped.push({ name: rawName, reason: 'duplicate name' });
      continue;
    }
    seen.add(key);
    const encrypted = (flags & 1) !== 0;
    const e: ZipEntry = {
      path,
      rawName,
      dir,
      method,
      flags,
      encrypted,
      crc32: crc,
      compressedSize,
      size,
      localHeaderOffset: localHeaderOffset + shift,
      dosTime,
      dosDate,
      externalAttrs,
      versionMadeBy,
    };
    if (encrypted) e.unreadable = 'password-protected';
    else if (method !== 0 && method !== 8) e.unreadable = `compressed with an unsupported method (${method})`;
    entries.push(e);
  }
  return { blob, entries, skipped, zip64, comment };
}

/** Where an entry's compressed bytes start: after its local header. */
async function dataStart(archive: ZipArchive, e: ZipEntry): Promise<number> {
  const h = await readBytes(archive.blob, e.localHeaderOffset, e.localHeaderOffset + 30);
  if (h.length < 30 || u32(h, 0) !== SIG_LOCAL) {
    throw new ZipError(`"${e.path}" is damaged inside the archive.`);
  }
  return e.localHeaderOffset + 30 + u16(h, 26) + u16(h, 28);
}

/**
 * Where each entry's data starts, for many entries at once. Local headers are
 * read in large windows rather than one small read per file, which matters
 * for archives with tens of thousands of entries.
 */
export async function dataStarts(archive: ZipArchive, entries: ZipEntry[]): Promise<Map<ZipEntry, number>> {
  const out = new Map<ZipEntry, number>();
  const sorted = entries.filter((e) => !e.dir).sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  const WINDOW = 4 * 1024 * 1024;
  let buf: Uint8Array = new Uint8Array(0);
  let base = 0;
  for (const e of sorted) {
    const rel = e.localHeaderOffset - base;
    // Header plus names and extras fit in 30 + 2 * 65535 bytes at most.
    if (rel < 0 || rel + 30 > buf.length || rel + 30 + u16(buf, rel + 26) + u16(buf, rel + 28) > buf.length) {
      base = e.localHeaderOffset;
      buf = await readBytes(archive.blob, base, base + Math.max(WINDOW, 30 + 2 * 65535));
    }
    const r = e.localHeaderOffset - base;
    if (r + 30 > buf.length || u32(buf, r) !== SIG_LOCAL) throw new ZipError(`"${e.path}" is damaged inside the archive.`);
    out.set(e, e.localHeaderOffset + 30 + u16(buf, r + 26) + u16(buf, r + 28));
  }
  return out;
}

/**
 * Raw (still compressed) bytes of many small entries, read in large windows.
 * Entries over `maxEach`, or past the total `budget`, are left out (they stay
 * lazy slices of the archive).
 */
export async function rawSmall(
  archive: ZipArchive,
  entries: ZipEntry[],
  starts: Map<ZipEntry, number>,
  maxEach = 256 * 1024,
  budget = 256 * 1024 * 1024,
): Promise<Map<ZipEntry, Uint8Array>> {
  const out = new Map<ZipEntry, Uint8Array>();
  const small = entries
    .filter((e) => !e.dir && starts.has(e) && e.compressedSize <= maxEach)
    .sort((a, b) => starts.get(a)! - starts.get(b)!);
  const WINDOW = 8 * 1024 * 1024;
  let buf: Uint8Array = new Uint8Array(0);
  let base = 0;
  let used = 0;
  for (const e of small) {
    if (used + e.compressedSize > budget) break;
    const at = starts.get(e)!;
    if (at - base < 0 || at - base + e.compressedSize > buf.length) {
      base = at;
      buf = await readBytes(archive.blob, base, base + Math.max(WINDOW, e.compressedSize));
    }
    const r = at - base;
    if (r + e.compressedSize > buf.length) continue;
    out.set(e, buf.subarray(r, r + e.compressedSize));
    used += e.compressedSize;
  }
  return out;
}

/** The raw (still compressed) bytes of an entry, as a lazy Blob slice. */
export async function rawData(archive: ZipArchive, e: ZipEntry): Promise<Blob> {
  const start = await dataStart(archive, e);
  if (start + e.compressedSize > archive.blob.size) throw new ZipError(`"${e.path}" is cut off: the archive is incomplete.`);
  return archive.blob.slice(start, start + e.compressedSize);
}

/* ------------------------------------------------------------------ crc32 */

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array, seed = 0): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------- inflating */

async function collect(stream: ReadableStream<Uint8Array>, limit: number, what: string): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ZipError(`"${what}" expands to more than ${Math.round(limit / 1048576)} MB, which is more than it claims or more than can be opened.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** A byte stream of a Blob, also where Blob.stream() is missing (older browsers, jsdom). */
function streamOf(b: Blob): ReadableStream<Uint8Array> {
  if (typeof (b as Blob & { stream?: unknown }).stream === 'function') return b.stream() as ReadableStream<Uint8Array>;
  const CHUNK = 4 * 1024 * 1024;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (at >= b.size) return ctrl.close();
      const part = new Uint8Array(await blobToArrayBuffer(b.slice(at, at + CHUNK)));
      at += CHUNK;
      ctrl.enqueue(part);
    },
  });
}

export async function inflateRaw(data: Uint8Array | Blob, limit: number, what = 'file'): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('This browser cannot unzip files (no DecompressionStream).');
  const source = data instanceof Uint8Array ? new Blob([data as BlobPart]) : data;
  const stream = streamOf(source).pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  try {
    return await collect(stream, limit, what);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError(`"${what}" is damaged inside the archive and cannot be decompressed.`);
  }
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return data;
  const stream = streamOf(new Blob([data as BlobPart])).pipeThrough(new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  return collect(stream, Number.MAX_SAFE_INTEGER, 'output');
}

/** The decompressed contents of an entry, size-capped and CRC-checked. */
export async function readEntry(archive: ZipArchive, e: ZipEntry, limit = LIMITS.maxEntryBytes): Promise<Uint8Array> {
  if (e.dir) return new Uint8Array(0);
  if (e.unreadable) throw new ZipError(`"${e.path}" cannot be opened: it is ${e.unreadable}.`);
  if (e.size > limit) throw new ZipError(`"${e.path}" is ${Math.round(e.size / 1048576)} MB, more than the ${Math.round(limit / 1048576)} MB that can be opened at once.`);
  const raw = await rawData(archive, e);
  let out: Uint8Array;
  if (e.method === 0) {
    out = new Uint8Array(await blobToArrayBuffer(raw));
  } else {
    // Allow a little slack over the declared size, never more than the cap.
    out = await inflateRaw(raw, Math.min(limit, e.size + 1024), e.path);
  }
  if (out.length !== e.size) throw new ZipError(`"${e.path}" is damaged inside the archive (wrong size).`);
  if (crc32(out) !== e.crc32) throw new ZipError(`"${e.path}" is damaged inside the archive (checksum mismatch).`);
  return out;
}
