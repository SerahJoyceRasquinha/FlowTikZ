import { MATH_CATEGORIES, PHYSICS_CATEGORIES, SymbolDef } from './symbols';
import { unicodeToTex } from './validate';

/**
 * The formula editor's document: a tree of rows, generated to and read from
 * LaTeX. LaTeX is what is stored on the canvas object, so nothing here needs
 * saving; a formula re-opens by parsing its source. Text nodes hold raw TeX,
 * which is what makes the parser lossless: anything it does not model stays
 * in the document verbatim instead of being dropped.
 */

export type StructType =
  | 'frac'
  | 'binom'
  | 'sup'
  | 'sub'
  | 'subsup'
  | 'sqrt'
  | 'nroot'
  | 'group'
  | 'bigop'
  | 'lim'
  | 'accent'
  | 'font'
  | 'matrix'
  | 'cases'
  | 'aligned'
  | 'gathered'
  | 'overset'
  | 'underset'
  | 'text'
  | 'color';

export interface MText {
  t: 'text';
  v: string;
}
export interface MSym {
  t: 'sym';
  tex: string;
  glyph: string;
}
export interface MStruct {
  t: 'struct';
  type: StructType;
  /** Macro, environment, delimiter key or colour spec, depending on `type`. */
  op?: string;
  /** Big operators: force limits above and below. */
  limits?: boolean;
  rows?: number;
  cols?: number;
  slots: MRow[];
}
export type MNode = MText | MSym | MStruct;
export type MRow = MNode[];

/* ------------------------------------------------------------- delimiters */

export const DELIMS: Record<string, { l: string; r: string; gl: string; gr: string; name: string }> = {
  paren: { l: '(', r: ')', gl: '(', gr: ')', name: 'Parentheses' },
  bracket: { l: '[', r: ']', gl: '[', gr: ']', name: 'Brackets' },
  brace: { l: '\\{', r: '\\}', gl: '{', gr: '}', name: 'Braces' },
  abs: { l: '|', r: '|', gl: '|', gr: '|', name: 'Absolute value' },
  norm: { l: '\\|', r: '\\|', gl: '‖', gr: '‖', name: 'Norm' },
  floor: { l: '\\lfloor', r: '\\rfloor', gl: '⌊', gr: '⌋', name: 'Floor' },
  ceil: { l: '\\lceil', r: '\\rceil', gl: '⌈', gr: '⌉', name: 'Ceiling' },
  angle: { l: '\\langle', r: '\\rangle', gl: '⟨', gr: '⟩', name: 'Angle brackets' },
};

const ACCENTS = ['vec', 'hat', 'bar', 'dot', 'ddot', 'tilde', 'overline', 'underline', 'overrightarrow', 'widehat', 'widetilde', 'overbrace', 'underbrace', 'cancel'];
const FONTS = ['mathbf', 'mathrm', 'mathit', 'mathsf', 'mathtt', 'mathbb', 'mathcal', 'mathfrak', 'boldsymbol'];
const BIGOPS = ['int', 'iint', 'iiint', 'oint', 'sum', 'prod', 'coprod', 'bigcup', 'bigcap'];
const LIMS = ['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf'];
const FRACS = ['frac', 'dfrac', 'tfrac', 'cfrac'];
const MATRIX_ENVS = ['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix'];

export const BIGOP_GLYPH: Record<string, string> = { int: '∫', iint: '∬', iiint: '∭', oint: '∮', sum: '∑', prod: '∏', coprod: '∐', bigcup: '⋃', bigcap: '⋂' };

const blank = (): MRow => [{ t: 'text', v: '' }];

export function makeMatrix(env: string, rows: number, cols: number): MStruct {
  return { t: 'struct', type: 'matrix', op: env, rows, cols, slots: Array.from({ length: rows * cols }, blank) };
}

export function makeLines(type: 'cases' | 'aligned' | 'gathered', rows: number): MStruct {
  const cols = type === 'gathered' ? 1 : 2;
  return { t: 'struct', type, rows, cols, slots: Array.from({ length: rows * cols }, blank) };
}

/* ----------------------------------------------------------- slot metadata */

export function slotLabels(st: MStruct): string[] {
  switch (st.type) {
    case 'frac':
      return ['Numerator', 'Denominator'];
    case 'binom':
      return ['Top', 'Bottom'];
    case 'sup':
      return ['Base', 'Exponent'];
    case 'sub':
      return ['Base', 'Subscript'];
    case 'subsup':
      return ['Base', 'Subscript', 'Superscript'];
    case 'sqrt':
      return ['Radicand'];
    case 'nroot':
      return ['Root index', 'Radicand'];
    case 'group':
      return ['Contents'];
    case 'bigop':
      return ['Lower limit', 'Upper limit'];
    case 'lim':
      return ['Under the operator'];
    case 'accent':
    case 'font':
    case 'text':
    case 'color':
      return ['Contents'];
    case 'overset':
      return ['Above', 'Base'];
    case 'underset':
      return ['Below', 'Base'];
    default: {
      const rows = st.rows ?? 1;
      const cols = st.cols ?? 1;
      const out: string[] = [];
      for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out.push(`Row ${r}, column ${c}`);
      return out;
    }
  }
}

/** Slots that may legitimately stay empty. */
export function slotOptional(st: MStruct, i: number): boolean {
  if (st.type === 'bigop') return true;
  if (st.type === 'matrix' || st.type === 'cases' || st.type === 'aligned' || st.type === 'gathered') {
    // Blank cells are ordinary LaTeX, so only a wholly blank table is an error.
    return st.slots.some((s, j) => j !== i && !rowEmpty(s));
  }
  return false;
}

export function rowEmpty(r: MRow): boolean {
  return r.every((n) => n.t === 'text' && !n.v.trim());
}

/** How many required boxes are still empty. */
export function countEmptySlots(r: MRow): number {
  let total = 0;
  for (const n of r) {
    if (n.t !== 'struct') continue;
    n.slots.forEach((slot, i) => {
      if (rowEmpty(slot) && !slotOptional(n, i)) total += 1;
      total += countEmptySlots(slot);
    });
  }
  return total;
}

/* ------------------------------------------------------------- serialising */

interface SerialiseOpts {
  /** Show empty boxes as a square, for the live preview. */
  placeholders?: boolean;
}

function joinTex(parts: string[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(p)) out += ' ';
    out += p;
  }
  return out;
}

export function rowToTex(row: MRow, opts: SerialiseOpts = {}): string {
  return joinTex(
    row.map((n) => {
      if (n.t === 'text') return unicodeToTex(n.v).trim() === '' && n.v !== ' ' ? '' : unicodeToTex(n.v);
      if (n.t === 'sym') return n.tex;
      return structToTex(n, opts);
    }),
  );
}

function slotTex(st: MStruct, i: number, opts: SerialiseOpts): string {
  const row = st.slots[i] ?? blank();
  if (rowEmpty(row)) return opts.placeholders && !slotOptional(st, i) ? '\\square ' : '';
  return rowToTex(row, opts).trim();
}

/** Braces are only added when TeX needs them around a script base. */
function baseTex(row: MRow, opts: SerialiseOpts): string {
  if (rowEmpty(row)) return opts.placeholders ? '\\square ' : '{}';
  const tex = rowToTex(row, opts).trim();
  const real = row.filter((n) => n.t !== 'text' || n.v.trim());
  if (real.length === 1 && real[0].t === 'struct' && !['sup', 'sub', 'subsup'].includes(real[0].type)) return tex;
  if (tex === '{}' || /^(?:[^\\{}\s]|\\[a-zA-Z]+|\\.)$/.test(tex)) return tex;
  return `{${tex}}`;
}

function tableBody(st: MStruct, opts: SerialiseOpts): string {
  const rows = st.rows ?? 1;
  const cols = st.cols ?? 1;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) cells.push(slotTex(st, r * cols + c, opts));
    lines.push(cells.join(' & '));
  }
  return lines.join(' \\\\ ');
}

function limitsTex(lower: string, upper: string): string {
  return `${lower ? `_{${lower}}` : ''}${upper ? `^{${upper}}` : ''}`;
}

export function structToTex(st: MStruct, opts: SerialiseOpts = {}): string {
  const a = (i: number) => slotTex(st, i, opts);
  switch (st.type) {
    case 'frac':
      return `\\${st.op ?? 'frac'}{${a(0)}}{${a(1)}}`;
    case 'binom':
      return `\\binom{${a(0)}}{${a(1)}}`;
    case 'sup':
      return `${baseTex(st.slots[0], opts)}^{${a(1)}}`;
    case 'sub':
      return `${baseTex(st.slots[0], opts)}_{${a(1)}}`;
    case 'subsup':
      return `${baseTex(st.slots[0], opts)}_{${a(1)}}^{${a(2)}}`;
    case 'sqrt':
      return `\\sqrt{${a(0)}}`;
    case 'nroot':
      return `\\sqrt[${a(0)}]{${a(1)}}`;
    case 'group': {
      const d = DELIMS[st.op ?? 'paren'];
      return `\\left${d.l} ${a(0)} \\right${d.r}`;
    }
    case 'bigop':
      return `\\${st.op}${st.limits ? '\\limits' : ''}${limitsTex(a(0), a(1))}`;
    case 'lim':
      return `\\${st.op}_{${a(0)}}`;
    case 'accent':
    case 'font':
      return `\\${st.op}{${a(0)}}`;
    case 'text':
      return `\\text{${(st.slots[0] ?? []).map((n) => (n.t === 'text' ? n.v : '')).join('')}}`;
    case 'color':
      return `\\textcolor${st.op}{${a(0)}}`;
    case 'overset':
    case 'underset':
      return `\\${st.type}{${a(0)}}{${a(1)}}`;
    case 'matrix':
      return `\\begin{${st.op}} ${tableBody(st, opts)} \\end{${st.op}}`;
    case 'cases':
    case 'aligned':
    case 'gathered':
      return `\\begin{${st.type}} ${tableBody(st, opts)} \\end{${st.type}}`;
  }
}

/* ---------------------------------------------------------------- parsing */

const SYMBOLS = new Map<string, SymbolDef>();
for (const c of [...MATH_CATEGORIES, ...PHYSICS_CATEGORIES]) {
  for (const s of c.symbols) if (/^\\[a-zA-Z]+$/.test(s.tex)) SYMBOLS.set(s.tex, s);
}

class Parser {
  i = 0;
  constructor(readonly src: string) {}

  eof() {
    return this.i >= this.src.length;
  }

  skipSpace() {
    while (!this.eof() && /\s/.test(this.src[this.i])) this.i++;
  }

  peekCommand(): string | null {
    if (this.src[this.i] !== '\\') return null;
    const m = /^\\([a-zA-Z]+|.)/.exec(this.src.slice(this.i, this.i + 64));
    return m ? m[1] : null;
  }

  /** The balanced `{...}` at the cursor, without the braces. */
  braced(): string | null {
    this.skipSpace();
    if (this.src[this.i] !== '{') return null;
    let depth = 0;
    for (let j = this.i; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const inner = this.src.slice(this.i + 1, j);
          this.i = j + 1;
          return inner;
        }
      }
    }
    return null;
  }

  /** An argument: a braced group, or a single token. */
  argument(): string | null {
    this.skipSpace();
    if (this.eof()) return null;
    if (this.src[this.i] === '{') return this.braced();
    const cmd = this.peekCommand();
    if (cmd) {
      this.i += cmd.length + 1;
      return `\\${cmd}`;
    }
    return this.src[this.i++];
  }

  bracketed(): string | null {
    this.skipSpace();
    if (this.src[this.i] !== '[') return null;
    let depth = 0;
    for (let j = this.i; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ']' && depth === 0) {
        const inner = this.src.slice(this.i + 1, j);
        this.i = j + 1;
        return inner;
      }
    }
    return null;
  }

  delimiter(): string | null {
    this.skipSpace();
    const cmd = this.peekCommand();
    if (cmd) {
      this.i += cmd.length + 1;
      return `\\${cmd}`;
    }
    return this.eof() ? null : this.src[this.i++];
  }

  /** `_x` and `^y` in either order. */
  scripts(): { lower: string; upper: string; any: boolean } {
    let lower = '';
    let upper = '';
    let any = false;
    for (let k = 0; k < 2; k++) {
      this.skipSpace();
      const c = this.src[this.i];
      if (c !== '_' && c !== '^') break;
      this.i++;
      const value = this.argument() ?? '';
      if (c === '_') lower = value;
      else upper = value;
      any = true;
    }
    return { lower, upper, any };
  }

  row(stop?: (p: Parser) => boolean): MRow {
    const row: MRow = [];
    const addText = (v: string) => {
      const last = row[row.length - 1];
      if (last?.t === 'text') last.v += v;
      else row.push({ t: 'text', v });
    };

    while (!this.eof()) {
      if (stop?.(this)) break;
      const c = this.src[this.i];

      if (/\s/.test(c)) {
        this.i++;
        continue;
      }
      if (c === '^' || c === '_') {
        this.i++;
        const value = parseRow(this.argument() ?? '');
        attachScript(row, c, value);
        continue;
      }
      if (c === '{') {
        const start = this.i;
        const inner = this.braced();
        if (inner === null) {
          this.i = start + 1;
          addText('{');
        } else {
          addText(`{${inner}}`);
        }
        continue;
      }
      if (c !== '\\') {
        this.i++;
        addText(c);
        continue;
      }

      const start = this.i;
      const cmd = this.peekCommand() as string;
      this.i += cmd.length + 1;
      const node = this.command(cmd);
      if (node) {
        row.push(node);
      } else {
        // Anything unmodelled is kept exactly as written.
        this.i = start + cmd.length + 1;
        addText(`\\${cmd}${/^[a-zA-Z]/.test(cmd) ? ' ' : ''}`);
      }
    }
    return row;
  }

  command(cmd: string): MNode | null {
    if (FRACS.includes(cmd)) {
      const a = this.argument();
      const b = this.argument();
      if (a === null || b === null) return null;
      return { t: 'struct', type: 'frac', op: cmd, slots: [parseRow(a), parseRow(b)] };
    }
    if (cmd === 'binom') {
      const a = this.argument();
      const b = this.argument();
      if (a === null || b === null) return null;
      return { t: 'struct', type: 'binom', slots: [parseRow(a), parseRow(b)] };
    }
    if (cmd === 'sqrt') {
      const idx = this.bracketed();
      const r = this.argument();
      if (r === null) return null;
      return idx === null
        ? { t: 'struct', type: 'sqrt', slots: [parseRow(r)] }
        : { t: 'struct', type: 'nroot', slots: [parseRow(idx), parseRow(r)] };
    }
    if (cmd === 'left') return this.leftRight();
    if (cmd === 'begin') return this.environment();
    if (cmd === 'text') {
      const a = this.braced();
      if (a === null) return null;
      return { t: 'struct', type: 'text', slots: [[{ t: 'text', v: a }]] };
    }
    if (cmd === 'textcolor') {
      const model = this.bracketed();
      const spec = this.braced();
      const body = this.braced();
      if (spec === null || body === null) return null;
      return { t: 'struct', type: 'color', op: `${model !== null ? `[${model}]` : ''}{${spec}}`, slots: [parseRow(body)] };
    }
    if (cmd === 'overset' || cmd === 'underset') {
      const a = this.argument();
      const b = this.argument();
      if (a === null || b === null) return null;
      return { t: 'struct', type: cmd, slots: [parseRow(a), parseRow(b)] };
    }
    if (ACCENTS.includes(cmd) || FONTS.includes(cmd)) {
      const a = this.argument();
      if (a === null) return null;
      return { t: 'struct', type: ACCENTS.includes(cmd) ? 'accent' : 'font', op: cmd, slots: [parseRow(a)] };
    }
    if (BIGOPS.includes(cmd)) {
      this.skipSpace();
      let limits = false;
      if (this.src.startsWith('\\limits', this.i) && !/[a-zA-Z]/.test(this.src[this.i + 7] ?? '')) {
        this.i += 7;
        limits = true;
      }
      const { lower, upper, any } = this.scripts();
      if (any || limits) {
        return { t: 'struct', type: 'bigop', op: cmd, limits: limits || undefined, slots: [parseRow(lower), parseRow(upper)] };
      }
      const sym = SYMBOLS.get(`\\${cmd}`);
      return { t: 'sym', tex: `\\${cmd}`, glyph: sym?.glyph ?? BIGOP_GLYPH[cmd] ?? cmd };
    }
    if (LIMS.includes(cmd)) {
      this.skipSpace();
      if (this.src[this.i] === '_') {
        this.i++;
        const a = this.argument() ?? '';
        return { t: 'struct', type: 'lim', op: cmd, slots: [parseRow(a)] };
      }
      return { t: 'sym', tex: `\\${cmd}`, glyph: cmd };
    }
    const sym = SYMBOLS.get(`\\${cmd}`);
    if (sym) return { t: 'sym', tex: sym.tex, glyph: sym.glyph };
    return null;
  }

  leftRight(): MNode | null {
    const open = this.delimiter();
    const key = Object.keys(DELIMS).find((k) => DELIMS[k].l === open);
    if (!key) return null;
    let depth = 0;
    const body = this.row((p) => {
      if (p.src.startsWith('\\left', p.i) && !/[a-zA-Z]/.test(p.src[p.i + 5] ?? '')) depth++;
      if (p.src.startsWith('\\right', p.i) && !/[a-zA-Z]/.test(p.src[p.i + 6] ?? '')) {
        if (depth === 0) return true;
        depth--;
      }
      return false;
    });
    if (!this.src.startsWith('\\right', this.i)) return null;
    this.i += 6;
    const close = this.delimiter();
    if (close !== DELIMS[key].r) return null;
    return { t: 'struct', type: 'group', op: key, slots: [body] };
  }

  environment(): MNode | null {
    const env = this.braced();
    if (env === null) return null;
    const known = MATRIX_ENVS.includes(env) || env === 'cases' || env === 'aligned' || env === 'gathered';
    if (!known) return null;

    const stopCell = (p: Parser) =>
      p.src[p.i] === '&' || p.src.startsWith('\\\\', p.i) || p.src.startsWith('\\end', p.i);
    const table: MRow[][] = [[]];
    for (;;) {
      table[table.length - 1].push(this.row(stopCell));
      if (this.eof()) return null;
      if (this.src[this.i] === '&') {
        this.i++;
      } else if (this.src.startsWith('\\\\', this.i)) {
        this.i += 2;
        table.push([]);
      } else {
        break;
      }
    }
    this.i += 4; // \end
    if (this.braced() !== env) return null;
    // A trailing \\ leaves one empty row behind.
    const last = table[table.length - 1];
    if (table.length > 1 && last.length === 1 && rowEmpty(last[0])) table.pop();

    const naturalCols = Math.max(...table.map((r) => r.length));
    const cols = env === 'cases' || env === 'aligned' ? Math.max(2, naturalCols) : naturalCols;
    const slots: MRow[] = [];
    for (const r of table) for (let c = 0; c < cols; c++) slots.push(r[c] ?? blank());
    if (MATRIX_ENVS.includes(env)) return { t: 'struct', type: 'matrix', op: env, rows: table.length, cols, slots };
    return { t: 'struct', type: env as 'cases', rows: table.length, cols, slots };
  }
}

/** Take the item a `^` or `_` applies to off the end of a row, and attach. */
function attachScript(row: MRow, c: string, value: MRow): void {
  const last = row[row.length - 1];
  if (last?.t === 'struct' && (last.type === 'sup' || last.type === 'sub')) {
    const need = last.type === 'sup' ? '_' : '^';
    if (c === need) {
      const base = last.slots[0];
      const sub = last.type === 'sub' ? last.slots[1] : value;
      const sup = last.type === 'sup' ? last.slots[1] : value;
      row[row.length - 1] = { t: 'struct', type: 'subsup', slots: [base, sub, sup] };
      return;
    }
  }
  const base = popBase(row);
  row.push({ t: 'struct', type: c === '^' ? 'sup' : 'sub', slots: [base, value] });
}

function popBase(row: MRow): MRow {
  const last = row[row.length - 1];
  if (!last) return [{ t: 'text', v: '{}' }];
  if (last.t !== 'text') {
    row.pop();
    return [last];
  }
  const piece = lastTextToken(last.v);
  last.v = last.v.slice(0, last.v.length - piece.length);
  if (!last.v) row.pop();
  const trimmed = piece.trim();
  return trimmed.startsWith('{') && trimmed.length > 2
    ? parseRow(trimmed.slice(1, -1))
    : [{ t: 'text', v: trimmed }];
}

/** The last TeX token of a run of raw text. */
export function lastTextToken(v: string): string {
  const cmd = /\\[a-zA-Z]+\s*$/.exec(v);
  if (cmd) return cmd[0];
  const end = v.trimEnd();
  if (end.endsWith('}')) {
    let depth = 0;
    for (let i = end.length - 1; i >= 0; i--) {
      if (end[i] === '}') depth++;
      else if (end[i] === '{' && --depth === 0) return v.slice(i);
    }
  }
  return v.slice(-1);
}

export function parseRow(src: string): MRow {
  return new Parser(src).row();
}

/** Parse LaTeX into an editable row. Never throws: the worst case is raw text. */
export function parseTex(src: string): MRow {
  try {
    return editable(new Parser(src.trim()).row());
  } catch {
    return [{ t: 'text', v: src }];
  }
}

/* ------------------------------------------------------- editing operations */

/** Text boxes before, between and after structures so the caret can land. */
export function editable(row: MRow): MRow {
  const out: MRow = [];
  for (const n of row) {
    const prev = out[out.length - 1];
    if (n.t === 'text') {
      if (prev?.t === 'text') prev.v += n.v;
      else out.push({ ...n });
    } else {
      if (!prev || prev.t !== 'text') out.push({ t: 'text', v: '' });
      out.push(n.t === 'struct' ? { ...n, slots: n.slots.map(editable) } : n);
    }
  }
  if (out[out.length - 1]?.t !== 'text') out.push({ t: 'text', v: '' });
  return out;
}

/** A row inside the tree: alternating node index, slot index. */
export type RowPath = number[];

export interface Caret {
  path: RowPath;
  node: number;
  offset: number;
  /** Selection end within the text box, when text is selected. */
  end?: number;
}

export function rowAt(root: MRow, path: RowPath): MRow {
  let row = root;
  for (let i = 0; i < path.length; i += 2) {
    row = (row[path[i]] as MStruct).slots[path[i + 1]];
  }
  return row;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Find the first empty box under a node; falls back to its first box. */
function firstSlotCaret(st: MStruct, base: RowPath, nodeIndex: number, skipFirst: boolean): Caret {
  let target = -1;
  st.slots.forEach((s, i) => {
    if (target < 0 && !(skipFirst && i === 0) && rowEmpty(s)) target = i;
  });
  if (target < 0) target = skipFirst ? Math.min(1, st.slots.length - 1) : 0;
  return { path: [...base, nodeIndex, target], node: 0, offset: 0 };
}

export interface EditResult {
  root: MRow;
  caret: Caret;
}

export function insertSymbol(rootIn: MRow, caret: Caret, tex: string, glyph: string): EditResult {
  const root = clone(rootIn);
  const row = rowAt(root, caret.path);
  const text = row[caret.node] as MText;
  const before = text.v.slice(0, caret.offset);
  const after = text.v.slice(caret.end ?? caret.offset);
  row.splice(caret.node, 1, { t: 'text', v: before }, { t: 'sym', tex, glyph }, { t: 'text', v: after });
  return { root, caret: { path: caret.path, node: caret.node + 2, offset: 0 } };
}

export function insertStructure(rootIn: MRow, caret: Caret, template: MStruct): EditResult {
  const root = clone(rootIn);
  const row = rowAt(root, caret.path);
  const st = clone(template);
  const text = row[caret.node] as MText;
  let before = text.v.slice(0, caret.offset);
  const selected = text.v.slice(caret.offset, caret.end ?? caret.offset);
  const after = text.v.slice(caret.end ?? caret.offset);

  const scripted = st.type === 'sup' || st.type === 'sub' || st.type === 'subsup';
  let takesBase = false;
  if (scripted && !selected) {
    // Taking the base from what precedes the caret: type x, press ^.
    if (before) {
      const piece = lastTextToken(before);
      before = before.slice(0, before.length - piece.length);
      st.slots[0] = [{ t: 'text', v: piece.trim() }];
      takesBase = true;
    } else if (caret.node >= 2) {
      const prev = row[caret.node - 1];
      if (prev.t !== 'text') {
        row.splice(caret.node - 1, 2);
        const removed = caret.node - 2;
        const prevText = row[removed] as MText;
        before = prevText.v + before;
        row.splice(removed, 1);
        st.slots[0] = editable([prev]);
        row.splice(removed, 0, { t: 'text', v: before }, st, { t: 'text', v: after });
        return { root, caret: firstSlotCaret(st, caret.path, removed + 1, true) };
      }
    }
  }
  if (selected) {
    const into = st.type === 'nroot' || st.type === 'overset' || st.type === 'underset' ? 1 : 0;
    st.slots[into] = editable(parseRow(selected));
  }
  row.splice(caret.node, 1, { t: 'text', v: before }, st, { t: 'text', v: after });
  return { root, caret: firstSlotCaret(st, caret.path, caret.node + 1, takesBase) };
}

/** Backspace at the start of a text box: remove what is before it. */
export function deleteBefore(rootIn: MRow, caret: Caret): EditResult | null {
  if (caret.node < 2) return null;
  const root = clone(rootIn);
  const row = rowAt(root, caret.path);
  const left = row[caret.node - 2] as MText;
  const right = row[caret.node] as MText;
  const offset = left.v.length;
  left.v += right.v;
  row.splice(caret.node - 1, 2);
  return { root, caret: { path: caret.path, node: caret.node - 2, offset } };
}

export function setText(rootIn: MRow, path: RowPath, node: number, value: string): MRow {
  const root = clone(rootIn);
  (rowAt(root, path)[node] as MText).v = value;
  return root;
}

/** Add or remove a row or column of a table. Never goes below one of either. */
export function resizeTable(rootIn: MRow, path: RowPath, node: number, drows: number, dcols: number): MRow {
  const root = clone(rootIn);
  const st = rowAt(root, path)[node] as MStruct;
  const rows = st.rows ?? 1;
  const cols = st.cols ?? 1;
  const nr = Math.max(1, rows + drows);
  const nc = Math.max(1, cols + dcols);
  const next: MRow[] = [];
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) next.push(r < rows && c < cols ? st.slots[r * cols + c] : blank());
  }
  st.rows = nr;
  st.cols = nc;
  st.slots = next;
  return root;
}

/* ------------------------------------------------------ structure catalogue */

export interface StructTemplate {
  id: string;
  name: string;
  glyph: string;
  group: string;
  keywords?: string;
  make: () => MStruct;
}

const st = (type: StructType, slots: number, extra: Partial<MStruct> = {}): MStruct => ({
  t: 'struct',
  type,
  slots: Array.from({ length: slots }, blank),
  ...extra,
});

const tpl = (id: string, name: string, glyph: string, group: string, make: () => MStruct, keywords = ''): StructTemplate => ({ id, name, glyph, group, make, keywords });

const groupT = (key: string, glyph: string): StructTemplate =>
  tpl(`group-${key}`, DELIMS[key].name, glyph, 'Brackets', () => st('group', 1, { op: key }), 'delimiter');

const accentT = (op: string, name: string, glyph: string): StructTemplate =>
  tpl(`accent-${op}`, name, glyph, 'Accents', () => st('accent', 1, { op }), 'overline accent');

const matrixT = (env: string, name: string, glyph: string): StructTemplate =>
  tpl(`matrix-${env}`, name, glyph, 'Matrices', () => makeMatrix(env, 2, 2), 'matrix determinant array');

const opT = (op: string, name: string, glyph: string, limits = false): StructTemplate =>
  tpl(`op-${op}${limits ? '-lim' : ''}`, name, glyph, 'Operators', () => st('bigop', 2, { op, limits: limits || undefined }), 'limits integral sum');

export const STRUCT_TEMPLATES: StructTemplate[] = [
  tpl('frac', 'Fraction', '□⁄□', 'Fractions & scripts', () => st('frac', 2, { op: 'frac' }), 'numerator denominator divide'),
  tpl('dfrac', 'Display fraction', '▭⁄▭', 'Fractions & scripts', () => st('frac', 2, { op: 'dfrac' }), 'large'),
  tpl('sup', 'Superscript', 'x²', 'Fractions & scripts', () => st('sup', 2), 'power exponent'),
  tpl('sub', 'Subscript', 'x₂', 'Fractions & scripts', () => st('sub', 2), 'index'),
  tpl('subsup', 'Sub + superscript', 'x₂²', 'Fractions & scripts', () => st('subsup', 3), 'both'),
  tpl('binom', 'Binomial', '(ⁿₖ)', 'Fractions & scripts', () => st('binom', 2), 'choose'),
  tpl('sqrt', 'Square root', '√□', 'Roots', () => st('sqrt', 1), 'radical'),
  tpl('nroot', 'n-th root', 'ⁿ√□', 'Roots', () => st('nroot', 2), 'radical cube index'),
  groupT('paren', '( )'),
  groupT('bracket', '[ ]'),
  groupT('brace', '{ }'),
  groupT('abs', '| |'),
  groupT('norm', '‖ ‖'),
  groupT('floor', '⌊ ⌋'),
  groupT('ceil', '⌈ ⌉'),
  groupT('angle', '⟨ ⟩'),
  opT('int', 'Integral with limits', '∫ₐᵇ'),
  opT('int', 'Integral, limits over/under', '∫̲', true),
  opT('oint', 'Contour integral', '∮'),
  opT('iint', 'Double integral', '∬'),
  opT('sum', 'Summation', '∑'),
  opT('prod', 'Product', '∏'),
  opT('bigcup', 'Big union', '⋃'),
  opT('bigcap', 'Big intersection', '⋂'),
  tpl('lim', 'Limit', 'lim', 'Operators', () => st('lim', 1, { op: 'lim' }), 'approaches'),
  tpl('max', 'Maximum', 'max', 'Operators', () => st('lim', 1, { op: 'max' })),
  tpl('min', 'Minimum', 'min', 'Operators', () => st('lim', 1, { op: 'min' })),
  accentT('vec', 'Vector arrow', 'x⃗'),
  accentT('hat', 'Hat', 'x̂'),
  accentT('bar', 'Bar', 'x̄'),
  accentT('dot', 'Dot', 'ẋ'),
  accentT('ddot', 'Double dot', 'ẍ'),
  accentT('tilde', 'Tilde', 'x̃'),
  accentT('overline', 'Overline', 'x̅'),
  accentT('underline', 'Underline', 'x̲'),
  accentT('overrightarrow', 'Long vector', 'AB→'),
  accentT('overbrace', 'Overbrace', '⏞'),
  accentT('underbrace', 'Underbrace', '⏟'),
  accentT('cancel', 'Cancel', 'x̸'),
  tpl('overset', 'Stack above', 'a̲b', 'Accents', () => st('overset', 2), 'overset limit'),
  tpl('underset', 'Stack below', 'b̲a', 'Accents', () => st('underset', 2), 'underset limit'),
  matrixT('pmatrix', 'Matrix ( )', '(⋮⋮)'),
  matrixT('bmatrix', 'Matrix [ ]', '[⋮⋮]'),
  matrixT('Bmatrix', 'Matrix { }', '{⋮⋮}'),
  matrixT('vmatrix', 'Determinant', '|⋮⋮|'),
  matrixT('Vmatrix', 'Double bars', '‖⋮‖'),
  matrixT('matrix', 'Plain matrix', '⋮⋮'),
  tpl('cases', 'Cases', '{⋮', 'Multi-line', () => makeLines('cases', 2), 'piecewise'),
  tpl('aligned', 'Aligned lines', '=⋮', 'Multi-line', () => makeLines('aligned', 2), 'align equation'),
  tpl('gathered', 'Centred lines', '≡⋮', 'Multi-line', () => makeLines('gathered', 2), 'gather'),
  tpl('text', 'Plain text', 'Aa', 'Text & style', () => st('text', 1), 'words roman'),
  tpl('bold', 'Bold', 'B', 'Text & style', () => st('font', 1, { op: 'boldsymbol' }), 'font'),
  tpl('mathrm', 'Upright', 'R', 'Text & style', () => st('font', 1, { op: 'mathrm' }), 'roman font'),
  tpl('mathbb', 'Blackboard', 'ℝ', 'Text & style', () => st('font', 1, { op: 'mathbb' }), 'font double'),
  tpl('mathcal', 'Calligraphic', 'ℒ', 'Text & style', () => st('font', 1, { op: 'mathcal' }), 'script font'),
];

/** `\textcolor` wrapper for a #rrggbb colour. xcolor and MathJax both read RGB. */
export function colorTemplate(hex: string): MStruct {
  const n = parseInt(hex.replace('#', ''), 16);
  return st('color', 1, { op: `[RGB]{${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}}` });
}
