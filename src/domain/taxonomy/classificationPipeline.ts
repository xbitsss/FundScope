import settings from '../../../config/plausibility.json';
import { resolveBenchmark } from '../../config/benchmarks';
import { alignNavLevels, alignedReturns } from '../stats/align';
import type { Fund } from '../types';
import type { BenchmarkSeriesById } from '../benchmarks/types';
import { computePlausibilityFlags } from './plausibility';

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number | undefined {
  if (a.length < settings.minimumAlignedReturns || a.length !== b.length) return undefined;
  let sumA = 0, sumB = 0;for(let index=0;index<a.length;index++){sumA+=a[index]!;sumB+=b[index]!;}
  const meanA = sumA / a.length;
  const meanB = sumB / b.length;
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (let index = 0; index < a.length; index++) { const da = a[index]! - meanA; const db = b[index]! - meanB; covariance += da * db; varianceA += da * da; varianceB += db * db; }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator > 0 ? covariance / denominator : undefined;
}

/** Adds S4 anomaly flags after NAV and peer metrics are computed; never changes asset class. */
export function applyClassificationPlausibility(funds: Fund[], seriesById: BenchmarkSeriesById = {}): Fund[] {
  const correlations = new Map<number, number>();
  for (const fund of funds) {
    const resolution = resolveBenchmark(fund);
    if (!resolution.ok) continue;
    const history = seriesById[resolution.benchmark.id]?.history;
    if (!history?.length || fund.history.length < 2) continue;
    const start = Math.max(fund.history[0]!.date, history[0]!.date);
    const end = Math.min(fund.history.at(-1)!.date, history.at(-1)!.date);
    const levels = alignNavLevels(fund.history, history, start, end);
    const returns = levels ? alignedReturns(levels) : null;
    if (!returns) continue;
    const value = correlation(returns.rf, returns.rb);
    if (value !== undefined) correlations.set(fund.code, value);
  }
  const flags = computePlausibilityFlags(funds, correlations);
  return funds.map(fund => {
    const old = fund.classDetail?.flags ?? [];
    const kept = old.filter(flag => !flag.startsWith('PLAUS_'));
    const next = flags.get(fund.code) ?? [];
    return fund.classDetail ? { ...fund, classDetail: { ...fund.classDetail, flags: [...new Set([...kept, ...next])] } } : fund;
  });
}
