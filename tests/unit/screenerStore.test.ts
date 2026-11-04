import { describe, expect, it } from 'vitest';
import { fromSavedScreen } from '../../src/app/screenerStore';
import { defaultScreenerFilters } from '../../src/domain/screener/filters';

describe('saved screener migration', () => {
  it('loads existing version 2 screens with their original filters', () => {
    const restored = fromSavedScreen({ version: 2, filters: { ...defaultScreenerFilters, categories: ['Flexi Cap'], metrics: [{ id: 'cagr_5y', min: 15, max: null, excludeMissing: true }] } });
    expect(restored.categories).toEqual(['Flexi Cap']);
    expect(restored.metrics).toEqual([{ id: 'cagr_5y', min: 15, max: null, excludeMissing: true }]);
  });

  it('loads version 3 filters and accepts legacy screen payloads', () => {
    expect(fromSavedScreen({ version: 3, filters: { ...defaultScreenerFilters, assetClasses: ['equity'] } }).assetClasses).toEqual(['equity']);
    expect(fromSavedScreen({ plan: 'Both', category: 'Debt|Equity' })).toMatchObject({ plan: [], categories: ['Debt', 'Equity'] });
  });
});
