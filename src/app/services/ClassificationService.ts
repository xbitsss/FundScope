import type { Fund } from '../../domain/types';
import type { AssetClass } from '../../domain/taxonomy/assetClass';
import { classifyFromCategory } from '../../domain/taxonomy/classify';
import { previousConflictFrom, reconcileClassification } from '../../domain/taxonomy/consensus';
import { normalizeCategory } from '../../domain/taxonomy/categoryNormalize';
import { TAXONOMY_VERSION } from '../../domain/taxonomy/assetClass';
import { getFunds, reconcileFundTaxonomy, saveFunds } from '../persistence';

export const classificationMessages = {
  status: { CONFIRMED: 'Confirmed', UNCONFIRMED: 'Unconfirmed', CONFLICT_STALE: 'Stale source conflict', CONFLICT: 'Under review' },
  source: { s1_navall: 'AMFI NAV catalog', s2_mfapi: 'MFapi metadata', s3_amfi_ter: 'AMFI TER disclosure' },
  unknown: 'Not provided by source',
  unmapped: 'Unmapped category; held as Other until a rule is reviewed.',
  review: 'Source categories disagree. Benchmark-relative metrics are suppressed until reviewed.',
  confirmed: 'AMFI category is corroborated by at least one independent source.',
  unconfirmed: 'AMFI category is mapped, but no independent category signal is available yet.',
} as const;

export interface ClassificationSummary {
  byClass: Record<AssetClass, number>;
  byStatus: Record<NonNullable<Fund['classStatus']>, number>;
  unmapped: Fund[];
  conflicts: Fund[];
  plausibilityFlags: Fund[];
}
export function summarizeClassification(funds: Fund[]): ClassificationSummary {
  const byClass: Record<AssetClass, number> = { equity: 0, debt: 0, hybrid: 0, liquid: 0, other: 0 };
  const byStatus: Record<NonNullable<Fund['classStatus']>, number> = { CONFIRMED: 0, UNCONFIRMED: 0, CONFLICT_STALE: 0, CONFLICT: 0 };
  for (const fund of funds) { byClass[fund.assetClass]++; byStatus[fund.classStatus ?? 'UNCONFIRMED']++; }
  return {
    byClass, byStatus,
    unmapped: funds.filter(fund => fund.classRuleId === 'UNMAPPED' || fund.classDetail?.flags.some(flag => flag === 'PASSIVE_AMBIGUOUS' || flag === 'PASSIVE_UNMATCHED')),
    conflicts: funds.filter(fund => fund.classStatus === 'CONFLICT' || fund.classStatus === 'CONFLICT_STALE' || fund.classDetail?.flags.includes('CATEGORY_DRIFT')),
    plausibilityFlags: funds.filter(fund => fund.classDetail?.flags.some(flag => flag.startsWith('PLAUS_'))),
  };
}

export async function rerunClassification(): Promise<Fund[]> {
  const existing = await getFunds();
  const reevaluated = existing.map(fund => {
    const result = reconcileClassification({
      s1: { categoryRaw: fund.category, headerRaw: fund.headerRaw, observedAt: fund.classDetail?.s1.observedAt ?? fund.navDate * 86_400_000 },
      s2: fund.classDetail?.s2 ? { categoryRaw: fund.classDetail.s2.categoryRaw, observedAt: fund.classDetail.s2.observedAt } : undefined,
      s3: fund.classDetail?.s3 ? { categoryRaw: fund.classDetail.s3.categoryRaw, observedAt: fund.classDetail.s3.observedAt } : undefined,
      schemeName: fund.name, previousConflict: previousConflictFrom(fund.classDetail,fund.classStatus), previousReview: fund.classDetail?.review,
    });
    if (fund.classRuleId === 'USER_REBIND_OTHER') return { ...fund, classStatus: 'UNCONFIRMED' as const, classDetail: { ...result.detail, flags: [...new Set([...result.detail.flags, 'HUMAN_REBOUND_OTHER'])], review: fund.classDetail?.review } };
    const primary = classifyFromCategory({ categoryRaw: fund.category, schemeName: fund.name });
    return { ...fund, assetClass: primary.assetClass, classRuleId: primary.ruleId, subCategory: normalizeCategory(fund.category).sub ?? fund.subCategory, taxonomyVersion: TAXONOMY_VERSION, classStatus: result.status, classDetail: result.detail };
  });
  const guarded = await reconcileFundTaxonomy(reevaluated);
  await saveFunds(guarded);
  return getFunds();
}
