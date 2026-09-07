import { describe, expect, it } from 'vitest';
import { escapeLatex, escapeNodeText, escapeComment } from '../latex/escape';

describe('escapeLatex', () => {
  it('escapes the seven TeX special characters', () => {
    expect(escapeLatex('#$%&_{}').text).toBe('\\#\\$\\%\\&\\_\\{\\}');
  });

  it('turns backslash, tilde and caret into commands', () => {
    const r = escapeLatex('a\\b~c^d');
    expect(r.text).toBe('a\\textbackslash{}b\\textasciitilde{}c\\textasciicircum{}d');
  });

  it('escapes comparison characters that would break text mode', () => {
    expect(escapeLatex('a<b>c|d').text).toBe(
      'a\\textless{}b\\textgreater{}c\\textbar{}d',
    );
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLatex('Validate payment').text).toBe('Validate payment');
  });

  it('maps common punctuation and symbols to LaTeX equivalents', () => {
    expect(escapeLatex('a — b').text).toContain('---');
    expect(escapeLatex('x ≤ y').text).toContain('$\\leq$');
    expect(escapeLatex('50°').text).toContain('\\textdegree{}');
    expect(escapeLatex('Δt').text).toContain('$\\Delta$');
  });

  it('accepts Latin-1 accents without flagging them', () => {
    const r = escapeLatex('Café Ürün');
    expect(r.risky).toHaveLength(0);
    expect(r.text).toBe('Café Ürün');
  });

  it('flags characters pdfLaTeX cannot set by default', () => {
    const r = escapeLatex('中文 🙂');
    expect(r.risky.length).toBeGreaterThan(0);
  });

  it('never leaves a lone backslash that could start a command', () => {
    const r = escapeLatex('\\newcommand{\\evil}{}');
    expect(r.text).not.toMatch(/\\newcommand/);
    expect(r.text.startsWith('\\textbackslash{}')).toBe(true);
  });
});

describe('escapeNodeText', () => {
  it('joins lines with a TeX line break', () => {
    expect(escapeNodeText('one\ntwo').body).toBe('one \\\\ two');
  });

  it('handles CRLF input', () => {
    expect(escapeNodeText('one\r\ntwo').lines).toEqual(['one', 'two']);
  });

  it('applies formatting per line so groups never span a break', () => {
    const r = escapeNodeText('a\nb', { bold: true, italic: true });
    expect(r.body).toBe('\\textit{\\textbf{a}} \\\\ \\textit{\\textbf{b}}');
  });

  it('reports empty text so callers can skip emitting a node body', () => {
    expect(escapeNodeText('   ').isEmpty).toBe(true);
    expect(escapeNodeText('x').isEmpty).toBe(false);
  });

  it('keeps blank lines as empty entries rather than dropping them', () => {
    expect(escapeNodeText('a\n\nb').lines).toEqual(['a', '', 'b']);
  });

  it('escapes special characters inside formatted text', () => {
    expect(escapeNodeText('100%', { bold: true }).body).toBe('\\textbf{100\\%}');
  });
});

describe('escapeComment', () => {
  it('flattens newlines and neutralises percent signs', () => {
    expect(escapeComment('a\nb 50%')).toBe('a b 50\\%');
  });
});
