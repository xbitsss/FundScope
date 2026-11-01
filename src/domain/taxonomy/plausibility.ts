import settings from '../../../config/plausibility.json';
import type { Fund } from '../types';

const minimumPeerSize = settings.minPeerSize;
const thresholdK = settings.k;
const oneYearDays = Math.ceil(365.25);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function robustZ(value: number, values: number[]): number | null {
  const center = median(values);
  const mad = median(values.map((entry) => Math.abs(entry - center)));
  return mad > 0 ? 0.6745 * (value - center) / mad : null;
}

export function computePlausibilityFlags(funds: Fund[], marketCorrelations: ReadonlyMap<number, number> = new Map()): Map<number, string[]> {
  const eligible = funds.filter((fund) =>
    fund.structure === 'open' && /growth/i.test(fund.option) && fund.history.length > 1 &&
    fund.history.at(-1)!.date - fund.history[0]!.date >= oneYearDays,
  );
  const groups = new Map<string, Fund[]>();
  for (const fund of eligible) {
    const key = `${fund.subCategory}\u0000${fund.plan}\u0000${fund.option}`;
    groups.set(key, [...(groups.get(key) ?? []), fund]);
  }
  const volatilityByClass = new Map<string, number[]>();
  for (const fund of eligible) {
    const value = fund.metrics.std_dev;
    if (value == null || !Number.isFinite(value)) continue;
    volatilityByClass.set(fund.assetClass, [...(volatilityByClass.get(fund.assetClass) ?? []), value]);
  }
  const flags = new Map<number, string[]>();
  const add = (fund: Fund, flag: string) => flags.set(fund.code, [...new Set([...(flags.get(fund.code) ?? []), flag])]);

  for (const [key, peers] of groups) {
    if (peers.length < minimumPeerSize) continue;
    const volPeers = peers.flatMap((fund) => fund.metrics.std_dev == null ? [] : [fund.metrics.std_dev]);
    const correlationPeers = peers.flatMap((fund) => {
      const value = marketCorrelations.get(fund.code);
      return value === undefined || !Number.isFinite(value) ? [] : [value];
    });
    for (const fund of peers) {
      const volatility = fund.metrics.std_dev;
      const z = volatility == null || volPeers.length < minimumPeerSize ? null : robustZ(volatility, volPeers);
      if (z !== null && Math.abs(z) > thresholdK) add(fund, 'PLAUS_VOL_OUTLIER');
      const correlation = marketCorrelations.get(fund.code);
      if ((fund.assetClass === 'equity' || fund.assetClass === 'hybrid') && correlation !== undefined && correlationPeers.length >= minimumPeerSize) {
        const corrZ = robustZ(correlation, correlationPeers);
        if (corrZ !== null && corrZ < -thresholdK) add(fund, 'PLAUS_LOW_MARKET_CORR');
      }
    }
    void key;
  }

  const equityMedian = volatilityByClass.get('equity');
  const liquidMedian = volatilityByClass.get('liquid');
  const equityCenter = equityMedian?.length ? median(equityMedian) : undefined;
  const liquidCenter = liquidMedian?.length ? median(liquidMedian) : undefined;
  for (const fund of eligible) {
    const volatility = fund.metrics.std_dev;
    if (volatility == null) continue;
    if ((fund.assetClass === 'debt' || fund.assetClass === 'liquid') && equityCenter !== undefined && volatility > equityCenter) add(fund, 'PLAUS_CLASS_MISMATCH');
    if (fund.assetClass === 'equity' && liquidCenter !== undefined && volatility < liquidCenter) add(fund, 'PLAUS_CLASS_MISMATCH');
  }
  return flags;
}
