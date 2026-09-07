import type { Diagram } from '../model/types';
import { normalizeHex } from './colors';
import { getShapeDef, SHAPE_DEFS } from '../model/shapes';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  objectId?: string;
  message: string;
}

const MAX_COORD = 100000;

/**
 * Structural checks run before code generation.
 *
 * The goal is that no diagram, however odd, can produce LaTeX that fails to
 * compile. Anything we cannot represent faithfully is reported here rather
 * than silently approximated.
 */
export function validateDiagram(d: Diagram): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (d.settings.unitsPerCm <= 0) {
    issues.push({
      severity: 'error',
      message: 'Scale must be greater than zero; falling back to 50 units/cm.',
    });
  }

  for (const node of Object.values(d.nodes)) {
    const id = node.id;
    if (!node.style || !node.textStyle) {
      issues.push({
        severity: 'error',
        objectId: id,
        message: 'Styling data is missing or corrupt for this shape.',
      });
      continue;
    }
    if (!SHAPE_DEFS[node.kind]) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: `Unknown shape "${node.kind}"; rendered as a plain process box.`,
      });
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      issues.push({
        severity: 'error',
        objectId: id,
        message: 'Position is not a finite number.',
      });
    }
    if (Math.abs(node.x) > MAX_COORD || Math.abs(node.y) > MAX_COORD) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: 'Position is extremely far from the origin; TikZ may overflow its dimension registers.',
      });
    }
    if (node.w <= 0 || node.h <= 0) {
      issues.push({
        severity: 'error',
        objectId: id,
        message: 'Width and height must both be positive.',
      });
    }
    if (node.w / (d.settings.unitsPerCm || 50) > 500) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: 'Shape is wider than TeX\'s maximum dimension; reduce the size or increase the scale.',
      });
    }
    for (const [label, value] of [
      ['fill', node.style.fill],
      ['stroke', node.style.stroke],
      ['shading', node.style.shadingColor],
      ['text', node.textStyle.color],
    ] as const) {
      if (!normalizeHex(value)) {
        issues.push({
          severity: 'warning',
          objectId: id,
          message: `Unreadable ${label} colour "${value}"; black used instead.`,
        });
      }
    }
    for (const [label, value] of [
      ['fill opacity', node.style.fillOpacity],
      ['stroke opacity', node.style.strokeOpacity],
      ['opacity', node.style.opacity],
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        issues.push({
          severity: 'warning',
          objectId: id,
          message: `${label} must be between 0 and 1; the value was clamped.`,
        });
      }
    }
    if (node.style.shadow && node.style.shading !== 'none') {
      issues.push({
        severity: 'info',
        objectId: id,
        message: 'Shadow plus gradient renders slightly differently in TikZ than on the canvas.',
      });
    }
    if (node.textStyle.fontSize <= 0) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: 'Font size must be positive.',
      });
    }
    if (node.rotation !== 0 && node.text.trim() && getShapeDef(node.kind).tikzNode) {
      // Informational only: TikZ rotates the whole node, matching the canvas.
    }
    if (node.textStyle.wrapWidth > 0) {
      issues.push({
        severity: 'info',
        objectId: id,
        message: 'Wrapped text breaks at LaTeX\'s line-breaking points, which may differ from the browser\'s.',
      });
    }
  }

  for (const edge of Object.values(d.edges)) {
    const id = edge.id;
    const srcOk = edge.source.nodeId ? !!d.nodes[edge.source.nodeId] : !!edge.source.point;
    const dstOk = edge.target.nodeId ? !!d.nodes[edge.target.nodeId] : !!edge.target.point;
    if (!srcOk || !dstOk) {
      issues.push({
        severity: 'error',
        objectId: id,
        message: 'Connector references a shape that no longer exists.',
      });
    }
    if (edge.strokeWidth <= 0) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: 'Line width must be positive.',
      });
    }
    if (!normalizeHex(edge.stroke)) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: `Unreadable line colour "${edge.stroke}"; black used instead.`,
      });
    }
    if (edge.label && (edge.label.pos < 0 || edge.label.pos > 1)) {
      issues.push({
        severity: 'warning',
        objectId: id,
        message: 'Label position must be between 0 and 1.',
      });
    }
    if (
      edge.routing === 'zigzag' &&
      (edge.arrowStart !== 'none' || edge.arrowEnd !== 'none')
    ) {
      issues.push({
        severity: 'info',
        objectId: id,
        message: 'Zig-zag connectors place the arrow along the last zig, which can look angled.',
      });
    }
  }

  return issues;
}

export function summarizeIssues(issues: ValidationIssue[]) {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  };
}
