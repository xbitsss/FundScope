import type { MetricReason, NavPoint } from '../types';
import { alignNavLevels, alignedReturns } from '../stats/align';
import { ANALYTICS_DEFAULTS } from './conventions';

/** Shared conventions for the local scorecard. Rates are decimal fractions (0.06 = 6%). */
export { ANALYTICS_DEFAULTS } from './conventions';

export type AnalyticsConfig = Partial<{
  calendarDaysPerYear: number;
  tradingDaysPerYear: number;
  annualRiskFreeRate: number;
  maximumRiskFreeRatePercent: number;
  annualConsistencyHurdle: number;
  rollingStepObservations: number;
  maxReturnGapDays: number;
  targetDateToleranceDays: number;
  minimumRiskObservations: number;
  minimumBenchmarkObservations: number;
  minimumBenchmarkCoverage: number;
  minimumCaptureObservations: number;
  varConfidence: number;
}>;
export type AlignmentStrategy = 'inner' | 'forward-fill';
export type AlignedLevel = { date: number; fund: number; benchmark: number };
export type AnalyticsResult = {
  asOfDate: number | null;
  metrics: Record<string, number | null>;
  reasons: Record<string, MetricReason>;
};
export type BenchmarkAnalyticsResult = AnalyticsResult & {
  benchmark: { returnBasis: 'TRI' | 'NAV' | 'UNKNOWN'; overlapObservations: number };
};

const withDefaults = (config: AnalyticsConfig = {}) => ({ ...ANALYTICS_DEFAULTS, ...config });
const finitePositive = (point: NavPoint) => Number.isFinite(point.date) && Number.isInteger(point.date) && Number.isFinite(point.nav) && point.nav > 0;

/** Sort and de-duplicate observations; the last supplied value wins for a duplicated date. */
export function normalizeSeries(input: readonly NavPoint[]): NavPoint[] {
  const byDate = new Map<number, number>();
  for (const point of input) if (finitePositive(point)) byDate.set(point.date, point.nav);
  return [...byDate].map(([date, nav]) => ({ date, nav })).sort((a, b) => a.date - b.date);
}

/** Align levels for display or valuation. Risk regressions use `inner` and never synthesize returns. */
export function alignSeriesLevels(
  fundInput: readonly NavPoint[],
  benchmarkInput: readonly NavPoint[],
  strategy: AlignmentStrategy = 'inner',
  from = Number.NEGATIVE_INFINITY,
  to = Number.POSITIVE_INFINITY,
): AlignedLevel[] {
  const fund = normalizeSeries(fundInput);
  const benchmark = normalizeSeries(benchmarkInput);
  if (strategy === 'inner') {
    const lowerBound = Number.isFinite(from) ? from : Math.max(fund[0]?.date ?? 0, benchmark[0]?.date ?? 0);
    const upperBound = Number.isFinite(to) ? to : Math.min(fund.at(-1)?.date ?? 0, benchmark.at(-1)?.date ?? 0);
    if (!fund.length || !benchmark.length || lowerBound > upperBound) return [];
    const levels = alignNavLevels(fund, benchmark, lowerBound, upperBound);
    return levels ? Array.from({ length: levels.n }, (_, index) => ({ date: levels.dates[index]!, fund: levels.a[index]!, benchmark: levels.b[index]! })) : [];
  }
  const aligned: AlignedLevel[] = [];
  let benchmarkIndex = 0;
  let latestBenchmark: NavPoint | undefined;
  for (const point of fund) {
    while (benchmarkIndex < benchmark.length && benchmark[benchmarkIndex]!.date <= point.date) latestBenchmark = benchmark[benchmarkIndex++]!;
    if (point.date >= from && point.date <= to && latestBenchmark) aligned.push({ date: point.date, fund: point.nav, benchmark: latestBenchmark.nav });
  }
  return aligned;
}

const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const sampleStd = (values: readonly number[]) => {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};
const quantile = (values: readonly number[], probability: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, probability * (sorted.length - 1)));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
};

function nearestObserved(series: readonly NavPoint[], target: number, tolerance: number): NavPoint | undefined {
  let low = 0;
  let high = series.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (series[middle]!.date < target) low = middle + 1;
    else high = middle;
  }
  const after = series[low];
  const before = series[low - 1];
  const nearest = !before ? after : !after ? before : Math.abs(before.date - target) <= Math.abs(after.date - target) ? before : after;
  return nearest && Math.abs(nearest.date - target) <= tolerance ? nearest : undefined;
}

function rollingCagrs(series: readonly NavPoint[], years: number, config: ReturnType<typeof withDefaults>): number[] {
  const results: number[] = [];
  const span = years * config.calendarDaysPerYear;
  let endIndex = 0;
  for (let index = 0; index < series.length; index += config.rollingStepObservations) {
    const start = series[index]!;
    const target = start.date + span;
    while (endIndex < series.length && series[endIndex]!.date < target) endIndex++;
    const after = series[endIndex];
    const before = series[endIndex - 1];
    const end = !before ? after : !after ? before : Math.abs(before.date - target) <= Math.abs(after.date - target) ? before : after;
    if (end && Math.abs(end.date - target) > config.targetDateToleranceDays) continue;
    if (!end || end.date <= start.date || end.date - start.date < years * 360 || start.nav <= 0) continue;
    results.push((Math.pow(end.nav / start.nav, config.calendarDaysPerYear / (end.date - start.date)) - 1) * 100);
  }
  return results;
}

const emptyIds = [
  'scheme_vintage_years', 'absolute_return_3m', 'absolute_return_6m', 'cagr_1y', 'cagr_3y', 'cagr_5y', 'cagr_10y',
  'rolling_3y_average_return', 'rolling_3y_consistency', 'rolling_5y_consistency', 'std_dev', 'max_drawdown', 'var_95',
  'semi_deviation', 'tail_risk_ratio', 'gain_loss_ratio', 'sharpe', 'sortino', 'omega', 'calmar',
];

/** Pure NAV-only scorecard. Percent-valued metrics are returned in percentage points. */
export function computeNavAnalytics(history: readonly NavPoint[], options: AnalyticsConfig & { riskWindowYears?: number } = {}): AnalyticsResult {
  const config = withDefaults(options);
  const series = normalizeSeries(history);
  const metrics: Record<string, number | null> = Object.fromEntries(emptyIds.map(id => [id, null]));
  const reasons: Record<string, MetricReason> = {};
  const missing = (id: string, reason: MetricReason) => { metrics[id] = null; reasons[id] = reason; };
  const latest = series.at(-1);
  const first = series[0];
  if (!latest || !first || series.length < 2) {
    for (const id of emptyIds) missing(id, 'INSUFFICIENT_HISTORY');
    return { asOfDate: latest?.date ?? null, metrics, reasons };
  }

  metrics.scheme_vintage_years = (latest.date - first.date) / config.calendarDaysPerYear;
  for (const years of [1, 3, 5, 10]) {
    const id = `cagr_${years}y`;
    const start = nearestObserved(series, latest.date - years * config.calendarDaysPerYear, config.targetDateToleranceDays);
    if (!start || latest.date - start.date < years * 360 || start.nav <= 0) missing(id, 'INSUFFICIENT_HISTORY');
    else metrics[id] = (Math.pow(latest.nav / start.nav, config.calendarDaysPerYear / (latest.date - start.date)) - 1) * 100;
  }
  for (const [id, days] of [['absolute_return_3m', 91], ['absolute_return_6m', 182]] as const) {
    const start = nearestObserved(series, latest.date - days, Math.min(config.targetDateToleranceDays, 21));
    if (!start || latest.date - start.date < days - 21 || start.nav <= 0) missing(id, 'INSUFFICIENT_HISTORY');
    else metrics[id] = (latest.nav / start.nav - 1) * 100;
  }

  for (const years of [3, 5]) {
    const windows = rollingCagrs(series, years, config);
    const id = `rolling_${years}y_consistency`;
    if (!windows.length) missing(id, 'INSUFFICIENT_HISTORY');
    else metrics[id] = windows.filter(value => value > config.annualConsistencyHurdle * 100).length / windows.length * 100;
    if (years === 3) {
      if (!windows.length) missing('rolling_3y_average_return', 'INSUFFICIENT_HISTORY');
      else metrics.rolling_3y_average_return = mean(windows);
    }
  }

  const riskFrom = latest.date - Math.max(1, options.riskWindowYears ?? 3) * config.calendarDaysPerYear;
  const firstRiskIndex = Math.max(0, series.findIndex(point => point.date >= riskFrom) - 1);
  const riskSeries = series.slice(firstRiskIndex);
  const simpleReturns: number[] = [];
  const logReturns: number[] = [];
  for (let index = 1; index < riskSeries.length; index++) {
    const before = riskSeries[index - 1]!;
    const after = riskSeries[index]!;
    const gap = after.date - before.date;
    if (gap <= 0 || gap > config.maxReturnGapDays || before.nav <= 0) continue;
    const simple = after.nav / before.nav - 1;
    if (!Number.isFinite(simple) || simple <= -1) continue;
    simpleReturns.push(simple);
    logReturns.push(Math.log1p(simple));
  }
  if (simpleReturns.length < config.minimumRiskObservations) {
    const span = latest.date - (riskSeries[0]?.date ?? latest.date);
    const reason: MetricReason = span < config.minimumRiskObservations || series.length < config.minimumRiskObservations ? 'INSUFFICIENT_HISTORY' : 'DATA_GAPS';
    for (const id of ['std_dev', 'max_drawdown', 'var_95', 'semi_deviation', 'tail_risk_ratio', 'gain_loss_ratio', 'sharpe', 'sortino', 'omega', 'calmar']) missing(id, reason);
    return { asOfDate: latest.date, metrics, reasons };
  }

  const volatility = sampleStd(logReturns);
  const averageSimple = mean(simpleReturns)!;
  const annualizedArithmetic = averageSimple * config.tradingDaysPerYear;
  const annualRiskFree = config.annualRiskFreeRate;
  const dailyRiskFree = Math.pow(1 + annualRiskFree, 1 / config.tradingDaysPerYear) - 1;
  const annualizedVolatility = volatility === null ? null : volatility * Math.sqrt(config.tradingDaysPerYear);
  const negative = simpleReturns.filter(value => value < 0);
  const downsideDeviation = Math.sqrt(simpleReturns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / simpleReturns.length) * Math.sqrt(config.tradingDaysPerYear);
  const sortedTailCount = Math.max(1, Math.ceil(simpleReturns.length * (1 - config.varConfidence)));
  const sorted = [...simpleReturns].sort((a, b) => a - b);
  const lowerTail = sorted.slice(0, sortedTailCount);
  const upperTail = sorted.filter(value => value > 0).slice(-sortedTailCount);
  const averageLoss = negative.length ? negative.reduce((sum, value) => sum + value, 0) / negative.length : null;
  const averageGain = simpleReturns.some(value => value > 0) ? simpleReturns.filter(value => value > 0).reduce((sum, value) => sum + value, 0) / simpleReturns.filter(value => value > 0).length : null;
  let peak = riskSeries[0]?.nav ?? latest.nav;
  let maxDrawdown = 0;
  for (const point of riskSeries) { peak = Math.max(peak, point.nav); maxDrawdown = Math.min(maxDrawdown, point.nav / peak - 1); }
  const riskStart = riskSeries[0];
  const riskSpan = riskStart ? latest.date - riskStart.date : 0;
  const riskWindowAnnualizedReturn = riskStart && riskSpan > 0 ? Math.pow(latest.nav / riskStart.nav, config.calendarDaysPerYear / riskSpan) - 1 : null;
  const gainsOverThreshold = simpleReturns.reduce((sum, value) => sum + Math.max(0, value - dailyRiskFree), 0);
  const lossesUnderThreshold = simpleReturns.reduce((sum, value) => sum + Math.max(0, dailyRiskFree - value), 0);

  metrics.std_dev = annualizedVolatility === null ? null : annualizedVolatility * 100;
  metrics.max_drawdown = maxDrawdown * 100;
  metrics.var_95 = Math.max(0, -(quantile(simpleReturns, 1 - config.varConfidence) ?? 0)) * 100;
  metrics.semi_deviation = downsideDeviation * 100;
  metrics.tail_risk_ratio = lowerTail.length && upperTail.length && mean(lowerTail)! < 0 ? mean(upperTail)! / Math.abs(mean(lowerTail)!) : null;
  metrics.gain_loss_ratio = averageGain !== null && averageLoss !== null ? averageGain / Math.abs(averageLoss) : null;
  metrics.sharpe = annualizedVolatility && annualizedVolatility > 0 ? (annualizedArithmetic - annualRiskFree) / annualizedVolatility : null;
  metrics.sortino = downsideDeviation > 0 ? (annualizedArithmetic - annualRiskFree) / downsideDeviation : null;
  metrics.omega = lossesUnderThreshold > 0 ? gainsOverThreshold / lossesUnderThreshold : null;
  metrics.calmar = riskWindowAnnualizedReturn !== null && maxDrawdown < 0 ? riskWindowAnnualizedReturn / Math.abs(maxDrawdown) : null;
  for (const id of ['std_dev', 'max_drawdown', 'var_95', 'semi_deviation', 'tail_risk_ratio', 'gain_loss_ratio', 'sharpe', 'sortino', 'omega', 'calmar']) {
    if (metrics[id] === null) reasons[id] = 'ZERO_DENOMINATOR';
  }
  return { asOfDate: latest.date, metrics, reasons };
}

export type BenchmarkReturnStats = {
  beta: number;
  rSquared: number | null;
  alpha: number;
  trackingError: number;
  treynor: number | null;
  informationRatio: number | null;
  upsideCapture: number | null;
  downsideCapture: number | null;
  lowR2: boolean;
  betaOutlier: boolean;
};

/** Core calculations shared by the UI worker and the benchmark governance gate. */
export function calculateBenchmarkReturnStats(fundReturns: Float64Array, benchmarkReturns: Float64Array, config: AnalyticsConfig = {}): BenchmarkReturnStats | null {
  const values = withDefaults(config);
  if (fundReturns.length !== benchmarkReturns.length || fundReturns.length < values.minimumBenchmarkObservations) return null;
  let fundMean = 0;
  let benchmarkMean = 0;
  for (let index = 0; index < fundReturns.length; index++) {
    const fund = fundReturns[index]!;
    const benchmark = benchmarkReturns[index]!;
    if (!Number.isFinite(fund) || !Number.isFinite(benchmark) || fund <= -1 || benchmark <= -1) return null;
    fundMean += fund;
    benchmarkMean += benchmark;
  }
  fundMean /= fundReturns.length;
  benchmarkMean /= benchmarkReturns.length;
  let benchmarkVariance = 0;
  let fundVariance = 0;
  let covariance = 0;
  for (let index = 0; index < fundReturns.length; index++) {
    const f = fundReturns[index]! - fundMean;
    const b = benchmarkReturns[index]! - benchmarkMean;
    fundVariance += f * f;
    benchmarkVariance += b * b;
    covariance += f * b;
  }
  if (benchmarkVariance <= Number.EPSILON) return null;
  const beta = covariance / benchmarkVariance;
  const rSquared = fundVariance > Number.EPSILON ? covariance * covariance / (fundVariance * benchmarkVariance) : null;
  const dailyRiskFree = Math.pow(1 + values.annualRiskFreeRate, 1 / values.tradingDaysPerYear) - 1;
  const alpha = ((fundMean - dailyRiskFree) - beta * (benchmarkMean - dailyRiskFree)) * values.tradingDaysPerYear * 100;
  const active = Array.from(fundReturns, (value, index) => value - benchmarkReturns[index]!);
  const activeMean = mean(active)!;
  const activeStd = sampleStd(active);
  const annualFundExcessPct = (fundMean - dailyRiskFree) * values.tradingDaysPerYear * 100;
  const capture = (upside: boolean) => {
    const selectedFund: number[] = [];
    const selectedBenchmark: number[] = [];
    for (let index = 0; index < benchmarkReturns.length; index++) {
      const benchmark = benchmarkReturns[index]!;
      if (upside ? benchmark > 0 : benchmark < 0) { selectedFund.push(fundReturns[index]!); selectedBenchmark.push(benchmark); }
    }
    if (selectedFund.length < values.minimumCaptureObservations) return null;
    const benchmarkGrowth = selectedBenchmark.reduce((product, value) => product * (1 + value), 1) - 1;
    const fundGrowth = selectedFund.reduce((product, value) => product * (1 + value), 1) - 1;
    return Math.abs(benchmarkGrowth) > Number.EPSILON ? fundGrowth / benchmarkGrowth * 100 : null;
  };
  return {
    beta,
    rSquared,
    alpha,
    trackingError: (activeStd ?? 0) * Math.sqrt(values.tradingDaysPerYear) * 100,
    treynor: Math.abs(beta) > Number.EPSILON ? annualFundExcessPct / beta : null,
    informationRatio: activeStd && activeStd > 0 ? activeMean / activeStd * Math.sqrt(values.tradingDaysPerYear) : null,
    upsideCapture: capture(true),
    downsideCapture: capture(false),
    lowR2: rSquared !== null && rSquared < 0.3,
    betaOutlier: beta < 0.2 || beta > 1.8,
  };
}

const benchmarkMetricIds = ['beta', 'r_squared', 'jensen_alpha', 'treynor', 'information_ratio', 'tracking_error', 'upside_capture', 'downside_capture'];

/** TRI-only benchmark scorecard; common-date interval returns form an exact inner join. */
export function computeBenchmarkAnalytics(
  fundHistory: readonly NavPoint[],
  benchmarkHistory: readonly NavPoint[],
  returnBasis: 'TRI' | 'NAV' | 'UNKNOWN',
  options: AnalyticsConfig = {},
): BenchmarkAnalyticsResult {
  const metrics: Record<string, number | null> = Object.fromEntries(benchmarkMetricIds.map(id => [id, null]));
  const reasons: Record<string, MetricReason> = {};
  const fail = (reason: MetricReason) => { for (const id of benchmarkMetricIds) reasons[id] = reason; };
  const config = withDefaults(options);
  if (returnBasis !== 'TRI') {
    fail('NO_BENCHMARK');
    return { asOfDate: normalizeSeries(fundHistory).at(-1)?.date ?? null, metrics, reasons, benchmark: { returnBasis, overlapObservations: 0 } };
  }
  const aligned = alignSeriesLevels(fundHistory, benchmarkHistory, 'inner');
  const levels = aligned.length ? alignNavLevels(normalizeSeries(fundHistory), normalizeSeries(benchmarkHistory), aligned[0]!.date, aligned.at(-1)!.date) : null;
  const returns = levels ? alignedReturns(levels) : null;
  const overlapObservations = returns?.nObs ?? 0;
  if (!returns || overlapObservations < config.minimumBenchmarkObservations) {
    fail('INSUFFICIENT_HISTORY');
    return { asOfDate: aligned.at(-1)?.date ?? null, metrics, reasons, benchmark: { returnBasis, overlapObservations } };
  }
  const benchmarkDeviation = sampleStd(Array.from(returns.rb));
  if (benchmarkDeviation === null || benchmarkDeviation <= Number.EPSILON) {
    fail('ZERO_DENOMINATOR');
    return { asOfDate: returns.dates.at(-1) ?? null, metrics, reasons, benchmark: { returnBasis, overlapObservations } };
  }
  const stats = calculateBenchmarkReturnStats(returns.rf, returns.rb, config);
  if (!stats) {
    fail('DATA_GAPS');
    return { asOfDate: returns.dates.at(-1) ?? null, metrics, reasons, benchmark: { returnBasis, overlapObservations } };
  }
  metrics.beta = stats.beta;
  metrics.r_squared = stats.rSquared;
  metrics.jensen_alpha = stats.alpha;
  metrics.treynor = stats.treynor;
  metrics.information_ratio = stats.informationRatio;
  metrics.tracking_error = stats.trackingError;
  metrics.upside_capture = stats.upsideCapture;
  metrics.downside_capture = stats.downsideCapture;
  for (const id of ['treynor', 'information_ratio'] as const) if (metrics[id] === null) reasons[id] = 'ZERO_DENOMINATOR';
  for (const id of ['upside_capture', 'downside_capture'] as const) if (metrics[id] === null) reasons[id] = 'TOO_FEW_SAMPLES';
  return { asOfDate: returns.dates.at(-1) ?? null, metrics, reasons, benchmark: { returnBasis, overlapObservations } };
}

/** Unified, JSON-serializable scorecard for workers, CLI jobs, and callers that have benchmark data. */
export function computeFinancialScorecard(
  fundHistory: readonly NavPoint[],
  benchmark?: { history: readonly NavPoint[]; returnBasis: 'TRI' | 'NAV' | 'UNKNOWN' },
  options: AnalyticsConfig & { riskWindowYears?: number } = {},
): AnalyticsResult & { benchmark?: BenchmarkAnalyticsResult['benchmark'] } {
  const standalone = computeNavAnalytics(fundHistory, options);
  if (!benchmark) return standalone;
  const relative = computeBenchmarkAnalytics(fundHistory, benchmark.history, benchmark.returnBasis, options);
  return {
    asOfDate: standalone.asOfDate,
    metrics: { ...standalone.metrics, ...relative.metrics, benchmark_overlap_days: relative.benchmark.overlapObservations },
    reasons: { ...standalone.reasons, ...relative.reasons },
    benchmark: relative.benchmark,
  };
}
