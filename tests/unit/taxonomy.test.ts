import { describe, expect, it } from 'vitest';
import inventory from '../../config/category-map-v2-draft.json';
import { classifyFromCategory } from '../../src/domain/taxonomy/classify';
import { normalizeCategory } from '../../src/domain/taxonomy/categoryNormalize';
import { classifyPassive } from '../../src/domain/taxonomy/indexRules';
import { parseAmfiNavAllFile } from '../../src/domain/taxonomy/navFileParser';
import { previousConflictFrom, reconcileClassification } from '../../src/domain/taxonomy/consensus';
import { parseClassificationAuditCsv, renderClassificationAuditSample } from '../../src/domain/taxonomy/auditCsv';

describe('AMFI category normalization', () => {
  it('collapses observed plural aliases, dash variants, spacing, and Fund suffixes', () => {
    expect(normalizeCategory(' Equity Schemes  – Large Cap Fund ')).toMatchObject({ family: 'Equity Scheme', sub: 'Large Cap', key: 'equity scheme|large cap', legacyShape: false });
    expect(normalizeCategory('Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation Fund').sub).toBe('Dynamic Asset Allocation or Balanced Advantage');
    expect(normalizeCategory('Income/Debt Oriented Schemes - Banking and PSU Debt Fund').family).toBe('Debt Scheme');
  });

  it('uses category rules as the primary classifier and fails closed on unknown categories', () => {
    expect(classifyFromCategory({ categoryRaw: 'Equity Schemes - Thematic Fund', schemeName: 'Nifty Bond Fund' })).toMatchObject({ ok: true, assetClass: 'equity', ruleId: 'equity_scheme' });
    expect(classifyFromCategory({ categoryRaw: 'Growth', schemeName: 'Large Cap Nifty Fund' })).toMatchObject({ ok: false, assetClass: 'other', ruleId: 'UNMAPPED', acknowledged: true });
    expect(classifyFromCategory({ categoryRaw: 'Unseen Category - Mystery Fund', schemeName: 'Nifty 50 Fund' })).toMatchObject({ ok: false, assetClass: 'other', ruleId: 'UNMAPPED', acknowledged: false });
  });

  it('classifies passive names only within passive families and reports mixed signals as ambiguous', () => {
    expect(classifyFromCategory({ categoryRaw: 'Other Scheme - Index Funds', schemeName: 'Nifty 50 Index Fund' })).toMatchObject({ ok: true, assetClass: 'equity', ruleId: 'passive_equity_index' });
    expect(classifyFromCategory({ categoryRaw: 'Equity Scheme - Large Cap Fund', schemeName: 'Nasdaq Nifty Bond Fund' })).toMatchObject({ ok: true, assetClass: 'equity', ruleId: 'equity_scheme' });
    expect(classifyPassive('International Nasdaq 100 Equity Index Fund')).toMatchObject({ assetClass: 'other', ruleId: 'PASSIVE_AMBIGUOUS', flags: ['PASSIVE_AMBIGUOUS'] });
    expect(classifyFromCategory({ categoryRaw: 'Index Funds - Debt Funds', schemeName: 'ICICI Gilt Index Fund' })).toMatchObject({ ok: true, assetClass: 'debt', ruleId: 'passive_debt_index' });
  });

  it('covers all C0 observed category labels with a rule or an explicit acknowledged-unmapped entry', () => {
    const missing = inventory.rules.flatMap(({ category_raw }) => {
      const result = classifyFromCategory({ categoryRaw: category_raw, schemeName: '' });
      return result.ok || result.acknowledged ? [] : [category_raw];
    });
    expect(missing).toEqual([]);
  });
});

describe('AMFI NAVAll state machine', () => {
  it('preserves category/header provenance, parses semicolon-containing names and keeps N.A. NAV master rows', () => {
    const parsed = parseAmfiNavAllFile([
      'Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;Plan;Option;NAV;Date',
      'Open Ended Schemes(Equity Schemes - Large Cap Fund)',
      'Example AMC Mutual Fund',
      '1001;INF000A00001;-;Example; International Fund;Direct Plan;Growth Option;N.A.;N.A.',
    ].join('\n'));
    expect(parsed.schemes).toHaveLength(1);
    expect(parsed.schemes[0]).toMatchObject({ schemeCode: 1001, name: 'Example; International Fund', nav: null, navDate: null, categoryRaw: 'Equity Schemes - Large Cap Fund', structure: 'open' });
    expect(parsed.diagnostics.shapeValid).toBe(true);
  });

  it('keeps the first duplicate scheme code and records rejected rows and shape diagnostics', () => {
    const parsed = parseAmfiNavAllFile([
      'Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;Plan;Option;NAV;Date',
      'Close Ended Schemes(Debt Scheme - Gilt Fund)',
      'Example AMC',
      '1001;-;-;First Gilt Fund;Direct;Growth;10.0;01-Jan-2024',
      '1001;-;-;Duplicate Gilt Fund;Direct;Growth;11.0;02-Jan-2024',
      'bad;-;-;Rejected Gilt Fund;Direct;Growth;12.0;03-Jan-2024',
    ].join('\n'));
    expect(parsed.schemes).toHaveLength(1);
    expect(parsed.schemes[0]?.name).toBe('First Gilt Fund');
    expect(parsed.diagnostics.duplicateSchemeCodes).toHaveLength(1);
    expect(parsed.diagnostics.rejectedRows[0]?.reason).toBe('INVALID_SCHEME_CODE');
    expect(parsed.diagnostics.shapeValid).toBe(false);
  });
});

describe('classification consensus and audit workflow', () => {
  it('marks source disagreement for review and only escalates a repeated stale conflict', () => {
    const day = 86_400_000;
    const base = 1_800_000_000_000;
    const first = reconcileClassification({
      s1: { categoryRaw: 'Equity Scheme - Large Cap Fund', observedAt: base },
      s2: { categoryRaw: 'Debt Scheme - Corporate Bond Fund', observedAt: base - 4 * day },
      schemeName: 'Example Fund', evaluatedAt: base,
    });
    expect(first.status).toBe('CONFLICT_STALE');
    const previousConflict = previousConflictFrom(first.detail, first.status);
    expect(previousConflict?.count).toBe(1);
    const repeated = reconcileClassification({
      s1: { categoryRaw: 'Equity Scheme - Large Cap Fund', observedAt: base + 4 * day },
      s2: { categoryRaw: 'Debt Scheme - Corporate Bond Fund', observedAt: base - 4 * day },
      schemeName: 'Example Fund', evaluatedAt: base + 4 * day, previousConflict,
    });
    expect(repeated.status).toBe('CONFLICT');
    expect(repeated.detail.conflictObservations).toBe(2);
  });

  it('round trips audit rows while retaining quoted commas and records explicit agreement', () => {
    const sample = renderClassificationAuditSample([{ code: 101, name: 'Example, Large Cap Fund', category: 'Equity Scheme - Large Cap Fund', assetClass: 'equity', classRuleId: 'equity_scheme' }]);
    expect(sample.split('\r\n')[0]).toContain('current_class');
    const completed = ['scheme_code,scheme_name,s1_category,s2_category,s3_category,current_class,sid_category,sid_url,expected_class,agrees,notes', '101,"Example, Large Cap Fund","Equity Scheme - Large Cap Fund",,,equity,"Equity Scheme - Large Cap Fund",https://example.test/sid,equity,true,"reviewed, signed"'].join('\n');
    const records = parseClassificationAuditCsv(completed);
    expect(records).toEqual([expect.objectContaining({ schemeCode: 101, sidCategory: 'Equity Scheme - Large Cap Fund', sidUrl: 'https://example.test/sid', expectedClass: 'equity', agrees: true, notes: 'reviewed, signed' })]);
  });
});
