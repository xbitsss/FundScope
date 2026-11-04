import { describe, expect, it } from 'vitest';
import presets from '../../config/scatter-presets.json';
import { metricRegistry } from '../../src/domain/metrics/registry';
import { computeScatterQuery, type ScatterFund } from '../../src/domain/scatter/scatterQuery';

const funds: ScatterFund[] = Array.from({ length: 8 }, (_, index) => ({
  code: index + 1, name: `Fund ${index + 1}`, amc: `House ${index}`, subCategory: index < 4 ? 'Equity A' : 'Debt B', assetClass: index < 4 ? 'equity' : 'debt',
  metrics: { cagr_3y: index === 7 ? null : index, std_dev: index + 10, sharpe: index - 2 },
  metricReasons: index === 7 ? { cagr_3y: 'INSUFFICIENT_HISTORY' } : {},
}));

describe('scatter query', () => {
  it('returns typed plot arrays, thresholds, coverage, and explicit missing-value reasons', () => {
    const result = computeScatterQuery(funds, { xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower', dirY: 'higher', scope: 'current', selectedCodes: [1, 2], currentScreenerIndices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]), splitRule: 'median' });
    expect(result.codes).toBeInstanceOf(Uint32Array);
    expect(result.x).toBeInstanceOf(Float32Array);
    expect(result.quadrants).toBeInstanceOf(Uint8Array);
    expect(result.codes.length).toBe(7);
    expect(result.rankX).toBeInstanceOf(Float32Array);
    expect(result.rankY).toBeInstanceOf(Float32Array);
    expect(result.notPlottedCount).toBe(1);
    expect(result.notPlottedReasons).toContainEqual({ metricId: 'cagr_3y', reason: 'INSUFFICIENT_HISTORY', count: 1 });
    expect(result.coverage.cagr_3y).toBe(7);
    expect(result.mixedAssetClasses).toBe(true);
  });

  it('scopes to selected peer categories or asset classes without filling metric gaps', () => {
    const peer = computeScatterQuery(funds, { xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower', dirY: 'higher', scope: 'same-subcategory', selectedCodes: [1], currentScreenerIndices: new Uint32Array(), splitRule: 'mean' });
    expect(peer.scopeCount).toBe(4);
    expect(peer.codes.length).toBe(4);
    const assets = computeScatterQuery(funds, { xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower', dirY: 'higher', scope: 'same-asset-class', selectedCodes: [8], currentScreenerIndices: new Uint32Array(), splitRule: 'mean' });
    expect(assets.scopeCount).toBe(4);
  });

  it('keeps every preset id valid and numeric', () => {
    const ids = new Set(metricRegistry.filter(metric => metric.unit !== 'enum').map(metric => metric.id));
    for (const preset of presets) { expect(ids.has(preset.x), preset.x).toBe(true); expect(ids.has(preset.y), preset.y).toBe(true); }
  });

  it('uses direction-aware top percentiles and keeps selected points ahead of the cloud', () => {
    const result = computeScatterQuery(funds, { xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower', dirY: 'higher', scope: 'current', selectedCodes: [4], currentScreenerIndices: new Uint32Array(funds.map((_, index) => index)), splitRule: 'median' });
    expect(result.codes[0]).toBe(4);
    expect(result.rankX[0]).toBeLessThan(result.rankX[6]!);
    expect(result.rankY[6]).toBeLessThan(result.rankY[0]!);
  });

  it('processes a 14,200 fund catalogue with typed results and complete counts', () => {
    const large: ScatterFund[] = Array.from({ length: 14_200 }, (_, index) => ({ code: index + 1, name: `Fund ${String(index).padStart(5, '0')}`, amc: `AMC ${index % 50}`, subCategory: `Peer ${index % 24}`, assetClass: index % 3 ? 'equity' : 'debt', metrics: { cagr_3y: index % 180 / 10 - 3, std_dev: index % 100 / 10, sharpe: index % 200 / 100 } }));
    const started = performance.now();
    const result = computeScatterQuery(large, { xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower', dirY: 'higher', scope: 'current', selectedCodes: [100, 200], currentScreenerIndices: new Uint32Array(large.map((_, index) => index)), splitRule: 'median' });
    const elapsed = performance.now() - started;
    expect(result.scopeCount).toBe(14_200);
    expect(result.codes.length).toBe(14_200);
    expect(result.codes[0]).toBe(100);
    expect(result.quadrants.reduce((counts, quadrant) => { counts[quadrant] = (counts[quadrant] ?? 0) + 1; return counts; }, new Array<number>(4).fill(0)).reduce((sum, count) => sum + count, 0)).toBe(14_200);
    expect(elapsed).toBeLessThan(250);
  });
});
