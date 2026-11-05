export type MetricDirection = 'higher' | 'lower' | 'none';
export type SplitRule = 'median' | 'mean' | 'peer-median' | 'custom';
export type QuadrantId = 0 | 1 | 2 | 3;
export type QuadrantTone = 'best' | 'worst' | 'mixed' | 'neutral';
export type Threshold = { value: number | null; rule: SplitRule; sampleCount: number };
export type ScatterValuePair = { x: number; y: number };
export type EffectiveSplit = { x: number | null; y: number | null; rule: SplitRule; peerCount: number; notice: string | null };

export function effectiveDirection(direction: string | null | undefined): MetricDirection {
  return direction === 'higher' || direction === 'lower' ? direction : 'none';
}

function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

/** Choose an available split in order, returning the effective rule and a user-visible fallback notice. */
export function computeSplit({ requested, plotted, peers = [], customX, customY }: {
  requested: SplitRule; plotted: readonly ScatterValuePair[]; peers?: readonly ScatterValuePair[]; customX?: number | null; customY?: number | null;
}): EffectiveSplit {
  const peerCount = peers.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).length;
  const peerReady = peerCount >= 10; const medianReady = plotted.length >= 3; const meanReady = plotted.length >= 2;
  const customReady = typeof customX === 'number' && Number.isFinite(customX) && typeof customY === 'number' && Number.isFinite(customY);
  const selectedMedian = (): EffectiveSplit => ({ x: median(plotted.map(point => point.x)), y: median(plotted.map(point => point.y)), rule: 'median', peerCount, notice: null });
  const selectedMean = (): EffectiveSplit => ({ x: mean(plotted.map(point => point.x)), y: mean(plotted.map(point => point.y)), rule: 'mean', peerCount, notice: null });
  const peerMedian = (): EffectiveSplit => ({ x: median(peers.map(point => point.x)), y: median(peers.map(point => point.y)), rule: 'peer-median', peerCount, notice: null });
  const custom = (): EffectiveSplit => ({ x: customX!, y: customY!, rule: 'custom', peerCount, notice: null });
  const direct: Partial<Record<SplitRule, () => EffectiveSplit>> = {
    'peer-median': peerReady ? peerMedian : undefined,
    median: medianReady ? selectedMedian : undefined,
    mean: meanReady ? selectedMean : undefined,
    custom: customReady ? custom : undefined,
  };
  if (direct[requested]) return direct[requested]!();

  const order: SplitRule[] = requested === 'peer-median' ? ['median', 'mean', 'custom']
    : requested === 'median' ? ['mean', 'custom']
      : requested === 'mean' ? ['custom']
        : ['median', 'mean'];
  for (const rule of order) {
    if (!direct[rule]) continue;
    const value = direct[rule]!();
    const prefix = requested === 'peer-median' ? `Peer median needs 10 matching peers${medianReady ? '' : ' and selected median needs 3 funds'}${meanReady && !medianReady ? '' : !customReady && !meanReady ? ' and selected mean needs 2 funds' : ''}`
      : requested === 'median' ? `Median of selected needs 3 funds${rule === 'custom' && !meanReady ? ' and mean needs 2 funds' : ''}`
        : requested === 'mean' ? 'Mean of selected needs 2 funds'
          : 'Custom split needs two finite values';
    return { ...value, notice: `${prefix}; using ${rule === 'median' ? `median of ${plotted.length} selected funds` : rule === 'mean' ? `mean of ${plotted.length} selected funds` : rule === 'custom' ? 'your custom split' : 'the peer median'}.` };
  }
  const message = requested === 'peer-median' ? 'Peer median needs 10 matching peers, selected median needs 3 funds, and selected mean needs 2 funds. Add compared funds or enter a custom split.'
    : requested === 'median' ? 'Median of selected needs 3 funds and mean needs 2. Add compared funds or enter a custom split.'
      : requested === 'mean' ? 'Mean of selected needs 2 funds. Add another compared fund or enter a custom split.'
        : 'Enter finite values for both split lines.';
  return { x: null, y: null, rule: 'custom', peerCount, notice: message };
}

/** Quadrant bits: bit 0 is high X, bit 1 is high Y. Exact ties belong to the better side. */
export function assignQuadrant(x: number, y: number, xThreshold: number, yThreshold: number, dirX: MetricDirection, dirY: MetricDirection): QuadrantId {
  const highX = dirX === 'lower' ? x > xThreshold : x >= xThreshold;
  const highY = dirY === 'lower' ? y > yThreshold : y >= yThreshold;
  return ((highX ? 1 : 0) | (highY ? 2 : 0)) as QuadrantId;
}

/** True means the high side is desirable; null means direction has no preference. */
export function quadrantTone(xHighIsGood: boolean | null, yHighIsGood: boolean | null, quadrant: QuadrantId): QuadrantTone {
  if (xHighIsGood === null || yHighIsGood === null) return 'neutral';
  const highX = (quadrant & 1) !== 0; const highY = (quadrant & 2) !== 0;
  const xGood = highX === xHighIsGood; const yGood = highY === yHighIsGood;
  if (xGood && yGood) return 'best';
  if (!xGood && !yGood) return 'worst';
  return 'mixed';
}

export function bestQuadrant(dirX: MetricDirection, dirY: MetricDirection): QuadrantId | null {
  if (dirX === 'none' || dirY === 'none') return null;
  return ((dirX === 'higher' ? 1 : 0) | (dirY === 'higher' ? 2 : 0)) as QuadrantId;
}

export function worstQuadrant(dirX: MetricDirection, dirY: MetricDirection): QuadrantId | null {
  const best = bestQuadrant(dirX, dirY);
  return best === null ? null : (best ^ 3) as QuadrantId;
}

function friendlyAxisName(label: string): string {
  const normalized = label.toLowerCase();
  if (/volatility|standard deviation|std dev|drawdown|semi-deviation|var 95|value at risk|tracking error|downside capture/.test(normalized)) return 'risk';
  if (/cagr|absolute return|return vs|outperformance|jensen alpha/.test(normalized)) return 'return';
  if (/ter|expense ratio|cost/.test(normalized)) return 'cost';
  return label.replace(/\s*\([^)]*\)/g, '').replace(/\s*·.*$/, '').trim();
}

export function quadrantName(id: QuadrantId, xLabel: string, yLabel: string, dirX: MetricDirection, dirY: MetricDirection): { label: string; kind: 'best' | 'avoid' | 'tradeoff' | 'neutral' } {
  const highX = (id & 1) !== 0; const highY = (id & 2) !== 0;
  const tone = quadrantTone(dirX === 'higher' ? true : dirX === 'lower' ? false : null, dirY === 'higher' ? true : dirY === 'lower' ? false : null, id);
  const xText = `${highX ? 'High' : 'Low'} ${friendlyAxisName(xLabel)}`;
  const yText = `${highY ? 'High' : 'Low'} ${friendlyAxisName(yLabel)}`;
  if (tone === 'neutral') return { label: `${xText}, ${yText}`, kind: 'neutral' };
  if (tone === 'best') return { label: `★ Best · ${xText}, ${yText}`, kind: 'best' };
  if (tone === 'worst') return { label: `⚠ Worst · ${xText}, ${yText}`, kind: 'avoid' };
  return { label: `${xText}, ${yText} · Trade-off`, kind: 'tradeoff' };
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

export function computeThreshold(values: readonly number[], rule: SplitRule, options: { custom?: number | null; groups?: readonly string[] } = {}): Threshold {
  const finite = values.filter(Number.isFinite);
  if (rule === 'custom') return { value: options.custom !== null && options.custom !== undefined && Number.isFinite(options.custom) ? options.custom : null, rule, sampleCount: finite.length };
  if (rule === 'mean') return { value: mean(finite), rule, sampleCount: finite.length };
  if (rule === 'peer-median' && options.groups?.length === values.length) {
    const peers = new Map<string, number[]>();
    values.forEach((value, index) => { if (!Number.isFinite(value)) return; const key = options.groups![index] ?? ''; const items = peers.get(key) ?? []; items.push(value); peers.set(key, items); });
    const groupMedians = [...peers.values()].flatMap(items => { const value = median(items); return value === null ? [] : [value]; });
    return { value: median(groupMedians), rule, sampleCount: finite.length };
  }
  return { value: median(finite), rule: rule === 'peer-median' ? 'median' : rule, sampleCount: finite.length };
}
