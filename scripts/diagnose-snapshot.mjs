import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const DEFAULT_BASE = 'https://xbitsss.github.io/FundScope/';
const DAY = 86_400_000;
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const localDir = dirIndex >= 0 ? resolve(args[dirIndex + 1] ?? '') : null;
const baseUrl = process.env.SNAPSHOT_BASE_URL ?? DEFAULT_BASE;
const date = new Date().toISOString().slice(0, 10);
const destination = join('docs', `DIAGNOSIS_${date}.md`);

function histogram(items, read) {
  const counts = new Map();
  for (const item of items) {
    const value = String(read(item) ?? '').trim() || '(empty)';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function table(rows) {
  return rows.map(([key, value]) => `| ${key} | ${value} |`).join('\n');
}

async function bytesFor(path) {
  if (localDir) return new Uint8Array(await readFile(join(localDir, path.replace(/^data\//, ''))));
  const response = await fetch(new URL(path, baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function manifestFor() {
  if (localDir) return JSON.parse(await readFile(join(localDir, 'manifest.json'), 'utf8'));
  const response = await fetch(new URL('data/manifest.json', baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);
  return response.json();
}

function decrypt(bytes, key, path) {
  const iv = bytes.subarray(0, 12);
  const ciphertext = bytes.subarray(12, bytes.length - 16);
  const tag = bytes.subarray(bytes.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(`fundscope-snapshot:1:${path}`));
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

const manifest = await manifestFor();
const indexEncrypted = await bytesFor(manifest.index.path);
const hash = createHash('sha256').update(indexEncrypted).digest('hex');
if (hash !== manifest.index.sha256 || indexEncrypted.byteLength !== manifest.index.encryptedBytes) throw new Error('Index integrity check failed during diagnosis.');

let funds = [];
let decryptionNote = 'Set DATA_PASSPHRASE to include index histograms and decrypted NAV samples.';
let navSamples = [];
if (process.env.DATA_PASSPHRASE) {
  const key = pbkdf2Sync(process.env.DATA_PASSPHRASE, Buffer.from(manifest.encryption.salt, 'base64'), manifest.encryption.iterations, 32, 'sha256');
  funds = JSON.parse(gunzipSync(decrypt(indexEncrypted, key, manifest.index.path)).toString('utf8'));
  const refs = Object.entries(manifest.histories).slice(0, 3);
  navSamples = await Promise.all(refs.map(async ([code, ref]) => {
    const bytes = await bytesFor(ref.path);
    const points = JSON.parse(gunzipSync(decrypt(bytes, key, ref.path)).toString('utf8'));
    return [code, `${points.at(0)?.date ?? '—'} → ${points.at(-1)?.date ?? '—'} · ${points.length} points · ${bytes.byteLength.toLocaleString('en-IN')} bytes`];
  }));
  decryptionNote = 'Index and three NAV packs decrypted successfully.';
}

const historyRefs = Object.entries(manifest.histories);
const sizes = historyRefs.map(([, ref]) => ref.encryptedBytes);
const all = funds.length;
const open = funds.filter(fund => fund.structure === 'open');
const direct = open.filter(fund => fund.plan === 'Direct');
const growth = direct.filter(fund => /growth/i.test(fund.option ?? '') && !/bonus/i.test(fund.option ?? ''));
const missingRefs = funds.filter(fund => !manifest.histories[String(fund.code)]).map(fund => fund.code);
const categoryAudit = new Map();
for (const fund of funds) {
  const item = categoryAudit.get(fund.subCategory) ?? { total: 0, universe: 0 };
  item.total++;
  if (growth.includes(fund)) item.universe++;
  categoryAudit.set(fund.subCategory, item);
}
const duplicateLabels = [...categoryAudit.keys()].filter((label, index, labels) => labels.some((other, otherIndex) => otherIndex !== index && label.trim().toLocaleLowerCase() === other.trim().toLocaleLowerCase()));
const lines = [
  '# FundScope snapshot diagnosis',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Manifest',
  '',
  '| Field | Value |',
  '| --- | ---: |',
  table([
    ['Generated at', manifest.generated_at], ['Data as of', manifest.data_as_of ?? '—'], ['Funds', manifest.fund_count], ['History count', manifest.history_count], ['History refs', historyRefs.length], ['NAV p50 bytes', percentile(sizes, .5)], ['NAV p95 bytes', percentile(sizes, .95)], ['NAV max bytes', Math.max(0, ...sizes)], ['Encrypted NAV MB', (sizes.reduce((sum, value) => sum + value, 0) / 1048576).toFixed(1)],
  ]),
  '',
  '## Decryption', '', decryptionNote,
  ...(navSamples.length ? ['', '| Scheme | Sample |', '| --- | --- |', table(navSamples)] : []),
  '', '## Histograms', '',
  ...['structure', 'plan', 'option', 'assetClass', 'classStatus'].flatMap(field => ['', `### ${field}`, '', '| Value | Count |', '| --- | ---: |', table(histogram(funds, fund => fund[field]))]),
  '', '## Universe funnel', '', '| Step | Remaining | Removed |', '| --- | ---: | ---: |',
  `| All | ${all} | 0 |`, `| Open-ended | ${open.length} | ${all - open.length} |`, `| Direct | ${direct.length} | ${open.length - direct.length} |`, `| Growth non-bonus | ${growth.length} | ${direct.length - growth.length} |`,
  '', '## History coverage', '', `- All funds: ${all ? Math.round((all - missingRefs.length) / all * 1000) / 10 : 0}% referenced`, `- Direct · Growth · Open: ${growth.length ? Math.round(growth.filter(fund => manifest.histories[String(fund.code)]).length / growth.length * 1000) / 10 : 0}% referenced`, `- First 20 codes without history refs: ${missingRefs.slice(0, 20).join(', ') || 'none'}`,
  '', '## Category audit', '', '| Sub-category | Total | Direct · Growth · Open | Flag |', '| --- | ---: | ---: | --- |',
  ...[...categoryAudit.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `| ${name || '(empty)'} | ${item.total} | ${item.universe} | ${item.universe === 0 ? 'no default-universe funds' : ''} |`),
  '', `Near-duplicate labels: ${duplicateLabels.length ? duplicateLabels.join(', ') : 'none'}`,
];
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
