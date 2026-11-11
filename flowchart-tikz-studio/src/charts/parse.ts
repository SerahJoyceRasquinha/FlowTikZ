import type { CellValue, ColumnType, DataColumn, DataTable } from './types';

/**
 * Tabular data import: CSV / TSV / pasted text, and Excel .xlsx workbooks.
 *
 * Everything here is pure and DOM-free. Excel files are read directly - an
 * .xlsx is a zip of XML parts - with the platform's DecompressionStream and
 * the project's own hardened XML parser, so no third-party spreadsheet code
 * runs on the user's files.
 */

export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 60;

export class DataImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataImportError';
  }
}

export interface ParsedTable {
  table: DataTable;
  warnings: string[];
}

/* =================================================================== text */

const EMPTY = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none', '#n/a', 'nan']);

export function isEmptyCell(s: string): boolean {
  return EMPTY.has(s.trim().toLowerCase());
}

/**
 * Parse a number the way a spreadsheet user writes one: "1,234.5", "₹50,000",
 * "$12", "12%", "(300)" for -300, "1.234,5" when the file uses decimal commas.
 */
export function parseNumber(raw: string, decimalComma = false): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[₹$€£¥]\s*/, '').replace(/^(rs\.?|inr|usd|eur)\s*/i, '');
  s = s.replace(/\s*(%|₹|\$|€|£)$/, '');
  s = s.replace(/[\s  ']/g, '');
  if (decimalComma) {
    if (!/^[+-]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return negative ? -v : v;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse a date string into ISO "YYYY-MM-DD". `dayFirst` decides the
 * ambiguous "03/04/2026"; the caller works it out for a whole column.
 */
export function parseDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})\.?[-\s/,]+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const y = Number(m[3]);
    const d = Number(m[1]);
    return mo && validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const y = Number(m[3]);
    const d = Number(m[2]);
    return mo && validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  return null;
}

/** Decide day-first vs month-first for a column of slash dates. */
function detectDayFirst(values: string[]): boolean {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst++;
    if (Number(m[2]) > 12) monthFirst++;
  }
  // Ambiguous columns default to day-first, the convention in India and Europe.
  return monthFirst > dayFirst ? false : true;
}

/* ===================================================================== CSV */

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  if (sample.length === 0) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Quick quote-aware split of one line; used only for delimiter detection. */
function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === d && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const s = text.replace(/^﻿/, '');
  const pushField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      wasQuoted = true;
      field = '';
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      pushField();
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
    } else field += ch;
  }
  if (field !== '' || row.length) {
    pushField();
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Decode bytes as UTF-8, falling back to Windows-1252 (Excel's "CSV" on Windows). */
export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 0) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/* ================================================================ typing */

function uniqueNames(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((name, i) => {
    let base = name.replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    if (base.length > 60) base = base.slice(0, 60);
    const n = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

/**
 * Turn a grid of strings (first row = header) into a typed table. A column is
 * a number column when at least 95% of its non-empty cells read as numbers;
 * the rest become blanks and are reported. Dates work the same way.
 */
export function tableFromGrid(
  input: (string | number | null)[][],
  name: string,
  source: string,
  opts: { decimalComma?: boolean; hasHeader?: boolean; dateColumns?: Set<number> } = {},
): ParsedTable {
  const warnings: string[] = [];
  let grid = input;
  if (grid.length === 0) throw new DataImportError('The file has no rows.');
  const hasHeader = opts.hasHeader ?? true;
  // Spreadsheets often carry a title row (or two) above the real header. The
  // header is the first row that is about as full as the widest of the first rows.
  if (hasHeader) {
    const filled = (r: (string | number | null)[]) => r.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length;
    const head = grid.slice(0, 10);
    const widest = Math.max(...head.map(filled));
    const start = head.findIndex((r) => filled(r) >= Math.max(2, Math.ceil(widest * 0.6)));
    if (start > 0 && start < grid.length - 1) {
      warnings.push(`Skipped ${start} title row${start === 1 ? '' : 's'} above the column names.`);
      grid = grid.slice(start);
    }
  }
  let width = Math.max(...grid.slice(0, 200).map((r) => r.length));
  if (width > MAX_COLUMNS) {
    warnings.push(`Only the first ${MAX_COLUMNS} of ${width} columns were imported.`);
    width = MAX_COLUMNS;
  }
  const headerRow = hasHeader ? grid[0] : [];
  const names = uniqueNames(
    Array.from({ length: width }, (_, i) => (hasHeader ? String(headerRow[i] ?? '') : `Column ${i + 1}`)),
  );
  let body = hasHeader ? grid.slice(1) : grid;
  if (body.length > MAX_ROWS) {
    warnings.push(`Only the first ${MAX_ROWS.toLocaleString('en-US')} of ${body.length.toLocaleString('en-US')} rows were imported.`);
    body = body.slice(0, MAX_ROWS);
  }
  if (body.length === 0) throw new DataImportError('The file has a header row but no data rows.');

  const columns: DataColumn[] = [];
  const converters: ((v: string | number | null) => CellValue)[] = [];

  for (let c = 0; c < width; c++) {
    const raw = body.map((r) => r[c] ?? null);
    const strings = raw
      .filter((v) => v !== null && !(typeof v === 'string' && isEmptyCell(v)))
      .map((v) => (typeof v === 'number' ? v : String(v)));
    let type: ColumnType = 'text';
    let failures = 0;
    if (strings.length > 0) {
      if (opts.dateColumns?.has(c)) {
        type = 'date';
      } else {
        const nums = strings.filter(
          (v) => typeof v === 'number' || parseNumber(String(v), opts.decimalComma) !== null,
        ).length;
        const textOnly = strings.filter((v) => typeof v === 'string');
        const dayFirst = detectDayFirst(textOnly as string[]);
        const dates = textOnly.filter((v) => parseDate(v as string, dayFirst) !== null).length;
        if (nums / strings.length >= 0.95) {
          type = 'number';
          failures = strings.length - nums;
        } else if (textOnly.length === strings.length && dates / strings.length >= 0.95) {
          type = 'date';
          failures = strings.length - dates;
        }
        if (type === 'date') {
          const df = dayFirst;
          converters[c] = (v) =>
            v === null || (typeof v === 'string' && isEmptyCell(v)) ? null : parseDate(String(v), df);
        }
      }
    }
    if (type === 'number') {
      converters[c] = (v) => {
        if (v === null) return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        return isEmptyCell(v) ? null : parseNumber(v, opts.decimalComma);
      };
    } else if (type === 'text') {
      converters[c] = (v) => {
        if (v === null) return null;
        const s = typeof v === 'number' ? formatPlainNumber(v) : v.trim();
        return s === '' ? null : s;
      };
    } else if (!converters[c]) {
      converters[c] = (v) => (v === null ? null : String(v));
    }
    if (failures > 0) {
      warnings.push(`${failures} value${failures === 1 ? '' : 's'} in "${names[c]}" could not be read as ${type === 'number' ? 'numbers' : 'dates'} and were left blank.`);
    }
    columns.push({ name: names[c], type });
  }

  const rows: CellValue[][] = body.map((r) => columns.map((_, c) => converters[c](r[c] ?? null)));
  // Columns with nothing in them at all are noise from trailing delimiters.
  const keep = columns.map((_, c) => rows.some((r) => r[c] !== null) || (hasHeader && String(headerRow[c] ?? '').trim() !== ''));
  const finalColumns = columns.filter((_, c) => keep[c]);
  const finalRows = rows.map((r) => r.filter((_, c) => keep[c]));
  if (finalColumns.length === 0) throw new DataImportError('No columns with data were found.');

  return {
    table: { name, source, columns: finalColumns, rows: finalRows },
    warnings,
  };
}

function formatPlainNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e10) / 1e10);
}

/** CSV, TSV, semicolon files and text pasted from a spreadsheet. */
export function parseCsvText(text: string, name: string, source = 'csv'): ParsedTable {
  if (!text.trim()) throw new DataImportError('The file is empty.');
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length < 2) throw new DataImportError('Need a header row and at least one data row.');
  if (Math.max(...grid.map((r) => r.length)) < 1) throw new DataImportError('No columns were found.');
  return tableFromGrid(grid, name, source, { decimalComma: delimiter === ';' });
}

/** Convert a type override chosen by the user, re-reading the column. */
export function retypeColumn(table: DataTable, column: string, type: ColumnType): DataTable {
  const idx = table.columns.findIndex((c) => c.name === column);
  if (idx < 0) return table;
  const columns = table.columns.map((c, i) => (i === idx ? { ...c, type } : c));
  const strings = table.rows.map((r) => r[idx]);
  const dayFirst = detectDayFirst(strings.filter((v): v is string => typeof v === 'string'));
  const conv = (v: CellValue): CellValue => {
    if (v === null) return null;
    if (type === 'number') return typeof v === 'number' ? v : parseNumber(v);
    if (type === 'date') {
      if (typeof v === 'number') return excelSerialToIso(v);
      return parseDate(v, dayFirst);
    }
    return typeof v === 'number' ? formatPlainNumber(v) : v;
  };
  const rows = table.rows.map((r) => r.map((v, i) => (i === idx ? conv(v) : v)));
  return { ...table, columns, rows };
}

/* ==================================================================== XLSX */

/** Excel day serial (1900 system) to ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // Day 60 is the fictitious 29 Feb 1900; Excel's epoch is effectively 30 Dec 1899.
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Old binary Excel (.xls) and other OLE2 compound files. */
export function isOle2(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length > 8 && sig.every((v, i) => bytes[i] === v);
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DataImportError('The workbook is damaged (no zip directory).');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name.replace(/\\/g, '/'), { name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipFile(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const o = entry.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new DataImportError('The workbook is damaged (bad zip entry).');
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder('utf-8').decode(data);
  if (entry.method !== 8) throw new DataImportError('The workbook uses an unsupported compression method.');
  const { inflate } = await import('../import/binary');
  const out = await inflate(data, 'deflate-raw', 200 * 1024 * 1024);
  return new TextDecoder('utf-8').decode(out);
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function colIndex(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmy]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped);
}

export interface WorkbookSheet {
  name: string;
  path: string;
}

export interface Workbook {
  sheets: WorkbookSheet[];
  readSheet: (name: string) => Promise<ParsedTable>;
}

/** Open an .xlsx workbook. Sheets are read on demand. */
export async function openXlsx(bytes: Uint8Array, fileName: string): Promise<Workbook> {
  if (isOle2(bytes)) {
    throw new DataImportError(
      'This is an old binary Excel file (.xls). Open it in Excel and use File > Save As > Excel Workbook (.xlsx) or CSV, then import that.',
    );
  }
  if (!isZip(bytes)) throw new DataImportError('This is not an Excel .xlsx workbook.');
  // Note: the parser's helpers compare lower-cased local names ("cellxfs").
  const { parseXml, findAll, findFirst, attr, textContent, localName } = await import('../import/xml/parser');
  const dir = readZipDirectory(bytes);
  const get = async (path: string): Promise<string | null> => {
    const e = dir.get(path);
    return e ? readZipFile(bytes, e) : null;
  };

  const workbookXml = await get('xl/workbook.xml');
  if (!workbookXml) throw new DataImportError('This zip file is not an Excel workbook (xl/workbook.xml is missing).');
  const wb = parseXml(workbookXml);
  const relsXml = await get('xl/_rels/workbook.xml.rels');
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const r of findAll(parseXml(relsXml), 'relationship')) {
      const id = attr(r, 'Id');
      const target = attr(r, 'Target');
      if (id && target) rels.set(id, resolvePart('xl/workbook.xml', target));
    }
  }
  const sheets: WorkbookSheet[] = [];
  for (const s of findAll(wb, 'sheet')) {
    const name = attr(s, 'name') ?? `Sheet${sheets.length + 1}`;
    const rid = Object.entries(s.attrs).find(([k]) => localName(k) === 'id' && k.includes(':'))?.[1];
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    if (dir.has(path)) sheets.push({ name, path });
  }
  if (sheets.length === 0) throw new DataImportError('The workbook has no worksheets.');

  // Shared strings and number formats are shared by every sheet.
  const shared: string[] = [];
  const ssXml = await get('xl/sharedStrings.xml');
  if (ssXml) {
    const ss = parseXml(ssXml, { maxElements: 3_000_000 });
    for (const si of findAll(ss, 'si')) {
      // Rich text: concatenate every run's <t>, but skip phonetic hints.
      let text = '';
      const walk = (el: typeof si) => {
        for (const ch of el.children) {
          if (ch.type !== 'element') continue;
          const ln = localName(ch.name);
          if (ln === 'rph' || ln === 'phoneticpr') continue;
          if (ln === 't') text += textContent(ch);
          else walk(ch);
        }
      };
      walk(si);
      shared.push(text);
    }
  }
  const dateStyles = new Set<number>();
  const stylesXml = await get('xl/styles.xml');
  if (stylesXml) {
    const st = parseXml(stylesXml);
    const custom = new Map<number, string>();
    for (const nf of findAll(st, 'numfmt')) {
      custom.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? '');
    }
    const cellXfs = findFirst(st, 'cellxfs');
    if (cellXfs) {
      findAll(cellXfs, 'xf').forEach((xf, i) => {
        const id = Number(attr(xf, 'numFmtId') ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!))) {
          dateStyles.add(i);
        }
      });
    }
  }

  const readSheet = async (name: string): Promise<ParsedTable> => {
    const sheet = sheets.find((s) => s.name === name) ?? sheets[0];
    const xml = await get(sheet.path);
    if (!xml) throw new DataImportError(`Sheet "${name}" could not be read.`);
    const doc = parseXml(xml, { maxElements: 4_000_000 });
    const grid: (string | number | null)[][] = [];
    const dateCells = new Map<number, { dates: number; numbers: number }>();
    let rowIndex = -1;
    for (const row of findAll(doc, 'row')) {
      const r = Number(attr(row, 'r'));
      rowIndex = Number.isFinite(r) && r > 0 ? r - 1 : rowIndex + 1;
      if (grid.length > MAX_ROWS + 1 && rowIndex > MAX_ROWS + 1) break;
      const cells: (string | number | null)[] = [];
      let col = -1;
      for (const c of row.children) {
        if (c.type !== 'element' || localName(c.name) !== 'c') continue;
        const ref = attr(c, 'r');
        col = ref ? colIndex(ref) : col + 1;
        if (col < 0 || col >= MAX_COLUMNS * 2) continue;
        const t = attr(c, 't') ?? 'n';
        const s = Number(attr(c, 's') ?? -1);
        const vEl = c.children.find((x) => x.type === 'element' && localName(x.name) === 'v');
        const v = vEl ? textContent(vEl) : '';
        let value: string | number | null = null;
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') {
          const is = c.children.find((x) => x.type === 'element' && localName(x.name) === 'is');
          value = is && is.type === 'element' ? findAll(is, 't').map(textContent).join('') : '';
        } else if (t === 'str') value = v;
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') value = null;
        else if (t === 'd') value = v.slice(0, 10);
        else if (v !== '') {
          const num = Number(v);
          value = Number.isFinite(num) ? num : v;
          if (typeof value === 'number' && rowIndex > 0) {
            const stats = dateCells.get(col) ?? { dates: 0, numbers: 0 };
            if (dateStyles.has(s)) stats.dates++;
            else stats.numbers++;
            dateCells.set(col, stats);
          }
        }
        cells[col] = value;
      }
      // Leading blank rows (title rows) are skipped below.
      grid[rowIndex] = cells;
    }
    // Compact: drop rows that are entirely empty.
    const dense = grid.filter((r) => r && r.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
    if (dense.length < 2) throw new DataImportError(`Sheet "${sheet.name}" needs a header row and at least one data row.`);
    // Columns whose numbers are formatted as dates become ISO date strings.
    const headerLen = Math.max(...dense.slice(0, 50).map((r) => r.length));
    const dateColumns = new Set<number>();
    for (const [col, stats] of dateCells) {
      if (stats.dates > 0 && stats.dates >= stats.numbers) dateColumns.add(col);
    }
    const normalised = dense.map((r, i) =>
      Array.from({ length: headerLen }, (_, c) => {
        const v = r[c];
        if (v === undefined) return null;
        if (i > 0 && dateColumns.has(c) && typeof v === 'number') return excelSerialToIso(v);
        return v;
      }),
    );
    return tableFromGrid(normalised, sheets.length > 1 ? `${fileName} (${sheet.name})` : fileName, 'xlsx', { dateColumns });
  };

  return { sheets, readSheet };
}

/* ================================================================= entry */

export type DataSource =
  | { kind: 'table'; parsed: ParsedTable }
  | { kind: 'workbook'; workbook: Workbook; fileName: string };

export const DATA_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Read any supported data file. Workbooks with several sheets return the workbook. */
export async function readDataFile(name: string, bytes: Uint8Array): Promise<DataSource> {
  const lower = name.toLowerCase();
  if (isOle2(bytes) || lower.endsWith('.xls')) {
    if (isZip(bytes)) {
      // A mis-named .xlsx.
    } else {
      throw new DataImportError(
        'This is an old binary Excel file (.xls). Open it in Excel and use File > Save As > Excel Workbook (.xlsx) or CSV, then import that.',
      );
    }
  }
  if (lower.endsWith('.ods') || lower.endsWith('.numbers')) {
    throw new DataImportError('Please save the file as .xlsx or .csv first; this format is not supported.');
  }
  if (isZip(bytes)) {
    const workbook = await openXlsx(bytes, name);
    return { kind: 'workbook', workbook, fileName: name };
  }
  if (bytes.length > 60 * 1024 * 1024) throw new DataImportError('The file is larger than 60 MB.');
  const text = decodeText(bytes);
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000))) {
    throw new DataImportError('This does not look like a text (CSV) file or an Excel workbook.');
  }
  return { kind: 'table', parsed: parseCsvText(text, name, 'csv') };
}

/** The table from the reference brief, so the feature can be tried without a file. */
export function sampleSalesTable(): DataTable {
  const rows: CellValue[][] = [
    ['2026-01-01', 'Laptop', 'North', 50000, 5],
    ['2026-01-02', 'Mobile', 'South', 30000, 10],
    ['2026-01-03', 'Laptop', 'South', 40000, 4],
    ['2026-01-04', 'Tablet', 'North', 20000, 8],
    ['2026-01-05', 'Mobile', 'North', 35000, 7],
    ['2026-02-02', 'Laptop', 'North', 56000, 6],
    ['2026-02-09', 'Tablet', 'South', 18000, 7],
    ['2026-02-16', 'Mobile', 'South', 33000, 11],
    ['2026-03-03', 'Laptop', 'South', 47000, 5],
    ['2026-03-10', 'Mobile', 'North', 39000, 8],
    ['2026-03-17', 'Tablet', 'North', 24000, 9],
    ['2026-03-24', 'Laptop', 'North', 52000, 5],
  ];
  return {
    name: 'Sample sales data',
    source: 'sample',
    columns: [
      { name: 'Date', type: 'date' },
      { name: 'Product', type: 'text' },
      { name: 'Region', type: 'text' },
      { name: 'Sales', type: 'number' },
      { name: 'Quantity', type: 'number' },
    ],
    rows,
  };
}
