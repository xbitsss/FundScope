import type { ReasonDetail } from '../governance/reasons';
import { assignQuadrant, computeSplit, type MetricDirection, type QuadrantId, type SplitRule } from './quadrants';

export type ScatterFund = {
  code: number; name: string; amc: string; subCategory: string; assetClass: string;
  lifecycle?: 'active' | 'dormant';
  metrics: Record<string, number | null | undefined>;
  metricReasons?: Record<string, string | undefined>;
  metricReasonDetails?: Record<string, ReasonDetail | undefined>;
};
export type ScatterQueryOptions = {
  xMetric: string; yMetric: string; dirX: MetricDirection; dirY: MetricDirection;
  selectedCodes: number[]; splitRule: SplitRule; customX?: number | null; customY?: number | null;
};
export type ScatterQueryResult = {
  codes: Uint32Array; x: Float32Array; y: Float32Array; quadrants: Uint8Array; selected: Uint8Array;
  percentileX: Float32Array; percentileY: Float32Array; rankX: Float32Array; rankY: Float32Array;
  names: string[]; amcs: string[]; categories: string[]; assetClasses: string[];
  thresholds: { x: number | null; y: number | null; rule: SplitRule; peerCount: number; peerScope: 'sub-category' | 'asset class' | null; subCategoryPeerCount: number; notice: string | null };
  coverage: Record<string, number>; coverageReasons: Record<string, string>; axisCoverage: { x: Record<string, number>; y: Record<string, number> };
  selectedCount: number; notPlotted: Array<{ code: number; name: string; metricId: string; reason: string; detail?: ReasonDetail }>;
  dataBounds: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null };
};

function finiteMetric(fund: ScatterFund, id: string): number | null {
  const value = fund.metrics?.[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function reasonFor(fund: ScatterFund, id: string): string {
  return fund.metricReasons?.[id] ?? fund.metricReasonDetails?.[id]?.code ?? 'SOURCE_MISSING';
}
function sortedBounds(sorted: readonly number[], value: number): { lower: number; upper: number } {
  let low = 0; let high = sorted.length;
  while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle]! < value) low = middle + 1; else high = middle; }
  const lower = low; high = sorted.length;
  while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle]! <= value) low = middle + 1; else high = middle; }
  return { lower, upper: low };
}
function percentile(sorted: readonly number[], value: number, direction: MetricDirection): number {
  if (!sorted.length) return 0;
  const bounds = sortedBounds(sorted, value);
  return (direction === 'lower' ? bounds.upper : direction === 'higher' ? sorted.length - bounds.lower : bounds.upper) / sorted.length * 100;
}
function rankPosition(sorted: readonly number[], value: number, direction: MetricDirection): number {
  const bounds = sortedBounds(sorted, value);
  if (direction === 'higher') return sorted.length - bounds.upper + 1;
  return bounds.lower + 1;
}
function finiteBounds(values: readonly number[]): [number | null, number | null] {
  if (!values.length) return [null, null];
  return [Math.min(...values), Math.max(...values)];
}

/** Plots only selected funds in tray order; the worker computes a separate, unplotted peer reference. */
export function computeScatterQuery(funds: readonly ScatterFund[], options: ScatterQueryOptions): ScatterQueryResult {
  const byCode = new Map(funds.map(fund => [fund.code, fund]));
  const selectedFunds = options.selectedCodes.slice(0, 6).flatMap(code => { const fund = byCode.get(code); return fund ? [fund] : []; });
  const coverage: Record<string, number> = {};
  const coverageReasonCounts = new Map<string, Map<string, number>>();
  const axisCoverage = { x: {} as Record<string, number>, y: {} as Record<string, number> };
  const notPlotted: ScatterQueryResult['notPlotted'] = [];
  const plotted: Array<{ fund: ScatterFund; x: number; y: number }> = [];

  for (const fund of selectedFunds) {
    for (const [id, raw] of Object.entries(fund.metrics ?? {})) {
      if (typeof raw === 'number' && Number.isFinite(raw)) coverage[id] = (coverage[id] ?? 0) + 1;
    }
    for (const [id, reason] of Object.entries(fund.metricReasons ?? {})) if (typeof reason === 'string' && finiteMetric(fund, id) === null) {
      const reasonCounts = coverageReasonCounts.get(id) ?? new Map<string, number>(); reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1); coverageReasonCounts.set(id, reasonCounts);
    }
    const x = finiteMetric(fund, options.xMetric); const y = finiteMetric(fund, options.yMetric);
    if (x !== null && y !== null) {
      plotted.push({ fund, x, y });
      axisCoverage.x[options.xMetric] = (axisCoverage.x[options.xMetric] ?? 0) + 1;
      axisCoverage.y[options.yMetric] = (axisCoverage.y[options.yMetric] ?? 0) + 1;
    } else {
      for (const [metricId, value] of [[options.xMetric, x], [options.yMetric, y]] as const) if (value === null) {
        const detail = fund.metricReasonDetails?.[metricId];
        notPlotted.push({ code: fund.code, name: fund.name, metricId, reason: reasonFor(fund, metricId), ...(detail ? { detail } : {}) });
      }
    }
  }

  const selectedSet = new Set(selectedFunds.map(fund => fund.code));
  const selectedCategories = new Set(selectedFunds.map(fund => fund.subCategory).filter(Boolean));
  const selectedAssets = new Set(selectedFunds.map(fund => fund.assetClass).filter(Boolean));
  // A peer reference is external to the selected sample. When selections span
  // sub-categories, pool peers from those selected groups and take their median.
  const subCategoryPeers = funds.filter(fund => fund.lifecycle === 'active' && !selectedSet.has(fund.code) && selectedCategories.has(fund.subCategory)
    && finiteMetric(fund, options.xMetric) !== null && finiteMetric(fund, options.yMetric) !== null);
  let peerFunds = subCategoryPeers;
  let peerScope: ScatterQueryResult['thresholds']['peerScope'] = 'sub-category';
  if (peerFunds.length < 10) { peerFunds = funds.filter(fund => fund.lifecycle === 'active' && !selectedSet.has(fund.code) && selectedAssets.has(fund.assetClass)
    && finiteMetric(fund, options.xMetric) !== null && finiteMetric(fund, options.yMetric) !== null);
    peerScope = peerFunds.length >= 10 ? 'asset class' : null;
  }
  const xs = plotted.map(point => point.x); const ys = plotted.map(point => point.y);
  const peerPairs = peerFunds.flatMap(fund => { const x = finiteMetric(fund, options.xMetric); const y = finiteMetric(fund, options.yMetric); return x === null || y === null ? [] : [{ x, y }]; });
  const split = computeSplit({ requested: options.splitRule, plotted, peers: peerPairs, customX: options.customX, customY: options.customY });
  const { rule, notice, peerCount } = split; const thresholdX = split.x; const thresholdY = split.y;

  const sortedX = xs.slice().sort((a, b) => a - b); const sortedY = ys.slice().sort((a, b) => a - b);
  const codes = new Uint32Array(plotted.length); const x = new Float32Array(plotted.length); const y = new Float32Array(plotted.length);
  const quadrants = new Uint8Array(plotted.length); const selected = new Uint8Array(plotted.length); selected.fill(1); const percentileX = new Float32Array(plotted.length); const percentileY = new Float32Array(plotted.length);
  const rankX = new Float32Array(plotted.length); const rankY = new Float32Array(plotted.length);
  const names: string[] = []; const amcs: string[] = []; const categories: string[] = []; const assetClasses: string[] = [];
  plotted.forEach((point, index) => {
    codes[index] = point.fund.code; x[index] = point.x; y[index] = point.y;
    quadrants[index] = thresholdX === null || thresholdY === null ? 0 : assignQuadrant(point.x, point.y, thresholdX, thresholdY, options.dirX, options.dirY);
    percentileX[index] = percentile(sortedX, point.x, options.dirX); percentileY[index] = percentile(sortedY, point.y, options.dirY);
    rankX[index] = rankPosition(sortedX, point.x, options.dirX); rankY[index] = rankPosition(sortedY, point.y, options.dirY);
    names.push(point.fund.name); amcs.push(point.fund.amc); categories.push(point.fund.subCategory); assetClasses.push(point.fund.assetClass);
  });
  const [xMin, xMax] = finiteBounds(xs); const [yMin, yMax] = finiteBounds(ys);
  const coverageReasons: Record<string, string> = {};
  for (const [id, reasons] of coverageReasonCounts) coverageReasons[id] = [...reasons].sort((a, b) => b[1] - a[1])[0]![0];
  return { codes, x, y, quadrants, selected, percentileX, percentileY, rankX, rankY, names, amcs, categories, assetClasses,
    thresholds: { x: thresholdX, y: thresholdY, rule, peerCount, peerScope, subCategoryPeerCount: subCategoryPeers.length, notice }, coverage, coverageReasons, axisCoverage,
    selectedCount: selectedFunds.length, notPlotted, dataBounds: { xMin, xMax, yMin, yMax } };
}
