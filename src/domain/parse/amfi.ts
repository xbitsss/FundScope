import type { Fund } from '../types';
import { computeMetricBundle } from '../metrics/compute';
import { parseSchemeName } from './schemeName';
import { parseAmfiDate } from './amfiDate';
import { TAXONOMY_VERSION } from '../taxonomy/assetClass';
import { parseAmfiNavAllFile } from '../taxonomy/navFileParser';
import { reconcileClassification } from '../taxonomy/consensus';
import { normalizeCategory } from '../taxonomy/categoryNormalize';

export { parseAmfiDate };
export { parseAmfiNavAllFile } from '../taxonomy/navFileParser';

export function parsedAmfiNavToFunds(parsed: ReturnType<typeof parseAmfiNavAllFile>): Fund[] {
  const funds: Fund[] = [];
  for (const row of parsed.schemes) {
    if (row.nav === null || row.navDate === null) continue;
    const parsedDimensions = parseSchemeName(row.name, row.plan ?? undefined, row.option ?? undefined);
    const plan = parsedDimensions.plan;
    const option = row.option?.trim() || parsedDimensions.option;
    const classification = reconcileClassification({
      s1: { categoryRaw: row.categoryRaw, headerRaw: row.headerRaw, observedAt: row.navDate * 86_400_000 },
      schemeName: row.name,
      evaluatedAt: row.navDate * 86_400_000,
    });
    const fund: Fund = {
      code: row.schemeCode,
      isinGrowth: row.isinA,
      isinReinvestment: row.isinB,
      name: row.name,
      amc: row.amc,
      category: row.categoryRaw,
      headerRaw: row.headerRaw,
      assetClass: classification.assetClass,
      classRuleId: classification.ruleId,
      taxonomyVersion: TAXONOMY_VERSION,
      classStatus: classification.status,
      classDetail: classification.detail,
      subCategory: normalizeCategory(row.categoryRaw).sub ?? row.categoryRaw,
      structure: row.structure,
      plan,
      option,
      nav: row.nav,
      navDate: row.navDate,
      history: [],
      metrics: {},
    };
    if (/growth/i.test(option) && !/bonus/i.test(option)) {
      const bundle = computeMetricBundle(fund);
      fund.metrics = bundle.metrics;
      fund.metricReasons = bundle.reasons;
    }
    funds.push(fund);
  }
  return funds;
}

export function parseAmfiNavAll(text: string): Fund[] {
  return parsedAmfiNavToFunds(parseAmfiNavAllFile(text));
}
