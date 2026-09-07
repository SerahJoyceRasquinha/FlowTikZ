/**
 * A small LaTeX tokeniser.
 *
 * A full editor component (CodeMirror et al.) would add ~700 kB to the bundle
 * for a panel that is read-only by design. This covers the token classes that
 * actually appear in generated TikZ: comments, control sequences, group
 * braces, coordinates and numeric lengths.
 */

export type TokenKind =
  | 'comment'
  | 'command'
  | 'brace'
  | 'bracket'
  | 'number'
  | 'coord'
  | 'text';

export interface Token {
  kind: TokenKind;
  value: string;
}

const COMMAND = /^\\[A-Za-z@]+\*?|^\\./;
const NUMBER = /^-?\d+(\.\d+)?(cm|pt|mm|in|ex|em)?/;
const COORD = /^\([-\d.]+,[-\d.]+\)/;

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  let buffer = '';

  const flush = () => {
    if (buffer) {
      tokens.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (rest.length > 0) {
    if (rest[0] === '%') {
      flush();
      tokens.push({ kind: 'comment', value: rest });
      rest = '';
      break;
    }
    const cmd = COMMAND.exec(rest);
    if (cmd) {
      flush();
      tokens.push({ kind: 'command', value: cmd[0] });
      rest = rest.slice(cmd[0].length);
      continue;
    }
    const coord = COORD.exec(rest);
    if (coord) {
      flush();
      tokens.push({ kind: 'coord', value: coord[0] });
      rest = rest.slice(coord[0].length);
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num && num[0].length > 0) {
      flush();
      tokens.push({ kind: 'number', value: num[0] });
      rest = rest.slice(num[0].length);
      continue;
    }
    if (rest[0] === '{' || rest[0] === '}') {
      flush();
      tokens.push({ kind: 'brace', value: rest[0] });
      rest = rest.slice(1);
      continue;
    }
    if (rest[0] === '[' || rest[0] === ']') {
      flush();
      tokens.push({ kind: 'bracket', value: rest[0] });
      rest = rest.slice(1);
      continue;
    }
    buffer += rest[0];
    rest = rest.slice(1);
  }
  flush();
  return tokens;
}

export function tokenizeDocument(code: string): Token[][] {
  return code.split('\n').map(tokenizeLine);
}

/** Case-insensitive search returning 1-based line numbers. */
export function findMatches(code: string, query: string): number[] {
  if (!query.trim()) return [];
  const needle = query.toLowerCase();
  const out: number[] = [];
  code.split('\n').forEach((line, i) => {
    if (line.toLowerCase().includes(needle)) out.push(i + 1);
  });
  return out;
}
