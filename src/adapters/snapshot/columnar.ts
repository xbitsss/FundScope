import type { Fund } from '../../domain/types';
import { TAXONOMY_VERSION } from '../../domain/taxonomy/assetClass';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fields = ['name', 'amc', 'category', 'assetClass', 'classRuleId', 'subCategory', 'structure', 'plan', 'option', 'management', 'group', 'riskBand', 'philosophy', 'speciality', 'lifecycle', 'classStatus', 'headerRaw'] as const;
const reasonCodes = ['INSUFFICIENT_HISTORY', 'DATA_GAPS', 'SOURCE_MISSING', 'NO_BENCHMARK', 'NOT_APPLICABLE', 'NA_CATEGORY', 'UNCLASSIFIED_FUND', 'UNKNOWN'] as const;
const reasonToId = new Map(reasonCodes.map((reason, index) => [reason, index + 1]));
const idToReason = new Map(reasonCodes.map((reason, index) => [index + 1, reason]));
type Field = typeof fields[number];
interface Header { format: 'fundscope-columnar-v1'; count: number; fields: Field[]; dictionaries: Record<Field, string[]>; metrics: string[]; reasonCodes: string[] }

function fieldValue(fund: Fund, field: Field): string {
  const value = fund[field];
  return field === 'speciality' ? (Array.isArray(value) ? value.join('\u001f') : '') : typeof value === 'string' ? value : '';
}

/** Compact binary list index. Detailed classification/provenance/history stays in per-fund detail packs. */
export function encodeFundColumns(funds: Fund[]): Uint8Array {
  const dictionaries = {} as Record<Field, string[]>;
  const idMaps = {} as Record<Field, Map<string, number>>;
  for (const field of fields) {
    const values = [...new Set(funds.map(fund => fieldValue(fund, field)))];
    dictionaries[field] = values;
    idMaps[field] = new Map(values.map((value, index) => [value, index]));
  }
  const metrics = [...new Set(funds.flatMap(fund => Object.keys(fund.metrics ?? {})))].sort();
  const header: Header = { format: 'fundscope-columnar-v1', count: funds.length, fields: [...fields], dictionaries, metrics, reasonCodes: [...reasonCodes] };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefixBytes = (4 + headerBytes.length + 3) & ~3;
  const codeBytes = funds.length * 4; const navBytes = funds.length * 8; const dateBytes = funds.length * 4;
  const fieldsBytes = funds.length * fields.length * 2; const metricsBytes = funds.length * metrics.length * 4; const reasonsBytes = funds.length * metrics.length;
  const output = new Uint8Array(prefixBytes + codeBytes + navBytes + dateBytes + fieldsBytes + metricsBytes + reasonsBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, headerBytes.length, true); output.set(headerBytes, 4);
  let offset = prefixBytes;
  for (const fund of funds) { view.setInt32(offset, fund.code, true); offset += 4; }
  for (const fund of funds) { view.setFloat64(offset, fund.nav, true); offset += 8; }
  for (const fund of funds) { view.setInt32(offset, fund.navDate, true); offset += 4; }
  for (const field of fields) for (const fund of funds) { view.setUint16(offset, idMaps[field].get(fieldValue(fund, field)) ?? 0, true); offset += 2; }
  for (const metric of metrics) for (const fund of funds) { const raw = fund.metrics?.[metric]; view.setFloat32(offset, typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN, true); offset += 4; }
  for (const metric of metrics) for (const fund of funds) { output[offset++] = reasonToId.get(String(fund.metricReasons?.[metric] ?? '') as typeof reasonCodes[number]) ?? 0; }
  if (offset !== output.length) throw new Error('Columnar index length calculation failed.');
  return output;
}

export function decodeFundColumns(input: Uint8Array | ArrayBuffer): Fund[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 4) throw new Error('Snapshot columnar index is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength === 0) throw new Error('Snapshot columnar header is truncated.');
  if (headerLength > bytes.byteLength - 4) throw new Error('Snapshot columnar header is truncated.');
  const header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + headerLength))) as Header;
  if (header.format !== 'fundscope-columnar-v1' || !Number.isInteger(header.count) || header.count < 0 || !Array.isArray(header.metrics) || !header.dictionaries) throw new Error('Snapshot columnar index format is not supported.');
  const count = header.count; let offset = (4 + headerLength + 3) & ~3;
  const codes = new Int32Array(count); for (let i = 0; i < count; i++) { codes[i] = view.getInt32(offset, true); offset += 4; }
  const navs = new Float64Array(count); for (let i = 0; i < count; i++) { navs[i] = view.getFloat64(offset, true); offset += 8; }
  const navDates = new Int32Array(count); for (let i = 0; i < count; i++) { navDates[i] = view.getInt32(offset, true); offset += 4; }
  const fieldIds = new Map<Field, Uint16Array>();
  for (const field of header.fields) { const ids = new Uint16Array(count); for (let i = 0; i < count; i++) { ids[i] = view.getUint16(offset, true); offset += 2; } fieldIds.set(field, ids); }
  const metricValues = new Map<string, Float32Array>();
  for (const metric of header.metrics) { const values = new Float32Array(count); for (let i = 0; i < count; i++) { values[i] = view.getFloat32(offset, true); offset += 4; } metricValues.set(metric, values); }
  const metricReasons = new Map<string, Uint8Array>();
  for (const metric of header.metrics) { const values = bytes.subarray(offset, offset + count); metricReasons.set(metric, values); offset += count; }
  if (offset !== bytes.byteLength) throw new Error('Snapshot columnar index has an unexpected trailing section.');
  return Array.from({ length: count }, (_, index) => {
    const text = (field: Field) => header.dictionaries[field]?.[fieldIds.get(field)?.[index] ?? 0] ?? '';
    const metrics: Fund['metrics'] = {}; const reasons: NonNullable<Fund['metricReasons']> = {};
    for (const id of header.metrics) {
      const value = metricValues.get(id)![index]!;
      metrics[id] = Number.isFinite(value) ? value : null;
      const reason = idToReason.get(metricReasons.get(id)![index]!);
      if (reason) reasons[id] = reason as NonNullable<Fund['metricReasons']>[string];
    }
    const speciality = text('speciality').split('\u001f').filter(Boolean);
    const fund: Fund = {
      code: codes[index]!, isinGrowth: null, isinReinvestment: null, name: text('name'), amc: text('amc'), category: text('category'),
      assetClass: text('assetClass') as Fund['assetClass'], classRuleId: text('classRuleId') || 'COLUMNAR_INDEX', taxonomyVersion: TAXONOMY_VERSION,
      subCategory: text('subCategory'), structure: (text('structure') || 'unknown') as Fund['structure'], plan: (text('plan') || 'Unknown') as Fund['plan'],
      option: text('option'), nav: navs[index]!, navDate: navDates[index]!, history: [], metrics,
      management: (text('management') || 'Not specified') as Fund['management'], group: text('group') || undefined,
      riskBand: (text('riskBand') || 'Not specified') as Fund['riskBand'], philosophy: (text('philosophy') || 'Blend/Unspecified') as Fund['philosophy'],
      speciality, lifecycle: (text('lifecycle') || 'active') as Fund['lifecycle'], classStatus: text('classStatus') as Fund['classStatus'],
      headerRaw: text('headerRaw') || undefined, metricReasons: reasons,
    };
    return fund;
  });
}

export function extractFundDetail(fund: Fund): Partial<Fund> {
  return {
    ...(fund.schemeMaster ? { schemeMaster: fund.schemeMaster } : {}), ...(fund.classDetail ? { classDetail: fund.classDetail } : {}),
    ...(fund.classificationProvenance ? { classificationProvenance: fund.classificationProvenance } : {}),
    ...(fund.metricReasonDetails ? { metricReasonDetails: fund.metricReasonDetails } : {}), ...(fund.metricFlags ? { metricFlags: fund.metricFlags } : {}),
    ...(fund.metricProvenance ? { metricProvenance: fund.metricProvenance } : {}), ...(fund.metricAsOf ? { metricAsOf: fund.metricAsOf } : {}),
    ...(fund.classificationReason ? { classificationReason: fund.classificationReason } : {}), ...(fund.lifecycleReason ? { lifecycleReason: fund.lifecycleReason } : {}),
  };
}
