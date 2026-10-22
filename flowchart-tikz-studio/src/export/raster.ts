import type { Diagram } from '../model/types';
import { buildSvgString, svgDimensions } from './svg';
import { isTransparentBackground } from '../model/meta';

/** Rasterise the diagram to a PNG blob at the requested pixel ratio. */
export async function exportPng(
  source: SVGSVGElement,
  d: Diagram,
  scale = 2,
): Promise<Blob> {
  const svg = buildSvgString(source, d);
  const { width, height } = svgDimensions(d);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The diagram could not be rasterised.'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  // PNG keeps an alpha channel, so a transparent document stays transparent.
  if (!isTransparentBackground(d.settings.background)) {
    ctx.fillStyle = d.settings.background || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
      'image/png',
    );
  });
}
