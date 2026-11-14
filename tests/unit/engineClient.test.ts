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
});
