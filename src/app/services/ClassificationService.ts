import type { Fund } from '../../domain/types';
import type { AssetClass } from '../../domain/taxonomy/assetClass';
import { previousConflictFrom, reconcileClassification } from '../../domain/taxonomy/consensus';
import { normalizeCategory } from '../../domain/taxonomy/categoryNormalize';
import { TAXONOMY_VERSION } from '../../domain/taxonomy/assetClass';
import { getFunds, reconcileFundTaxonomy, saveFunds } from '../persistence';
import { ASSET_CLASSES } from '../../domain/taxonomy/assetClass';

export const classificationMessages = {
  status: { CONFIRMED: 'Confirmed', UNCONFIRMED: 'Unconfirmed', CONFLICT_STALE: 'Stale source conflict', CONFLICT: 'Under review' },
  source: { s0_amfi_master: 'AMFI Scheme Master', s1_navall: 'AMFI NAV catalog', s2_mfapi: 'MFapi history metadata (informational)', s3_amfi_ter: 'AMFI TER disclosure', s4_amfi_aum: 'AMFI AAUM disclosure' },
  unknown: 'Not provided by source',
  unmapped: 'Unclassified AMFI category; review the reason code before adding a rule.',
  review: 'Source categories disagree. Benchmark-relative metrics are suppressed until reviewed.',
  confirmed: 'At least two AMFI sources agree on the category leaf.',
  unconfirmed: 'Only one AMFI category signal is available; MFapi is informational only.',
} as const;

export interface ClassificationSummary {
  byClass: Record<AssetClass, number>;
  byStatus: Record<NonNullable<Fund['classStatus']>, number>;
  unmapped: Fund[];
  conflicts: Fund[];
  plausibilityFlags: Fund[];
}
export function summarizeClassification(funds: Fund[]): ClassificationSummary {
  const byClass = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as Record<AssetClass, number>;
  const byStatus: Record<NonNullable<Fund['classStatus']>, number> = { CONFIRMED: 0, UNCONFIRMED: 0, CONFLICT_STALE: 0, CONFLICT: 0 };
  for (const fund of funds) { byClass[fund.assetClass]++; byStatus[fund.classStatus ?? 'UNCONFIRMED']++; }
  return {
    byClass, byStatus,
    unmapped: funds.filter(fund => Boolean(fund.classificationReason) || fund.classRuleId === 'UNMAPPED' || fund.classDetail?.flags.some(flag => flag === 'PASSIVE_AMBIGUOUS' || flag === 'PASSIVE_UNMATCHED')),
    conflicts: funds.filter(fund => fund.classStatus === 'CONFLICT' || fund.classStatus === 'CONFLICT_STALE' || fund.classDetail?.flags.includes('CATEGORY_DRIFT')),
    plausibilityFlags: funds.filter(fund => fund.classDetail?.flags.some(flag => flag.startsWith('PLAUS_'))),
  };
}

export async function rerunClassification(): Promise<Fund[]> {
  const existing = await getFunds();
  const newestNavDate = Math.max(0, ...existing.map((fund) => fund.navDate));
  const reevaluated = existing.map(fund => {
    const observedAt = fund.classDetail?.s1.observedAt ?? fund.navDate * 86_400_000;
    const result = reconcileClassification({
      ...(fund.schemeMaster?.categoryRaw ? { s0: { categoryRaw: fund.schemeMaster.categoryRaw, observedAt, schemeMaster: { categoryRaw: fund.schemeMaster.categoryRaw, closureDate: fund.schemeMaster.closureDate } } } : {}),
      s1: { categoryRaw: fund.category, headerRaw: fund.headerRaw, observedAt, structure: fund.structure, navDate: fund.navDate, newestNavDate },
      s2: fund.classDetail?.s2 ? { categoryRaw: fund.classDetail.s2.categoryRaw, observedAt: fund.classDetail.s2.observedAt } : undefined,
      s3: fund.classDetail?.s3 ? { categoryRaw: fund.classDetail.s3.categoryRaw, observedAt: fund.classDetail.s3.observedAt } : undefined,
      s4: fund.classDetail?.s4 ? { categoryRaw: fund.classDetail.s4.categoryRaw, observedAt: fund.classDetail.s4.observedAt } : undefined,
      schemeName: fund.name, previousConflict: previousConflictFrom(fund.classDetail,fund.classStatus), previousReview: fund.classDetail?.review,
    });
    if (fund.classRuleId === 'USER_REBIND_OTHER') return { ...fund, classStatus: 'UNCONFIRMED' as const, classDetail: { ...result.detail, flags: [...new Set([...result.detail.flags, 'HUMAN_REBOUND_OTHER'])], review: fund.classDetail?.review } };
    return { ...fund, assetClass: result.assetClass, classRuleId: result.ruleId, subCategory: result.subCategory, group: result.group, management: result.management, riskBand: result.riskBand, philosophy: result.philosophy, speciality: result.speciality, lifecycle: result.lifecycle, classificationReason: result.reason, classificationProvenance: result.provenance, taxonomyVersion: TAXONOMY_VERSION, classStatus: result.status, classDetail: result.detail };
  });
  const guarded = await reconcileFundTaxonomy(reevaluated);
  await saveFunds(guarded);
  return getFunds();
}
