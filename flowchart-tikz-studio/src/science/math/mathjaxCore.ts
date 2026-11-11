/**
 * The heavy half of the typesetter. Only ever reached through the dynamic
 * import in `engine.ts`, so MathJax and its font tables are a separate chunk
 * that a plain flowchart session never downloads or parses.
 *
 * MathJax's SVG output with `fontCache: 'none'` makes every formula self-
 * contained vector paths: no CSS, no web font and no shared <defs>. That is
 * what lets the existing exporters (which clone the live SVG) carry formulas
 * into SVG, PNG and PDF untouched.
 */
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';

export interface RawRender {
  viewBox: [number, number, number, number];
  inner: string;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: ['base', 'ams', 'mhchem', 'color', 'boldsymbol', 'cancel'],
  // Errors must reach the caller, not be drawn in red inside the picture.
  formatError: (_jax: unknown, err: unknown) => {
    throw err;
  },
});
// Inline line-breaking would split a formula into several <svg>; one object is
// one picture, so it stays off.
const svg = new SVG({ fontData: MathJaxTexFont, fontCache: 'none', linebreaks: { inline: false } });
svg.addExtension(MathJaxMhchemFontExtension as never);
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

/** Typeset one formula. Throws on a TeX error. */
export function typeset(source: string, display: boolean): RawRender {
  const node = doc.convert(source, { display, containerWidth: 1600, em: 16, ex: 8 });
  const outer = adaptor.firstChild(node) as never;
  const vb = (adaptor.getAttribute(outer, 'viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
  const inner = adaptor
    .innerHTML(outer)
    // Attributes meant for assistive tooling; they only add weight per formula.
    .replace(/\s(?:data-[a-z-]+|aria-[a-z-]+|focusable|role)="[^"]*"/g, '')
    // `\href` is not offered, but an old or hand-edited file must not get a link.
    .replace(/<\/?a(?:\s[^>]*)?>/g, '');
  return { viewBox: [vb[0], vb[1], vb[2], vb[3]], inner };
}
