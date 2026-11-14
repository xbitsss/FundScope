import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { defaultScreenerFilters } from '../../src/domain/screener/filters';
import { ScreenerEngine } from '../../src/engine/core';
import { sameScreenerIndexData } from '../../src/engine/engineClient';
import { hasAuthoritativeMetrics } from '../../src/app/historyLoader';

const fund: Fund = {
  code: 1, isinGrowth: null, isinReinvestment: null, name: 'Example Fund', amc: 'Example AMC', category: 'Equity',
  assetClass: 'equity', classRuleId: 'TEST', taxonomyVersion: 3, subCategory: 'Flexi Cap', structure: 'open',
  plan: 'Direct', option: 'Growth', nav: 12.5, navDate: 20_500, history: [], metrics: { cagr_3y: 12 },
  management: 'Active', group: 'Diversified', riskBand: 'High', philosophy: 'Blend/Unspecified', speciality: ['Index'], lifecycle: 'active',
};

describe('screener index invalidation and on-demand metric stability', () => {
  it('does not rebuild for history/detail-only updates or shallow-cloned metrics with identical values', () => {
    const next = {
      ...fund,
      history: [{ date: 20_499, nav: 12 }],
      metrics: { ...fund.metrics },
      speciality: [...(fund.speciality ?? [])],
      classDetail: undefined,
      metricReasonDetails: undefined,
    };
    expect(sameScreenerIndexData([fund], [next])).toBe(true);
  });

  it('rebuilds when a searchable, facetable, NAV, freshness or metric value changes', () => {
    expect(sameScreenerIndexData([fund], [{ ...fund, name: 'Renamed Fund' }])).toBe(false);
    expect(sameScreenerIndexData([fund], [{ ...fund, nav: 13.25 }])).toBe(false);
    expect(sameScreenerIndexData([fund], [{ ...fund, navDate: 20_400 }])).toBe(false);
    expect(sameScreenerIndexData([fund], [{ ...fund, metrics: { cagr_3y: 13 } }])).toBe(false);
  });

  it('detects authoritative precomputed metrics so on-demand chart loads do not recompute table metrics', () => {
    expect(hasAuthoritativeMetrics({ ...fund, metricsNavAsOf: 20_500 }, 20_500)).toBe(true);
    expect(hasAuthoritativeMetrics({ ...fund, metricsNavAsOf: 20_400 }, 20_500)).toBe(false);
    expect(hasAuthoritativeMetrics({ ...fund, metrics: {} }, 20_500)).toBe(false);
  });

  it('sorts by latest NAV in the columnar screener engine', () => {
    const funds = [
      { ...fund, code: 1, nav: 45.2 },
      { ...fund, code: 2, nav: 180.75 },
      { ...fund, code: 3, nav: 12.1 },
    ];
    const engine = new ScreenerEngine(funds);
    const descOrder = Array.from(engine.query(defaultScreenerFilters, { id: 'nav', desc: true }, 20_500 * 86_400_000).indices);
    expect(descOrder.map(i => funds[i]!.code)).toEqual([2, 1, 3]);
    const ascOrder = Array.from(engine.query(defaultScreenerFilters, { id: 'nav', desc: false }, 20_500 * 86_400_000).indices);
    expect(ascOrder.map(i => funds[i]!.code)).toEqual([3, 1, 2]);
  });

  it('returns distinct Float32Array score buffers across repeated queries so worker Transferable postMessage never detaches cached scores', () => {
    const funds = [
      { ...fund, code: 1, metrics: { cagr_3y: 12, sharpe: 1.1 } },
      { ...fund, code: 2, metrics: { cagr_3y: 15, sharpe: 1.4 } },
      { ...fund, code: 3, metrics: { cagr_3y: 9, sharpe: 0.8 } },
    ];
    const factors = [{ id: 'cagr_3y', label: '3Y CAGR', weight: 50, lowerIsBetter: false }, { id: 'sharpe', label: 'Sharpe', weight: 50, lowerIsBetter: false }];
    const engine = new ScreenerEngine(funds);
    const first = engine.query(defaultScreenerFilters, { id: 'score', desc: true }, 20_500 * 86_400_000, factors);
    const second = engine.query(defaultScreenerFilters, { id: 'score', desc: true }, 20_500 * 86_400_000, factors);
    expect(first.scores).toBeDefined();
    expect(second.scores).toBeDefined();
    expect(first.scores!.buffer).not.toBe(second.scores!.buffer);
    expect(Array.from(first.scores!)).toEqual(Array.from(second.scores!));
  });

  it('updates scores in-place without requiring a full ScreenerEngine rebuild', () => {
    const funds = [
      { ...fund, code: 1, metrics: { cagr_3y: 12, sharpe: 1.1 } },
      { ...fund, code: 2, metrics: { cagr_3y: 15, sharpe: 1.4 } },
    ];
    const withUpdatedScores = [
      { ...funds[0]!, metrics: { ...funds[0]!.metrics, composite_score: 42.5, composite_score_model_hash: 12345 } },
      { ...funds[1]!, metrics: { ...funds[1]!.metrics, composite_score: 91.2, composite_score_model_hash: 12345 } },
    ];
    expect(sameScreenerIndexData(funds, withUpdatedScores)).toBe(true);

    const factors = [{ id: 'cagr_3y', weight: 50, direction: 'higher' as const }, { id: 'sharpe', weight: 50, direction: 'higher' as const }];
    const engine = new ScreenerEngine(funds);
    engine.updateScores(new Float32Array([88.5, 34.0]), 999);
    const result = engine.query(defaultScreenerFilters, { id: 'score', desc: true }, 20_500 * 86_400_000, factors);
    expect(Array.from(result.indices)).toEqual([0, 1]);
    expect(result.scores?.[0]).toBeCloseTo(88.5, 2);
    expect(result.scores?.[1]).toBeCloseTo(34.0, 2);
  });
});
