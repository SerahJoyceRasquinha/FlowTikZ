import { LIMITS, ZipError, dataStarts, openZip, rawSmall, readEntry, type ZipArchive, type ZipEntry } from './zip';
import { buildZip, fileEntry, type WriteEntry } from './zipWriter';
import { detectMain, type MainDetection } from './texScan';
import type { FileAccess } from './document';

/**
 * A LaTeX project opened from a zip, the way Overleaf takes one.
 *
 * Text files (.tex, .bib, .sty, .cls...) are read up front so the main file
 * can be found and the document previewed; images and everything else stay
 * inside the archive and are read only when shown or exported.
 */

export type FileKind = 'tex' | 'bib' | 'style' | 'image' | 'pdf' | 'data' | 'other';

export interface ProjectFile {
  /** Path inside the project (without a single wrapping folder). */
  path: string;
  /** Path inside the original archive. */
  archivePath: string;
  entry?: ZipEntry;
  size: number;
  kind: FileKind;
  /** Current text (text files only). */
  text?: string;
  /** Text as imported, to tell what changed. */
  original?: string;
  encoding?: 'utf-8' | 'windows-1252';
  /** The file started with a UTF-8 byte-order mark (kept on export). */
  bom?: boolean;
  /** Text that could not be read (too large, damaged...). */
  error?: string;
}

export interface LatexProject {
  name: string;
  archive: ZipArchive;
  /** Folder every file sat in, stripped for display ("" when none). */
  rootPrefix: string;
  files: Record<string, ProjectFile>;
  /** Paths in archive order. */
  order: string[];
  mainPath: string;
  detection: MainDetection;
  warnings: string[];
  sizeBytes: number;
}

export class ProjectError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ProjectError';
  }
}

export const PROJECT_LIMITS = {
  /** Largest .tex/.bib/.sty file read as text. */
  maxTextFile: 32 * 1024 * 1024,
  /** Total text read up front. */
  maxTotalText: 512 * 1024 * 1024,
  /** Most text files read up front. */
  maxTextFiles: 20_000,
};

const TEXT_EXT = /\.(tex|ltx|bib|sty|cls|bst|bbx|cbx|lbx|dtx|ins|def|cfg|clo|txt|md|latexmkrc|bbl)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

export function kindOf(path: string): FileKind {
  const p = path.toLowerCase();
  if (/\.(tex|ltx)$/.test(p)) return 'tex';
  if (p.endsWith('.bib')) return 'bib';
  if (/\.(sty|cls|bst|bbx|cbx|def|cfg|clo)$/.test(p)) return 'style';
  if (IMAGE_EXT.test(p)) return 'image';
  if (/\.(pdf|eps|ps)$/.test(p)) return 'pdf';
  if (/\.(csv|dat|tsv|txt|json|md)$/.test(p)) return 'data';
  return 'other';
}

/** UTF-8 when valid, Windows-1252 (Latin-1) otherwise - the common inputenc choices. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252'; bom: boolean } {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom ? 3 : 0)), encoding: 'utf-8', bom };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252', bom: false };
  }
}

const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function encodeText(text: string, encoding: 'utf-8' | 'windows-1252' = 'utf-8', bom = false): Uint8Array {
  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 63;
    out[n++] = c < 256 ? c : (CP1252_EXTRA[c] ?? 63);
  }
  return out.subarray(0, n);
}

function commonRoot(paths: string[]): string {
  if (!paths.length) return '';
  const first = paths[0].split('/')[0];
  if (!paths.every((p) => p.includes('/') && p.split('/')[0] === first)) return '';
  return `${first}/`;
}

export interface LoadProgress {
  stage: 'reading' | 'scanning' | 'detecting';
  done: number;
  total: number;
  detail?: string;
}

async function pool<T>(items: T[], size: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** Open a .zip as a LaTeX project. Throws ProjectError with a plain-language message. */
export async function loadProject(file: Blob, name: string, onProgress?: (p: LoadProgress) => void): Promise<LatexProject> {
  let archive: ZipArchive;
  try {
    onProgress?.({ stage: 'reading', done: 0, total: 1, detail: 'Reading the table of contents' });
    archive = await openZip(file);
  } catch (err) {
    // Not a zip at all, and not named like one: say what is wanted.
    if (!/\.zip$/i.test(name)) throw new ProjectError('Please choose a .zip file: the LaTeX project as downloaded from Overleaf, or zipped yourself.');
    if (err instanceof ZipError) throw new ProjectError(err.message);
    throw new ProjectError('The file could not be read.');
  }
  const fileEntries = archive.entries.filter((e) => !e.dir);
  if (fileEntries.length === 0) throw new ProjectError('This zip archive is empty.');

  const rootPrefix = commonRoot(fileEntries.map((e) => e.path));
  const files: Record<string, ProjectFile> = {};
  const order: string[] = [];
  const warnings: string[] = [];
  for (const s of archive.skipped) if (s.reason !== 'system file') warnings.push(`Left out "${s.name}": ${s.reason}.`);
  let sizeBytes = 0;
  for (const e of fileEntries) {
    const path = e.path.slice(rootPrefix.length);
    files[path] = { path, archivePath: e.path, entry: e, size: e.size, kind: kindOf(path) };
    order.push(path);
    sizeBytes += e.size;
  }

  // Read the text files.
  const textFiles = order.filter((p) => TEXT_EXT.test(p) && !/\.bbl$/i.test(p) || /\.tex$/i.test(p));
  if (!textFiles.some((p) => files[p].kind === 'tex')) {
    throw new ProjectError('There is no .tex file in this zip, so there is no LaTeX document to open.', order.slice(0, 12));
  }
  if (textFiles.length > PROJECT_LIMITS.maxTextFiles) {
    warnings.push(`Only the first ${PROJECT_LIMITS.maxTextFiles.toLocaleString('en-US')} text files were read.`);
    textFiles.length = PROJECT_LIMITS.maxTextFiles;
  }
  let totalText = 0;
  let done = 0;
  await pool(textFiles, 6, async (p) => {
    const f = files[p];
    const e = f.entry!;
    if (e.unreadable) {
      f.error = `cannot be opened (${e.unreadable})`;
    } else if (e.size > PROJECT_LIMITS.maxTextFile) {
      f.error = `is ${Math.round(e.size / 1048576)} MB, too large to preview`;
    } else if (totalText + e.size > PROJECT_LIMITS.maxTotalText) {
      f.error = 'was not read: the project has more text than can be held at once';
    } else {
      totalText += e.size;
      try {
        const bytes = await readEntry(archive, e, Math.min(LIMITS.maxEntryBytes, PROJECT_LIMITS.maxTextFile));
        const d = decodeText(bytes);
        f.text = d.text;
        f.original = d.text;
        f.encoding = d.encoding;
        f.bom = d.bom;
      } catch (err) {
        f.error = err instanceof Error ? err.message.replace(/^"[^"]*" /, '') : 'could not be read';
      }
    }
    if (f.error && f.kind === 'tex') warnings.push(`${p} ${f.error}.`);
    done++;
    onProgress?.({ stage: 'scanning', done, total: textFiles.length, detail: p });
  });

  onProgress?.({ stage: 'detecting', done: 1, total: 1 });
  const texFiles = order.filter((p) => files[p].kind === 'tex' && files[p].text !== undefined).map((p) => ({ path: p, text: files[p].text! }));
  const detection = detectMain(texFiles);
  if (!detection.candidates.length) {
    const details = [
      ...detection.rejected.map((r) => `${r.path} ${r.reason}`),
      ...order.filter((p) => files[p].kind === 'tex' && !detection.rejected.some((r) => r.path === p)).slice(0, 10).map((p) => (files[p].error ? `${p}: could not be read (${files[p].error})` : `${p}: no \\documentclass`)),
    ];
    throw new ProjectError(
      'No main LaTeX file was found. The main file is the one with \\documentclass{...} and \\begin{document} … \\end{document}; add it to the zip and try again.',
      details,
    );
  }
  return {
    name: name.replace(/\.zip$/i, ''),
    archive,
    rootPrefix,
    files,
    order,
    mainPath: detection.candidates[0].path,
    detection,
    warnings,
    sizeBytes,
  };
}

/** Read access to the project's current texts, for the parser and the inserter. */
export function access(project: LatexProject, overrides?: Map<string, string>): FileAccess {
  return {
    text: (p) => overrides?.get(p) ?? project.files[p]?.text,
    exists: (p) => p in project.files,
  };
}

export function modifiedPaths(project: LatexProject): string[] {
  return project.order.filter((p) => {
    const f = project.files[p];
    return f.text !== undefined && f.text !== f.original;
  });
}

/** The image bytes of a project file, as an object-URL-ready Blob. */
export async function fileBlob(project: LatexProject, path: string): Promise<Blob> {
  const f = project.files[path];
  if (!f?.entry) throw new ProjectError(`${path} is not in the project.`);
  const bytes = await readEntry(project.archive, f.entry);
  const type = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : '';
  return new Blob([bytes as BlobPart], { type });
}

/**
 * The project as a new zip: edited files rewritten, every other file copied
 * across still compressed, byte for byte, in the original order and folders.
 */
export async function exportProject(project: LatexProject, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const out: WriteEntry[] = [];
  const total = project.archive.entries.length;
  let done = 0;
  const byArchivePath = new Map(Object.values(project.files).map((f) => [f.archivePath, f]));
  const starts = await dataStarts(project.archive, project.archive.entries);
  // Small files are copied in bulk; a download made of thousands of tiny
  // slices of the original file is slow in browsers.
  const inMemory = await rawSmall(project.archive, project.archive.entries, starts);
  const blob = project.archive.blob;
  for (const e of project.archive.entries) {
    done++;
    if (e.dir) {
      out.push({ path: e.path, data: new Uint8Array(0), method: 0, crc32: 0, compressedSize: 0, size: 0, dir: true, dosTime: e.dosTime, dosDate: e.dosDate, externalAttrs: e.externalAttrs });
      continue;
    }
    const f = byArchivePath.get(e.path);
    if (f && f.text !== undefined && f.text !== f.original) {
      const entry = await fileEntry(e.path, encodeText(f.text, f.encoding, !!f.bom));
      entry.externalAttrs = e.externalAttrs;
      out.push(entry);
    } else {
      out.push({
        path: e.path,
        data: inMemory.get(e) ?? (() => {
          const at = starts.get(e)!;
          if (at + e.compressedSize > blob.size) throw new ProjectError(`${e.path} is cut off: the original archive is incomplete.`);
          return blob.slice(at, at + e.compressedSize);
        })(),
        method: e.method,
        crc32: e.crc32,
        compressedSize: e.compressedSize,
        size: e.size,
        flags: e.flags & 0x0001,
        dosTime: e.dosTime,
        dosDate: e.dosDate,
        externalAttrs: (e.versionMadeBy >> 8) === 3 ? e.externalAttrs : 0,
      });
    }
    if (done % 500 === 0) onProgress?.(done, total);
  }
  onProgress?.(total, total);
  return buildZip(out);
}
