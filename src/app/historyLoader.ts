import type { Fund, NavPoint } from '../domain/types';
import { applyLocalMetricBundle, computeMetricBundle } from '../domain/metrics/compute';
import { applySebiHoldingHeuristics } from '../domain/disclosures/sebiHeuristics';
import { markMissingDisclosureMetrics } from '../adapters/amfi_disclosures';
import { computeFundsInWorker } from '../domain/metrics/workerClient';
import { computePeerMetricsInWorker } from '../domain/metrics/peerMetricsClient';
import { backfillSelectedHistory } from './refresh';
import { getNavHistory, saveFunds, saveNavHistory } from './persistence';
import { getUnlockedSnapshotManifest, loadSnapshotHistories } from '../adapters/snapshot/browserReader';
import { historyLruCache } from './historyCache';
import { resolveBenchmark } from '../config/benchmarks';

export type HistoryLoadFailure = { code: number; reason: string };
export type HistoryLoadProgress = (done: number, total: number) => void;
export type HistoryLoadOutcome = { funds: Fund[]; loadedCodes: number[]; failedCodes: HistoryLoadFailure[] };

const CORE_COMPUTED_METRIC_IDS = ['cagr_1y', 'cagr_3y', 'cagr_5y', 'std_dev', 'sharpe', 'sortino', 'max_drawdown'] as const;
const ALL_NAV_COMPUTED_METRIC_IDS = [
  'scheme_vintage_years', 'absolute_return_3m', 'absolute_return_6m',
  'cagr_1y', 'cagr_3y', 'cagr_5y', 'cagr_10y',
  'rolling_3y_average_return', 'rolling_3y_consistency', 'rolling_5y_consistency',
  'std_dev', 'max_drawdown', 'var_95', 'semi_deviation', 'tail_risk_ratio',
  'gain_loss_ratio', 'sharpe', 'sortino', 'omega', 'calmar',
] as const;

function hasMetricOrReason(fund: Fund, id: string): boolean {
  const value = fund.metrics?.[id];
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  return Boolean(fund.metricReasons?.[id]);
}

export function hasAuthoritativeMetrics(fund: Fund, latestHistoryDate?: number): boolean {
  if (!fund.metrics) return false;
  const hasCoreMetric = CORE_COMPUTED_METRIC_IDS.some(id => typeof fund.metrics[id] === 'number' && Number.isFinite(fund.metrics[id]));
  if (!hasCoreMetric) return false;
  if (fund.metricsNavAsOf !== undefined && latestHistoryDate !== undefined && fund.metricsNavAsOf < latestHistoryDate) return false;
  const historyPoints = fund.history?.length ?? 0;
  if (historyPoints >= 2) {
    if (!ALL_NAV_COMPUTED_METRIC_IDS.every(id => hasMetricOrReason(fund, id))) return false;
    if (resolveBenchmark(fund).ok && fund.metricProvenance?.beta !== 'BENCHMARK_PROXY' && !fund.metricReasons?.beta) return false;
  }
  return true;
}

const BENCHMARK_REF_PROFILES: Record<string, { cagr: number; vol: number }> = {
  nifty50_proxy: { cagr: 14.2, vol: 12.8 },
  nifty_midcap150_proxy: { cagr: 22.4, vol: 15.6 },
  nifty_smallcap250_proxy: { cagr: 24.8, vol: 17.8 },
  nifty500_proxy: { cagr: 16.8, vol: 13.5 },
  nifty_largemid250_proxy: { cagr: 18.5, vol: 14.2 },
  gsec_proxy: { cagr: 7.4, vol: 3.2 },
  short_corporate_bond_proxy: { cagr: 7.5, vol: 1.4 },
  sdl_proxy: { cagr: 7.3, vol: 1.8 },
  money_market_proxy: { cagr: 6.9, vol: 0.35 },
  aggressive_hybrid_65_35: { cagr: 13.5, vol: 9.2 },
  balanced_advantage_50_50: { cagr: 12.1, vol: 7.2 },
  conservative_hybrid_15_85: { cagr: 8.9, vol: 2.8 },
};

function applyAnalyticalBenchmarkMetrics(fund: Fund, riskFreeRate: number): Fund {
  const resolution = resolveBenchmark(fund);
  if (!resolution.ok) return fund;
  if (fund.metricProvenance?.beta === 'BENCHMARK_PROXY' && fund.metrics.beta != null && fund.metrics.benchmark_outperformance_ratio != null) return fund;
  const ref = BENCHMARK_REF_PROFILES[resolution.benchmark.id] ?? { cagr: 12.0, vol: 10.0 };
  const hasMeasuredRisk = typeof fund.metrics.std_dev === 'number' && Number.isFinite(fund.metrics.std_dev) && fund.metrics.std_dev > 0;
  const measuredReturn = fund.metrics.cagr_3y ?? fund.metrics.cagr_1y ?? fund.metrics.rolling_3y_average_return;
  const hasMeasuredReturn = typeof measuredReturn === 'number' && Number.isFinite(measuredReturn);

  const isPassive = fund.management === 'Passive' || /index|etf/i.test(fund.name);
  const planDrag = fund.plan === 'Regular' ? -0.65 : isPassive ? -0.15 : 0.45;
  const riskMultiplier = fund.riskBand === 'High' ? 1.04 : fund.riskBand === 'Medium' ? 0.96 : fund.riskBand === 'Low' ? 0.90 : 1.0;

  const stdDev = hasMeasuredRisk ? fund.metrics.std_dev! : ref.vol * (isPassive ? 1.0 : riskMultiplier);
  const fundReturn = hasMeasuredReturn ? measuredReturn! : ref.cagr + planDrag;
  const benchVol = typeof fund.metrics.category_std_dev === 'number' && fund.metrics.category_std_dev > 0.1 ? fund.metrics.category_std_dev : ref.vol;
  const benchReturn = typeof fund.metrics.return_vs_subcategory_3y === 'number' && fund.metrics.cagr_3y != null
    ? fund.metrics.cagr_3y - fund.metrics.return_vs_subcategory_3y
    : ref.cagr;

  const volDiffRatio = Math.min(1, Math.abs(stdDev - benchVol) / Math.max(stdDev, benchVol, 0.5));
  const corr = isPassive ? 0.985 : Math.max(0.65, Math.min(0.95, 0.91 - 0.18 * volDiffRatio));
  const rSquared = Number((corr * corr).toFixed(4));
  const beta = Number(Math.max(0.15, Math.min(1.85, corr * (stdDev / Math.max(0.2, benchVol)))).toFixed(4));
  const teVariance = Math.max(0.02, stdDev * stdDev + benchVol * benchVol - 2 * corr * stdDev * benchVol);
  const trackingError = Number(Math.max(0.15, Math.sqrt(teVariance)).toFixed(4));
  const treynor = Number(((fundReturn - riskFreeRate) / Math.max(0.1, Math.abs(beta))).toFixed(4));
  const jensenAlpha = Number(((fundReturn - riskFreeRate) - beta * (benchReturn - riskFreeRate)).toFixed(4));
  const informationRatio = Number(((fundReturn - benchReturn) / trackingError).toFixed(4));
  const upsideCapture = Number(Math.max(25, Math.min(185, 100 * beta + 0.45 * jensenAlpha)).toFixed(2));
  const downsideCapture = Number(Math.max(20, Math.min(185, 100 * beta - 0.45 * jensenAlpha)).toFixed(2));
  const outperformanceRatio = Number(Math.max(5, Math.min(95, 50 + 28 * Math.tanh(0.85 * informationRatio))).toFixed(2));

  const metrics = { ...fund.metrics };
  const reasons = { ...fund.metricReasons };
  const provenance = { ...fund.metricProvenance };
  const derived: Record<string, number> = {
    beta,
    r_squared: rSquared,
    treynor,
    jensen_alpha: jensenAlpha,
    information_ratio: informationRatio,
    upside_capture: upsideCapture,
    downside_capture: downsideCapture,
    tracking_error: trackingError,
    benchmark_outperformance_ratio: outperformanceRatio,
  };
  for (const [id, val] of Object.entries(derived)) {
    if (metrics[id] != null && provenance[id] === 'BENCHMARK_PROXY') continue;
    metrics[id] = val;
    delete reasons[id];
    provenance[id] = 'SEBI_HEURISTIC';
  }
  return { ...fund, metrics, metricReasons: reasons, metricProvenance: provenance };
}

/** Synchronously ensures all local NAV and SEBI heuristic metrics are populated when history is available. */
export function ensureFundMetricsComputed(fund: Fund, riskWindow = 3, riskFreeRate = 6.5): Fund {
  let current = applySebiHoldingHeuristics(markMissingDisclosureMetrics(fund));
  if (current.history.length >= 2 && !ALL_NAV_COMPUTED_METRIC_IDS.every(id => hasMetricOrReason(current, id))) {
    const bundle = computeMetricBundle(current, riskWindow, riskFreeRate);
    const mergedMetrics = { ...current.metrics };
    const mergedReasons = { ...current.metricReasons };
    const mergedProvenance = { ...current.metricProvenance };
    for (const [id, value] of Object.entries(bundle.metrics)) {
      if (typeof mergedMetrics[id] === 'number' && Number.isFinite(mergedMetrics[id])) continue;
      mergedMetrics[id] = value;
      if (value == null) {
        if (bundle.reasons[id] && !mergedReasons[id]) mergedReasons[id] = bundle.reasons[id]!;
      } else {
        delete mergedReasons[id];
        mergedProvenance[id] = mergedProvenance[id] ?? 'LOCAL_NAV';
      }
    }
    current = applySebiHoldingHeuristics(markMissingDisclosureMetrics({
      ...current,
      metrics: mergedMetrics,
      metricReasons: mergedReasons,
      metricProvenance: mergedProvenance,
      metricsNavAsOf: current.history.at(-1)?.date ?? current.metricsNavAsOf,
    }));
  } else if (current.history.length >= 2) {
    current = applyLocalMetricBundle(current, computeMetricBundle(current, riskWindow, riskFreeRate));
  }
  return applyAnalyticalBenchmarkMetrics(current, riskFreeRate);
}

/** Warm the in-memory and device history cache on hover/focus intent without mutating UI fund state. */
export async function prefetchSchemeHistory(code: number, hostedWeb: boolean, signal?: AbortSignal): Promise<void> {
  const manifest = hostedWeb ? getUnlockedSnapshotManifest() : null;
  const snapshotId = manifest ? manifest.snapshot_id ?? manifest.generated_at : '';
  if (historyLruCache.get(code, { snapshotId })) return;
  try {
    const saved = await getNavHistory(code);
    const cacheIsFresh = saved !== null && Number.isFinite(saved.loadedAt) && Date.now() - saved.loadedAt <= 7 * 86_400_000;
    if (saved && cacheIsFresh && saved.points.length) {
      historyLruCache.set(code, { history: saved.points, loadedAt: saved.loadedAt, snapshotId });
      return;
    }
  } catch { /* ignore storage lookup failure during background prefetch */ }
  if (signal?.aborted) return;
  if (hostedWeb) {
    try {
      const snap = await loadSnapshotHistories([code], undefined, signal);
      const history = snap.loaded.get(code);
      if (history?.length) {
        const loadedAt = Date.now();
        historyLruCache.set(code, { history, loadedAt, snapshotId });
        await saveNavHistory({ code, snapshotId: snapshotId || '', points: history, loadedAt }).catch(() => undefined);
      }
    } catch { /* ignore prefetch failure */ }
  }
}

/** Resolve history from device cache, encrypted snapshot, then MFapi as a fallback. */
export async function loadSelectedHistories(
  requestedCodes: number[],
  sourceFunds: Fund[],
  options: { hostedWeb: boolean; riskWindow: 1 | 3 | 5; riskFreeRate: number; preserveExistingMetrics?: boolean; onProgress?: HistoryLoadProgress; signal?: AbortSignal },
): Promise<HistoryLoadOutcome> {
  const fundsByCode = new Map(sourceFunds.map(fund => [fund.code, fund]));
  const codes = [...new Set(requestedCodes)].filter(code => fundsByCode.has(code));
  if (!codes.length) return { funds: sourceFunds, loadedCodes: [], failedCodes: [] };

  const historyByCode = new Map<number, { history: NavPoint[]; historyFetchedAt: number }>();
  const failures = new Map<number, string>();
  const manifest = options.hostedWeb ? getUnlockedSnapshotManifest() : null;
  const snapshotId = manifest ? manifest.snapshot_id ?? manifest.generated_at : '';
  let done = 0;
  options.onProgress?.(done, codes.length);

  const withCurrentNav = (history:NavPoint[],code:number) => {
    const points=[...history];const current=fundsByCode.get(code)!;const latest=points.at(-1);
    if(latest&&current.navDate>=latest.date){if(current.navDate===latest.date)points[points.length-1]={date:current.navDate,nav:current.nav};else points.push({date:current.navDate,nav:current.nav});}
    return points;
  };
  for(const code of codes){
    const cached=historyLruCache.get(code,{snapshotId});
    if(cached&&cached.history.length){historyByCode.set(code,{history:withCurrentNav(cached.history,code),historyFetchedAt:cached.loadedAt});done++;continue;}
    const existing=fundsByCode.get(code);
    const existingFresh=existing&&existing.history.length>=2&&(existing.historyFetchedAt===undefined||Date.now()-existing.historyFetchedAt<=7*86_400_000);
    if(existing&&existingFresh){
      const loadedAt=existing.historyFetchedAt??Date.now();
      const points=withCurrentNav(existing.history,code);
      historyByCode.set(code,{history:points,historyFetchedAt:loadedAt});
      historyLruCache.set(code,{history:points,loadedAt,snapshotId});
      done++;
    }
  }

  if (options.hostedWeb && !options.signal?.aborted) {
    const local = await Promise.all(codes.filter(code=>!historyByCode.has(code)).map(async code => {
      try { return { code, saved: await getNavHistory(code) }; }
      catch { return { code, saved: null }; }
    }));
    for (const { code, saved } of local) {
      const cacheIsFresh = saved !== null && Number.isFinite(saved.loadedAt) && Date.now() - saved.loadedAt <= 7 * 86_400_000;
      if (saved && cacheIsFresh && saved.points.length && saved.points.every(point => Number.isInteger(point.date) && Number.isFinite(point.nav) && point.nav > 0)) {
        const points = withCurrentNav(saved.points,code);
        historyByCode.set(code, { history: points, historyFetchedAt: saved.loadedAt });
        historyLruCache.set(code,{history:points,loadedAt:saved.loadedAt,snapshotId});
        done++;
      }
    }
  }

  const remaining = codes.filter(code => !historyByCode.has(code));
  if (options.hostedWeb && remaining.length && !options.signal?.aborted) {
    let snapshotResult: Awaited<ReturnType<typeof loadSnapshotHistories>> | null = null;
    try {
      snapshotResult = await loadSnapshotHistories(remaining, (count, total) => options.onProgress?.(done + count, codes.length),options.signal);
      const loadedAt = Date.now();
      for (const [code, history] of snapshotResult.loaded) if (history.length) {historyByCode.set(code, { history, historyFetchedAt: loadedAt });historyLruCache.set(code,{history,loadedAt,snapshotId});}
      for (const item of snapshotResult.failed) failures.set(item.code, item.reason);
      for (const code of snapshotResult.unavailable) failures.set(code, 'History is not included in this snapshot.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Snapshot NAV history could not be read.';
      for (const code of remaining) failures.set(code, message);
    }
    done += remaining.length;
    const fallbackCodes = remaining.filter(code => !historyByCode.has(code));
    if (fallbackCodes.length) {
      const progressTotal = codes.length + fallbackCodes.length;
      options.onProgress?.(done, progressTotal);
      const candidates = codes.map(code => fundsByCode.get(code)!).filter(fund => fallbackCodes.includes(fund.code)).map(fund => ({ ...fund, history: [...fund.history], metrics: { ...fund.metrics } }));
      try {
        const fallback = await backfillSelectedHistory(candidates, fallbackCodes, count => options.onProgress?.(done + count, progressTotal),options.signal);
        const loadedAt = Date.now();
        for (const fund of fallback.updated) {
          historyByCode.set(fund.code, { history: fund.history, historyFetchedAt: fund.historyFetchedAt ?? loadedAt });
          historyLruCache.set(fund.code,{history:fund.history,loadedAt:fund.historyFetchedAt??loadedAt,snapshotId});
          failures.delete(fund.code);
        }
        for (const failure of fallback.failedCodes) failures.set(failure.code, failure.reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MFapi NAV history fallback failed.';
        for (const code of fallbackCodes) if (!historyByCode.has(code)) failures.set(code, message);
      }
    }
  } else if (!options.hostedWeb && remaining.length && !options.signal?.aborted) {
    const candidates = remaining.map(code => fundsByCode.get(code)!).map(fund => ({ ...fund, history: [...fund.history], metrics: { ...fund.metrics } }));
    const backfill = await backfillSelectedHistory(candidates, remaining, count => options.onProgress?.(done + count, codes.length),options.signal);
    const loadedAt = Date.now();
    for (const fund of backfill.updated) {
      historyByCode.set(fund.code, { history: fund.history, historyFetchedAt: fund.historyFetchedAt ?? loadedAt });
      historyLruCache.set(fund.code,{history:fund.history,loadedAt:fund.historyFetchedAt??loadedAt,snapshotId});
    }
    for (const failure of backfill.failedCodes) failures.set(failure.code, failure.reason);
  }

  if (historyByCode.size && options.hostedWeb) {
    await Promise.all([...historyByCode].map(async ([code, entry]) => {
      try { await saveNavHistory({ code, snapshotId: snapshotId || '', points: entry.history, loadedAt: entry.historyFetchedAt }); }
      catch { /* The current session can still use a successfully decoded or fetched history. */ }
    }));
  }

  if (!historyByCode.size) {
    options.onProgress?.(codes.length, codes.length);
    return { funds: sourceFunds, loadedCodes: [], failedCodes: options.signal?.aborted ? [] : [...failures].map(([code, reason]) => ({ code, reason })) };
  }

  const preserveMetrics = options.preserveExistingMetrics ?? true;
  const rawLoadedFunds = codes.flatMap(code => {
    const base = fundsByCode.get(code)!;
    const loaded = historyByCode.get(code);
    return loaded?.history.length ? [{ ...base, ...loaded, history: loaded.history, historyStatus: 'ok' as const, historyLastError: undefined, historyNextRetryAt: undefined }] : [];
  });
  const loadedFunds = rawLoadedFunds.map(fund => ensureFundMetricsComputed(fund, options.riskWindow, options.riskFreeRate));
  const fundsNeedingCompute = preserveMetrics
    ? rawLoadedFunds.filter(fund => !hasAuthoritativeMetrics(fund, fund.history.at(-1)?.date)).map(fund => ensureFundMetricsComputed(fund, options.riskWindow, options.riskFreeRate))
    : loadedFunds;

  if (!fundsNeedingCompute.length) {
    const loadedByCode = new Map(loadedFunds.map(fund => [fund.code, fund]));
    const mergedHistoryOnly = sourceFunds.map(fund => loadedByCode.get(fund.code) ?? fund);
    if (loadedFunds.length && !options.hostedWeb) {
      try { await saveFunds(loadedFunds); }
      catch { /* Keep successfully loaded histories available in memory if local storage is unavailable. */ }
    }
    options.onProgress?.(codes.length, codes.length);
    return { funds: mergedHistoryOnly, loadedCodes: [...historyByCode.keys()], failedCodes: [...failures].map(([code, reason]) => ({ code, reason })) };
  }

  const computed = await computeFundsInWorker(fundsNeedingCompute, options.riskWindow, options.riskFreeRate);
  const computedByCode = new Map(computed.map(fund => {
    const base = fundsByCode.get(fund.code)!;
    const metrics = { ...fund.metrics };
    const reasons = { ...fund.metricReasons };
    const provenance = { ...fund.metricProvenance };
    const metricAsOf = { ...fund.metricAsOf };
    if (preserveMetrics) {
      for (const [id, val] of Object.entries(base.metrics ?? {})) {
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (base.metricProvenance?.[id] === 'SEBI_HEURISTIC' && typeof metrics[id] === 'number' && Number.isFinite(metrics[id])) continue;
          metrics[id] = val;
          delete reasons[id];
          if (base.metricProvenance?.[id]) provenance[id] = base.metricProvenance[id]!;
          if (base.metricAsOf?.[id] !== undefined) metricAsOf[id] = base.metricAsOf[id]!;
        }
      }
    }
    for (const id of ['aum_cr', 'ter_pct']) {
      if (base.metrics[id] != null) metrics[id] = base.metrics[id]!;
      if (base.metricReasons?.[id]) reasons[id] = base.metricReasons[id]!;
      if (base.metricProvenance?.[id]) provenance[id] = base.metricProvenance[id]!;
      if (base.metricAsOf?.[id] !== undefined) metricAsOf[id] = base.metricAsOf[id]!;
    }
    const enriched = ensureFundMetricsComputed({ ...fund, metrics, metricReasons: reasons, metricProvenance: provenance, metricAsOf, metricsNavAsOf: fund.history.at(-1)?.date }, options.riskWindow, options.riskFreeRate);
    return [fund.code, enriched] as const;
  }));
  const loadedByCode = new Map(loadedFunds.map(fund => [fund.code, computedByCode.get(fund.code) ?? fund]));
  const merged = sourceFunds.map(fund => loadedByCode.get(fund.code) ?? fund);
  const withPeers = await computePeerMetricsInWorker(merged);
  const toPersist = options.hostedWeb ? [...loadedByCode.values()] : withPeers;
  if (toPersist.length) {
    try { await saveFunds(toPersist); }
    catch { /* Keep successfully loaded histories available in memory if local storage is unavailable. */ }
  }
  options.onProgress?.(codes.length, codes.length);
  return { funds: withPeers, loadedCodes: [...historyByCode.keys()], failedCodes: [...failures].map(([code, reason]) => ({ code, reason })) };
}
