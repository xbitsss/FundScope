import { describe, expect, it } from 'vitest';
import { classifyAmfiScheme } from '../../src/domain/taxonomy/classifyV3';
import { reconcileClassification } from '../../src/domain/taxonomy/consensus';

describe('taxonomy v3 AMFI-only scheme classification', () => {
  it.each([
    ['Exchange Traded Funds (ETFs) - Debt ETF', 'Nifty PSU Bond ETF', 'debt', 'ETF'],
    ['Exchange Traded Funds (ETFs) - Equity ETF', 'Nifty 50 ETF', 'equity', 'ETF'],
    ['Index Funds - Hybrid Fund', 'Balanced Allocation Index Fund', 'hybrid', 'Index'],
    ['Other Scheme - Index Funds', 'Nifty 50 Index Fund', 'equity', 'Index'],
    ['Other Scheme - FoF Overseas', 'Global Equity Fund of Funds', 'equity', 'Fund of Funds'],
    ['Other Scheme - Other ETFs', 'Gold ETF', 'commodity', 'ETF'],
  ] as const)('classifies %s from AMFI category/name', (categoryRaw, name, assetClass, speciality) => {
    expect(classifyAmfiScheme({ categoryRaw, name, structure: 'open', navDate: 20_000, newestNavDate: 20_000 })).toMatchObject({ assetClass, speciality: expect.arrayContaining([speciality]) });
  });

  it('keeps unknown passive underlyings unclassified with an explicit reason', () => {
    expect(classifyAmfiScheme({ categoryRaw: 'Other Scheme - Index Funds', name: 'Thematic Alpha Fund', structure: 'open', navDate: 20_000, newestNavDate: 20_000 })).toMatchObject({ assetClass: 'other', reason: 'INDEX_UNDERLYING_UNKNOWN' });
  });

  it.each([
    ['Equity Schemes - ELSS- Tax Saver Fund', 'Tax saver scheme', 'equity', 'ELSS'],
    ['Equity Scheme - Sectoral/ Thematic', 'Banking sector fund', 'equity', 'Sectoral/Thematic'],
    ['Income/Debt Oriented Schemes - Other Debt Scheme', 'Closed debt fund', 'debt', 'Other Debt'],
    ['Children’s Fund - Childrens\' Fund', 'Children plan', 'solution', "Children's"],
    ['Life Cycle Funds - Life Cycle Fund with Maturity of 10 Years', 'Target maturity fund', 'solution', 'Life Cycle'],
  ] as const)('maps observed legacy AMFI category %s', (categoryRaw, name, assetClass, subCategory) => {
    expect(classifyAmfiScheme({ categoryRaw, name, structure: 'open', navDate: 20_000, newestNavDate: 20_000 })).toMatchObject({ assetClass, subCategory });
  });

  it('uses a generic index leaf instead of labeling a broad Nifty index as thematic', () => {
    expect(classifyAmfiScheme({ categoryRaw: 'Other Scheme - Index Funds', name: 'Nifty 50 Index Fund', structure: 'open', navDate: 20_000, newestNavDate: 20_000 })).toMatchObject({ assetClass: 'equity', subCategory: 'Equity Index Fund', management: 'Passive' });
  });

  it('uses specific S0 over S1, excludes MFapi from votes, and confirms two AMFI signals', () => {
    const result = reconcileClassification({
      s0: { categoryRaw: 'Equity Scheme - Large Cap Fund', observedAt: 100 },
      s1: { categoryRaw: 'Income', headerRaw: 'Close Ended Schemes', observedAt: 100 },
      s2: { categoryRaw: 'Debt Scheme - Corporate Bond Fund', observedAt: 100 },
      s3: { categoryRaw: 'Equity Scheme - Large Cap Fund', observedAt: 100 },
      schemeName: 'Example Large Cap Fund', evaluatedAt: 100,
    });
    expect(result).toMatchObject({ assetClass: 'equity', status: 'CONFIRMED', detail: { s2: { sourceId: 's2_mfapi' } } });
    const mfapiOnly = reconcileClassification({ s1: { categoryRaw: 'Unmapped header', observedAt: 100 }, s2: { categoryRaw: 'Equity Scheme - Large Cap Fund', observedAt: 100 }, schemeName: 'Mystery', evaluatedAt: 100 });
    expect(mfapiOnly.status).toBe('UNCONFIRMED');
  });

  it('marks stale NAV as dormant with a transparent lifecycle rule', () => {
    expect(classifyAmfiScheme({ categoryRaw: 'Debt Scheme - Liquid Fund', name: 'Liquid Fund', structure: 'open', navDate: 19_900, newestNavDate: 20_000 })).toMatchObject({ lifecycle: 'dormant', lifecycleReason: 'NO_RECENT_NAV' });
  });
});
