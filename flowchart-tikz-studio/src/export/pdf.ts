import type { Diagram } from '../model/types';
import { buildSvgString, svgDimensions } from './svg';

/**
 * PDF export.
 *
 * The diagram is opened in a print window at its true size and handed to the
 * browser's own PDF writer, which keeps the output vector. Bundling a
 * JavaScript PDF library would have rasterised the shapes or required
 * re-implementing text layout, and the LaTeX route already covers
 * publication-quality vector output.
 */
export function exportPdf(source: SVGSVGElement, d: Diagram): void {
  const svg = buildSvgString(source, d);
  const { width, height } = svgDimensions(d);
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error(
      'The browser blocked the print window. Allow pop-ups for this page and try again.',
    );
  }
  win.document.write(`<!doctype html>
<html>
  <head>
    <title>${d.name || 'diagram'}</title>
    <style>
      @page { size: ${Math.ceil(width)}px ${Math.ceil(height)}px; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      svg { display: block; }
    </style>
  </head>
  <body>${svg}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
