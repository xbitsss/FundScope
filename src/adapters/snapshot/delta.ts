import type { Fund, MetricReason } from '../../domain/types';

const indexFields = [
  'isinGrowth', 'isinReinvestment', 'name', 'amc', 'category', 'assetClass', 'classRuleId', 'taxonomyVersion', 'nav', 'navDate',
  'subCategory', 'structure', 'plan', 'option', 'management', 'group', 'riskBand', 'philosophy', 'speciality',
  'lifecycle', 'classStatus', 'headerRaw', 'sparkline',
] as const;
type IndexField = typeof indexFields[number];

export interface SnapshotFundPatch {
  code: number;
  fields: Partial<Pick<Fund, IndexField>>;
  removedFields?: IndexField[];
  metrics: Record<string, number | null>;
  removedMetrics?: string[];
  reasons: Record<string, MetricReason | null>;
}

export interface SnapshotDelta {
  version: 1;
  base_snapshot_id: string;
  snapshot_id: string;
  fund_count: number;
  upserts: SnapshotFundPatch[];
  deleted_codes: number[];
}

const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** Build sparse list/metric patches; full NAV history and detail payloads are never copied into the delta. */
export function buildSnapshotDelta(base: Fund[], latest: Fund[], baseSnapshotId: string, snapshotId: string): SnapshotDelta {
  const before = new Map(base.map(fund => [fund.code, fund]));
  const after = new Map(latest.map(fund => [fund.code, fund]));
  const upserts: SnapshotFundPatch[] = [];
  for (const fund of latest) {
    const previous = before.get(fund.code);
    const fields: Partial<Pick<Fund, IndexField>> = {};
    const removedFields: IndexField[] = [];
    for (const field of indexFields) {
      const next = fund[field];
      if (previous && same(previous[field], next)) continue;
      if (next === undefined) { if (previous) removedFields.push(field); }
      else Object.assign(fields, { [field]: next });
    }
    const metrics: Record<string, number | null> = {};
    const removedMetrics: string[] = [];
    const metricIds = new Set([...Object.keys(previous?.metrics ?? {}), ...Object.keys(fund.metrics ?? {})]);
    for (const id of metricIds) {
      const oldValue = previous?.metrics[id] ?? null;
      const nextValue = fund.metrics[id] ?? null;
      if (!previous || !same(oldValue, nextValue)) metrics[id] = nextValue;
      if (previous && id in (previous.metrics ?? {}) && !(id in (fund.metrics ?? {}))) removedMetrics.push(id);
    }
    const reasons: Record<string, MetricReason | null> = {};
    const reasonIds = new Set([...Object.keys(previous?.metricReasons ?? {}), ...Object.keys(fund.metricReasons ?? {})]);
    for (const id of reasonIds) {
      const oldValue = previous?.metricReasons?.[id] ?? null;
      const nextValue = fund.metricReasons?.[id] ?? null;
      if (oldValue !== nextValue) reasons[id] = nextValue;
    }
    if (!previous || Object.keys(fields).length || removedFields.length || Object.keys(metrics).length || removedMetrics.length || Object.keys(reasons).length) {
      upserts.push({ code: fund.code, fields, ...(removedFields.length ? { removedFields } : {}), metrics, ...(removedMetrics.length ? { removedMetrics } : {}), reasons });
    }
  }
  const deleted_codes = base.flatMap(fund => after.has(fund.code) ? [] : [fund.code]);
  return { version: 1, base_snapshot_id: baseSnapshotId, snapshot_id: snapshotId, fund_count: latest.length, upserts, deleted_codes };
}

function validatePatch(value: unknown): value is SnapshotFundPatch {
  if (!value || typeof value !== 'object') return false;
  const patch = value as Partial<SnapshotFundPatch>;
  if (!Number.isSafeInteger(patch.code) || patch.code! <= 0 || !patch.fields || typeof patch.fields !== 'object' || Array.isArray(patch.fields) || !patch.metrics || typeof patch.metrics !== 'object' || Array.isArray(patch.metrics) || !patch.reasons || typeof patch.reasons !== 'object' || Array.isArray(patch.reasons)) return false;
  if (Object.keys(patch.fields).some(key => !indexFields.includes(key as IndexField))) return false;
  for (const [key, fieldValue] of Object.entries(patch.fields)) {
    if (key === 'nav' && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue <= 0)) return false;
    if (key === 'navDate' && !Number.isSafeInteger(fieldValue)) return false;
    if (key === 'taxonomyVersion' && !Number.isSafeInteger(fieldValue)) return false;
    if (key === 'sparkline' && (!Array.isArray(fieldValue) || fieldValue.some(point => typeof point !== 'number' || !Number.isFinite(point)))) return false;
    if (key !== 'nav' && key !== 'navDate' && key !== 'taxonomyVersion' && key !== 'sparkline' && fieldValue !== null && typeof fieldValue !== 'string' && !(key === 'speciality' && Array.isArray(fieldValue) && fieldValue.every(item => typeof item === 'string'))) return false;
  }
  if (Object.values(patch.metrics).some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) return false;
  if (Object.values(patch.reasons).some(value => value !== null && typeof value !== 'string')) return false;
  const removedFields = patch.removedFields ?? [];
  const removedMetrics = patch.removedMetrics ?? [];
  return removedFields.every((field, index) => indexFields.includes(field) && !Object.hasOwn(patch.fields!, field) && removedFields.indexOf(field) === index) &&
    removedMetrics.every((id, index) => typeof id === 'string' && !Object.hasOwn(patch.metrics!, id) && removedMetrics.indexOf(id) === index);
}

/** Apply a delta only to its exact base and target snapshot; callers fall back to the full index on any error. */
export function applySnapshotDelta(base: Fund[], delta: unknown, expectedBaseId: string, expectedSnapshotId: string, expectedFundCount: number): Fund[] {
  if (!delta || typeof delta !== 'object') throw new Error('Snapshot delta is malformed.');
  const value = delta as Partial<SnapshotDelta>;
  if (value.version !== 1 || value.base_snapshot_id !== expectedBaseId || value.snapshot_id !== expectedSnapshotId) throw new Error('Snapshot delta does not match the cached snapshot.');
  if (!Array.isArray(value.upserts) || !Array.isArray(value.deleted_codes) || !Number.isSafeInteger(value.fund_count) || value.fund_count !== expectedFundCount) throw new Error('Snapshot delta counts are malformed.');
  const rows = new Map<number, Fund>();
  for (const fund of base) {
    if (!Number.isSafeInteger(fund.code) || rows.has(fund.code)) throw new Error('Cached fund index contains duplicate or invalid scheme codes.');
    rows.set(fund.code, fund);
  }
  const removed = new Set<number>();
  for (const code of value.deleted_codes) {
    if (!Number.isSafeInteger(code) || removed.has(code)) throw new Error('Snapshot delta contains duplicate or invalid removals.');
    removed.add(code); rows.delete(code);
  }
  const seen = new Set<number>();
  for (const patchValue of value.upserts) {
    if (!validatePatch(patchValue) || seen.has(patchValue.code) || removed.has(patchValue.code)) throw new Error('Snapshot delta contains an invalid or duplicate fund update.');
    seen.add(patchValue.code);
    const previous = rows.get(patchValue.code);
    const fields = { ...patchValue.fields } as Partial<Fund>;
    for (const field of patchValue.removedFields ?? []) delete fields[field];
    const metrics = { ...(previous?.metrics ?? {}) };
    for (const id of patchValue.removedMetrics ?? []) delete metrics[id];
    Object.assign(metrics, patchValue.metrics);
    const reasons: NonNullable<Fund['metricReasons']> = { ...(previous?.metricReasons ?? {}) };
    for (const [id, reason] of Object.entries(patchValue.reasons)) {
      if (reason === null) delete reasons[id]; else reasons[id] = reason;
    }
    const cleanPrevious = previous ? { ...previous } : {} as Partial<Fund>;
    for (const key of ['schemeMaster', 'classDetail', 'classificationReason', 'classificationProvenance', 'lifecycleReason', 'metricReasonDetails', 'metricFlags', 'metricProvenance', 'metricAsOf'] as const) delete cleanPrevious[key];
    rows.set(patchValue.code, { ...cleanPrevious, ...fields, code: patchValue.code, history: previous?.history ?? [], metrics, metricReasons: reasons } as Fund);
  }
  if (rows.size !== expectedFundCount) throw new Error(`Snapshot delta produced ${rows.size} funds; expected ${expectedFundCount}.`);
  return [...rows.values()].sort((left, right) => left.code - right.code);
}
