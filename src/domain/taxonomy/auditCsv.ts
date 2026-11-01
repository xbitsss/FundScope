import { classifyFromCategory } from './classify';
import type { AssetClass } from './assetClass';

export interface ClassificationAuditRecord { schemeCode: number; auditor: string; sidCategory: string; sidUrl: string | null; expectedClass: AssetClass; agrees: boolean; notes: string | null }
const parseRow = (line: string): string[] => { const values: string[] = []; let value = '', quoted = false; for (let index = 0; index < line.length; index++) { const char = line[index]!; if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; } else if (char === ',' && !quoted) { values.push(value); value = ''; } else value += char; } values.push(value); return values.map(item => item.trim()); };
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function parseClassificationAuditCsv(text: string, funds: Array<{ code: number; assetClass: AssetClass }> = []): ClassificationAuditRecord[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()); if (lines.length < 2) return [];
  const headers = parseRow(lines[0]!).map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const at = (...keys: string[]) => headers.findIndex(value => keys.includes(value));
  const codeIndex = at('scheme_code', 'amfi_scheme_code'); const categoryIndex = at('sid_category'); const urlIndex = at('sid_url'); const classIndex = at('expected_class'); const auditorIndex = at('auditor'); const notesIndex = at('notes'); const agreesIndex = at('agrees');
  if (codeIndex < 0 || categoryIndex < 0 || classIndex < 0) throw new Error('Audit CSV must include scheme_code, sid_category, and expected_class columns.');
  return lines.slice(1).flatMap(line => { const row = parseRow(line); const schemeCode = Number(row[codeIndex]); const sidCategory = row[categoryIndex] ?? ''; const expected = (row[classIndex] ?? '').toLowerCase(); if (!Number.isInteger(schemeCode) || schemeCode <= 0 || !sidCategory || !['equity','debt','hybrid','liquid','other'].includes(expected)) return []; const current = funds.find(fund=>fund.code===schemeCode);const inferred = classifyFromCategory({ categoryRaw: sidCategory }).assetClass; const agrees = agreesIndex >= 0 && row[agreesIndex] ? /^(true|1|yes)$/i.test(row[agreesIndex]!) : current?current.assetClass===expected:inferred===expected; return [{ schemeCode, auditor: row[auditorIndex] || 'manual-audit', sidCategory, sidUrl: row[urlIndex] || null, expectedClass: expected as AssetClass, agrees, notes: row[notesIndex] || null }]; });
}
export function renderClassificationAuditSample(rows: Array<{ code: number; category: string; name: string; assetClass: AssetClass; classRuleId: string; classStatus?: string; classDetail?: { s2?: { categoryRaw: string }; s3?: { categoryRaw: string } } }>): string {
  const columns = ['scheme_code','scheme_name','s1_category','s2_category','s3_category','current_class','sid_category','sid_url','expected_class','agrees','notes'];
  return [columns.join(','), ...rows.map(row => [String(row.code),row.name,row.category,row.classDetail?.s2?.categoryRaw ?? '',row.classDetail?.s3?.categoryRaw ?? '',row.assetClass,'','','','',''].map(quote).join(','))].join('\r\n');
}
