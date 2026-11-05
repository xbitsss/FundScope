import type { MetricDefinition } from '../types';
import type { MetricDirection } from './quadrants';

const validDate = (milliseconds: number): Date | null => {
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) return null;
  const date = new Date(milliseconds); return Number.isNaN(date.getTime()) ? null : date;
};
export function formatEpochDay(day: number | null | undefined): string {
  if (typeof day !== 'number' || !Number.isFinite(day)) return '—';
  const date = validDate(Math.trunc(day) * 86_400_000); if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function formatEpochMs(milliseconds: number | null | undefined): string {
  if (typeof milliseconds !== 'number') return '—';
  const date = validDate(milliseconds); if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Returns 4–6 readable, rounded values including a zero tick when the range crosses zero. */
export function niceTicks(minimum: number, maximum: number, target = 5): number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  let low = Math.min(minimum, maximum); let high = Math.max(minimum, maximum);
  if (low === high) { const pad = Math.max(Math.abs(low) * 0.08, 0.01); low -= pad; high += pad; }
  const desired = Math.max(2, Math.min(8, target)); const raw = (high - low) / (desired - 1);
  const exponent = Math.floor(Math.log10(raw)); const fractions = [1, 2, 2.5, 5, 10];
  const candidates = [-1, 0, 1].flatMap(offset => fractions.map(fraction => fraction * 10 ** (exponent + offset)));
  const makeTicks = (step: number) => {
    const start = Math.ceil(low / step - 1e-10) * step; const values: number[] = [];
    for (let value = start, guard = 0; value <= high + step * 1e-8 && guard < 12; value += step, guard++) values.push(Number(value.toPrecision(12)));
    if (low < 0 && high > 0 && !values.some(value => Math.abs(value) < step * 1e-8)) values.push(0);
    return values.sort((a, b) => a - b);
  };
  const score = (step: number) => {
    const count = makeTicks(step).length; const inPreferredRange = count >= 4 && count <= 6;
    return (inPreferredRange ? 0 : 10 + Math.abs(count - desired)) + Math.abs(count - desired) * .25 + Math.abs(Math.log(step / raw)) * .12;
  };
  const step = candidates.sort((a, b) => score(a) - score(b))[0]!;
  return makeTicks(step);
}

const riskMetrics = new Set(['std_dev', 'var_95', 'semi_deviation', 'sharpe', 'sortino', 'max_drawdown', 'calmar', 'tail_risk_ratio', 'gain_loss_ratio', 'omega', 'beta', 'r_squared', 'treynor', 'jensen_alpha', 'information_ratio', 'upside_capture', 'downside_capture', 'tracking_error']);

export function formatMetricName(metric: Pick<MetricDefinition, 'label' | 'unit'>): string {
  const unitPattern = metric.unit === '%' ? /\s*\(%\)\s*$/ : metric.unit === '₹ Cr' ? /\s*\(₹\s*Cr\)\s*$/i : metric.unit === 'years' ? /\s*\(years?\)\s*$/i : metric.unit === 'ratio' ? /\s*\(ratio\)\s*$/i : null;
  return (unitPattern ? metric.label.replace(unitPattern, '') : metric.label).trim();
}

export function formatMetricAxisLabel(metric: Pick<MetricDefinition, 'id' | 'label' | 'unit'>, windowYears?: number): string {
  const unit = metric.unit && metric.unit !== 'enum' ? metric.unit : '';
  const label = formatMetricName(metric);
  const fixedWindow = metric.id.match(/_(\d+)y$/i)?.[1];
  const basis = riskMetrics.has(metric.id)
    ? (windowYears ? `${windowYears}Y risk window` : '')
    : fixedWindow && !new RegExp(`\\b${fixedWindow}Y\\b`, 'i').test(label) ? `${fixedWindow}Y` : '';
  const unitSuffix = unit === '%' ? ' (%)' : unit ? ` (${unit})` : '';
  return `${label}${unitSuffix}${basis ? ` · ${basis}` : ''}`;
}

export function formatSplitValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : '';
}

export function parseSplitValue(input: string, lastValid: number | null): { value: number | null; valid: boolean } {
  const clean = input.trim().replace(/[₹,%\s,]/g, '');
  const parsed = clean === '' ? null : Number(clean);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? { value: parsed, valid: true } : { value: lastValid, valid: false };
}

export function formatAxisTitle(metric: Pick<MetricDefinition, 'id' | 'label' | 'unit'>, direction: MetricDirection, windowYears?: number): string {
  const directionText = direction === 'higher' ? 'higher is better' : direction === 'lower' ? 'lower is better' : 'no preference';
  return `${formatMetricAxisLabel(metric, windowYears)} · ${directionText}`;
}

/** Best-effort deterministic label placement. Positions are clamped to the plot area. */
export function labelPlacement(points: Array<{ x: number; y: number; label: string }>, bounds: { left: number; top: number; right: number; bottom: number }): Array<{ x: number; y: number; anchor: 'start' | 'end'; moved: boolean }> {
  const placed: Array<{ x: number; y: number; anchor: 'start' | 'end'; moved: boolean; width: number; height: number }> = [];
  let collisionFallback = false;
  const offsets = [[10, -10, 'start'], [10, 14, 'start'], [-10, -10, 'end'], [-10, 14, 'end'], [0, -22, 'start'], [0, 25, 'start'], [18, 0, 'start'], [-18, 0, 'end']] as const;
  const output = points.map(point => {
    const width = Math.min(150, Math.max(34, point.label.length * 6.4)); const height = 18;
    for (const [dx, dy, anchor] of offsets) {
      const rawX = point.x + dx;
      const x = anchor === 'end' ? Math.max(bounds.left + width, Math.min(bounds.right - 3, rawX)) : Math.max(bounds.left + 3, Math.min(bounds.right - width, rawX));
      const y = Math.max(bounds.top + height, Math.min(bounds.bottom - 3, point.y + dy));
      const boxLeft = anchor === 'end' ? x - width : x;
      const overlap = placed.some(item => {
        const itemLeft = item.anchor === 'end' ? item.x - item.width : item.x;
        return boxLeft < itemLeft + item.width && boxLeft + width > itemLeft && y - height < item.y && y > item.y - item.height;
      });
      if (!overlap) { placed.push({ x, y, anchor, moved: dx !== 10 || dy !== -10, width, height }); return { x, y, anchor, moved: dx !== 10 || dy !== -10 }; }
    }
    collisionFallback = true;
    const x = Math.max(bounds.left + 3, Math.min(bounds.right - width, point.x + 10));
    const y = Math.max(bounds.top + height, Math.min(bounds.bottom - 3, point.y - 10));
    placed.push({ x, y, anchor: 'start', moved: true, width, height });
    return { x, y, anchor: 'start' as const, moved: true };
  });
  if (!collisionFallback) return output;
  // At very close point clusters, put all labels in distinct plot rows. With at
  // most six compared funds this keeps labels readable and prevents overlap.
  const rowHeight = Math.max(20, (bounds.bottom - bounds.top - 12) / Math.max(1, points.length));
  return points.map((point, index) => {
    const width = Math.min(150, Math.max(34, point.label.length * 6.4));
    const x = Math.max(bounds.left + 3, Math.min(bounds.right - width, point.x + 10));
    const y = Math.min(bounds.bottom - 3, bounds.top + 18 + index * rowHeight);
    return { x, y, anchor: 'start' as const, moved: true };
  });
}
