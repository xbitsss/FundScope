import type { Fund } from '../types';

export interface ScoreFactor { id: string; weight: number; direction: 'higher' | 'lower' }
export type PeerGroupMode = 'subcategory' | 'category_plan' | 'universe' | 'filtered';
export interface RankedFund {
  fund: Fund;
  score: number | null;
  contributions: Record<string, number>;
  factorPercentiles?: Record<string, number>;
}

export interface RankFundsOptions {
  peerGroup?: PeerGroupMode;
  useSavedScores?: boolean;
  robustMagnitude?: boolean;
}

export const SCORE_METRIC_ID = 'composite_score';
export const SCORE_MODEL_HASH_METRIC_ID = 'composite_score_model_hash';

export const DEFAULT_SCORE_FACTORS: ScoreFactor[] = [
  { id: 'sharpe', weight: 20, direction: 'higher' },
  { id: 'rolling_3y_average_return', weight: 20, direction: 'higher' },
  { id: 'return_vs_subcategory_3y', weight: 15, direction: 'higher' },
  { id: 'return_vs_subcategory_5y', weight: 10, direction: 'higher' },
  { id: 'std_dev', weight: 10, direction: 'lower' },
  { id: 'category_std_dev', weight: 10, direction: 'lower' },
  { id: 'cagr_5y', weight: 10, direction: 'higher' },
  { id: 'cagr_10y', weight: 5, direction: 'higher' },
];

const CATEGORY_MACRO_FACTORS = new Set(['category_std_dev', 'category_pe_ratio', 'category_ytm']);

/**
 * Deterministic 20-bit integer signature (1 .. 1_048_575) safe for Float32 columnar storage.
 */
export function scoreFactorsSignature(factors: readonly ScoreFactor[], peerGroup: PeerGroupMode = 'subcategory'): number {
  const active = factors
    .filter(f => f.weight > 0)
    .map(f => `${f.id}:${Math.round(f.weight * 100)}:${f.direction}`)
    .join('|');
  const raw = `${peerGroup}::${active}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) + 1;
}

function computeCohortFactorMap(cohort: Fund[], factor: ScoreFactor, robustMagnitude: boolean): Map<number, number> {
  const available = cohort
    .filter(f => typeof f.metrics?.[factor.id] === 'number' && Number.isFinite(f.metrics[factor.id]))
    .sort((a, b) => (b.metrics[factor.id]! - a.metrics[factor.id]!) * (factor.direction === 'higher' ? 1 : -1) || a.code - b.code);
  const map = new Map<number, number>();
  if (!available.length) return map;

  let winsorMean = 0;
  let winsorStd = 0;
  let p10 = 0;
  let p90 = 0;
  const useZBlend = robustMagnitude && available.length >= 8;
  if (useZBlend) {
    const asc = available.map(f => f.metrics[factor.id]!).sort((a, b) => a - b);
    p10 = asc[Math.floor((asc.length - 1) * 0.1)]!;
    p90 = asc[Math.ceil((asc.length - 1) * 0.9)]!;
    if (p90 > p10) {
      const clamped = asc.map(v => Math.max(p10, Math.min(p90, v)));
      winsorMean = clamped.reduce((sum, v) => sum + v, 0) / clamped.length;
      const variance = clamped.reduce((sum, v) => sum + (v - winsorMean) ** 2, 0) / clamped.length;
      winsorStd = Math.sqrt(variance);
    }
  }

  let start = 0;
  while (start < available.length) {
    let end = start + 1;
    const val = available[start]!.metrics[factor.id]!;
    while (end < available.length && available[end]!.metrics[factor.id]! === val) end++;
    const avgRank = (start + end - 1) / 2;
    const ordinalPct = available.length <= 1 ? 100 : ((available.length - 1 - avgRank) / (available.length - 1)) * 100;
    let finalPct = ordinalPct;
    if (useZBlend && winsorStd > 1e-9) {
      const clampedVal = Math.max(p10, Math.min(p90, val));
      const orientedZ = ((clampedVal - winsorMean) / winsorStd) * (factor.direction === 'higher' ? 1 : -1);
      const boundedZ = Math.max(-2.5, Math.min(2.5, orientedZ));
      const zPct = ((boundedZ + 2.5) / 5) * 100;
      finalPct = 0.75 * ordinalPct + 0.25 * zPct;
    }
    for (let idx = start; idx < end; idx++) {
      map.set(available[idx]!.code, finalPct);
    }
    start = end;
  }
  return map;
}

function buildFactorPercentileMap(
  funds: Fund[],
  factor: ScoreFactor,
  peerGroup: PeerGroupMode,
  robustMagnitude: boolean,
): Map<number, number> {
  const universeMap = computeCohortFactorMap(funds, factor, robustMagnitude);
  if (peerGroup === 'filtered' || peerGroup === 'universe' || funds.length < 6) {
    return universeMap;
  }

  const byAsset = new Map<string, Fund[]>();
  const byCohort = new Map<string, Fund[]>();
  for (const fund of funds) {
    const assetKey = fund.assetClass || 'other';
    const assetList = byAsset.get(assetKey) ?? [];
    assetList.push(fund);
    byAsset.set(assetKey, assetList);

    const cohortKey = peerGroup === 'category_plan'
      ? `${assetKey}\u0000${fund.subCategory || ''}\u0000${fund.plan || ''}`
      : `${assetKey}\u0000${fund.subCategory || ''}`;
    const cohortList = byCohort.get(cohortKey) ?? [];
    cohortList.push(fund);
    byCohort.set(cohortKey, cohortList);
  }

  const assetMaps = new Map<string, Map<number, number>>();
  for (const [assetKey, list] of byAsset) {
    const map = computeCohortFactorMap(list, factor, robustMagnitude);
    if (map.size >= 3) assetMaps.set(assetKey, map);
  }

  if (CATEGORY_MACRO_FACTORS.has(factor.id)) {
    const result = new Map<number, number>();
    for (const fund of funds) {
      const assetMap = assetMaps.get(fund.assetClass || 'other');
      const val = assetMap?.get(fund.code) ?? universeMap.get(fund.code);
      if (val !== undefined) result.set(fund.code, val);
    }
    return result;
  }

  const cohortMaps = new Map<string, Map<number, number>>();
  for (const [cohortKey, list] of byCohort) {
    const map = computeCohortFactorMap(list, factor, robustMagnitude);
    if (map.size >= 3) cohortMaps.set(cohortKey, map);
  }

  const result = new Map<number, number>();
  for (const fund of funds) {
    const assetKey = fund.assetClass || 'other';
    const cohortKey = peerGroup === 'category_plan'
      ? `${assetKey}\u0000${fund.subCategory || ''}\u0000${fund.plan || ''}`
      : `${assetKey}\u0000${fund.subCategory || ''}`;
    const val = cohortMaps.get(cohortKey)?.get(fund.code)
      ?? assetMaps.get(assetKey)?.get(fund.code)
      ?? universeMap.get(fund.code);
    if (val !== undefined) result.set(fund.code, val);
  }
  return result;
}

export function rankFunds(
  funds: Fund[],
  factors: ScoreFactor[],
  options: RankFundsOptions = {},
): RankedFund[] {
  const peerGroup = options.peerGroup ?? 'filtered';
  const robustMagnitude = options.robustMagnitude ?? (peerGroup !== 'filtered');
  const expectedHash = scoreFactorsSignature(factors, peerGroup === 'filtered' ? 'subcategory' : peerGroup);

  const percentiles = new Map<string, Map<number, number>>();
  for (const factor of factors) {
    if (factor.weight <= 0) continue;
    percentiles.set(factor.id, buildFactorPercentileMap(funds, factor, peerGroup, robustMagnitude));
  }

  return funds.map(fund => {
    let weighted = 0;
    let used = 0;
    const contributions: Record<string, number> = {};
    const factorPercentiles: Record<string, number> = {};
    for (const factor of factors) {
      if (factor.weight <= 0) continue;
      const percentile = percentiles.get(factor.id)?.get(fund.code) ?? 0;
      const contribution = percentile * factor.weight;
      contributions[factor.id] = contribution;
      factorPercentiles[factor.id] = percentile;
      weighted += contribution;
      used += factor.weight;
    }
    const savedScore = fund.metrics?.[SCORE_METRIC_ID];
    const savedHash = fund.metrics?.[SCORE_MODEL_HASH_METRIC_ID];
    if (
      options.useSavedScores &&
      typeof savedScore === 'number' &&
      Number.isFinite(savedScore) &&
      (savedHash == null || Math.round(savedHash) === expectedHash)
    ) {
      return { fund, score: savedScore, contributions, factorPercentiles };
    }
    return { fund, score: used ? weighted / used : null, contributions, factorPercentiles };
  });
}

function hasOwnScoredSignal(fund: Fund, factors: readonly ScoreFactor[]): boolean {
  const positiveFactors = factors.filter(f => f.weight > 0);
  if (!positiveFactors.length) return false;
  const nonCategoryFactors = positiveFactors.filter(f => !CATEGORY_MACRO_FACTORS.has(f.id));
  const checkFactors = nonCategoryFactors.length ? nonCategoryFactors : positiveFactors;
  return checkFactors.some(f => {
    const val = fund.metrics?.[f.id];
    return typeof val === 'number' && Number.isFinite(val);
  });
}

/**
 * Precomputes and stores persistent multi-factor scores (`metrics.composite_score`)
 * across the catalog so scores remain stable and do not churn during filtering or on-demand chart loads.
 */
export function applyPersistentScores(
  funds: Fund[],
  factors: ScoreFactor[] = DEFAULT_SCORE_FACTORS,
  peerGroup: PeerGroupMode = 'subcategory',
): Fund[] {
  if (!funds.length) return funds;
  const modelHash = scoreFactorsSignature(factors, peerGroup);
  const ranked = rankFunds(funds, factors, { peerGroup, robustMagnitude: true, useSavedScores: false });
  return ranked.map(({ fund, score }) => {
    const metrics = { ...fund.metrics };
    const reasons = { ...fund.metricReasons };
    const provenance = { ...fund.metricProvenance };
    if (score !== null && Number.isFinite(score) && hasOwnScoredSignal(fund, factors)) {
      metrics[SCORE_METRIC_ID] = Number(score.toFixed(2));
      metrics[SCORE_MODEL_HASH_METRIC_ID] = modelHash;
      delete reasons[SCORE_METRIC_ID];
      provenance[SCORE_METRIC_ID] = 'PEER_MEDIAN';
    } else {
      metrics[SCORE_METRIC_ID] = null;
      metrics[SCORE_MODEL_HASH_METRIC_ID] = modelHash;
      reasons[SCORE_METRIC_ID] = 'INSUFFICIENT_HISTORY';
      delete provenance[SCORE_METRIC_ID];
    }
    return { ...fund, metrics, metricReasons: reasons, metricProvenance: provenance };
  });
}

export function hasCurrentPersistentScores(
  funds: readonly Fund[],
  factors: readonly ScoreFactor[] = DEFAULT_SCORE_FACTORS,
  peerGroup: PeerGroupMode = 'subcategory',
): boolean {
  const expectedHash = scoreFactorsSignature(factors, peerGroup);
  let checked = 0;
  for (const fund of funds) {
    if (!hasOwnScoredSignal(fund, factors)) continue;
    checked++;
    const score = fund.metrics?.[SCORE_METRIC_ID];
    const hash = fund.metrics?.[SCORE_MODEL_HASH_METRIC_ID];
    if (typeof score !== 'number' || !Number.isFinite(score) || typeof hash !== 'number' || Math.round(hash) !== expectedHash) {
      return false;
    }
    if (checked >= 25) return true;
  }
  return checked > 0;
}
