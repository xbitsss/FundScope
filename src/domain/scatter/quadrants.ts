export type MetricDirection = 'higher' | 'lower' | 'none';
export type SplitRule = 'median' | 'mean' | 'peer-median' | 'custom';
export type QuadrantId = 0 | 1 | 2 | 3;
export type Threshold = { value: number | null; rule: SplitRule; sampleCount: number };

export function effectiveDirection(direction: string | null | undefined): MetricDirection {
  return direction === 'higher' || direction === 'lower' ? direction : 'none';
}

function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function computeThreshold(values: readonly number[], rule: SplitRule, options: { custom?: number | null; groups?: readonly string[] } = {}): Threshold {
  const finite = values.filter(Number.isFinite);
  if (rule === 'custom') return { value: options.custom !== null && options.custom !== undefined && Number.isFinite(options.custom) ? options.custom : null, rule, sampleCount: finite.length };
  if (rule === 'mean') return { value: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null, rule, sampleCount: finite.length };
  if (rule === 'peer-median' && options.groups?.length === values.length) {
    const peers = new Map<string, number[]>();
    values.forEach((value, index) => { if (!Number.isFinite(value)) return; const key = options.groups![index] ?? ''; const items = peers.get(key) ?? []; items.push(value); peers.set(key, items); });
    const groupMedians = [...peers.values()].flatMap(items => { const value = median(items); return value === null ? [] : [value]; });
    return { value: median(groupMedians), rule, sampleCount: finite.length };
  }
  return { value: median(finite), rule: rule === 'peer-median' ? 'median' : rule, sampleCount: finite.length };
}

/** Quadrant bits: bit 0 is high X, bit 1 is high Y. Exact ties go to the better side; no-preference ties go high. */
export function assignQuadrant(x: number, y: number, xThreshold: number, yThreshold: number, dirX: MetricDirection, dirY: MetricDirection): QuadrantId {
  const highX = dirX === 'lower' ? x > xThreshold : x >= xThreshold;
  const highY = dirY === 'lower' ? y > yThreshold : y >= yThreshold;
  return ((highX ? 1 : 0) | (highY ? 2 : 0)) as QuadrantId;
}

export function bestQuadrant(dirX: MetricDirection, dirY: MetricDirection): QuadrantId | null {
  if (dirX === 'none' || dirY === 'none') return null;
  return ((dirX === 'higher' ? 1 : 0) | (dirY === 'higher' ? 2 : 0)) as QuadrantId;
}

export function worstQuadrant(dirX: MetricDirection, dirY: MetricDirection): QuadrantId | null {
  const best = bestQuadrant(dirX, dirY);
  return best === null ? null : (best ^ 3) as QuadrantId;
}

export function quadrantName(id: QuadrantId, xLabel: string, yLabel: string, dirX: MetricDirection, dirY: MetricDirection): { label: string; kind: 'best' | 'avoid' | 'tradeoff' | 'neutral' } {
  const highX = (id & 1) !== 0;
  const highY = (id & 2) !== 0;
  const best = bestQuadrant(dirX, dirY);
  const worst = worstQuadrant(dirX, dirY);
  if (best === null) return { label: `${highX ? 'High X' : 'Low X'} · ${highY ? 'High Y' : 'Low Y'}`, kind: 'neutral' };
  const axisTerm = (label: string) => {
    const normalized = label.toLowerCase();
    if (/volatility|standard deviation|std dev|drawdown|semi-deviation|var 95|value at risk|tracking error|downside capture/.test(normalized)) return 'risk';
    if (/cagr|absolute return|return vs|outperformance|jensen alpha/.test(normalized)) return 'return';
    if (/ter|expense ratio|cost/.test(normalized)) return 'cost';
    return label.length > 19 ? `${label.slice(0, 18)}…` : label;
  };
  const xText = `${highX ? 'High' : 'Low'} ${axisTerm(xLabel)}`;
  const yText = `${highY ? 'High' : 'Low'} ${axisTerm(yLabel)}`;
  if (id === best) return { label: `${xText} · ${yText} — Best`, kind: 'best' };
  if (id === worst) return { label: `${xText} · ${yText} — Avoid`, kind: 'avoid' };
  return { label: `${xText} · ${yText} — Trade-off`, kind: 'tradeoff' };
}

/** Percent of finite observations at or below value; callers reverse it for lower-is-better metrics. */
export function percentileRank(value: number, values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || !finite.length) return null;
  let belowOrEqual = 0;
  for (const item of finite) if (item <= value) belowOrEqual++;
  return belowOrEqual / finite.length * 100;
}

export function percentileValue(values: readonly number[], percentile: number): number | null {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = Math.min(1, Math.max(0, percentile)) * (sorted.length - 1);
  const low = Math.floor(position); const high = Math.ceil(position); const fraction = position - low;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * fraction;
}
