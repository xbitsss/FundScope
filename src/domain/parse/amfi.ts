import type { Fund } from '../types';
import { computeMetricBundle } from '../metrics/compute';
import { parseSchemeName } from './schemeName';
import { classifyAssetClass, TAXONOMY_VERSION } from '../taxonomy/assetClass';

const monthMap: Record<string,number> = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
export function parseAmfiDate(raw: string): number | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const month = monthMap[match[2]!.toLowerCase()];
  if (month === undefined) return null;
  return Math.floor(Date.UTC(Number(match[3]), month, Number(match[1])) / 86_400_000);
}
export function parseAmfiNavAll(text: string): Fund[] {
  let category = 'Unknown'; let amc = 'Unknown';
  let structureType: Fund['structure'] = 'unknown';
  const funds = new Map<number, Fund>();
  for (const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const parts = line.split(';');
    if (parts.length !== 8) {
      const trimmed = line.trim();
      if (!trimmed || /^Scheme Code/i.test(trimmed)) continue;
      const structure = /^Open Ended Schemes\((.*)\)$/i.exec(trimmed);
      if (structure) { category = structure[1]!; structureType = 'open'; continue; }
      const other = /^(Close Ended|Interval) Schemes\((.*)\)$/i.exec(trimmed);
      if (other) { category = other[2]!; structureType = /^Close/i.test(other[1]!) ? 'close' : 'interval'; continue; }
      if (!/^(Open|Close|Interval) Ended Schemes/i.test(trimmed) && !/\d/.test(trimmed)) amc = trimmed;
      continue;
    }
    const [codeRaw, isinA, isinB, name, planRaw, optionRaw, navRaw, dateRaw] = parts;
    const code = Number(codeRaw); const nav = Number(navRaw); const date = parseAmfiDate(dateRaw ?? '');
    if (!Number.isInteger(code) || !(nav > 0) || date === null || !name?.trim()) continue;
    const parsed=parseSchemeName(name,planRaw,optionRaw);
    const plan = parsed.plan;
    const option = optionRaw?.trim() || parsed.option;
    const classification=classifyAssetClass({categoryRaw:category,name:name.trim()});
    const existing = funds.get(code);
    const fund: Fund = {code,isinGrowth:isinA && isinA!=='-' ? isinA : null,isinReinvestment:isinB && isinB!=='-' ? isinB : null,name:name.trim(),amc,category,assetClass:classification.assetClass,classRuleId:classification.ruleId,taxonomyVersion:TAXONOMY_VERSION,subCategory:classification.subCategory,structure:structureType,plan,option,nav,navDate:date,history:existing?.history ?? [],metrics:existing?.metrics ?? {}};
    if(/growth/i.test(option) && !/bonus/i.test(option)){const bundle=computeMetricBundle(fund);fund.metrics=bundle.metrics;fund.metricReasons=bundle.reasons;}else fund.metrics = {};
    funds.set(code,fund);
  }
  return [...funds.values()];
}
