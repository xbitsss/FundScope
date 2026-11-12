import type { Fund } from '../../domain/types';
import { encodeNormalizedFundColumns } from '../snapshot/columnar';

export interface NormalizedFundListRow {
  scheme_code: number;
  isin_growth: string | null;
  isin_reinvestment: string | null;
  name: string;
  amc: string;
  category: string;
  asset_class: string;
  class_rule_id: string;
  taxonomy_version: number;
  sub_category: string;
  management: string | null;
  fund_group: string | null;
  risk_band: string | null;
  philosophy: string | null;
  speciality: string;
  lifecycle: string | null;
  structure: string;
  plan: string;
  option: string;
  nav: number;
  nav_date: number;
  class_status: string | null;
  header_raw: string | null;
  history_fetched_at: number | null;
  history_status: string | null;
  history_attempts: number | null;
  history_last_error: string | null;
  history_next_retry_at: number | null;
  metrics_nav_as_of: number | null;
}

export interface NormalizedMetricRow {
  scheme_code: number;
  metric_id: string;
  metric_value: number | null;
  reason_code: string | null;
}

export interface NormalizedFundWrite {
  list: Omit<NormalizedFundListRow, 'scheme_code'> & { code: number };
  metrics: Array<{ metricId: string; value: number | null; reasonCode: string | null }>;
  detailJson: string | null;
  history: Array<{ date: number; nav: number }>;
}

const detailFields = [
  'schemeMaster', 'classDetail', 'classificationReason', 'classificationProvenance', 'lifecycleReason',
  'metricReasonDetails', 'metricFlags', 'metricProvenance', 'metricAsOf',
] as const;

/** Project a full fund into typed list columns, typed metric rows and lazy detail/history payloads. */
export function toNormalizedFundWrite(fund: Fund): NormalizedFundWrite {
  const detail: Partial<Fund> = {};
  for (const field of detailFields) {
    const value = fund[field];
    if (value !== undefined) Object.assign(detail, { [field]: value });
  }
  return {
    list: {
      code: fund.code,
      isin_growth: fund.isinGrowth,
      isin_reinvestment: fund.isinReinvestment,
      name: fund.name,
      amc: fund.amc,
      category: fund.category,
      asset_class: fund.assetClass,
      class_rule_id: fund.classRuleId,
      taxonomy_version: fund.taxonomyVersion,
      sub_category: fund.subCategory,
      management: fund.management ?? null,
      fund_group: fund.group ?? null,
      risk_band: fund.riskBand ?? null,
      philosophy: fund.philosophy ?? null,
      speciality: (fund.speciality ?? []).join('\u001f'),
      lifecycle: fund.lifecycle ?? null,
      structure: fund.structure,
      plan: fund.plan,
      option: fund.option,
      nav: fund.nav,
      nav_date: fund.navDate,
      class_status: fund.classStatus ?? null,
      header_raw: fund.headerRaw ?? null,
      history_fetched_at: fund.historyFetchedAt ?? null,
      history_status: fund.historyStatus ?? null,
      history_attempts: fund.historyAttempts ?? null,
      history_last_error: fund.historyLastError ?? null,
      history_next_retry_at: fund.historyNextRetryAt ?? null,
      metrics_nav_as_of: fund.metricsNavAsOf ?? null,
    },
    metrics: Object.entries(fund.metrics ?? {}).map(([metricId, value]) => ({
      metricId,
      value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      reasonCode: fund.metricReasons?.[metricId] ?? null,
    })),
    detailJson: Object.keys(detail).length ? JSON.stringify(detail) : null,
    history: Array.isArray(fund.history) ? fund.history : [],
  };
}

/** Rebuild only the lightweight Fund list model. Detail JSON and NAV history are intentionally lazy. */
export function fromNormalizedFundRows(listRows: NormalizedFundListRow[], metricRows: NormalizedMetricRow[]): Fund[] {
  const byCode = new Map<number, { metrics: Fund['metrics']; reasons: NonNullable<Fund['metricReasons']> }>();
  for (const row of metricRows) {
    const record = byCode.get(row.scheme_code) ?? { metrics: {}, reasons: {} };
    record.metrics[row.metric_id] = typeof row.metric_value === 'number' && Number.isFinite(row.metric_value) ? row.metric_value : null;
    if (row.reason_code) record.reasons[row.metric_id] = row.reason_code as NonNullable<Fund['metricReasons']>[string];
    byCode.set(row.scheme_code, record);
  }
  const funds = listRows.map(row => {
    const record = byCode.get(Number(row.scheme_code));
    return {
      code: Number(row.scheme_code),
      isinGrowth: row.isin_growth ?? null,
      isinReinvestment: row.isin_reinvestment ?? null,
      name: row.name,
      amc: row.amc,
      category: row.category,
      assetClass: row.asset_class as Fund['assetClass'],
      classRuleId: row.class_rule_id,
      taxonomyVersion: Number(row.taxonomy_version),
      subCategory: row.sub_category,
      management: row.management as Fund['management'],
      group: row.fund_group ?? undefined,
      riskBand: row.risk_band as Fund['riskBand'],
      philosophy: row.philosophy as Fund['philosophy'],
      speciality: row.speciality ? row.speciality.split('\u001f').filter(Boolean) : [],
      lifecycle: row.lifecycle as Fund['lifecycle'],
      structure: row.structure as Fund['structure'],
      plan: row.plan as Fund['plan'],
      option: row.option,
      nav: Number(row.nav),
      navDate: Number(row.nav_date),
      history: [],
      historyFetchedAt: row.history_fetched_at === null ? undefined : Number(row.history_fetched_at),
      historyStatus: row.history_status as Fund['historyStatus'],
      historyAttempts: row.history_attempts === null ? undefined : Number(row.history_attempts),
      historyLastError: row.history_last_error ?? undefined,
      historyNextRetryAt: row.history_next_retry_at === null ? undefined : Number(row.history_next_retry_at),
      metricsNavAsOf: row.metrics_nav_as_of === null ? undefined : Number(row.metrics_nav_as_of),
      metrics: record?.metrics ?? {},
      metricReasons: record?.reasons ?? {},
    } satisfies Fund;
  });
  // The engine worker can receive a compact typed columnar buffer instead of cloning each object.
  return funds;
}

export function encodeNormalizedFundIndex(listRows: NormalizedFundListRow[], metricRows: NormalizedMetricRow[]): ArrayBuffer {
  const bytes = encodeNormalizedFundColumns(listRows, metricRows);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
