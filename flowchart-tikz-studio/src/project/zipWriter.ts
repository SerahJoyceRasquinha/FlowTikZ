import { crc32, deflateRaw } from './zip';

/**
 * Builds a zip archive as a Blob made of parts.
 *
 * Unchanged files are carried over as slices of the original archive - still
 * compressed, never decompressed, never copied into memory - so exporting a
 * huge project costs little more than the files that were edited. Zip64
 * records are written automatically when the archive passes 4 GB or 65,535
 * entries.
 */

export interface WriteEntry {
  path: string;
  /** Already-compressed bytes (with `method`), or plain bytes for method 0. */
  data: Blob | Uint8Array;
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  /** General-purpose flags to keep (encryption); the data-descriptor bit is dropped. */
  flags?: number;
  dosTime?: number;
  dosDate?: number;
  externalAttrs?: number;
  dir?: boolean;
}

/** A new or edited file: compressed here when that makes it smaller. */
export async function fileEntry(path: string, bytes: Uint8Array, when = new Date()): Promise<WriteEntry> {
  const crc = crc32(bytes);
  const deflated = bytes.length > 64 ? await deflateRaw(bytes) : bytes;
  const useDeflate = deflated !== bytes && deflated.length < bytes.length;
  const { time, date } = toDos(when);
  return {
    path,
    data: useDeflate ? deflated : bytes,
    method: useDeflate ? 8 : 0,
    crc32: crc,
    compressedSize: useDeflate ? deflated.length : bytes.length,
    size: bytes.length,
    dosTime: time,
    dosDate: date,
  };
}

export function toDos(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const enc = new TextEncoder();

class Bytes {
  private a: number[] = [];
  u16(v: number) {
    this.a.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number) {
    this.a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: number) {
    this.u32(v >>> 0);
    this.u32(Math.floor(v / 0x1_0000_0000) >>> 0);
    return this;
  }
  raw(b: Uint8Array) {
    for (const x of b) this.a.push(x);
    return this;
  }
  done() {
    return new Uint8Array(this.a);
  }
}

const MAX32 = 0xffffffff;

/** Options exposed for tests: force Zip64 records without writing 4 GB. */
export interface BuildOptions {
  forceZip64?: boolean;
  comment?: string;
}

/** Collects output parts, merging runs of small byte arrays into big chunks. */
class Parts {
  readonly list: (Blob | Uint8Array)[] = [];
  private pending: Uint8Array[] = [];
  private pendingSize = 0;
  push(...items: (Blob | Uint8Array)[]) {
    for (const it of items) {
      if (it instanceof Uint8Array && it.length < 1024 * 1024) {
        this.pending.push(it);
        this.pendingSize += it.length;
        if (this.pendingSize >= 4 * 1024 * 1024) this.flush();
      } else {
        this.flush();
        this.list.push(it);
      }
    }
  }
  flush() {
    if (!this.pending.length) return;
    const out = new Uint8Array(this.pendingSize);
    let o = 0;
    for (const p of this.pending) {
      out.set(p, o);
      o += p.length;
    }
    this.list.push(out);
    this.pending = [];
    this.pendingSize = 0;
  }
}

export function buildZip(entries: WriteEntry[], opts: BuildOptions = {}): Blob {
  const parts = new Parts();
  const central: Uint8Array[] = [];
  let offset = 0;
  let anyZip64 = !!opts.forceZip64 || entries.length >= 0xffff;

  for (const e of entries) {
    const name = enc.encode(e.dir && !e.path.endsWith('/') ? `${e.path}/` : e.path);
    const big = !!opts.forceZip64 || e.size >= MAX32 || e.compressedSize >= MAX32;
    const bigOffset = !!opts.forceZip64 || offset >= MAX32;
    if (big || bigOffset) anyZip64 = true;
    const flags = ((e.flags ?? 0) & ~0x0008) | 0x0800; // UTF-8 names, sizes in the header
    const version = big || bigOffset ? 45 : e.method === 8 ? 20 : 10;

    // Local header (sizes in a zip64 extra when large).
    const localExtra = big ? new Bytes().u16(0x0001).u16(16).u64(e.size).u64(e.compressedSize).done() : new Uint8Array(0);
    const local = new Bytes()
      .u32(0x04034b50)
      .u16(version)
      .u16(flags)
      .u16(e.method)
      .u16(e.dosTime ?? 0)
      .u16(e.dosDate ?? 0x21)
      .u32(e.crc32)
      .u32(big ? MAX32 : e.compressedSize)
      .u32(big ? MAX32 : e.size)
      .u16(name.length)
      .u16(localExtra.length)
      .raw(name)
      .raw(localExtra)
      .done();
    parts.push(local, e.data);

    const cExtraParts = new Bytes();
    let cExtraLen = 0;
    if (big || bigOffset) {
      const fields = (big ? 16 : 0) + (bigOffset ? 8 : 0);
      cExtraParts.u16(0x0001).u16(fields);
      if (big) cExtraParts.u64(e.size).u64(e.compressedSize);
      if (bigOffset) cExtraParts.u64(offset);
      cExtraLen = 4 + fields;
    }
    const cExtra = cExtraParts.done();
    central.push(
      new Bytes()
        .u32(0x02014b50)
        .u16((3 << 8) | version) // made by: Unix, so attributes travel
        .u16(version)
        .u16(flags)
        .u16(e.method)
        .u16(e.dosTime ?? 0)
        .u16(e.dosDate ?? 0x21)
        .u32(e.crc32)
        .u32(big ? MAX32 : e.compressedSize)
        .u32(big ? MAX32 : e.size)
        .u16(name.length)
        .u16(cExtraLen)
        .u16(0)
        .u16(0)
        .u16(0)
        .u32(e.externalAttrs ?? (e.dir ? 0o40755 << 16 : 0o100644 << 16))
        .u32(bigOffset ? MAX32 : offset)
        .raw(name)
        .raw(cExtra)
        .done(),
    );
    offset += local.length + e.compressedSize;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    parts.push(c);
    cdSize += c.length;
  }
  if (cdStart >= MAX32 || cdSize >= MAX32) anyZip64 = true;

  if (anyZip64) {
    const recAt = cdStart + cdSize;
    parts.push(
      new Bytes()
        .u32(0x06064b50)
        .u64(44)
        .u16(45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(entries.length)
        .u64(entries.length)
        .u64(cdSize)
        .u64(cdStart)
        .done(),
      new Bytes().u32(0x07064b50).u32(0).u64(recAt).u32(1).done(),
    );
  }
  const comment = enc.encode(opts.comment ?? '');
  parts.push(
    new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(anyZip64 ? 0xffff : entries.length)
      .u16(anyZip64 ? 0xffff : entries.length)
      .u32(anyZip64 ? MAX32 : cdSize)
      .u32(anyZip64 ? MAX32 : cdStart)
      .u16(comment.length)
      .raw(comment)
      .done(),
  );
  parts.flush();
  return new Blob(parts.list as BlobPart[], { type: 'application/zip' });
}
