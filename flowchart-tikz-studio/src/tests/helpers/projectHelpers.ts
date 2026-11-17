import { emptyDiagram } from '../../model/defaults';
import { normalizeOrder } from '../../model/diagram';
import type { Diagram } from '../../model/types';
import { TEMPLATE_BY_ID, buildTemplate } from '../../templates/library';

/** A ready-made diagram from the template library, as a standalone document. */
export function diagramOf(id: string): Diagram {
  const d = emptyDiagram('Figure');
  const frag = buildTemplate(TEMPLATE_BY_ID[id]);
  for (const n of frag.nodes) {
    d.nodes[n.id] = n;
    d.order.push(n.id);
  }
  for (const e of frag.edges) {
    d.edges[e.id] = e;
    d.order.push(e.id);
  }
  normalizeOrder(d);
  return d;
}
