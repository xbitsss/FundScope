import type { Fund } from '../../domain/types';
import { TAXONOMY_VERSION } from '../../domain/taxonomy/assetClass';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fields = ['name', 'amc', 'category', 'assetClass', 'classRuleId', 'subCategory', 'structure', 'plan', 'option', 'management', 'group', 'riskBand', 'philosophy', 'speciality', 'lifecycle', 'classStatus', 'headerRaw'] as const;
const SPARKLINE_POINTS=12;
const reasonCodes = ['INSUFFICIENT_HISTORY', 'DATA_GAPS', 'SOURCE_MISSING', 'NO_BENCHMARK', 'NOT_APPLICABLE', 'NA_CATEGORY', 'UNCLASSIFIED_FUND', 'UNKNOWN', 'TOO_FEW_SAMPLES', 'ZERO_DENOMINATOR', 'UNAVAILABLE_SOURCE', 'INSUFFICIENT_ALIGNED_HISTORY'] as const;
const reasonToId = new Map(reasonCodes.map((reason, index) => [reason, index + 1]));
const idToReason = new Map(reasonCodes.map((reason, index) => [index + 1, reason]));
type Field = typeof fields[number];
interface Header { format: 'fundscope-columnar-v1'; count: number; fields: Field[]; dictionaries: Record<Field, string[]>; metrics: string[]; reasonCodes: string[]; sparklinePoints?:number }

export interface NormalizedFundColumnRow {
  scheme_code: number; name: string; amc: string; category: string; asset_class: string; class_rule_id: string;
  sub_category: string; structure: string; plan: string; option: string; management: string | null;
  fund_group: string | null; risk_band: string | null; philosophy: string | null; speciality: string;
  lifecycle: string | null; class_status: string | null; header_raw: string | null; nav: number; nav_date: number;
}
export interface NormalizedFundMetricRow {
  scheme_code: number; metric_id: string; metric_value: number | null; reason_code: string | null;
}

function fieldValue(fund: Fund, field: Field): string {
  const value = fund[field];
  return field === 'speciality' ? (Array.isArray(value) ? value.join('\u001f') : '') : typeof value === 'string' ? value : '';
}

function resampleSparkline(values:number[]|undefined):number[]|null{
  if(!values?.length||values.some(value=>!Number.isFinite(value)))return null;
  if(values.length===1)return Array.from({length:SPARKLINE_POINTS},()=>values[0]!);
  return Array.from({length:SPARKLINE_POINTS},(_,index)=>{const position=index*(values.length-1)/(SPARKLINE_POINTS-1);const left=Math.floor(position);const fraction=position-left;return values[left]!*(1-fraction)+values[Math.min(values.length-1,left+1)]!*fraction;});
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
  const hasSparklines=funds.some(fund=>Array.isArray(fund.sparkline)&&fund.sparkline.length>0);
  const header: Header = { format: 'fundscope-columnar-v1', count: funds.length, fields: [...fields], dictionaries, metrics, reasonCodes: [...reasonCodes], ...(hasSparklines?{sparklinePoints:SPARKLINE_POINTS}:{}) };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefixBytes = (4 + headerBytes.length + 3) & ~3;
  const codeBytes = funds.length * 4; const navBytes = funds.length * 8; const dateBytes = funds.length * 4;
  const fieldsBytes = funds.length * fields.length * 2; const metricsBytes = funds.length * metrics.length * 4; const reasonsBytes = funds.length * metrics.length;
  const sparklineBytes=hasSparklines?funds.length*SPARKLINE_POINTS*2:0;
  const output = new Uint8Array(prefixBytes + codeBytes + navBytes + dateBytes + fieldsBytes + metricsBytes + reasonsBytes + sparklineBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, headerBytes.length, true); output.set(headerBytes, 4);
  let offset = prefixBytes;
  for (const fund of funds) { view.setInt32(offset, fund.code, true); offset += 4; }
  for (const fund of funds) { view.setFloat64(offset, fund.nav, true); offset += 8; }
  for (const fund of funds) { view.setInt32(offset, fund.navDate, true); offset += 4; }
  for (const field of fields) for (const fund of funds) { view.setUint16(offset, idMaps[field].get(fieldValue(fund, field)) ?? 0, true); offset += 2; }
  for (const metric of metrics) for (const fund of funds) { const raw = fund.metrics?.[metric]; view.setFloat32(offset, typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN, true); offset += 4; }
  for (const metric of metrics) for (const fund of funds) { output[offset++] = reasonToId.get(String(fund.metricReasons?.[metric] ?? '') as typeof reasonCodes[number]) ?? 0; }
  if(hasSparklines)for(const fund of funds){const values=resampleSparkline(fund.sparkline);for(let point=0;point<SPARKLINE_POINTS;point++){const value=values?.[point];view.setUint16(offset,value===undefined?0xffff:Math.round(Math.max(0,Math.min(1,value))*0xfffe),true);offset+=2;}}
  if (offset !== output.length) throw new Error('Columnar index length calculation failed.');
  return output;
}

/** Encodes desktop SQLite rows directly into the existing worker index format. */
export function encodeNormalizedFundColumns(rows: NormalizedFundColumnRow[], metricRows: NormalizedFundMetricRow[]): Uint8Array {
  const fieldKeys: Record<Field, keyof NormalizedFundColumnRow> = {
    name: 'name', amc: 'amc', category: 'category', assetClass: 'asset_class', classRuleId: 'class_rule_id',
    subCategory: 'sub_category', structure: 'structure', plan: 'plan', option: 'option', management: 'management',
    group: 'fund_group', riskBand: 'risk_band', philosophy: 'philosophy', speciality: 'speciality', lifecycle: 'lifecycle',
    classStatus: 'class_status', headerRaw: 'header_raw',
  };
  const dictionaries = {} as Record<Field, string[]>;
  const idMaps = {} as Record<Field, Map<string, number>>;
  for (const field of fields) {
    const key = fieldKeys[field];
    const values = [...new Set(rows.map(row => typeof row[key] === 'string' ? row[key] as string : ''))];
    dictionaries[field] = values;
    idMaps[field] = new Map(values.map((value, index) => [value, index]));
  }
  const metrics = [...new Set(metricRows.map(row => row.metric_id))].sort();
  const metricByFund = new Map<number, Map<string, NormalizedFundMetricRow>>();
  for (const row of metricRows) {
    const fundMetrics = metricByFund.get(row.scheme_code) ?? new Map<string, NormalizedFundMetricRow>();
    fundMetrics.set(row.metric_id, row);
    metricByFund.set(row.scheme_code, fundMetrics);
  }
  const header: Header = { format: 'fundscope-columnar-v1', count: rows.length, fields: [...fields], dictionaries, metrics, reasonCodes: [...reasonCodes] };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefixBytes = (4 + headerBytes.length + 3) & ~3;
  const output = new Uint8Array(prefixBytes + rows.length * (4 + 8 + 4 + fields.length * 2 + metrics.length * 5));
  const view = new DataView(output.buffer);
  view.setUint32(0, headerBytes.length, true); output.set(headerBytes, 4);
  let offset = prefixBytes;
  for (const row of rows) { view.setInt32(offset, row.scheme_code, true); offset += 4; }
  for (const row of rows) { view.setFloat64(offset, row.nav, true); offset += 8; }
  for (const row of rows) { view.setInt32(offset, row.nav_date, true); offset += 4; }
  for (const field of fields) {
    const key = fieldKeys[field];
    for (const row of rows) {
      const raw = row[key]; const value = typeof raw === 'string' ? raw : '';
      view.setUint16(offset, idMaps[field].get(value) ?? 0, true); offset += 2;
    }
  }
  for (const metric of metrics) for (const row of rows) {
    const value = metricByFund.get(row.scheme_code)?.get(metric)?.metric_value;
    view.setFloat32(offset, typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN, true); offset += 4;
  }
  for (const metric of metrics) for (const row of rows) {
    const reason = metricByFund.get(row.scheme_code)?.get(metric)?.reason_code ?? '';
    output[offset++] = reasonToId.get(reason as typeof reasonCodes[number]) ?? 0;
  }
  if (offset !== output.length) throw new Error('Normalized columnar index length calculation failed.');
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
  const sparklineRows:number[][]|undefined=header.sparklinePoints===undefined?undefined:Array.from({length:count},()=>[]);
  if(header.sparklinePoints!==undefined){if(!Number.isInteger(header.sparklinePoints)||header.sparklinePoints<2||header.sparklinePoints>128)throw new Error('Columnar sparkline shape is invalid.');const sparklineBytes=count*header.sparklinePoints*2;if(offset+sparklineBytes>bytes.byteLength)throw new Error('Columnar sparkline section is truncated.');for(let fundIndex=0;fundIndex<count;fundIndex++){let hasValue=false;const values=sparklineRows![fundIndex]!;for(let point=0;point<header.sparklinePoints;point++){const value=view.getUint16(offset,true);offset+=2;if(value===0xffff)values.push(Number.NaN);else{values.push(value/0xfffe);hasValue=true;}}if(!hasValue)sparklineRows![fundIndex]=[];}}
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
      ...(sparklineRows?.[index]?.length?{sparkline:sparklineRows[index]!.map(value=>Number.isFinite(value)?value:0)}:{}),
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
