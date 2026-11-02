import { describe, expect, it } from 'vitest';
import { alignSeriesLevels, calculateBenchmarkReturnStats, computeBenchmarkAnalytics, computeFinancialScorecard, computeNavAnalytics } from '../../src/domain/metrics/analytics';
import type { NavPoint } from '../../src/domain/types';

const historyFromReturns = (returns: number[], startDate = 20_000, startNav = 100): NavPoint[] => {
  const history: NavPoint[] = [{ date: startDate, nav: startNav }];
  for (let index = 0; index < returns.length; index++) history.push({ date: startDate + index + 1, nav: history[index]!.nav * (1 + returns[index]!) });
  return history;
};

describe('financial analytics engine', () => {
  it('calculates annualized volatility from daily log returns and peak-to-trough drawdown', () => {
    const history = historyFromReturns(Array.from({ length: 40 }, (_, index) => index % 2 ? -0.01 : 0.02));
    const result = computeNavAnalytics(history, { minimumRiskObservations: 30 });
    const logReturns = Array.from({ length: 40 }, (_, index) => Math.log1p(index % 2 ? -0.01 : 0.02));
    const average = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
    const sampleDeviation = Math.sqrt(logReturns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (logReturns.length - 1));
    expect(result.metrics.std_dev).toBeCloseTo(sampleDeviation * Math.sqrt(252) * 100, 8);
    expect(result.metrics.max_drawdown).toBeLessThan(0);
    expect(result.metrics.var_95).toBeGreaterThan(0);
  });

  it('returns explicit denominator reasons for a flat NAV history', () => {
    const history = Array.from({ length: 40 }, (_, index) => ({ date: 20_000 + index, nav: 100 }));
    const result = computeNavAnalytics(history);
    expect(result.metrics.std_dev).toBe(0);
    expect(result.metrics.sharpe).toBeNull();
    expect(result.reasons.sharpe).toBe('ZERO_DENOMINATOR');
    expect(result.metrics.calmar).toBeNull();
  });

  it('aligns inner joins on exact dates and supports explicit as-of forward fill', () => {
    const fund = [{ date: 10, nav: 1 }, { date: 11, nav: 2 }, { date: 12, nav: 3 }];
    const benchmark = [{ date: 10, nav: 10 }, { date: 12, nav: 12 }];
    expect(alignSeriesLevels(fund, benchmark, 'inner').map(point => point.date)).toEqual([10, 12]);
    expect(alignSeriesLevels(fund, benchmark, 'forward-fill').map(point => [point.date, point.benchmark])).toEqual([[10, 10], [11, 10], [12, 12]]);
  });

  it('computes OLS benchmark statistics from aligned TRI returns', () => {
    const benchmarkReturns = Array.from({ length: 260 }, (_, index) => index % 2 ? -0.003 : 0.004);
    const fundReturns = benchmarkReturns.map(value => value * 1.4 + 0.0002);
    const fund = historyFromReturns(fundReturns);
    const benchmark = historyFromReturns(benchmarkReturns);
    const result = computeBenchmarkAnalytics(fund, benchmark, 'TRI', { minimumCaptureObservations: 20 });
    expect(result.metrics.beta).toBeCloseTo(1.4, 8);
    expect(result.metrics.r_squared).toBeCloseTo(1, 8);
    expect(result.metrics.tracking_error).toBeGreaterThan(0);
    expect(result.metrics.jensen_alpha).toBeDefined();
    expect(result.benchmark.overlapObservations).toBe(260);
  });

  it('fails closed for non-TRI benchmark series and preserves the reason in the combined JSON scorecard', () => {
    const fund = historyFromReturns(Array.from({ length: 240 }, () => 0.001));
    const result = computeFinancialScorecard(fund, { history: fund, returnBasis: 'NAV' });
    expect(result.metrics.beta).toBeNull();
    expect(result.reasons.beta).toBe('NO_BENCHMARK');
    expect(result.benchmark).toMatchObject({ returnBasis: 'NAV', overlapObservations: 0 });
  });

  it('returns null on zero benchmark variance rather than dividing by zero', () => {
    const returns = new Float64Array(220).fill(0);
    expect(calculateBenchmarkReturnStats(returns, returns, { annualRiskFreeRate: 0.06 })).toBeNull();
  });
});
