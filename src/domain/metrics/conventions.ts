/** Industry benchmark label for the Indian mutual fund risk-free rate (AMFI / CRISIL / Value Research / Groww standard). */
export const INDUSTRY_RISK_FREE_BENCHMARK = 'FBIL Overnight MIBOR';

/** Numerical conventions shared by NAV, benchmark, and worker calculations. */
export const ANALYTICS_DEFAULTS = Object.freeze({
  calendarDaysPerYear: 365.25,
  tradingDaysPerYear: 252,
  annualRiskFreeRate: 0.0555,
  maximumRiskFreeRatePercent: 30,
  annualConsistencyHurdle: 0.0555,
  rollingStepObservations: 1,
  maxReturnGapDays: 7,
  targetDateToleranceDays: 31,
  minimumRiskObservations: 30,
  minimumBenchmarkObservations: 200,
  minimumBenchmarkCoverage: 0.816,
  minimumCaptureObservations: 30,
  varConfidence: 0.95,
});
