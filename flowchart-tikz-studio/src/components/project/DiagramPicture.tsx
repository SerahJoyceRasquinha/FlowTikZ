import { memo } from 'react';
import type { Diagram } from '../../model/types';
import { ShapeView } from '../../canvas/ShapeView';
import { ConnectorView } from '../../canvas/ConnectorView';
import { diagramBounds } from '../../model/diagram';

/**
 * A diagram drawn read-only with the canvas's own renderers - how a FlowTikZ
 * figure appears in the document preview. Its width matches what the
 * compiled figure will have: natural size in centimetres, capped at the text
 * width (the figure block scales down only when it is wider).
 */
export const DiagramPicture = memo(function DiagramPicture({ diagram, pxPerCm, maxWidthPx }: { diagram: Diagram; pxPerCm: number; maxWidthPx: number }) {
  const ids = diagram.order;
  if (ids.length === 0) return null;
  const b = diagramBounds(diagram);
  const pad = 4;
  const naturalPx = ((b.w + pad * 2) / (diagram.settings.unitsPerCm || 50)) * pxPerCm;
  const width = Math.min(naturalPx, maxWidthPx);
  const height = width * ((b.h + pad * 2) / (b.w + pad * 2));
  return (
    <svg
      className="tx-diagram"
      width={width}
      height={height}
      viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`}
      role="img"
      aria-label="FlowTikZ drawing"
      data-preview=""
    >
      {ids.map((id) =>
        diagram.edges[id] ? <ConnectorView key={id} diagram={diagram} edge={diagram.edges[id]} selected={false} /> : null,
      )}
      {ids.map((id) => (diagram.nodes[id] ? <ShapeView key={id} node={diagram.nodes[id]} selected={false} /> : null))}
    </svg>
  );
});
