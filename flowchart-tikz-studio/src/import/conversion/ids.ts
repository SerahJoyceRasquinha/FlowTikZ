import type { Diagram } from '../../model/types';

/**
 * Identifier allocation for imported objects.
 *
 * The mapper may run in a Web Worker, whose id counters are not the editor's.
 * It therefore numbers objects with a local allocator, and the main thread
 * re-numbers the finished diagram with the editor's own `nextId` just before
 * committing it. That keeps ids unique across the document (important when an
 * import is inserted into an existing diagram) and stable afterwards.
 */

export type IdAllocator = (prefix: 'n' | 'e' | 'g') => string;

export function localAllocator(): IdAllocator {
  const counters: Record<string, number> = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
}

/**
 * Re-number every node, edge and group, in paint order. Returns the new
 * diagram and old-id -> new-id map. The input is not modified.
 */
export function remapDiagramIds(
  d: Diagram,
  alloc: IdAllocator,
): { diagram: Diagram; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const id of d.order) {
    if (d.nodes[id]) idMap.set(id, alloc('n'));
  }
  for (const id of d.order) {
    if (d.edges[id]) idMap.set(id, alloc('e'));
  }
  for (const id of Object.keys(d.nodes)) if (!idMap.has(id)) idMap.set(id, alloc('n'));
  for (const id of Object.keys(d.edges)) if (!idMap.has(id)) idMap.set(id, alloc('e'));
  for (const id of Object.keys(d.groups)) idMap.set(id, alloc('g'));

  const out: Diagram = {
    ...d,
    nodes: {},
    edges: {},
    groups: {},
    order: d.order.map((id) => idMap.get(id) ?? id),
  };
  for (const [id, n] of Object.entries(d.nodes)) {
    const nid = idMap.get(id)!;
    out.nodes[nid] = {
      ...n,
      id: nid,
      groupId: n.groupId ? idMap.get(n.groupId) : undefined,
    };
    if (out.nodes[nid].groupId === undefined) delete out.nodes[nid].groupId;
  }
  for (const [id, e] of Object.entries(d.edges)) {
    const eid = idMap.get(id)!;
    out.edges[eid] = {
      ...e,
      id: eid,
      source: e.source.nodeId ? { ...e.source, nodeId: idMap.get(e.source.nodeId) } : { ...e.source },
      target: e.target.nodeId ? { ...e.target, nodeId: idMap.get(e.target.nodeId) } : { ...e.target },
    };
  }
  for (const [id, g] of Object.entries(d.groups)) {
    const gid = idMap.get(id)!;
    out.groups[gid] = { ...g, id: gid, memberIds: g.memberIds.map((m) => idMap.get(m) ?? m) };
  }
  return { diagram: out, idMap };
}
