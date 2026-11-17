import type { Diagram } from '../model/types';
import { emptyDiagram } from '../model/defaults';
import { normalizeOrder } from '../model/diagram';
import { TEMPLATES, buildTemplate, type Measure, type TemplateCategory } from './library';

/**
 * Every template of a category laid out on one page, each inserted exactly as
 * the Templates dialog inserts it. Used by the unit tests and by the pdfLaTeX
 * fixtures, which are the proof that every template compiles.
 */
export function templateGallery(category: TemplateCategory, measure: Measure = () => null): Diagram {
  const d = emptyDiagram(`Templates: ${category}`);
  let x = 0;
  let y = 0;
  let rowH = 0;
  let serial = 0;
  const maxRow = 2400;
  for (const t of TEMPLATES.filter((tt) => tt.category === category)) {
    const frag = buildTemplate(t, measure);
    if (frag.nodes.length === 0) continue;
    const minX = Math.min(...frag.nodes.map((n) => n.x));
    const minY = Math.min(...frag.nodes.map((n) => n.y));
    const w = Math.max(...frag.nodes.map((n) => n.x + n.w)) - minX;
    const h = Math.max(...frag.nodes.map((n) => n.y + n.h)) - minY;
    if (x > 0 && x + w > maxRow) {
      x = 0;
      y += rowH + 80;
      rowH = 0;
    }
    const ids = new Map<string, string>();
    for (const n of frag.nodes) {
      const id = `g${++serial}`;
      ids.set(n.id, id);
      d.nodes[id] = { ...n, id, x: n.x - minX + x, y: n.y - minY + y };
      d.order.push(id);
    }
    for (const e of frag.edges) {
      const id = `g${++serial}`;
      d.edges[id] = {
        ...e,
        id,
        source: { ...e.source, nodeId: e.source.nodeId ? ids.get(e.source.nodeId) : undefined },
        target: { ...e.target, nodeId: e.target.nodeId ? ids.get(e.target.nodeId) : undefined },
      };
      d.order.push(id);
    }
    x += w + 80;
    rowH = Math.max(rowH, h);
  }
  normalizeOrder(d);
  return d;
}
