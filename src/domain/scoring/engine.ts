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
  includeContributions?: boolean;
}

export interface ScoreModelPreset {
  id: string;
  name: string;
  description: string;
  peerGroup: PeerGroupMode;
  factors: ScoreFactor[];
  builtIn?: boolean;
  savedAt: number;
  dataAsOf?: number | null;
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

export const PRESET_SCORE_MODELS: ScoreModelPreset[] = [
  {
    id: 'jpmc-multi-factor',
    name: 'JPMC multi-factor model',
    description: 'Balanced institutional model combining 3Y/5Y alpha, rolling return consistency, Sharpe, and volatility control.',
    peerGroup: 'subcategory',
    factors: DEFAULT_SCORE_FACTORS,
    builtIn: true,
    savedAt: 0,
  },
  {
    id: 'risk-adjusted-compounder',
    name: 'Risk-adjusted compounder',
    description: 'Emphasizes Sharpe, Sortino, Calmar, and 3Y rolling consistency with downside protection.',
    peerGroup: 'subcategory',
    factors: [
      { id: 'sharpe', weight: 25, direction: 'higher' },
      { id: 'sortino', weight: 25, direction: 'higher' },
      { id: 'rolling_3y_consistency', weight: 20, direction: 'higher' },
      { id: 'calmar', weight: 15, direction: 'higher' },
      { id: 'max_drawdown', weight: 15, direction: 'higher' },
    ],
    builtIn: true,
    savedAt: 0,
  },
  {
    id: 'alpha-momentum-leader',
    name: 'Alpha & benchmark leader',
    description: 'Targets high information ratio, Jensen alpha, 3Y CAGR, and consistent sub-category outperformance.',
    peerGroup: 'subcategory',
    factors: [
      { id: 'jensen_alpha', weight: 25, direction: 'higher' },
      { id: 'information_ratio', weight: 25, direction: 'higher' },
      { id: 'return_vs_subcategory_3y', weight: 20, direction: 'higher' },
      { id: 'cagr_3y', weight: 15, direction: 'higher' },
      { id: 'benchmark_outperformance_ratio', weight: 15, direction: 'higher' },
    ],
    builtIn: true,
    savedAt: 0,
  },
  {
    id: 'low-vol-defender',
    name: 'Low-volatility defender',
    description: 'Prioritizes low standard deviation, shallow drawdowns, low downside capture, and low expense ratio.',
    peerGroup: 'subcategory',
    factors: [
      { id: 'std_dev', weight: 30, direction: 'lower' },
      { id: 'max_drawdown', weight: 25, direction: 'higher' },
      { id: 'downside_capture', weight: 20, direction: 'lower' },
      { id: 'sharpe', weight: 15, direction: 'higher' },
      { id: 'ter_pct', weight: 10, direction: 'lower' },
    ],
    builtIn: true,
    savedAt: 0,
  },
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

interface PrebuiltCohorts {
  byAsset: Map<string, Fund[]>;
  byCohort: Map<string, Fund[]>;
  assetKeys: string[];
  cohortKeys: string[];
}

function buildCohorts(funds: readonly Fund[], peerGroup: PeerGroupMode): PrebuiltCohorts {
  const byAsset = new Map<string, Fund[]>();
  const byCohort = new Map<string, Fund[]>();
  const assetKeys = new Array<string>(funds.length);
  const cohortKeys = new Array<string>(funds.length);
  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i]!;
    const assetKey = fund.assetClass || 'other';
    assetKeys[i] = assetKey;
    let assetList = byAsset.get(assetKey);
    if (!assetList) {
      assetList = [];
      byAsset.set(assetKey, assetList);
    }
    assetList.push(fund);

    const cohortKey = peerGroup === 'category_plan'
      ? `${assetKey}\u0000${fund.subCategory || ''}\u0000${fund.plan || ''}`
      : `${assetKey}\u0000${fund.subCategory || ''}`;
    cohortKeys[i] = cohortKey;
    let cohortList = byCohort.get(cohortKey);
    if (!cohortList) {
      cohortList = [];
      byCohort.set(cohortKey, cohortList);
    }
    cohortList.push(fund);
  }
  return { byAsset, byCohort, assetKeys, cohortKeys };
}

function buildFactorPercentileMap(
  funds: Fund[],
  factor: ScoreFactor,
  peerGroup: PeerGroupMode,
  robustMagnitude: boolean,
  cohorts?: PrebuiltCohorts,
): Map<number, number> {
  if (peerGroup === 'filtered' || peerGroup === 'universe' || funds.length < 6) {
    return computeCohortFactorMap(funds, factor, robustMagnitude);
  }

  const { byAsset, byCohort, assetKeys, cohortKeys } = cohorts ?? buildCohorts(funds, peerGroup);
  let universeMap: Map<number, number> | null = null;
  const getUniverseMap = () => {
    if (!universeMap) universeMap = computeCohortFactorMap(funds, factor, robustMagnitude);
    return universeMap;
  };
  const assetMaps = new Map<string, Map<number, number> | null>();
  const getAssetMap = (assetKey: string): Map<number, number> | undefined => {
    if (!assetMaps.has(assetKey)) {
      const list = byAsset.get(assetKey);
      const map = list ? computeCohortFactorMap(list, factor, robustMagnitude) : null;
      assetMaps.set(assetKey, map && map.size >= 3 ? map : null);
    }
    return assetMaps.get(assetKey) ?? undefined;
  };

  if (CATEGORY_MACRO_FACTORS.has(factor.id)) {
    const result = new Map<number, number>();
    for (let i = 0; i < funds.length; i++) {
      const fund = funds[i]!;
      const val = getAssetMap(assetKeys[i]!)?.get(fund.code) ?? getUniverseMap().get(fund.code);
      if (val !== undefined) result.set(fund.code, val);
    }
    return result;
  }

  const cohortMaps = new Map<string, Map<number, number>>();
  for (const [cohortKey, list] of byCohort) {
    if (list.length < 3) continue;
    const map = computeCohortFactorMap(list, factor, robustMagnitude);
    if (map.size >= 3) cohortMaps.set(cohortKey, map);
  }

  const result = new Map<number, number>();
  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i]!;
    const cohortMap = cohortMaps.get(cohortKeys[i]!);
    if (cohortMap) {
      const val = cohortMap.get(fund.code);
      if (val !== undefined) result.set(fund.code, val);
      continue;
    }
    const rawVal = fund.metrics?.[factor.id];
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;
    const fallbackVal = getAssetMap(assetKeys[i]!)?.get(fund.code) ?? getUniverseMap().get(fund.code);
    if (fallbackVal !== undefined) result.set(fund.code, fallbackVal);
  }
  return result;
}

export function rankFunds(
  funds: Fund[],
  factors: ScoreFactor[],
  options: RankFundsOptions = {},
): RankedFund[] {
  const peerGroup = options.peerGroup ?? 'filtered';
  const effectivePeerGroup: PeerGroupMode = peerGroup === 'filtered' ? 'subcategory' : peerGroup;
  const expectedHash = scoreFactorsSignature(factors, effectivePeerGroup);

  if (
    options.useSavedScores &&
    options.includeContributions === false &&
    hasCurrentPersistentScores(funds, factors, effectivePeerGroup)
  ) {
    return funds.map(fund => {
      const savedScore = fund.metrics?.[SCORE_METRIC_ID];
      return {
        fund,
        score: typeof savedScore === 'number' && Number.isFinite(savedScore) ? savedScore : null,
        contributions: {},
      };
    });
  }

  const robustMagnitude = options.robustMagnitude ?? (peerGroup !== 'filtered');
  const cohorts = peerGroup !== 'filtered' && peerGroup !== 'universe' && funds.length >= 6
    ? buildCohorts(funds, peerGroup)
    : undefined;

  const percentiles = new Map<string, Map<number, number>>();
  for (const factor of factors) {
    if (factor.weight <= 0) continue;
    percentiles.set(factor.id, buildFactorPercentileMap(funds, factor, peerGroup, robustMagnitude, cohorts));
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
 * Fast typed-array score computation for worker and UI updates without allocating per-fund contribution maps.
 */
export function computeScoreArray(
  funds: Fund[],
  factors: ScoreFactor[] = DEFAULT_SCORE_FACTORS,
  peerGroup: PeerGroupMode = 'subcategory',
): { scores: Float32Array; modelHash: number } {
  const modelHash = scoreFactorsSignature(factors, peerGroup);
  const scores = new Float32Array(funds.length).fill(Number.NaN);
  const activeFactors = factors.filter(f => f.weight > 0);
  const totalWeight = activeFactors.reduce((sum, f) => sum + f.weight, 0);
  if (!funds.length || totalWeight <= 0) return { scores, modelHash };

  const cohorts = peerGroup !== 'filtered' && peerGroup !== 'universe' && funds.length >= 6
    ? buildCohorts(funds, peerGroup)
    : undefined;
  const factorMaps = activeFactors.map(factor => ({
    factor,
    map: buildFactorPercentileMap(funds, factor, peerGroup, true, cohorts),
  }));

  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i]!;
    if (!hasOwnScoredSignal(fund, activeFactors)) continue;
    let weighted = 0;
    for (let fIdx = 0; fIdx < factorMaps.length; fIdx++) {
      const { factor, map } = factorMaps[fIdx]!;
      const pct = map.get(fund.code) ?? 0;
      weighted += pct * factor.weight;
    }
    scores[i] = Number((weighted / totalWeight).toFixed(2));
  }
  return { scores, modelHash };
}

/**
 * Precomputes and stores persistent multi-factor scores (`metrics.composite_score`)
 * across the catalog so scores remain stable and do not churn during filtering or on-demand chart loads.
 */
export function applyPersistentScores(
  funds: Fund[],
  factors: ScoreFactor[] = DEFAULT_SCORE_FACTORS,
  peerGroup: PeerGroupMode = 'subcategory',
  precomputed?: { scores: Float32Array; modelHash: number },
): Fund[] {
  if (!funds.length) return funds;
  const { scores, modelHash } = precomputed ?? computeScoreArray(funds, factors, peerGroup);
  return funds.map((fund, i) => {
    const score = scores[i]!;
    const currentScore = fund.metrics?.[SCORE_METRIC_ID];
    const currentHash = fund.metrics?.[SCORE_MODEL_HASH_METRIC_ID];
    const isFiniteScore = Number.isFinite(score);
    if (
      isFiniteScore &&
      currentScore === score &&
      currentHash !== undefined &&
       currentHash !== null &&
      Math.round(currentHash) === modelHash
    ) {
      return fund;
    }
    const metrics = { ...fund.metrics };
    const reasons = { ...fund.metricReasons };
    const provenance = { ...fund.metricProvenance };
    if (isFiniteScore) {
      metrics[SCORE_METRIC_ID] = score;
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
