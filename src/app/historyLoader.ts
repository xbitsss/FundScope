import type { Fund, NavPoint } from '../domain/types';
import { computeFundsInWorker } from '../domain/metrics/workerClient';
import { computePeerMetricsInWorker } from '../domain/metrics/peerMetricsClient';
import { backfillSelectedHistory } from './refresh';
import { getNavHistory, saveFunds, saveNavHistory } from './persistence';
import { getUnlockedSnapshotManifest, loadSnapshotHistories } from '../adapters/snapshot/browserReader';

export type HistoryLoadFailure = { code: number; reason: string };
export type HistoryLoadProgress = (done: number, total: number) => void;
export type HistoryLoadOutcome = { funds: Fund[]; loadedCodes: number[]; failedCodes: HistoryLoadFailure[] };

/** Resolve history from device cache, encrypted snapshot, then MFapi as a fallback. */
export async function loadSelectedHistories(
  requestedCodes: number[],
  sourceFunds: Fund[],
  options: { hostedWeb: boolean; riskWindow: 1 | 3 | 5; riskFreeRate: number; onProgress?: HistoryLoadProgress },
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

  if (options.hostedWeb) {
    const local = await Promise.all(codes.map(async code => {
      try { return { code, saved: await getNavHistory(code) }; }
      catch { return { code, saved: null }; }
    }));
    for (const { code, saved } of local) {
      const cacheIsFresh = saved !== null && Number.isFinite(saved.loadedAt) && Date.now() - saved.loadedAt <= 7 * 86_400_000;
      if (saved && cacheIsFresh && saved.points.length && saved.points.every(point => Number.isInteger(point.date) && Number.isFinite(point.nav) && point.nav > 0)) {
        const points = [...saved.points];
        const current = fundsByCode.get(code)!;
        const latest = points.at(-1);
        if (latest && current.navDate >= latest.date) {
          if (current.navDate === latest.date) points[points.length - 1] = { date: current.navDate, nav: current.nav };
          else points.push({ date: current.navDate, nav: current.nav });
        }
        historyByCode.set(code, { history: points, historyFetchedAt: saved.loadedAt });
        done++;
      }
    }
  }

  const remaining = codes.filter(code => !historyByCode.has(code));
  if (options.hostedWeb && remaining.length) {
    let snapshotResult: Awaited<ReturnType<typeof loadSnapshotHistories>> | null = null;
    try {
      snapshotResult = await loadSnapshotHistories(remaining, (count, total) => options.onProgress?.(done + count, codes.length));
      const loadedAt = Date.now();
      for (const [code, history] of snapshotResult.loaded) if (history.length) historyByCode.set(code, { history, historyFetchedAt: loadedAt });
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
        const fallback = await backfillSelectedHistory(candidates, fallbackCodes, count => options.onProgress?.(done + count, progressTotal));
        const loadedAt = Date.now();
        for (const fund of fallback.updated) {
          historyByCode.set(fund.code, { history: fund.history, historyFetchedAt: fund.historyFetchedAt ?? loadedAt });
          failures.delete(fund.code);
        }
        for (const failure of fallback.failedCodes) failures.set(failure.code, failure.reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MFapi NAV history fallback failed.';
        for (const code of fallbackCodes) if (!historyByCode.has(code)) failures.set(code, message);
      }
    }
  } else if (!options.hostedWeb) {
    const candidates = codes.map(code => fundsByCode.get(code)!).map(fund => ({ ...fund, history: [...fund.history], metrics: { ...fund.metrics } }));
    const backfill = await backfillSelectedHistory(candidates, codes, (count, total) => options.onProgress?.(count, total));
    const loadedAt = Date.now();
    for (const fund of backfill.updated) historyByCode.set(fund.code, { history: fund.history, historyFetchedAt: fund.historyFetchedAt ?? loadedAt });
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
    return { funds: sourceFunds, loadedCodes: [], failedCodes: [...failures].map(([code, reason]) => ({ code, reason })) };
  }

  const loadedFunds = codes.flatMap(code => {
    const base = fundsByCode.get(code)!;
    const loaded = historyByCode.get(code);
    return loaded?.history.length ? [{ ...base, ...loaded, history: loaded.history, historyStatus: 'ok' as const, historyLastError: undefined, historyNextRetryAt: undefined }] : [];
  });
  const computed = loadedFunds.length
    ? await computeFundsInWorker(loadedFunds, options.riskWindow, options.riskFreeRate)
    : [];
  const computedByCode = new Map(computed.map(fund => {
    const base = fundsByCode.get(fund.code)!;
    const metrics = { ...fund.metrics };
    const reasons = { ...fund.metricReasons };
    const provenance = { ...fund.metricProvenance };
    const metricAsOf = { ...fund.metricAsOf };
    for (const id of ['aum_cr', 'ter_pct']) {
      if (base.metrics[id] != null) metrics[id] = base.metrics[id]!;
      if (base.metricReasons?.[id]) reasons[id] = base.metricReasons[id]!;
      if (base.metricProvenance?.[id]) provenance[id] = base.metricProvenance[id]!;
      if (base.metricAsOf?.[id] !== undefined) metricAsOf[id] = base.metricAsOf[id]!;
    }
    const enriched = { ...fund, metrics, metricReasons: reasons, metricProvenance: provenance, metricAsOf, metricsNavAsOf: fund.history.at(-1)?.date };
    return [fund.code, enriched] as const;
  }));
  const merged = sourceFunds.map(fund => computedByCode.get(fund.code) ?? fund);
  const withPeers = await computePeerMetricsInWorker(merged);
  const toPersist = options.hostedWeb ? [...computedByCode.values()] : withPeers;
  if (toPersist.length) {
    try { await saveFunds(toPersist); }
    catch { /* Keep successfully loaded histories available in memory if local storage is unavailable. */ }
  }
  options.onProgress?.(codes.length, codes.length);
  return { funds: withPeers, loadedCodes: [...historyByCode.keys()], failedCodes: [...failures].map(([code, reason]) => ({ code, reason })) };
}
