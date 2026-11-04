import type { ReasonDetail } from '../governance/reasons';
import { assignQuadrant, computeThreshold, type MetricDirection, type QuadrantId, type SplitRule } from './quadrants';

export type ScatterScope = 'compared' | 'current' | 'same-subcategory' | 'same-asset-class';
export type ScatterFund = {
  code: number; name: string; amc: string; subCategory: string; assetClass: string;
  metrics: Record<string, number | null | undefined>;
  metricReasons?: Record<string, string | undefined>;
  metricReasonDetails?: Record<string, ReasonDetail | undefined>;
};
export type ScatterQueryOptions = {
  xMetric: string; yMetric: string; dirX: MetricDirection; dirY: MetricDirection;
  scope: ScatterScope; selectedCodes: number[]; currentScreenerIndices: Uint32Array;
  splitRule: SplitRule; customX?: number | null; customY?: number | null;
  sort?: { by: 'name' | 'x' | 'y' | 'quadrant' | 'rankX' | 'rankY'; desc: boolean };
};
export type ScatterQueryResult = {
  codes: Uint32Array; x: Float32Array; y: Float32Array; quadrants: Uint8Array;
  percentileX: Float32Array; percentileY: Float32Array; rankX: Float32Array; rankY: Float32Array; selected: Uint8Array;
  names: string[]; amcs: string[]; categories: string[]; assetClasses: string[];
  thresholds: { x: number | null; y: number | null; rule: SplitRule };
  coverage: Record<string, number>; axisCoverage: { x: Record<string, number>; y: Record<string, number> }; scopeCount: number; notPlottedCount: number;
  notPlottedReasons: Array<{ metricId: string; reason: string; count: number; detail?: ReasonDetail }>;
  outlierCount: number; outlierBounds: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null };
  dataBounds: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null };
  mixedAssetClasses: boolean;
};

function finiteMetric(fund: ScatterFund, id: string): number | null {
  const value = fund.metrics?.[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function reasonFor(fund: ScatterFund, id: string): string {
  return fund.metricReasons?.[id] ?? fund.metricReasonDetails?.[id]?.code ?? 'SOURCE_MISSING';
}
function sortedBounds(sorted: readonly number[], value: number): { lower: number; upper: number } {
  let lower = 0; let high = sorted.length;
  while (lower < high) { const middle = (lower + high) >>> 1; if (sorted[middle]! < value) lower = middle + 1; else high = middle; }
  let upper = lower; high = sorted.length;
  while (upper < high) { const middle = (upper + high) >>> 1; if (sorted[middle]! <= value) upper = middle + 1; else high = middle; }
  return { lower, upper };
}
function topPercentile(sorted: readonly number[], value: number, direction: MetricDirection): number {
  if (!sorted.length) return 0;
  const bounds = sortedBounds(sorted, value);
  return (direction === 'lower' ? bounds.upper : direction === 'higher' ? sorted.length - bounds.lower : bounds.upper) / sorted.length * 100;
}
function quantileSorted(sorted: readonly number[], quantile: number): number | null {
  if (!sorted.length) return null;
  const position = Math.min(1, Math.max(0, quantile)) * (sorted.length - 1);
  const low = Math.floor(position); const high = Math.ceil(position); const fraction = position - low;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * fraction;
}
function medianSorted(sorted: readonly number[]): number | null {
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Builds a scope and plot payload from the worker-owned catalogue without imputing null metrics. */
export function computeScatterQuery(funds: readonly ScatterFund[], options: ScatterQueryOptions): ScatterQueryResult {
  const selectedSet = new Set(options.selectedCodes);
  const current = new Set(options.currentScreenerIndices);
  const selectedFunds = funds.filter(fund => selectedSet.has(fund.code));
  const categories = new Set(selectedFunds.map(fund => fund.subCategory));
  const selectedAsset = selectedFunds[0]?.assetClass;
  const scoped: ScatterFund[] = [];
  for (let index = 0; index < funds.length; index++) {
    const fund = funds[index]!;
    const include = options.scope === 'compared' ? selectedSet.has(fund.code)
      : options.scope === 'current' ? current.has(index)
        : options.scope === 'same-subcategory' ? categories.has(fund.subCategory)
        : selectedAsset !== undefined && fund.assetClass === selectedAsset;
    if (include) scoped.push(fund);
  }

  const coverage: Record<string, number> = {};
  const axisCoverage = { x: {} as Record<string, number>, y: {} as Record<string, number> };
  const reasons = new Map<string, number>();
  const reasonDetails = new Map<string, ReasonDetail>();
  const plotted: Array<{ fund: ScatterFund; x: number; y: number; selected: boolean; sortName: string }> = [];
  for (const fund of scoped) {
    const x = finiteMetric(fund, options.xMetric); const y = finiteMetric(fund, options.yMetric);
    for (const [id, value] of Object.entries(fund.metrics ?? {})) if (typeof value === 'number' && Number.isFinite(value)) {
      coverage[id] = (coverage[id] ?? 0) + 1;
      if (y !== null) axisCoverage.x[id] = (axisCoverage.x[id] ?? 0) + 1;
      if (x !== null) axisCoverage.y[id] = (axisCoverage.y[id] ?? 0) + 1;
    }
    if (x === null || y === null) {
      if (x === null) { const key = `${options.xMetric}\u0000${reasonFor(fund, options.xMetric)}`; reasons.set(key, (reasons.get(key) ?? 0) + 1); const detail = fund.metricReasonDetails?.[options.xMetric]; if (detail) reasonDetails.set(key, detail); }
      if (y === null) { const key = `${options.yMetric}\u0000${reasonFor(fund, options.yMetric)}`; reasons.set(key, (reasons.get(key) ?? 0) + 1); const detail = fund.metricReasonDetails?.[options.yMetric]; if (detail) reasonDetails.set(key, detail); }
      continue;
    }
    plotted.push({ fund, x, y, selected: selectedSet.has(fund.code), sortName: fund.name.toLowerCase() });
  }

  const valuesX = plotted.map(point => point.x); const valuesY = plotted.map(point => point.y);
  const sortedX = valuesX.slice().sort((a, b) => a - b); const sortedY = valuesY.slice().sort((a, b) => a - b);
  const peerGroups = plotted.map(point => point.fund.subCategory);
  const threshold = (values: number[], sorted: number[], custom: number | null | undefined) => options.splitRule === 'median'
    ? { value: medianSorted(sorted), rule: options.splitRule, sampleCount: sorted.length }
    : computeThreshold(values, options.splitRule, { custom, groups: peerGroups });
  const thresholdX = threshold(valuesX, sortedX, options.customX);
  const thresholdY = threshold(valuesY, sortedY, options.customY);
  const sort = options.sort ?? { by: 'name' as const, desc: false };
  const sortDirection = sort.desc ? -1 : 1;
  plotted.sort((left, right) => {
    const selectedCompare = Number(right.selected) - Number(left.selected);
    if (selectedCompare) return selectedCompare;
    let compare = 0;
    if (sort.by === 'name') compare = left.sortName < right.sortName ? -1 : left.sortName > right.sortName ? 1 : 0;
    else if (sort.by === 'x') compare = left.x - right.x;
    else if (sort.by === 'y') compare = left.y - right.y;
    else if (sort.by === 'rankX') compare = options.dirX==='higher'?right.x-left.x:left.x-right.x;
    else if (sort.by === 'rankY') compare = options.dirY==='higher'?right.y-left.y:left.y-right.y;
    else compare = assignQuadrant(left.x, left.y, thresholdX.value ?? 0, thresholdY.value ?? 0, options.dirX, options.dirY) - assignQuadrant(right.x, right.y, thresholdX.value ?? 0, thresholdY.value ?? 0, options.dirX, options.dirY);
    return compare * sortDirection || (left.sortName < right.sortName ? -1 : left.sortName > right.sortName ? 1 : 0);
  });
  const codes = new Uint32Array(plotted.length); const x = new Float32Array(plotted.length); const y = new Float32Array(plotted.length);
  const quadrants = new Uint8Array(plotted.length); const percentileX = new Float32Array(plotted.length); const percentileY = new Float32Array(plotted.length); const rankX = new Float32Array(plotted.length); const rankY = new Float32Array(plotted.length); const selected = new Uint8Array(plotted.length);
  const names: string[] = []; const amcs: string[] = []; const categoryNames: string[] = []; const assetClasses: string[] = [];
  let outlierCount = 0;
  const xMin = quantileSorted(sortedX, .01); const xMax = quantileSorted(sortedX, .99);
  const yMin = quantileSorted(sortedY, .01); const yMax = quantileSorted(sortedY, .99);
  const dataBounds = valuesX.length ? {
    xMin: sortedX[0]!, xMax: sortedX.at(-1)!, yMin: sortedY[0]!, yMax: sortedY.at(-1)!,
  } : { xMin: null, xMax: null, yMin: null, yMax: null };
  const mixedAssetClasses = new Set(scoped.map(fund => fund.assetClass)).size > 1;
  for (let index = 0; index < plotted.length; index++) {
    const point = plotted[index]!;
    codes[index] = point.fund.code; x[index] = point.x; y[index] = point.y;
    quadrants[index] = thresholdX.value === null || thresholdY.value === null ? 0 : assignQuadrant(point.x, point.y, thresholdX.value, thresholdY.value, options.dirX, options.dirY);
    const rankBoundsX=sortedBounds(sortedX,point.x);const rankBoundsY=sortedBounds(sortedY,point.y);
    percentileX[index] = sortedX.length ? rankBoundsX.upper / sortedX.length * 100 : 0; percentileY[index] = sortedY.length ? rankBoundsY.upper / sortedY.length * 100 : 0;
    rankX[index] = topPercentile(sortedX,point.x,options.dirX);rankY[index] = topPercentile(sortedY,point.y,options.dirY);
    selected[index] = selectedSet.has(point.fund.code) ? 1 : 0;
    names.push(point.fund.name); amcs.push(point.fund.amc); categoryNames.push(point.fund.subCategory); assetClasses.push(point.fund.assetClass);
    if (xMin !== null && xMax !== null && yMin !== null && yMax !== null && (point.x < xMin || point.x > xMax || point.y < yMin || point.y > yMax)) outlierCount++;
  }
  return {
    codes, x, y, quadrants, percentileX, percentileY, rankX, rankY, selected, names, amcs, categories: categoryNames, assetClasses,
    thresholds: { x: thresholdX.value, y: thresholdY.value, rule: options.splitRule }, coverage, axisCoverage, scopeCount: scoped.length,
    notPlottedCount: scoped.length - plotted.length,
    notPlottedReasons: [...reasons].map(([key, count]) => { const [metricId, reason] = key.split('\u0000'); const detail = reasonDetails.get(key); return { metricId: metricId!, reason: reason!, count, ...(detail ? { detail } : {}) }; }),
    outlierCount, outlierBounds: { xMin, xMax, yMin, yMax }, dataBounds, mixedAssetClasses,
  };
}
