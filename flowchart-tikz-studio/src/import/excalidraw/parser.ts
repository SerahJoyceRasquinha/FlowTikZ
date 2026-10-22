import type { ReportBuilder } from '../report';
import { ImportError } from '../types';
import { validateIR } from '../ir/validate';
import type { IRArrow, IRDiagram } from '../ir/types';

/**
 * Excalidraw (.excalidraw JSON) -> IR.
 *
 * Excalidraw is structured: shapes, bound text and bound arrows are explicit,
 * so - as with draw.io - nothing is inferred from pixels. The hand-drawn
 * "roughness" is a rendering style the editor does not have; it is kept as
 * metadata and noted once.
 */

type El = Record<string, any>;

const ARROWS: Record<string, IRArrow> = {
  arrow: 'open',
  triangle: 'triangle',
  triangle_outline: 'open-triangle',
  dot: 'circle',
  circle: 'circle',
  circle_outline: 'open-circle',
  bar: 'bar',
  diamond: 'diamond',
  diamond_outline: 'open-diamond',
};

const FONT: Record<number, string> = {
  1: 'Virgil',
  2: 'Helvetica',
  3: 'Cascadia Code, monospace',
  5: 'Excalifont',
  6: 'Nunito',
  7: 'Lilita One',
  8: 'Comic Shanns, monospace',
};

function colour(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v === 'transparent') return null;
  return v;
}

function dash(style: unknown): string {
  return style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : 'solid';
}

export function excalidrawToIR(json: string, opts: { report: ReportBuilder }): IRDiagram {
  const { report } = opts;
  let data: El;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ImportError('invalid-file', 'The Excalidraw file is not valid JSON.');
  }
  const elements: El[] = Array.isArray(data?.elements) ? data.elements.filter((e: El) => e && !e.isDeleted) : [];
  if (!elements.length) throw new ImportError('no-diagram', 'The Excalidraw drawing is empty.');

  const byId = new Map(elements.map((e) => [e.id, e]));
  const objects: El[] = [];
  const connectors: El[] = [];
  const groupMembers = new Map<string, string[]>();
  let rough = 0;
  let skipped = 0;

  elements.forEach((e, z) => {
    if (typeof e.roughness === 'number' && e.roughness > 0) rough++;
    const rotation = typeof e.angle === 'number' ? (e.angle * 180) / Math.PI : 0;
    const base = {
      id: String(e.id),
      sourceId: String(e.id),
      z,
      locked: e.locked === true,
      preserved: {
        ...(e.roughness ? { roughness: e.roughness } : {}),
        ...(e.fillStyle && e.fillStyle !== 'solid' ? { fillStyle: e.fillStyle } : {}),
        ...(e.link ? { link: String(e.link) } : {}),
      },
    };
    const style = {
      fill: colour(e.backgroundColor),
      stroke: colour(e.strokeColor),
      strokeWidth: typeof e.strokeWidth === 'number' ? e.strokeWidth : 1,
      dash: dash(e.strokeStyle),
      opacity: typeof e.opacity === 'number' ? e.opacity / 100 : 1,
      cornerRadius: e.roundness ? Math.min(e.width, e.height) * 0.25 : 0,
    };
    for (const g of Array.isArray(e.groupIds) ? e.groupIds.slice(-1) : []) {
      if (!groupMembers.has(g)) groupMembers.set(g, []);
      groupMembers.get(g)!.push(String(e.id));
    }

    switch (e.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const bound = (Array.isArray(e.boundElements) ? e.boundElements : [])
          .map((b: El) => byId.get(b.id))
          .find((b: El | undefined) => b?.type === 'text');
        objects.push({
          ...base,
          shape: e.type === 'rectangle' ? (e.roundness ? 'rounded-rectangle' : 'rectangle') : e.type === 'ellipse' ? 'ellipse' : 'diamond',
          x: e.x,
          y: e.y,
          w: e.width,
          h: e.height,
          rotation,
          style,
          ...(bound ? { text: textOf(bound) } : {}),
        });
        break;
      }
      case 'text': {
        if (e.containerId && byId.has(e.containerId)) break; // carried by its container
        objects.push({ ...base, shape: 'text', x: e.x, y: e.y, w: e.width, h: e.height, rotation, style: { fill: null, stroke: null }, text: textOf(e) });
        break;
      }
      case 'arrow':
      case 'line': {
        const pts: El[] = Array.isArray(e.points) ? e.points : [];
        const abs = pts.map((p) => ({ x: e.x + Number(p[0]), y: e.y + Number(p[1]) }));
        if (abs.length < 2) {
          skipped++;
          break;
        }
        const label = (Array.isArray(e.boundElements) ? e.boundElements : [])
          .map((b: El) => byId.get(b.id))
          .find((b: El | undefined) => b?.type === 'text');
        const closedLine = e.type === 'line' && abs.length > 2 && Math.hypot(abs[0].x - abs[abs.length - 1].x, abs[0].y - abs[abs.length - 1].y) < 1;
        if (closedLine) {
          objects.push({ ...base, shape: 'polygon', path: [...abs.map((p, i) => ({ c: i ? 'L' : 'M', p })), { c: 'Z' }], style });
          break;
        }
        connectors.push({
          ...base,
          points: abs,
          routing: e.elbowed ? 'orthogonal' : e.roundness && abs.length > 2 ? 'curved' : abs.length > 2 ? 'polyline' : 'straight',
          arrowStart: e.type === 'arrow' ? ARROWS[e.startArrowhead] ?? 'none' : 'none',
          arrowEnd: e.type === 'arrow' ? ARROWS[e.endArrowhead] ?? (e.endArrowhead === null ? 'none' : 'open') : 'none',
          style: { stroke: style.stroke ?? '#000000', strokeWidth: style.strokeWidth, dash: style.dash, opacity: style.opacity },
          ...(e.startBinding?.elementId ? { source: { objectId: String(e.startBinding.elementId) } } : {}),
          ...(e.endBinding?.elementId ? { target: { objectId: String(e.endBinding.elementId) } } : {}),
          ...(label ? { label: { text: String(label.text ?? ''), fontSize: label.fontSize, color: label.strokeColor, background: true } } : {}),
        });
        break;
      }
      case 'frame':
      case 'magicframe':
        objects.push({ ...base, shape: 'rectangle', x: e.x, y: e.y, w: e.width, h: e.height, rotation, style: { fill: null, stroke: '#bbbbbb', strokeWidth: 1 }, text: e.name ? { content: String(e.name), valign: 'top', align: 'left', fontSize: 12 } : undefined });
        break;
      case 'image':
        objects.push({ ...base, shape: 'image', x: e.x, y: e.y, w: e.width, h: e.height, rotation, style: { fill: null, stroke: '#7c8a9b' } });
        break;
      case 'freedraw': {
        const pts: El[] = Array.isArray(e.points) ? e.points : [];
        if (pts.length < 2) break;
        const path = pts.map((p, i) => ({ c: i ? 'L' : 'M', p: { x: e.x + Number(p[0]), y: e.y + Number(p[1]) } }));
        objects.push({ ...base, shape: 'path', path, style: { ...style, fill: null } });
        break;
      }
      default:
        skipped++;
    }
  });

  if (rough) report.add('style-difference', `${rough} hand-drawn element${rough === 1 ? '' : 's'} imported with clean lines (the sketch style is kept as metadata).`);
  if (skipped) report.add('unsupported', `${skipped} Excalidraw element${skipped === 1 ? '' : 's'} of an unsupported type skipped.`);

  const groups = [...groupMembers].filter(([, m]) => m.length >= 2).map(([id, memberIds]) => ({ id, memberIds }));
  const bg = colour(data?.appState?.viewBackgroundColor);
  return validateIR(
    {
      background: { color: bg, removed: !!bg, transparent: !bg },
      objects,
      connectors,
      groups,
      metadata: { format: 'excalidraw', generator: String(data?.source ?? 'excalidraw').slice(0, 60), notes: [] },
    },
    { report },
  );
}

function textOf(t: El) {
  return {
    content: String(t.text ?? t.originalText ?? ''),
    fontSize: typeof t.fontSize === 'number' ? t.fontSize : 20,
    fontFamily: FONT[t.fontFamily as number] ?? 'sans-serif',
    color: colour(t.strokeColor) ?? '#000000',
    align: t.textAlign === 'left' || t.textAlign === 'right' ? t.textAlign : 'center',
    valign: t.verticalAlign === 'top' || t.verticalAlign === 'bottom' ? t.verticalAlign : 'middle',
  };
}
