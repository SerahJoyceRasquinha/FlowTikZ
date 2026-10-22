/**
 * The conversion report.
 *
 * An import never silently drops or bends anything: every approximation,
 * every unsupported element, every piece of low-confidence text is recorded
 * here with a reference to the object it concerns, and the report is shown to
 * the user when the import completes.
 */

export type ReportCategory =
  /** Imported with no loss. Aggregated, so the list stays readable. */
  | 'converted'
  /** Imported, but part of it could not be represented. */
  | 'partial'
  /** Could not be imported at all (the rest of the diagram still was). */
  | 'unsupported'
  /** Imported with a visual approximation (a different dash, arrow, font...). */
  | 'approximated'
  /** Source properties with no model equivalent, kept verbatim as metadata. */
  | 'preserved'
  /** Text recognised with low confidence - check it. */
  | 'low-confidence-text'
  /** A connector whose endpoints could not be attached to shapes. */
  | 'unmapped-connector'
  /** A style that renders differently than in the source. */
  | 'style-difference'
  /** Background handling and other context. */
  | 'info';

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  converted: 'Converted',
  partial: 'Partially converted',
  unsupported: 'Unsupported elements',
  approximated: 'Approximated properties',
  preserved: 'Preserved as metadata',
  'low-confidence-text': 'Text to check',
  'unmapped-connector': 'Connectors not attached',
  'style-difference': 'Style differences',
  info: 'Notes',
};

/** Order the categories appear in, most actionable first. */
export const CATEGORY_ORDER: ReportCategory[] = [
  'unsupported',
  'low-confidence-text',
  'unmapped-connector',
  'partial',
  'approximated',
  'style-difference',
  'preserved',
  'info',
  'converted',
];

export interface ReportEntry {
  category: ReportCategory;
  message: string;
  /** Id of the object in the intermediate representation. */
  ref?: string;
  /** Id of the resulting diagram object, once mapped. */
  objectId?: string;
}

export interface ImportReport {
  format: string;
  fileName: string;
  counts: {
    shapes: number;
    texts: number;
    connectors: number;
    groups: number;
  };
  entries: ReportEntry[];
  /** Milliseconds from file selection to a committed diagram. */
  durationMs?: number;
}

/** Accumulates entries across the pipeline stages. */
export class ReportBuilder {
  readonly entries: ReportEntry[] = [];
  private seen = new Set<string>();

  add(category: ReportCategory, message: string, ref?: string): void {
    // The same approximation on thirty shapes is one fact, not thirty lines -
    // unless it is tied to a particular object, when the object matters.
    const key = `${category}|${ref ?? ''}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.entries.push(ref ? { category, message, ref } : { category, message });
  }

  /** Count-style entry, e.g. "3 elements with display:none were skipped". */
  addCount(category: ReportCategory, count: number, singular: string, plural: string): void {
    if (count <= 0) return;
    this.add(category, `${count} ${count === 1 ? singular : plural}`);
  }

  has(category: ReportCategory): boolean {
    return this.entries.some((e) => e.category === category);
  }

  private tallies = new Map<string, { category: ReportCategory; message: string; count: number }>();

  /**
   * Count a recurring, object-independent observation ("custom dash pattern
   * approximated"). Tallies become one entry each, with a multiplier, when
   * `flushTallies` runs - so the report reads as facts, not as a log.
   */
  tally(category: ReportCategory, message: string): void {
    const key = `${category}|${message}`;
    const t = this.tallies.get(key);
    if (t) t.count++;
    else this.tallies.set(key, { category, message, count: 1 });
  }

  flushTallies(): void {
    for (const t of this.tallies.values()) {
      this.add(t.category, t.count > 1 ? `${t.message} (${t.count} objects)` : t.message);
    }
    this.tallies.clear();
  }
}

/** Re-point entries from IR ids to diagram ids after mapping or re-numbering. */
export function remapReport(report: ImportReport, idMap: Map<string, string>): ImportReport {
  return {
    ...report,
    entries: report.entries.map((e) => {
      if (e.objectId && idMap.has(e.objectId)) return { ...e, objectId: idMap.get(e.objectId) };
      return e;
    }),
  };
}

/** Entries grouped for display, in `CATEGORY_ORDER`. */
export function groupReport(report: ImportReport): { category: ReportCategory; entries: ReportEntry[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    entries: report.entries.filter((e) => e.category === category),
  })).filter((g) => g.entries.length > 0);
}

/** Number of entries the user should look at (everything but converted/info). */
export function attentionCount(report: ImportReport): number {
  return report.entries.filter(
    (e) => e.category !== 'converted' && e.category !== 'info' && e.category !== 'preserved',
  ).length;
}
