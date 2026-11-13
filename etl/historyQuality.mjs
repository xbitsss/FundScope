export const MINIMUM_HISTORY_COVERAGE = 0.95;

// Retry batches can be much smaller than the catalog; release readiness is based
// on the saved snapshot coverage, not failures divided by the current batch.
export function assessHistoryCoverage(funds, minimumCoverage = MINIMUM_HISTORY_COVERAGE) {
  const total = funds.length;
  const withHistory = funds.reduce((count, fund) => count + (fund.history?.length ? 1 : 0), 0);
  const coverage = total ? withHistory / total : 0;
  const passes = total > 0 && Number.isFinite(minimumCoverage) && minimumCoverage >= 0 && minimumCoverage <= 1 && coverage >= minimumCoverage;
  return {
    total,
    withHistory,
    missing: total - withHistory,
    coverage,
    minimumCoverage,
    passes,
    message: `History coverage ${withHistory.toLocaleString('en-IN')}/${total.toLocaleString('en-IN')} (${(coverage * 100).toFixed(2)}%); minimum ${(minimumCoverage * 100).toFixed(0)}%.`,
  };
}
