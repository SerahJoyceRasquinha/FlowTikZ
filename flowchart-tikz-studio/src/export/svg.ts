import type { Diagram } from '../model/types';
import { diagramBounds } from '../model/diagram';
import { round } from '../model/geometry';
import { isTransparentBackground } from '../model/meta';

/**
 * SVG export.
 *
 * Rather than maintaining a second renderer, the live canvas is cloned and
 * stripped of editor chrome (marked with `data-ui`). Whatever the user sees is
 * exactly what lands in the file.
 */

const PADDING = 16;

export function buildSvgString(source: SVGSVGElement, d: Diagram): string {
  const bounds = diagramBounds(d);
  const width = Math.max(1, bounds.w + PADDING * 2);
  const height = Math.max(1, bounds.h + PADDING * 2);

  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-ui]').forEach((el) => el.remove());

  const content = clone.querySelector('[data-layer="content"]');
  const inner = content ? content.innerHTML : clone.innerHTML;

  const transparent = isTransparentBackground(d.settings.background);
  const bg = d.settings.background || '#ffffff';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${round(
      width,
      2,
    )}" height="${round(height, 2)}" viewBox="${round(bounds.x - PADDING, 2)} ${round(
      bounds.y - PADDING,
      2,
    )} ${round(width, 2)} ${round(height, 2)}">`,
    // A transparent document ships no backdrop at all.
    ...(transparent
      ? []
      : [
          `<rect x="${round(bounds.x - PADDING, 2)}" y="${round(
            bounds.y - PADDING,
            2,
          )}" width="${round(width, 2)}" height="${round(height, 2)}" fill="${bg}"/>`,
        ]),
    `<g>${inner}</g>`,
    '</svg>',
  ].join('\n');
}

export function svgDimensions(d: Diagram) {
  const b = diagramBounds(d);
  return { width: b.w + PADDING * 2, height: b.h + PADDING * 2 };
}
