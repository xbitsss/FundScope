import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { sameScreenerIndexData } from '../../src/engine/engineClient';

const fund: Fund = {
  code: 1, isinGrowth: null, isinReinvestment: null, name: 'Example Fund', amc: 'Example AMC', category: 'Equity',
  assetClass: 'equity', classRuleId: 'TEST', taxonomyVersion: 3, subCategory: 'Flexi Cap', structure: 'open',
  plan: 'Direct', option: 'Growth', nav: 12.5, navDate: 20_500, history: [], metrics: { cagr_3y: 12 },
  management: 'Active', group: 'Diversified', riskBand: 'High', philosophy: 'Blend/Unspecified', speciality: ['Index'], lifecycle: 'active',
};

describe('screener index invalidation', () => {
  it('does not rebuild for history/detail-only updates', () => {
    const next = { ...fund, history: [{ date: 20_499, nav: 12 }], classDetail: undefined, metricReasonDetails: undefined };
    expect(sameScreenerIndexData([fund], [next])).toBe(true);
  });

  it('rebuilds when a searchable, facetable, freshness or metric value changes', () => {
    expect(sameScreenerIndexData([fund], [{ ...fund, name: 'Renamed Fund' }])).toBe(false);
    expect(sameScreenerIndexData([fund], [{ ...fund, navDate: 20_400 }])).toBe(false);
    expect(sameScreenerIndexData([fund], [{ ...fund, metrics: { cagr_3y: 13 } }])).toBe(false);
  });
});
