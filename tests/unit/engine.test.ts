import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { computeScreenerView, defaultScreenerFilters, type ScreenerFilters } from '../../src/domain/screener/filters';
import { ScreenerEngine, facetOptionsFromCounts } from '../../src/engine/core';

const categories = ['Large Cap', 'Flexi Cap', 'Corporate Bond', 'Liquid'];
const amcs = ['Alpha AMC', 'Beta AMC', 'Nifty Funds'];
function makeFunds(length: number): Fund[] {
  return Array.from({ length }, (_, index) => ({
    code: index + 1, isinGrowth: null, isinReinvestment: null,
    name: index % 6 === 0 ? `Nifty 50 Index ${index}` : `Synthetic ${index}`,
    amc: amcs[index % amcs.length]!, category: categories[index % categories.length]!, assetClass: ['equity', 'debt', 'hybrid'][index % 3] as Fund['assetClass'],
    classRuleId: 'TEST', taxonomyVersion: 1, subCategory: categories[(index * 3) % categories.length]!,
    structure: ['open', 'close', 'interval', 'unknown'][index % 4] as Fund['structure'], plan: ['Direct', 'Regular', 'Unknown'][index % 3] as Fund['plan'],
    option: ['Growth', 'IDCW', 'Bonus'][index % 3]!, nav: 10 + index / 100, navDate: 20_500 - index % 15, history: [],
    management: index % 2 ? 'Active' : 'Passive', group: `Group ${index % 5}`,
    riskBand: ['Low', 'Medium', 'High', 'Not specified'][index % 4] as Fund['riskBand'],
    philosophy: ['Value', 'Contra', 'Blend/Unspecified'][index % 3] as Fund['philosophy'],
    speciality: index % 4 === 0 ? ['Index', 'ETF'] : index % 2 ? ['Thematic'] : [],
    lifecycle: index % 11 === 0 ? 'dormant' : 'active',
    classStatus: ['CONFIRMED', 'UNCONFIRMED', 'CONFLICT'][index % 3] as Fund['classStatus'],
    metrics: { cagr_1y: index % 7 ? (index % 300) / 10 : null, cagr_3y: index % 9 ? (index % 700) / 10 : null },
    metricReasons: index % 7 ? {} : { cagr_1y: 'INSUFFICIENT_HISTORY' },
  }));
}

describe('columnar screener engine', () => {
  it('matches the reference rows, funnel and all facet counts across seeded filter combinations', () => {
    const funds = makeFunds(350);
    const engine = new ScreenerEngine(funds);
    let seed = 0x51f15e;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x1_0000_0000; };
    const choose = <T,>(values: T[]): T[] => values.filter(() => random() < 0.22);
    const choices: Record<string, string[]> = {
      management: ['Active', 'Passive', 'Not specified'], structure: ['open', 'close', 'interval', 'unknown'],
      plan: ['Direct', 'Regular', 'Unknown'], option: ['Growth', 'IDCW', 'Unknown'],
      assetClasses: ['equity', 'debt', 'hybrid'], riskBands: ['Low', 'Medium', 'High', 'Not specified'],
      philosophies: ['Value', 'Contra', 'Blend/Unspecified'], specialities: ['Index', 'ETF', 'Thematic', 'None'],
      groups: Array.from({ length: 5 }, (_, index) => `Group ${index}`), categories, amcs,
      statuses: ['CONFIRMED', 'UNCONFIRMED', 'CONFLICT', 'Unknown'], lifecycle: ['active', 'dormant'],
    };
    for (let run = 0; run < 500; run++) {
      const filters: ScreenerFilters = {
        ...defaultScreenerFilters,
        search: run % 5 === 0 ? ['nifty', 'alpha', 'corporate', 'synthetic'][run % 4]! : '',
        hideStaleNav: random() < 0.2,
        metrics: random() < 0.35 ? [{ id: 'cagr_1y', min: random() < 0.5 ? 10 : null, max: random() < 0.5 ? 20 : null, excludeMissing: random() < 0.5 }] : [],
        structure: choose(choices.structure!), plan: choose(choices.plan!), option: choose(choices.option!),
        categories: choose(categories), amcs: choose(amcs), assetClasses: choose(choices.assetClasses!),
        management: choose(choices.management!), statuses: choose(choices.statuses!), riskBands: choose(choices.riskBands!),
        philosophies: choose(choices.philosophies!), specialities: choose(choices.specialities!), groups: choose(choices.groups!), lifecycle: choose(choices.lifecycle!),
      };
      const reference = computeScreenerView(funds, filters, 20_500 * 86_400_000);
      const actual = engine.query(filters, { id: 'source', desc: false }, 20_500 * 86_400_000);
      expect(Array.from(actual.indices, index => funds[index]!.code)).toEqual(reference.rows.map(fund => fund.code));
      expect(actual.funnel).toEqual(reference.funnel);
      expect(facetOptionsFromCounts(actual.facets)).toEqual(reference.facets);
    }
  }, 30_000);

  it('indexes 14,200 funds and returns typed indices and facet counts', () => {
    const funds = makeFunds(14_200);
    const engine = new ScreenerEngine(funds);
    const result = engine.query({ ...defaultScreenerFilters, search: 'nifty 50' }, { id: 'cagr_3y', desc: true }, 20_500 * 86_400_000);
    expect(engine.size).toBe(14_200);
    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.facets.categories.counts).toBeInstanceOf(Uint32Array);
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBe(result.indices.length);
  });
});
