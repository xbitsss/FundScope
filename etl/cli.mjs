import { webcrypto } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv, redactedEnvSummary } from '../src/config/env.ts';
import { NodeSqliteRepository } from '../src/adapters/node/NodeSqliteRepository.mjs';
import { parseAmfiNavAllFile, parsedAmfiNavToFunds } from '../src/domain/parse/amfi.ts';
import { parseMfapiHistory } from '../src/domain/parse/mfapi.ts';
import { computeMetricBundle, applyLocalMetricBundle } from '../src/domain/metrics/compute.ts';
import { applyRelativeMetrics } from '../src/domain/metrics/relative.ts';
import { markMissingDisclosureMetrics, parseAmfiAverageAumRows, parseDisclosureCsv, applyDisclosures } from '../src/adapters/amfi_disclosures.ts';
import { parseSchemeName } from '../src/domain/parse/schemeName.ts';
import { previousConflictFrom, reconcileClassification } from '../src/domain/taxonomy/consensus.ts';
import { applySebiHoldingHeuristics } from '../src/domain/disclosures/sebiHeuristics.ts';
import { benchmarkConfig } from '../src/config/benchmarks.ts';
import { decodeUtf8, decryptSnapshotFile, encodeUtf8, gunzipBytes, gzipBytes, encryptSnapshotFile, deriveSnapshotKey, randomBytes, toBase64, sha256Hex } from '../src/adapters/crypto/snapshotCrypto.ts';

globalThis.crypto ??= webcrypto;
const env = parseEnv();
const root = process.cwd();
const dataDir = resolve(root, env.DATA_DIR);
const dbPath = join(dataDir, 'fundscope.db');
const snapshotDir = join(dataDir, 'snapshot');
const runStarted = Date.now();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const logger = (message) => console.log(`[FundScope ETL ${new Date().toISOString()}] ${message}`);
const fail = (message) => { throw new Error(message); };
function runTar(args, cwd, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('tar', args, { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore', windowsHide: true });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`tar exited with status ${code}${stderr ? `: ${stderr.trim().slice(0, 250)}` : ''}.`)));
  });
}

for (const line of redactedEnvSummary(env)) logger(line);
await mkdir(dataDir, { recursive: true });
if (env.ENCRYPT_DATA && (!env.DATA_PASSPHRASE || env.DATA_PASSPHRASE.length < 16)) fail('Encrypted hosting requires DATA_PASSPHRASE (16+ characters).');
const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
const visibility = env.GITHUB_REPOSITORY_VISIBILITY || (repo.toLowerCase() === 'xbitsss/fundscope' ? 'public' : undefined);
if (visibility === 'private' && process.env.ALLOW_PRIVATE_REPO !== 'true') fail('A private repository needs ALLOW_PRIVATE_REPO=true for Pages hosting.');
if (process.env.ALLOW_PRIVATE_REPO === 'true' && env.HOSTING_TARGET === 'github-pages' && visibility !== 'public') fail('Private GitHub Pages cannot be used for this free public hosting workflow.');

async function request(url, init = {}, label = 'source') {
  let lastError;
  for (let attempt = 0; attempt <= env.HTTP_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { 'User-Agent': 'FundScope-free-data-refresh/1.0', Accept: 'application/json,text/plain,*/*', ...init.headers } });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) fail(`${label} returned HTTP ${response.status}.`);
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 500 * 2 ** attempt;
      lastError = new Error(`${label} returned HTTP ${response.status}.`);
      if (attempt < env.HTTP_MAX_RETRIES) await sleep(delay);
    } catch (error) {
      lastError = error;
      if (controller.signal.aborted) lastError = new Error(`${label} timed out after ${Math.round(env.HTTP_TIMEOUT_MS / 1000)} seconds.`);
      if (attempt < env.HTTP_MAX_RETRIES) await sleep(500 * 2 ** attempt);
    } finally { clearTimeout(timer); }
  }
  throw lastError ?? new Error(`${label} failed.`);
}

async function githubApi(path, init = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) fail('GITHUB_TOKEN is required to load or publish the encrypted data release.');
  return request(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...init.headers } }, 'GitHub API');
}

async function releaseAsset(name) {
  if (!repo) return null;
  try {
    const response = await githubApi(`/repos/${repo}/releases/tags/${encodeURIComponent(env.DATA_RELEASE_TAG)}`);
    const release = await response.json();
    const asset = release.assets?.find((item) => item.name === name);
    if (!asset) return null;
    const download = await githubApi(`/repos/${repo}/releases/assets/${asset.id}`, { headers: { Accept: 'application/octet-stream' } });
    return new Uint8Array(await download.arrayBuffer());
  } catch (error) {
    if (String(error).includes('HTTP 404')) return null;
    throw error;
  }
}

async function pullDatabase() {
  const metadataBytes = await releaseAsset('fundscope.db.json');
  const encrypted = await releaseAsset('fundscope.db.enc');
  const previousMetadataBytes = await releaseAsset('fundscope.db.prev.json');
  const previousEncrypted = await releaseAsset('fundscope.db.prev.enc');
  for (const [label, metadataBytesCandidate, encryptedCandidate] of [
    ['current', metadataBytes, encrypted], ['previous', previousMetadataBytes, previousEncrypted],
  ]) {
    if (!metadataBytesCandidate || !encryptedCandidate) continue;
    try {
      const metadata = JSON.parse(new TextDecoder().decode(metadataBytesCandidate));
      if (metadata.algorithm !== 'AES-256-GCM' || metadata.kdf !== 'PBKDF2-SHA256' || typeof metadata.salt !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.sha256)) continue;
      if (await sha256Hex(encryptedCandidate) !== metadata.sha256) continue;
      const key = await deriveSnapshotKey(env.DATA_PASSPHRASE, Uint8Array.from(Buffer.from(metadata.salt, 'base64')), metadata.iterations);
      const packed = await decryptSnapshotFile(key, 'fundscope.db.gz', encryptedCandidate);
      const compressed = await gunzipBytes(packed);
      await writeFile(dbPath, compressed);
      const checkRepo = new NodeSqliteRepository(dbPath).initialize();
      const integrity = checkRepo.integrityCheck();
      checkRepo.close();
      if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error('SQLite integrity check failed.');
      logger(`Restored encrypted database (${label} backup).`);
      return true;
    } catch (error) {
      logger(`Stored ${label} database could not be restored; trying next safe recovery path (${error instanceof Error ? error.message : 'invalid payload'}).`);
      await rm(dbPath, { force: true });
    }
  }
  if (metadataBytes || encrypted || previousMetadataBytes || previousEncrypted) {
    fail('An encrypted database asset exists but neither current nor backup data could be authenticated. Check DATA_PASSPHRASE and the Release assets; the existing data was not replaced.');
  }
  logger('No usable encrypted database release was found; initializing a new local database.');
  return false;
}

async function mapWithConcurrency(items, concurrency, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await fn(items[current], current);
      if (env.HTTP_INTERVAL_MS) await sleep(env.HTTP_INTERVAL_MS);
    }
  });
  await Promise.all(workers);
}

function mergeCatalog(previous, incoming) {
  const prior = new Map(previous.map((fund) => [fund.code, fund]));
  return incoming.map((fund) => {
    const saved = prior.get(fund.code);
    if (!saved) return { ...fund, history: [] };
    const history = [...(saved.history ?? [])];
    if (!history.some((point) => point.date === fund.navDate)) history.push({ date: fund.navDate, nav: fund.nav });
    history.sort((a, b) => a.date - b.date);
    const parsed = parseSchemeName(fund.name, fund.plan, fund.option);
    const classification = reconcileClassification({
      s1: { categoryRaw: fund.category, headerRaw: fund.headerRaw, observedAt: fund.navDate * 86_400_000 },
      s2: saved.classDetail?.s2 ? { categoryRaw: saved.classDetail.s2.categoryRaw, observedAt: saved.classDetail.s2.observedAt } : undefined,
      s3: saved.classDetail?.s3 ? { categoryRaw: saved.classDetail.s3.categoryRaw, observedAt: saved.classDetail.s3.observedAt } : undefined,
      schemeName: fund.name,
      evaluatedAt: Date.now(),
      previousConflict: previousConflictFrom(saved.classDetail, saved.classStatus),
      previousReview: saved.classDetail?.review,
    });
    const result = {
      ...fund,
      assetClass: classification.assetClass,
      classRuleId: classification.ruleId,
      classStatus: classification.status,
      classDetail: classification.detail,
      subCategory: classification.subCategory,
      plan: saved.plan !== 'Unknown' ? saved.plan : parsed.plan,
      option: saved.option !== 'Unknown' ? saved.option : parsed.option,
      history,
      historyFetchedAt: saved.historyFetchedAt,
      metricsNavAsOf: saved.metricsNavAsOf,
      metrics: { ...saved.metrics },
      metricReasons: { ...saved.metricReasons },
      metricReasonDetails: { ...saved.metricReasonDetails },
      metricFlags: { ...saved.metricFlags },
      metricProvenance: { ...saved.metricProvenance },
      metricAsOf: { ...saved.metricAsOf },
      classStatus: saved.classStatus && saved.category === fund.category ? saved.classStatus : fund.classStatus,
      classDetail: saved.classStatus && saved.category === fund.category ? saved.classDetail : fund.classDetail,
    };
    return result;
  });
}

async function fetchHistory(code) {
  const response = await request(`https://api.mfapi.in/mf/${code}`, {}, `MFapi history ${code}`);
  return parseMfapiHistory(await response.json(), code);
}

function parsePeriodEnd(period) {
  const match = /([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})/.exec(period);
  if (!match) return null;
  const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  const month = months[match[2].toLowerCase()];
  return month === undefined ? null : Math.floor(Date.UTC(Number(match[3]), month + 1, 0) / 86_400_000);
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function disclosureName(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function terBase(value) { return disclosureName(value).replace(/\b(?:direct|regular) plan\b.*$/, '').replace(/\b(?:growth|idcw|dividend payout|dividend reinvestment|bonus)\b(?: option)?$/, '').trim(); }

async function ingestAum(funds) {
  const rootUrl = 'https://www.amfiindia.com/api/average-aum-schemewise';
  const base = `${rootUrl}?strType=Typewise&MF_ID=0`;
  const yearPayload = await (await request(base, {}, 'AMFI AAUM years')).json();
  const firstYear = object(yearPayload.data?.[0]);
  if (firstYear?.id === undefined) fail('AMFI AAUM financial-year list is malformed.');
  const periodPayload = await (await request(`${rootUrl}?fyId=${encodeURIComponent(firstYear.id)}&strType=Typewise&MF_ID=0`, {}, 'AMFI AAUM periods')).json();
  const period = object(object(periodPayload.data)?.periods?.[0]);
  if (period?.id === undefined || typeof period.period !== 'string') fail('AMFI AAUM period list is malformed.');
  const asOf = parsePeriodEnd(period.period);
  if (asOf === null) fail(`AMFI AAUM reporting period is not recognized (${period.period}).`);
  const report = await (await request(`${rootUrl}?fyId=${encodeURIComponent(firstYear.id)}&periodId=${encodeURIComponent(period.id)}&strType=Typewise&MF_ID=0`, {}, 'AMFI AAUM report')).json();
  const records = parseAmfiAverageAumRows(report, asOf);
  if (!records.length) fail('AMFI AAUM report did not include scheme-code keyed values.');
  return { funds: applyDisclosures(funds, records), records: records.length, period: period.period };
}

async function ingestTer(funds) {
  const month = `${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-${new Date().getUTCFullYear()}`;
  const houseRows = await (await request('https://www.amfiindia.com/api/populate-mf', {}, 'AMFI AMC list')).json();
  if (!Array.isArray(houseRows)) fail('AMFI AMC list is malformed.');
  const wanted = new Set(funds.map((fund) => disclosureName(fund.amc)));
  const houses = houseRows.flatMap((value) => { const row = object(value); return row && typeof row.mfId === 'string' && typeof row.mfName === 'string' && wanted.has(disclosureName(row.mfName)) ? [{ mfId: row.mfId, mfName: row.mfName }] : []; });
  if (!houses.length) fail('AMFI AMC list did not match the local fund catalogue.');
  const records = new Map();
  const classifications = new Map();
  for (const house of houses) {
    let page = 1; let pageCount = 1; const rows = [];
    while (page <= pageCount && page <= 100) {
      const url = `https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID=${encodeURIComponent(house.mfId)}&Month=${encodeURIComponent(month)}&strCat=-1&strType=1&page=${page}&pageSize=100`;
      const payload = object(await (await request(url, {}, 'AMFI TER')).json());
      if (!Array.isArray(payload?.data)) fail(`AMFI TER data is malformed for ${house.mfName}.`);
      rows.push(...payload.data);
      const pageInfo = object(payload.meta); const count = Number(pageInfo?.pageCount);
      if (Number.isInteger(count) && count > 0) pageCount = count;
      page++;
      if (page <= pageCount) await sleep(Math.max(250, env.HTTP_INTERVAL_MS));
    }
    if (page <= pageCount) fail(`AMFI TER pagination exceeded the safety limit for ${house.mfName}.`);
    const terRows = new Map();
    for (const row of rows) if (typeof row?.Scheme_Name === 'string' && typeof row?.TER_Date === 'string') {
      const key = terBase(row.Scheme_Name); const existing = terRows.get(key);
      if (!existing || row.TER_Date > existing.TER_Date) terRows.set(key, row);
    }
    const fundsByName = new Map();
    for (const fund of funds) if (disclosureName(fund.amc) === disclosureName(house.mfName)) {
      const key = terBase(fund.name); fundsByName.set(key, [...(fundsByName.get(key) ?? []), fund]);
    }
    for (const [name, row] of terRows) {
      const matches = fundsByName.get(name) ?? [];
      if (!matches.length || new Set(matches.map((fund) => fund.subCategory)).size > 1) continue;
      const asOf = Math.floor(Date.parse(row.TER_Date) / 86_400_000);
      if (!Number.isFinite(asOf)) continue;
      for (const fund of matches) {
        const raw = fund.plan === 'Direct' ? row.D_TER : fund.plan === 'Regular' ? row.R_TER : undefined;
        const terPct = Number(raw);
        if (raw != null && String(raw).trim() && Number.isFinite(terPct) && terPct >= 0 && terPct <= 20) records.set(fund.code, { schemeCode: fund.code, terPct, asOf, source: 'AMFI_DISCLOSURE' });
        if (typeof row.SchemeCat_Desc === 'string' && row.SchemeCat_Desc.trim()) classifications.set(fund.code, { categoryRaw: row.SchemeCat_Desc.trim(), observedAt: asOf * 86_400_000 });
      }
    }
  }
  const classified = funds.map((fund) => {
    const signal = classifications.get(fund.code);
    if (!signal) return fund;
    const consensus = reconcileClassification({
      s1: { categoryRaw: fund.category, headerRaw: fund.headerRaw, observedAt: fund.classDetail?.s1.observedAt ?? fund.navDate * 86_400_000 },
      s2: fund.classDetail?.s2 ? { categoryRaw: fund.classDetail.s2.categoryRaw, observedAt: fund.classDetail.s2.observedAt } : undefined,
      s3: signal,
      schemeName: fund.name,
      evaluatedAt: Date.now(),
      previousConflict: previousConflictFrom(fund.classDetail, fund.classStatus),
      previousReview: fund.classDetail?.review,
    });
    return { ...fund, assetClass: consensus.assetClass, classRuleId: consensus.ruleId, classStatus: consensus.status, classDetail: consensus.detail, subCategory: consensus.subCategory };
  });
  return { funds: applyDisclosures(classified, [...records.values()]), records: records.size, month };
}

async function applyLocalOverrides(funds) {
  const directory = join(root, 'config', 'local_overrides');
  let names = [];
  try { names = await readdir(directory); } catch { return funds; }
  let updated = funds;
  const byCode = new Set(funds.map((fund) => fund.code));
  for (const name of names.filter((item) => item.toLowerCase().endsWith('.csv')).sort()) {
    const rows = parseDisclosureCsv(await readFile(join(directory, name), 'utf8'), 'LOCAL_OVERRIDE').filter((row) => byCode.has(row.schemeCode));
    updated = applyDisclosures(updated, rows);
    logger(`Applied ${rows.length} code-matched override rows from ${basename(name)}.`);
  }
  return updated;
}

function compositeHistory(components) {
  if (components.length < 2 || Math.abs(components.reduce((sum, item) => sum + item.weight, 0) - 1) > 1e-9) return [];
  const start = Math.max(...components.map((item) => item.history[0]?.date ?? Infinity));
  const end = Math.min(...components.map((item) => item.history.at(-1)?.date ?? -Infinity));
  if (!Number.isFinite(start) || start >= end) return [];
  const lookups = components.map((item) => new Map(item.history.map((point) => [point.date, point.nav])));
  const dates = [...lookups[0].keys()].filter((date) => date >= start && date <= end && lookups.slice(1).every((lookup) => lookup.has(date))).sort((a, b) => a - b);
  if (dates.length < 2) return [];
  const result = [{ date: dates[0], nav: 100 }]; let nav = 100;
  for (let index = 1; index < dates.length; index++) {
    const before = dates[index - 1]; const after = dates[index];
    if (after - before > 7) continue;
    let dailyReturn = 0;
    for (let component = 0; component < components.length; component++) {
      const oldValue = lookups[component].get(before); const newValue = lookups[component].get(after);
      if (!oldValue || !newValue) return [];
      dailyReturn += components[component].weight * (newValue / oldValue - 1);
    }
    nav *= 1 + dailyReturn;
    result.push({ date: after, nav });
  }
  return result;
}

async function loadVerifiedBenchmarkSeries(database) {
  const seriesById = {};
  if (!benchmarkConfig) return seriesById;
  const proxies = benchmarkConfig.benchmarks.filter((item) => item.kind === 'proxy' && item.status === 'verified' && item.scheme_code);
  await mapWithConcurrency(proxies, env.HTTP_CONCURRENCY, async (benchmark) => {
    const current = database.getBenchmarkSeries(benchmark.scheme_code);
    if (current?.history?.length && Date.now() - current.fetchedAt < benchmarkConfig.max_series_age_days * 86_400_000) return;
    try {
      const history = await fetchHistory(benchmark.scheme_code);
      database.saveBenchmarkSeries({ schemeCode: benchmark.scheme_code, schemeName: history.schemeName, fetchedAt: Date.now(), history: history.history });
    } catch (error) {
      logger(`Verified proxy ${benchmark.id} could not refresh; cached data will be used if available (${error instanceof Error ? error.message : 'request failed'}).`);
    }
  });
  for (const benchmark of benchmarkConfig.benchmarks) {
    let history = [];
    let fetchedAt = 0;
    if (benchmark.kind === 'proxy' && benchmark.status === 'verified' && benchmark.scheme_code) {
      const series = database.getBenchmarkSeries(benchmark.scheme_code);
      history = series?.history ?? [];
      fetchedAt = series?.fetchedAt ?? 0;
    } else if (benchmark.kind === 'composite' && benchmark.status === 'verified') {
      const components = benchmark.components.flatMap((component) => {
        const definition = benchmarkConfig.benchmarks.find((item) => item.id === component.benchmark_id);
        if (definition?.kind !== 'proxy' || definition.status !== 'verified' || !definition.scheme_code) return [];
        const series = database.getBenchmarkSeries(definition.scheme_code);
        return series?.history?.length ? [{ history: series.history, fetchedAt: series.fetchedAt, weight: component.weight }] : [];
      });
      if (components.length === benchmark.components.length) {
        history = compositeHistory(components);
        fetchedAt = Math.min(...components.map((item) => item.fetchedAt));
      }
    }
    if (history.length) seriesById[benchmark.id] = { benchmarkId: benchmark.id, displayName: benchmark.display_name, assetClass: benchmark.asset_class, kind: benchmark.kind, history, fetchedAt };
  }
  return seriesById;
}

async function buildSnapshot(funds, sourceStatus, disclosures) {
  await rm(snapshotDir, { recursive: true, force: true });
  const dataRoot = join(snapshotDir, 'data');
  const navDir = join(dataRoot, 'nav');
  await mkdir(navDir, { recursive: true });
  const salt = randomBytes(16);
  const iterations = 600_000;
  const key = await deriveSnapshotKey(env.DATA_PASSPHRASE, salt, iterations);
  const refs = {};
  async function writeEncrypted(path, text) {
    const compressed = await gzipBytes(encodeUtf8(text));
    const encrypted = await encryptSnapshotFile(key, path, compressed);
    const localPath = join(snapshotDir, path);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, encrypted);
    return { path, sha256: await sha256Hex(encrypted), encryptedBytes: encrypted.byteLength, compressedBytes: compressed.byteLength, plaintextBytes: Buffer.byteLength(text) };
  }
  const canaryPath = 'data/canary.enc';
  const canaryEncrypted = await encryptSnapshotFile(key, canaryPath, encodeUtf8('FundScope snapshot canary:v1'));
  await writeFile(join(snapshotDir, canaryPath), canaryEncrypted);
  const canary = { path: canaryPath, sha256: await sha256Hex(canaryEncrypted), encryptedBytes: canaryEncrypted.byteLength, compressedBytes: 0, plaintextBytes: 28, plaintext: 'FundScope snapshot canary:v1' };
  const fundsWithoutHistory = funds.map(({ history, ...fund }) => ({ ...fund, history: [] }));
  const index = await writeEncrypted('data/index.enc', JSON.stringify(fundsWithoutHistory));
  for (let start = 0; start < funds.length; start += 100) {
    for (const fund of funds.slice(start, start + 100)) {
      if (!fund.history?.length) continue;
      const path = `data/nav/${fund.code}.enc`;
      refs[String(fund.code)] = await writeEncrypted(path, JSON.stringify(fund.history));
    }
    if (start && start % 1000 === 0) logger(`Encrypted NAV packs: ${Math.min(start + 100, funds.length).toLocaleString('en-IN')} / ${funds.length.toLocaleString('en-IN')}`);
  }
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    data_as_of: sourceStatus.dataAsOf,
    fund_count: funds.length,
    history_count: Object.keys(refs).length,
    disclosures,
    encryption: { algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), canary },
    index,
    histories: refs,
  };
  await writeFile(join(dataRoot, 'manifest.json'), JSON.stringify(manifest));
  const archivePath = join(dataDir, 'snapshot.tar.gz');
  await runTar(['-czf', archivePath, 'data'], snapshotDir);
  const archiveSize = (await stat(archivePath)).size;
  const siteBytes = await directorySize(dataRoot);
  const siteLimit = env.MAX_SITE_SIZE_MB * 1024 * 1024;
  if (siteBytes > siteLimit) fail(`Static snapshot is ${(siteBytes / 1048576).toFixed(1)} MiB; MAX_SITE_SIZE_MB is ${env.MAX_SITE_SIZE_MB}.`);
  logger(`Snapshot prepared: ${funds.length.toLocaleString('en-IN')} funds, ${Object.keys(refs).length.toLocaleString('en-IN')} histories, ${(siteBytes / 1048576).toFixed(1)} MiB expanded, ${(archiveSize / 1048576).toFixed(1)} MiB archive.`);
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

async function encryptDatabase() {
  const rawSize = (await stat(dbPath)).size;
  if (rawSize > env.MAX_DB_SIZE_MB * 1024 * 1024) fail(`SQLite database exceeds MAX_DB_SIZE_MB (${env.MAX_DB_SIZE_MB}).`);
  const compressed = new Uint8Array(await (await import('node:zlib')).gzipSync(await readFile(dbPath), { level: 9 }));
  const salt = randomBytes(16); const iterations = 600_000;
  const key = await deriveSnapshotKey(env.DATA_PASSPHRASE, salt, iterations);
  const encrypted = await encryptSnapshotFile(key, 'fundscope.db.gz', compressed);
  const encryptedPath = join(dataDir, 'fundscope.db.enc');
  await writeFile(encryptedPath, encrypted);
  await writeFile(join(dataDir, 'fundscope.db.json'), JSON.stringify({ algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), sha256: await sha256Hex(encrypted), encryptedBytes: encrypted.length }));
  if (encrypted.byteLength > env.MAX_DB_SIZE_MB * 1024 * 1024) fail(`Encrypted database exceeds MAX_DB_SIZE_MB (${env.MAX_DB_SIZE_MB}).`);
}

async function uploadReleaseAsset(name, filePath, contentType = 'application/octet-stream') {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token || !repo) fail('Publishing release data needs GITHUB_TOKEN and GITHUB_REPOSITORY.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let releaseResponse;
  try { releaseResponse = await githubApi(`/repos/${repo}/releases/tags/${encodeURIComponent(env.DATA_RELEASE_TAG)}`); }
  catch (error) {
    if (!String(error).includes('HTTP 404')) throw error;
    releaseResponse = await githubApi(`/repos/${repo}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: env.DATA_RELEASE_TAG, name: 'FundScope encrypted data', body: 'Encrypted database and static snapshot artifacts. Generated by FundScope nightly workflow.', draft: false, prerelease: true }) });
  }
  const release = await releaseResponse.json();
  for (const asset of release.assets ?? []) if (asset.name === name) await githubApi(`/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' });
  const uploadUrl = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`;
  const body = await readFile(filePath);
  const upload = await fetch(uploadUrl, { method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'Content-Length': String(body.byteLength) }, body });
  if (!upload.ok) fail(`Could not upload ${name} to the data release (HTTP ${upload.status}).`);
}

async function publishRelease() {
  const oldDb = await releaseAsset('fundscope.db.enc');
  const oldDbJson = await releaseAsset('fundscope.db.json');
  if (oldDb && oldDbJson) {
    await writeFile(join(dataDir, 'fundscope.db.prev.enc'), oldDb);
    await writeFile(join(dataDir, 'fundscope.db.prev.json'), oldDbJson);
    await uploadReleaseAsset('fundscope.db.prev.enc', join(dataDir, 'fundscope.db.prev.enc'));
    await uploadReleaseAsset('fundscope.db.prev.json', join(dataDir, 'fundscope.db.prev.json'), 'application/json');
  }
  await uploadReleaseAsset('fundscope.db.enc', join(dataDir, 'fundscope.db.enc'));
  await uploadReleaseAsset('fundscope.db.json', join(dataDir, 'fundscope.db.json'), 'application/json');
  await uploadReleaseAsset('snapshot.tar.gz', join(dataDir, 'snapshot.tar.gz'), 'application/gzip');
}

async function main() {
  if (process.argv.includes('--restore-snapshot')) {
    const snapshotArchive = join(dataDir, 'snapshot.tar.gz');
    const bytes = await releaseAsset('snapshot.tar.gz');
    if (!bytes) fail('No previously published snapshot exists; run the full ETL once first.');
    await writeFile(snapshotArchive, bytes);
    await rm(snapshotDir, { recursive: true, force: true });
    await mkdir(snapshotDir, { recursive: true });
    const listing = await runTar(['-tvzf', snapshotArchive], dataDir, true);
    for (const line of listing.split(/\r?\n/).filter(Boolean)) {
      const type = line[0];
      const archivePath = line.trim().split(/\s+/).at(-1)?.replaceAll('\\', '/') ?? '';
      const segments = archivePath.split('/');
      if (!['-', 'd'].includes(type) || (!archivePath.startsWith('data/') && archivePath !== 'data') || segments.some((segment) => segment === '..' || segment === '.')) {
        fail('The stored snapshot archive contains an unsafe path or file type.');
      }
    }
    await runTar(['-xzf', snapshotArchive, '--no-same-owner'], snapshotDir);
    logger('Restored the latest snapshot for a code-only Pages deployment.');
    return;
  }

  await pullDatabase();
  const database = new NodeSqliteRepository(dbPath).initialize();
  try {
    let funds = database.getFunds();
    logger(`Database loaded: ${funds.length.toLocaleString('en-IN')} schemes.`);
    const response = await request('https://portal.amfiindia.com/spages/NAVAll.txt', {}, 'AMFI NAVAll');
    const parsed = parseAmfiNavAllFile(await response.text());
    if (!parsed.diagnostics.shapeValid || !parsed.schemes.length) fail(`AMFI catalog shape check failed (${parsed.diagnostics.parsedRowCount}/${parsed.diagnostics.candidateRowCount}).`);
    funds = mergeCatalog(funds, parsedAmfiNavToFunds(parsed));
    database.saveFunds(funds);
    database.saveSchemeMasterRows(parsed.schemes, funds);
    const asOf = Math.max(...funds.map((fund) => fund.navDate));
    const fetchedAt = Date.now();
    database.setSourceState('amfi_nav', { fetchedAt, dataAsOf: asOf * 86_400_000, status: 'ok', detail: `${funds.length.toLocaleString('en-IN')} schemes loaded from AMFI NAVAll.` });
    logger(`AMFI catalog refreshed: ${funds.length.toLocaleString('en-IN')} schemes, as of ${new Date(asOf * 86_400_000).toISOString().slice(0, 10)}.`);

    const todo = funds.filter((fund) => !fund.history?.length || !fund.historyFetchedAt || fetchedAt - fund.historyFetchedAt > 30 * 86_400_000)
      .sort((a, b) => Number(!(a.structure === 'open' && a.plan === 'Direct' && /growth/i.test(a.option) && !/bonus/i.test(a.option))) - Number(!(b.structure === 'open' && b.plan === 'Direct' && /growth/i.test(b.option) && !/bonus/i.test(b.option))) || Number(Boolean(a.history?.length)) - Number(Boolean(b.history?.length)) || (a.historyFetchedAt ?? 0) - (b.historyFetchedAt ?? 0) || b.navDate - a.navDate)
      .slice(0, env.ETL_BATCH_SIZE);
    let complete = 0; let failed = 0;
    const updates = new Map();
    await mapWithConcurrency(todo, env.HTTP_CONCURRENCY, async (fund) => {
      if ((Date.now() - runStarted) > env.ETL_TIME_BUDGET_MINUTES * 60_000) return;
      try {
        const result = await fetchHistory(fund.code);
        const latestNav = fund.history.at(-1);
        const historyByDate = new Map((fund.history ?? []).map((point) => [point.date, point.nav]));
        for (const point of result.history) historyByDate.set(point.date, point.nav);
        if (fund.navDate >= (latestNav?.date ?? 0)) historyByDate.set(fund.navDate, fund.nav);
        const history = [...historyByDate].sort(([left], [right]) => left - right).map(([date, nav]) => ({ date, nav }));
        const historyFetchedAt = Date.now();
        const classification = result.schemeCategory ? reconcileClassification({
          s1: { categoryRaw: fund.category, headerRaw: fund.headerRaw, observedAt: fund.classDetail?.s1.observedAt ?? fund.navDate * 86_400_000 },
          s2: { categoryRaw: result.schemeCategory, observedAt: historyFetchedAt },
          s3: fund.classDetail?.s3 ? { categoryRaw: fund.classDetail.s3.categoryRaw, observedAt: fund.classDetail.s3.observedAt } : undefined,
          schemeName: fund.name,
          evaluatedAt: historyFetchedAt,
          previousConflict: previousConflictFrom(fund.classDetail, fund.classStatus),
          previousReview: fund.classDetail?.review,
        }) : null;
        updates.set(fund.code, { ...fund, history, historyFetchedAt, ...(classification ? { assetClass: classification.assetClass, classRuleId: classification.ruleId, classStatus: classification.status, classDetail: classification.detail, subCategory: classification.subCategory } : {}) });
      } catch (error) {
        failed++;
        logger(`History fetch failed for scheme ${fund.code}: ${error instanceof Error ? error.message : 'request failed'}`);
      }
      complete++;
      if (complete % 100 === 0) logger(`History batch: ${complete.toLocaleString('en-IN')} / ${todo.length.toLocaleString('en-IN')} processed, ${updates.size.toLocaleString('en-IN')} updated.`);
    });
    funds = funds.map((fund) => updates.get(fund.code) ?? fund);
    if (updates.size) database.saveFunds([...updates.values()]);
    logger(`History batch complete: ${updates.size.toLocaleString('en-IN')} loaded, ${failed.toLocaleString('en-IN')} failed, ${funds.filter((fund) => fund.history?.length).length.toLocaleString('en-IN')} total schemes with NAV history.`);

    let aumMessage = 'AAUM refresh unavailable'; let terMessage = 'TER refresh unavailable';
    try { const aum = await ingestAum(funds); funds = aum.funds; aumMessage = `${aum.period} · ${aum.records.toLocaleString('en-IN')} scheme AAUM values`; logger(`AMFI AAUM: ${aumMessage}.`); }
    catch (error) { logger(`AMFI AAUM ingestion failed: ${error instanceof Error ? error.message : 'source unavailable'}`); }
    try { const ter = await ingestTer(funds); funds = ter.funds; terMessage = `${ter.month} · ${ter.records.toLocaleString('en-IN')} scheme-plan TER values`; logger(`AMFI TER: ${terMessage}.`); }
    catch (error) { logger(`AMFI TER ingestion failed: ${error instanceof Error ? error.message : 'source unavailable'}`); }
    funds = await applyLocalOverrides(funds);
    funds = funds.map((fund) => {
      const parsedName = parseSchemeName(fund.name, fund.plan, fund.option);
      const normalized = { ...fund, plan: fund.plan === 'Unknown' ? parsedName.plan : fund.plan, option: fund.option === 'Unknown' ? parsedName.option : fund.option };
      const computed = applyLocalMetricBundle(normalized, computeMetricBundle(normalized, 3, env.RISK_FREE_RATE));
      return markMissingDisclosureMetrics(applySebiHoldingHeuristics(computed));
    });
    const benchmarkSeries = await loadVerifiedBenchmarkSeries(database);
    funds = applyRelativeMetrics(funds, 3, env.RISK_FREE_RATE, benchmarkSeries);
    database.saveFunds(funds);
    const status = database.getSourceState('amfi_nav');
    database.setSourceState('amfi_disclosures', { fetchedAt: Date.now(), dataAsOf: status.dataAsOf, status: 'ok', detail: `AAUM: ${aumMessage}; TER: ${terMessage}.` });
    const integrity = database.integrityCheck();
    if (integrity.length !== 1 || integrity[0] !== 'ok') fail('SQLite integrity check failed before publishing.');
    database.close();
    await buildSnapshot(funds, status, { aum: aumMessage, ter: terMessage });
    await encryptDatabase();
    await publishRelease();
    logger(`Refresh finished in ${Math.round((Date.now() - runStarted) / 1000)} seconds.`);
  } finally {
    database.close();
  }
}

await main().catch((error) => {
  console.error(`[FundScope ETL] Failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
