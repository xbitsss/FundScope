import type { ReasonDetail } from '../governance/reasons';
import { assignQuadrant, computeThreshold, type MetricDirection, type QuadrantId, type SplitRule } from './quadrants';

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
  thresholds: { x: number | null; y: number | null; rule: SplitRule; peerCount: number; notice: string | null };
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
function median(values: readonly number[]): number | null {
  const sorted = values.slice().sort((a, b) => a - b); if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function finiteBounds(values: readonly number[]): [number | null, number | null] {
  if (!values.length) return [null, null];
  return [Math.min(...values), Math.max(...values)];
}

/** Plots only selected funds in tray order; the worker computes a separate, unplotted peer reference. */
export function computeScatterQuery(funds: readonly ScatterFund[], options: ScatterQueryOptions): ScatterQueryResult {
  const byCode = new Map(funds.map(fund => [fund.code, fund]));
  const selectedFunds = options.selectedCodes.flatMap(code => { const fund = byCode.get(code); return fund ? [fund] : []; });
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

  const selectedSet = new Set(options.selectedCodes);
  const selectedCategories = new Set(selectedFunds.map(fund => fund.subCategory).filter(Boolean));
  const selectedAssets = new Set(selectedFunds.map(fund => fund.assetClass).filter(Boolean));
  // A peer reference is external to the selected sample. When selections span
  // sub-categories, pool peers from those selected groups and take their median.
  let peerFunds = funds.filter(fund => fund.lifecycle === 'active' && !selectedSet.has(fund.code) && selectedCategories.has(fund.subCategory)
    && finiteMetric(fund, options.xMetric) !== null && finiteMetric(fund, options.yMetric) !== null);
  if (peerFunds.length < 10) peerFunds = funds.filter(fund => fund.lifecycle === 'active' && !selectedSet.has(fund.code) && selectedAssets.has(fund.assetClass)
    && finiteMetric(fund, options.xMetric) !== null && finiteMetric(fund, options.yMetric) !== null);
  const peerCount = peerFunds.length;
  const peerValue = (metricId: string): number | null => {
    if (peerCount < 10) return null;
    return median(peerFunds.map(fund => finiteMetric(fund, metricId)).filter((value): value is number => value !== null));
  };
  const xs = plotted.map(point => point.x); const ys = plotted.map(point => point.y);
  const requested = options.splitRule;
  let rule: SplitRule = requested; let notice: string | null = null;
  let thresholdX: number | null = null; let thresholdY: number | null = null;
  if (requested === 'peer-median') {
    thresholdX = peerValue(options.xMetric); thresholdY = peerValue(options.yMetric);
    if (thresholdX === null || thresholdY === null) {
      if (plotted.length >= 3) { rule = 'median'; notice = `Peer median needs 10 matching peers; using median of ${plotted.length} selected funds.`; }
      else if (plotted.length >= 2) { rule = 'mean'; notice = `Peer median needs 10 matching peers and selected median needs 3 funds; using mean of ${plotted.length} selected funds.`; }
      else if (Number.isFinite(options.customX) && Number.isFinite(options.customY)) { rule = 'custom'; notice = 'Peer reference is unavailable; using your custom split.'; }
      else { rule = 'custom'; notice = 'Peer reference needs 10 matching peers. Add funds or enter a custom split to show quadrants.'; }
    }
  } else if (requested === 'median' && plotted.length < 3) {
    if (plotted.length >= 2) { rule = 'mean'; notice = `Median of selected needs 3 funds; using mean of ${plotted.length} selected funds.`; }
    else { rule = 'custom'; notice = 'Median of selected needs 3 funds; enter a custom split to show quadrants.'; }
  } else if (requested === 'mean' && plotted.length < 2) {
    rule = 'custom'; notice = 'Mean of selected needs 2 funds; enter a custom split to show quadrants.';
  }
  if (rule === 'median') { thresholdX = median(xs); thresholdY = median(ys); }
  else if (rule === 'mean') {
    thresholdX = xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
    thresholdY = ys.length ? ys.reduce((sum, value) => sum + value, 0) / ys.length : null;
  } else if (rule === 'custom') {
    thresholdX = typeof options.customX === 'number' && Number.isFinite(options.customX) ? options.customX : null;
    thresholdY = typeof options.customY === 'number' && Number.isFinite(options.customY) ? options.customY : null;
  }

  const sortedX = xs.slice().sort((a, b) => a - b); const sortedY = ys.slice().sort((a, b) => a - b);
  const codes = new Uint32Array(plotted.length); const x = new Float32Array(plotted.length); const y = new Float32Array(plotted.length);
  const quadrants = new Uint8Array(plotted.length); const selected = new Uint8Array(plotted.length); selected.fill(1); const percentileX = new Float32Array(plotted.length); const percentileY = new Float32Array(plotted.length);
  const rankX = new Float32Array(plotted.length); const rankY = new Float32Array(plotted.length);
  const names: string[] = []; const amcs: string[] = []; const categories: string[] = []; const assetClasses: string[] = [];
  plotted.forEach((point, index) => {
    codes[index] = point.fund.code; x[index] = point.x; y[index] = point.y;
    quadrants[index] = thresholdX === null || thresholdY === null || selectedFunds.length < 2 ? 0 : assignQuadrant(point.x, point.y, thresholdX, thresholdY, options.dirX, options.dirY);
    const bx = sortedBounds(sortedX, point.x); const by = sortedBounds(sortedY, point.y);
    percentileX[index] = sortedX.length ? bx.upper / sortedX.length * 100 : 0;
    percentileY[index] = sortedY.length ? by.upper / sortedY.length * 100 : 0;
    rankX[index] = percentile(sortedX, point.x, options.dirX); rankY[index] = percentile(sortedY, point.y, options.dirY);
    names.push(point.fund.name); amcs.push(point.fund.amc); categories.push(point.fund.subCategory); assetClasses.push(point.fund.assetClass);
  });
  const [xMin, xMax] = finiteBounds(xs); const [yMin, yMax] = finiteBounds(ys);
  const coverageReasons: Record<string, string> = {};
  for (const [id, reasons] of coverageReasonCounts) coverageReasons[id] = [...reasons].sort((a, b) => b[1] - a[1])[0]![0];
  return { codes, x, y, quadrants, selected, percentileX, percentileY, rankX, rankY, names, amcs, categories, assetClasses,
    thresholds: { x: thresholdX, y: thresholdY, rule, peerCount, notice }, coverage, coverageReasons, axisCoverage,
    selectedCount: selectedFunds.length, notPlotted, dataBounds: { xMin, xMax, yMin, yMax } };
}
