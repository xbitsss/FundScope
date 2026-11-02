import type { Fund, MetricReason, NavPoint } from '../types';
import { computeNavAnalytics } from './analytics';
import { ANALYTICS_DEFAULTS } from './conventions';

export type MetricBundle = { metrics: Record<string, number | null>; reasons: Record<string, MetricReason> };
export const DEFAULT_RISK_FREE_RATE_PERCENT = ANALYTICS_DEFAULTS.annualRiskFreeRate * 100;
export const MAX_RISK_FREE_RATE_PERCENT = ANALYTICS_DEFAULTS.maximumRiskFreeRatePercent;

export function applyLocalMetricBundle(fund: Fund, bundle: MetricBundle): Fund {
  const metrics = { ...fund.metrics };
  const reasons = { ...fund.metricReasons };
  const metricProvenance = { ...fund.metricProvenance };
  for (const [id, value] of Object.entries(bundle.metrics)) {
    const provenance = metricProvenance[id];
    if (metrics[id] != null && provenance && provenance !== 'LOCAL_NAV') continue;
    metrics[id] = value;
    if (value == null) {
      if (bundle.reasons[id]) reasons[id] = bundle.reasons[id]!;
      delete metricProvenance[id];
    } else {
      delete reasons[id];
      metricProvenance[id] = 'LOCAL_NAV';
    }
  }
  return { ...fund, metrics, metricReasons: reasons, metricProvenance };
}

/** Compatibility wrapper for the app's settings, which store rates in percentage points. */
export function computeMetricBundle(
  fund: Pick<Fund, 'history' | 'nav' | 'navDate'>,
  riskWindow = 3,
  riskFreeRatePercent = DEFAULT_RISK_FREE_RATE_PERCENT,
  hurdleRatePercent = riskFreeRatePercent,
): MetricBundle {
  const result = computeNavAnalytics(fund.history, {
    riskWindowYears: riskWindow,
    annualRiskFreeRate: riskFreeRatePercent / 100,
    annualConsistencyHurdle: hurdleRatePercent / 100,
  });
  return { metrics: result.metrics, reasons: result.reasons };
}

export function computeMetrics(
  fund: Pick<Fund, 'history' | 'nav' | 'navDate'>,
  riskWindow = 3,
  riskFreeRatePercent = DEFAULT_RISK_FREE_RATE_PERCENT,
  hurdleRatePercent = riskFreeRatePercent,
): Record<string, number | null> {
  return computeMetricBundle(fund, riskWindow, riskFreeRatePercent, hurdleRatePercent).metrics;
}

export function growthSeries(history: NavPoint[], days = ANALYTICS_DEFAULTS.calendarDaysPerYear * 5): NavPoint[] {
  const end = history.at(-1);
  if (!end) return [];
  const result = history.filter(point => point.date >= end.date - days);
  const base = result[0]?.nav;
  return base ? result.map(point => ({ date: point.date, nav: point.nav / base * 10_000 })) : [];
}
