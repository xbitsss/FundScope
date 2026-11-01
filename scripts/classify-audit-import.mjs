import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCategory, loadTaxonomyConfig, parseArgs, parseCsv } from './lib/taxonomy-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input) {
  console.log('Usage: pnpm classify:audit-import --input <completed-audit.csv> [--output <audit-report.json>]');
  console.log('Validates and scores SID audit rows. Import the completed CSV in FundScope > Classification to persist rows into local SQLite/IndexedDB.');
  process.exit(args.help ? 0 : 2);
}
const { categoryMap, passive } = await loadTaxonomyConfig(root);
const rows = parseCsv(await readFile(resolve(String(args.input)), 'utf8'));
if (rows.length < 2) throw new Error('Audit CSV contains no data rows.');
const headers = rows.shift().map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
const index = (...names) => headers.findIndex(value => names.includes(value));
const codeAt = index('scheme_code', 'amfi_scheme_code');
const categoryAt = index('sid_category');
const nameAt = index('scheme_name');
const currentAt = index('current_class');
const expectedAt = index('expected_class');
const urlAt = index('sid_url');
const notesAt = index('notes');
if ([codeAt, categoryAt, expectedAt].some(value => value < 0)) throw new Error('CSV must include scheme_code, sid_category, and expected_class columns.');
const invalid = [];
const audited = [];
for (const row of rows) {
  const schemeCode = Number(row[codeAt]);
  const sidCategory = row[categoryAt] ?? '';
  const expectedClass = (row[expectedAt] ?? '').toLowerCase();
  if (!Number.isInteger(schemeCode) || schemeCode <= 0 || !sidCategory || !['equity','debt','hybrid','liquid','other'].includes(expectedClass)) {
    invalid.push({ schemeCode: row[codeAt] ?? '', reason: 'Invalid or incomplete audit row' });
    continue;
  }
  const predicted = classifyCategory(sidCategory, row[nameAt] ?? '', { categoryMap, passive });
  const currentClass = currentAt >= 0 ? (row[currentAt] ?? '').toLowerCase() : '';
  const comparedClass = ['equity','debt','hybrid','liquid','other'].includes(currentClass) ? currentClass : predicted.assetClass;
  audited.push({ schemeCode, sidCategory, sidUrl: row[urlAt] || null, expectedClass, comparedClass, comparedUsing: comparedClass === currentClass ? 'current_class' : 'sid_category_rule', ruleId: predicted.ruleId, agrees: comparedClass === expectedClass, notes: row[notesAt] || null });
}
const report = { auditCount: audited.length, agreements: audited.filter(row => row.agrees).length, disagreements: audited.filter(row => !row.agrees).length, invalidCount: invalid.length, invalid, rows: audited };
const outputPath = resolve(String(args.output ?? 'fundscope-classification-audit-report.json'));
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`Audited ${report.auditCount} rows: ${report.agreements} agree, ${report.disagreements} disagree, ${report.invalidCount} invalid. Report: ${outputPath}`);
