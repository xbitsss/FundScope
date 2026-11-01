import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvCell, parseArgs } from './lib/taxonomy-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input) {
  console.log('Usage: pnpm classify:audit-sample --input <funds.json> [--output <sample.csv>] [--count 30]');
  console.log('Input JSON may be a fund array or { "funds": [...] }. The governance screen can also download a local sample directly.');
  process.exit(args.help ? 0 : 2);
}
const inputPath = resolve(String(args.input));
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const funds = Array.isArray(input) ? input : input.funds;
if (!Array.isArray(funds)) throw new Error('Input must be a JSON array or an object containing a funds array.');
const count = Math.max(1, Math.min(500, Number(args.count ?? 30) || 30));
const chosen = new Map();
for (const fund of funds.filter(item => item.classRuleId === 'UNMAPPED' || item.classStatus === 'CONFLICT' || item.classStatus === 'CONFLICT_STALE' || item.classDetail?.flags?.some(flag => flag.startsWith('PLAUS_')) || item.assetClass === 'other')) chosen.set(Number(fund.code), fund);
const groups = new Map();
for (const fund of funds) {
  const key = `${fund.assetClass ?? 'other'}\0${fund.subCategory ?? ''}`;
  groups.set(key, [...(groups.get(key) ?? []), fund]);
}
for (const assetClass of ['equity', 'debt', 'hybrid', 'liquid', 'other']) {
  const buckets = [...groups.entries()].filter(([key]) => key.startsWith(`${assetClass}\0`)).map(([, items]) => items);
  for (let offset = 0; chosen.size < count && buckets.some(items => items[offset]); offset++) {
    for (const bucket of buckets) {
      const candidate = bucket[offset];
      if (candidate && !chosen.has(Number(candidate.code))) chosen.set(Number(candidate.code), candidate);
      if (chosen.size >= count) break;
    }
  }
}
const columns = ['scheme_code','scheme_name','s1_category','s2_category','s3_category','current_class','sid_category','sid_url','expected_class','agrees','notes'];
const output = [columns.join(','), ...[...chosen.values()].slice(0, count).map(fund => [fund.code, fund.name, fund.category, fund.classDetail?.s2?.categoryRaw ?? '', fund.classDetail?.s3?.categoryRaw ?? '', fund.assetClass ?? '', '', '', '', '', ''].map(csvCell).join(','))].join('\r\n');
const outputPath = resolve(String(args.output ?? 'fundscope-classification-audit-sample.csv'));
await writeFile(outputPath, output, 'utf8');
console.log(`Wrote ${Math.min(chosen.size, count)} stratified audit candidates to ${outputPath}`);
