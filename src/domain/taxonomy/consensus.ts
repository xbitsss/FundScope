import { classifyFromCategory } from './classify';
import type { AssetClass } from './assetClass';

export type ClassificationStatus = 'CONFIRMED' | 'UNCONFIRMED' | 'CONFLICT_STALE' | 'CONFLICT';
export interface ClassificationSignal {
  sourceId: 's1_navall' | 's2_mfapi' | 's3_amfi_ter';
  categoryRaw: string;
  assetClass: AssetClass;
  ruleId: string;
  observedAt: number;
  schemeName?: string;
}
export interface ClassificationDetail {
  s1: ClassificationSignal & { headerRaw?: string };
  s2?: ClassificationSignal;
  s3?: ClassificationSignal;
  evaluatedAt: number;
  flags: string[];
  conflictFirstSeenAt?: number;
  conflictObservations?: number;
  review?: { action: 'accept_s1' | 'rebind_other'; reviewedAt: number; categoryRaw: string; note?: string };
}
export interface ClassificationConsensus {
  assetClass: AssetClass;
  ruleId: string;
  status: ClassificationStatus;
  detail: ClassificationDetail;
}
export interface PreviousConflict { count: number; firstSeenAt: number; lastSeenAt: number }

export function previousConflictFrom(detail: ClassificationDetail | undefined, status: ClassificationStatus | undefined): PreviousConflict | undefined {
  if (!detail || (status !== 'CONFLICT' && status !== 'CONFLICT_STALE')) return undefined;
  return { count: detail.conflictObservations ?? 1, firstSeenAt: detail.conflictFirstSeenAt ?? detail.evaluatedAt, lastSeenAt: detail.evaluatedAt };
}

export function reconcileClassification(input: {
  s1: { categoryRaw: string; headerRaw?: string; observedAt: number };
  s2?: { categoryRaw?: string | null; observedAt: number };
  s3?: { categoryRaw?: string | null; observedAt: number };
  schemeName: string;
  evaluatedAt?: number;
  previousConflict?: PreviousConflict;
  previousReview?: ClassificationDetail['review'];
}): ClassificationConsensus {
  const evaluatedAt = input.evaluatedAt ?? Date.now();
  const primary = classifyFromCategory({ categoryRaw: input.s1.categoryRaw, schemeName: input.schemeName });
  const makeSignal = (sourceId: ClassificationSignal['sourceId'], categoryRaw: string, observedAt: number): ClassificationSignal => {
    const classification = classifyFromCategory({ categoryRaw, schemeName: input.schemeName });
    return { sourceId, categoryRaw, assetClass: classification.assetClass, ruleId: classification.ruleId, observedAt, schemeName: input.schemeName };
  };
  const s1: ClassificationSignal & { headerRaw?: string } = {
    ...makeSignal('s1_navall', input.s1.categoryRaw, input.s1.observedAt),
    ...(input.s1.headerRaw ? { headerRaw: input.s1.headerRaw } : {}),
  };
  const s2 = input.s2?.categoryRaw ? makeSignal('s2_mfapi', input.s2.categoryRaw, input.s2.observedAt) : undefined;
  const s3 = input.s3?.categoryRaw ? makeSignal('s3_amfi_ter', input.s3.categoryRaw, input.s3.observedAt) : undefined;
  const available = [s2, s3].filter((signal): signal is ClassificationSignal => Boolean(signal) && signal!.ruleId !== 'UNMAPPED');
  const conflicts = available.filter((signal) => signal.assetClass !== primary.assetClass);
  const agreements = available.filter((signal) => signal.assetClass === primary.assetClass);

  let status: ClassificationStatus = agreements.length ? 'CONFIRMED' : 'UNCONFIRMED';
  let conflictFirstSeenAt: number | undefined;
  let conflictObservations: number | undefined;
  if (conflicts.length) {
    const staleConflict = conflicts.some((signal) => input.s1.observedAt - signal.observedAt > 3 * 86_400_000);
    const previous = input.previousConflict;
    conflictFirstSeenAt = previous?.firstSeenAt ?? evaluatedAt;
    conflictObservations = (previous?.count ?? 0) + 1;
    const persistent = conflictObservations >= 2 && evaluatedAt - conflictFirstSeenAt >= 3 * 86_400_000;
    status = staleConflict && !persistent ? 'CONFLICT_STALE' : 'CONFLICT';
  }
  const review = input.previousReview?.categoryRaw === input.s1.categoryRaw ? input.previousReview : undefined;
  if (status === 'CONFLICT' && review?.action === 'accept_s1') status = 'UNCONFIRMED';
  if (status !== 'CONFLICT' && status !== 'CONFLICT_STALE') {
    conflictFirstSeenAt = undefined;
    conflictObservations = undefined;
  }
  return {
    assetClass: primary.assetClass,
    ruleId: primary.ruleId,
    status,
    detail: { s1, ...(s2 ? { s2 } : {}), ...(s3 ? { s3 } : {}), evaluatedAt, flags: [...primary.flags, ...(review ? ['REVIEWED_S1'] : [])], ...(conflictFirstSeenAt !== undefined ? { conflictFirstSeenAt, conflictObservations } : {}), ...(review ? { review } : {}) },
  };
}
