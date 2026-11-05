import { describe, expect, it } from 'vitest';
import presets from '../../config/scatter-presets.json';
import { metricRegistry } from '../../src/domain/metrics/registry';
import { computeScatterQuery, type ScatterFund } from '../../src/domain/scatter/scatterQuery';

const sample: ScatterFund[] = Array.from({ length: 8 }, (_, index) => ({
  code: index + 1, name: `Fund ${index + 1}`, amc: `House ${index}`, subCategory: index < 4 ? 'Equity A' : 'Debt B', assetClass: index < 4 ? 'equity' : 'debt',
  metrics: { cagr_3y: index === 7 ? null : index, std_dev: index + 10, sharpe: index - 2 },
  metricReasons: index === 7 ? { cagr_3y: 'INSUFFICIENT_HISTORY' } : {},
}));
const options = (selectedCodes: number[], splitRule: 'peer-median' | 'median' | 'mean' | 'custom' = 'peer-median') => ({ xMetric: 'std_dev', yMetric: 'cagr_3y', dirX: 'lower' as const, dirY: 'higher' as const, selectedCodes, splitRule });

describe('selected-fund scatter query', () => {
  it('plots only selected funds with both metrics, preserves tray order, and explains missing values', () => {
    const result = computeScatterQuery(sample, options([4, 8, 2]));
    expect(Array.from(result.codes)).toEqual([4, 2]);
    expect(result.selectedCount).toBe(3);
    expect(result.notPlotted).toEqual([{ code: 8, name: 'Fund 8', metricId: 'cagr_3y', reason: 'INSUFFICIENT_HISTORY' }]);
    expect(result.coverage.cagr_3y).toBe(2);
    expect(Array.from(result.selected)).toEqual([1, 1]);
  });

  it('computes the peer median off-chart and requires ten peers with both metrics', () => {
    const peers: ScatterFund[] = Array.from({ length: 12 }, (_, index) => ({ code: 100 + index, name: `Peer ${index}`, amc: 'Peer AMC', subCategory: 'Equity A', assetClass: 'equity', lifecycle: 'active', metrics: { std_dev: index, cagr_3y: index + 20 } }));
    const result = computeScatterQuery([...sample, ...peers], options([1, 2, 3, 4]));
    expect(Array.from(result.codes)).toEqual([1, 2, 3, 4]);
    expect(result.thresholds).toMatchObject({ x: 5.5, y: 25.5, rule: 'peer-median', peerCount: 12, notice: null });
  });

  it('visibly falls back from unavailable peer references to selected median, mean, then custom', () => {
    const median = computeScatterQuery(sample, options([1, 2, 3]));
    expect(median.thresholds.rule).toBe('median'); expect(median.thresholds.x).toBe(11); expect(median.thresholds.notice).toMatch(/using median/);
    const mean = computeScatterQuery(sample, options([1, 2]));
    expect(mean.thresholds.rule).toBe('mean'); expect(mean.thresholds.x).toBe(10.5); expect(mean.thresholds.notice).toMatch(/using mean/);
    const custom = computeScatterQuery(sample, { ...options([1]), customX: 10.5, customY: 0.5 });
    expect(custom.thresholds).toMatchObject({ x: 10.5, y: 0.5, rule: 'custom' });
  });

  it('keeps the peer split unavailable when fewer than ten exact-match peers exist', () => {
    const peers: ScatterFund[] = Array.from({ length: 9 }, (_, index) => ({ code: 100 + index, name: `Peer ${index}`, amc: 'Peer AMC', subCategory: 'Equity A', assetClass: 'equity', lifecycle: 'active', metrics: { std_dev: index, cagr_3y: index + 1 } }));
    const result = computeScatterQuery([...sample, ...peers], options([1, 2, 3, 4]));
    expect(result.thresholds.peerCount).toBe(9);
    expect(result.thresholds.rule).toBe('median');
  });

  it('keeps all configured preset axes numeric', () => {
    const ids = new Set(metricRegistry.filter(metric => metric.unit !== 'enum').map(metric => metric.id));
    for (const preset of presets) { expect(ids.has(preset.x), preset.x).toBe(true); expect(ids.has(preset.y), preset.y).toBe(true); }
  });

  it('does not turn a large local catalogue into chart points', () => {
    const catalogue: ScatterFund[] = Array.from({ length: 14_200 }, (_, index) => ({ code: index + 1, name: `Fund ${index}`, amc: 'AMC', subCategory: `Category ${index % 20}`, assetClass: 'equity', lifecycle: 'active', metrics: { std_dev: index % 50, cagr_3y: index % 100 } }));
    const result = computeScatterQuery(catalogue, options([7, 200, 18]));
    expect(Array.from(result.codes)).toEqual([7, 200, 18]);
    expect(result.selectedCount).toBe(3);
    expect(result.codes.length).toBeLessThanOrEqual(6);
  });
});
