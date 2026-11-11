import { describe, expect, it } from 'vitest';
import salesXlsx from './fixtures/data/sales.xlsx?b64';
import excelStyleXlsx from './fixtures/data/excel-style.xlsx?b64';
import messyCsv from './fixtures/data/messy.csv?b64';
import semicolonCsv from './fixtures/data/semicolon.csv?b64';
import { base64ToBytes } from '../import/binary';
import {
  DataImportError,
  detectDelimiter,
  excelSerialToIso,
  parseCsvText,
  parseDate,
  parseDelimited,
  parseNumber,
  readDataFile,
  retypeColumn,
} from '../charts/parse';

const FIXTURES: Record<string, string> = {
  'sales.xlsx': salesXlsx,
  'excel-style.xlsx': excelStyleXlsx,
  'messy.csv': messyCsv,
  'semicolon.csv': semicolonCsv,
};
const fixture = (name: string) => base64ToBytes(FIXTURES[name]);
const col = (t: { columns: { name: string; type: string }[] }, name: string) => t.columns.find((c) => c.name === name);

describe('number and date reading', () => {
  it('reads numbers the way spreadsheet users write them', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('₹50,000')).toBe(50000);
    expect(parseNumber('$12')).toBe(12);
    expect(parseNumber('Rs. 400')).toBe(400);
    expect(parseNumber('12%')).toBe(12);
    expect(parseNumber('(300)')).toBe(-300);
    expect(parseNumber('-4.5e3')).toBe(-4500);
    expect(parseNumber('1.234,5', true)).toBe(1234.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('12abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('reads common date spellings into ISO dates', () => {
    expect(parseDate('2026-01-05')).toBe('2026-01-05');
    expect(parseDate('2026-01-05T10:30:00Z')).toBe('2026-01-05');
    expect(parseDate('03/04/2026', true)).toBe('2026-04-03');
    expect(parseDate('03/04/2026', false)).toBe('2026-03-04');
    expect(parseDate('1 Jan 2026')).toBe('2026-01-01');
    expect(parseDate('01-Jan-2026')).toBe('2026-01-01');
    expect(parseDate('March 5, 2026')).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('01-Jan')).toBeNull();
  });

  it('converts Excel day serials', () => {
    expect(excelSerialToIso(46023)).toBe('2026-01-01');
    expect(excelSerialToIso(1)).toBe('1899-12-31');
    expect(excelSerialToIso(-5)).toBeNull();
  });
});

describe('CSV and pasted text', () => {
  it('detects the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
  });

  it('handles quotes, doubled quotes and newlines inside quotes', () => {
    const rows = parseDelimited('a,b\n"x, y","say ""hi""\nthere"\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });

  it('types columns and keeps the header names exactly', () => {
    const { table, warnings } = parseCsvText(new TextDecoder().decode(fixture('messy.csv')), 'messy.csv');
    expect(table.columns.map((c) => c.name)).toEqual(['Name, full', 'Amount', 'When', 'Note']);
    expect(col(table, 'Amount')?.type).toBe('number');
    expect(col(table, 'When')?.type).toBe('date');
    expect(col(table, 'Note')?.type).toBe('text');
    expect(table.rows.map((r) => r[1])).toEqual([1200, 2500.5, null, -300]);
    // 25/12 forces day-first for the whole column, so 03/04 is 3 April.
    expect(table.rows.map((r) => r[2])).toEqual(['2026-04-03', '2026-12-25', '2026-01-01', '2026-06-15']);
    expect(table.rows[0][3]).toBe('said "hi"\non two lines');
    expect(warnings).toEqual([]);
  });

  it('reads semicolon files with decimal commas and a BOM', () => {
    const { table } = parseCsvText(new TextDecoder().decode(fixture('semicolon.csv')), 'semicolon.csv');
    expect(table.columns.map((c) => c.name)).toEqual(['Product', 'Region', 'Sales']);
    expect(table.rows.map((r) => r[2])).toEqual([50000.5, 30000, 1234.25]);
    expect(table.rows[2][1]).toBe('North; East');
  });

  it('reads tab-separated text pasted from Excel', () => {
    const { table } = parseCsvText('Product\tSales\nLaptop\t50000\nMobile\t30000\n', 'Pasted data', 'paste');
    expect(table.source).toBe('paste');
    expect(table.rows).toEqual([
      ['Laptop', 50000],
      ['Mobile', 30000],
    ]);
  });

  it('names blank and duplicate headers sensibly', () => {
    const { table } = parseCsvText(',Sales,Sales\nA,1,2\n', 'x.csv');
    expect(table.columns.map((c) => c.name)).toEqual(['Column 1', 'Sales', 'Sales (2)']);
  });

  it('blanks the few cells that do not fit a numeric column, and says so', () => {
    const lines = ['Item,Value', ...Array.from({ length: 30 }, (_, i) => `i${i},${i}`), 'bad,oops'];
    const { table, warnings } = parseCsvText(lines.join('\n'), 'x.csv');
    expect(col(table, 'Value')?.type).toBe('number');
    expect(table.rows[30][1]).toBeNull();
    expect(warnings[0]).toMatch(/1 value in "Value" could not be read as numbers/);
  });

  it('rejects empty and header-only files with a clear message', () => {
    expect(() => parseCsvText('', 'e.csv')).toThrow(DataImportError);
    expect(() => parseCsvText('a,b\n', 'e.csv')).toThrow(/header row and at least one data row/);
  });

  it('lets the user change a column type afterwards', () => {
    const { table } = parseCsvText('Year,Sales\n2024,10\n2025,20\n', 'y.csv');
    expect(col(table, 'Year')?.type).toBe('number');
    const t2 = retypeColumn(table, 'Year', 'text');
    expect(col(t2, 'Year')?.type).toBe('text');
    expect(t2.rows.map((r) => r[0])).toEqual(['2024', '2025']);
    const t3 = retypeColumn(t2, 'Year', 'number');
    expect(t3.rows.map((r) => r[0])).toEqual([2024, 2025]);
  });
});

describe('Excel workbooks', () => {
  it('lists the sheets and reads the first, with dates, numbers and formulas', async () => {
    const src = await readDataFile('sales.xlsx', fixture('sales.xlsx'));
    expect(src.kind).toBe('workbook');
    if (src.kind !== 'workbook') return;
    expect(src.workbook.sheets.map((s) => s.name)).toEqual(['Sales', 'Marks']);
    const { table } = await src.workbook.readSheet('Sales');
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ['Date', 'date'],
      ['Product', 'text'],
      ['Region', 'text'],
      ['Sales', 'number'],
      ['Quantity', 'number'],
      ['Revenue per unit', 'text'],
    ]);
    expect(table.rows[0].slice(0, 5)).toEqual(['2026-01-01', 'Laptop', 'North', 50000, 5]);
    expect(table.rows).toHaveLength(5);
  });

  it('skips title rows above the header and keeps booleans and blanks', async () => {
    const src = await readDataFile('sales.xlsx', fixture('sales.xlsx'));
    if (src.kind !== 'workbook') throw new Error('expected workbook');
    const { table, warnings } = await src.workbook.readSheet('Marks');
    expect(table.name).toBe('sales.xlsx (Marks)');
    expect(warnings).toContain('Skipped 1 title row above the column names.');
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ['Student', 'text'],
      ['Subject', 'text'],
      ['Score', 'number'],
      ['Passed', 'text'],
    ]);
    expect(table.rows.map((r) => r[2])).toEqual([78, 45, 91, null, 66]);
    expect(table.rows.map((r) => r[3])).toEqual(['TRUE', 'FALSE', 'TRUE', null, 'TRUE']);
  });

  it('reads shared strings, rich text, cached formula values, custom date formats and errors', async () => {
    const src = await readDataFile('excel-style.xlsx', fixture('excel-style.xlsx'));
    if (src.kind !== 'workbook') throw new Error('expected workbook');
    expect(src.workbook.sheets.map((s) => s.name)).toEqual(['Q1 & Q2']);
    const { table } = await src.workbook.readSheet('Q1 & Q2');
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ['Month', 'date'],
      ['Team', 'text'],
      ['Cost', 'number'],
      ['Approved', 'text'],
      ['Double', 'number'],
      ['Notes', 'text'],
    ]);
    expect(table.rows.map((r) => r[0])).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(table.rows.map((r) => r[1])).toEqual(['R&D lab', 'Ops', 'Café', 'Ops']);
    expect(table.rows.map((r) => r[2])).toEqual([1250.5, 980, 400.25, 610]);
    expect(table.rows.map((r) => r[3])).toEqual(['TRUE', 'FALSE', 'TRUE', null]);
    expect(table.rows.map((r) => r[4])).toEqual([2501, null, 800.5, null]);
  });

  it('explains what to do with an old .xls file', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readDataFile('old.xls', ole)).rejects.toThrow(/Save As > Excel Workbook \(.xlsx\)/);
  });

  it('rejects a zip that is not a workbook, and binary junk', async () => {
    const notWorkbook = fixture('sales.xlsx').slice(0, 200);
    await expect(readDataFile('broken.xlsx', notWorkbook)).rejects.toThrow(DataImportError);
    await expect(readDataFile('x.csv', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(/does not look like/);
  });
});
