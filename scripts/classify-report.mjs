import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const navUrl = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const amfiApi = 'https://www.amfiindia.com/api';
const mfapi = 'https://api.mfapi.in/mf';
const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log('Usage: pnpm classify:report [--write-fixtures] [--write-report] [--write-draft]');
  console.log('Reads the current AMFI NAVAll catalog and compares production v2 rules with the C0 proposal. Requires network access.');
  process.exit(0);
}
const shouldWriteFixtures = args.has('--write-fixtures');
const shouldWriteReport = args.has('--write-report');
const shouldWriteDraft = args.has('--write-draft');

const categoryMap = JSON.parse(await readFile(resolve(root, 'config/category-map.json'), 'utf8'));
const passiveRules = JSON.parse(await readFile(resolve(root, 'config/passive-rules.json'), 'utf8'));

function classifyWithCurrentConfig(categoryRaw, name) {
  const normalize = value => value.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').replace(/[‘’]/g, "'").replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  const lower = value => normalize(value).toLocaleLowerCase('en');
  const normalized = normalize(categoryRaw);
  const separator = normalized.indexOf(' - ');
  let family = null;
  let subCategory = normalized;
  if (separator >= 0) {
    const rawFamily = normalized.slice(0, separator);
    family = categoryMap.family_aliases.find(item => lower(item.alias) === lower(rawFamily))?.canonical ?? rawFamily;
    const rawSub = normalized.slice(separator + 3).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
    const subAlias = categoryMap.subcategory_aliases.find(item => lower(item.family) === lower(family) && lower(item.alias.replace(/\s+(?:funds?|etfs?)$/i, '')) === lower(rawSub));
    subCategory = (subAlias?.canonical ?? rawSub).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
  }
  const exact = categoryMap.exact_category_rules.find(rule => lower(rule.category) === lower(subCategory));
  if (exact) return { assetClass: exact.asset_class, ruleId: exact.id };
  const sub = categoryMap.subcategory_rules.find(rule => lower(rule.family) === lower(family ?? '') && rule.sub_categories.some(item => lower(item) === lower(subCategory)));
  if (sub) return { assetClass: sub.asset_class, ruleId: sub.id };
  const familyRule = categoryMap.family_rules.find(rule => lower(rule.family) === lower(family ?? ''));
  if (familyRule) return { assetClass: familyRule.asset_class, ruleId: familyRule.id };
  if (categoryMap.passive_families.some(item => lower(item) === lower(family ?? ''))) {
    const matched = passiveRules.rules.filter(rule => new RegExp(rule.pattern, 'i').test(name));
    const classes = [...new Set(matched.map(rule => rule.asset_class))];
    if (classes.length > 1) return { assetClass: 'other', ruleId: 'PASSIVE_AMBIGUOUS' };
    if (matched.length) return { assetClass: matched[0].asset_class, ruleId: matched[0].id };
    return { assetClass: 'other', ruleId: 'PASSIVE_UNMATCHED' };
  }
  return { assetClass: 'other', ruleId: 'UNMAPPED', acknowledged: categoryMap.acknowledged_unmapped.some(item => lower(item.category) === lower(subCategory)) };
}

function draftCategoryOutcome(categoryRaw) {
  const [familyRaw = '', ...rest] = categoryRaw.split(' - ');
  const family = familyRaw.trim().toLowerCase().replace(/\s+/g, ' ');
  const sub = rest.join(' - ').trim().replace(/\s+fund$/i, '').toLowerCase().replace(/\s+/g, ' ');
  const liquidSub = /\b(overnight|liquid|money market)\b/i.test(sub);
  if (/^equity schemes?$/.test(family)) return { assetClass: 'equity', ruleId: 'draft_equity_category' };
  if (/^debt schemes?$/.test(family) || /^income\/debt oriented schemes?$/.test(family)) return { assetClass: liquidSub ? 'liquid' : 'debt', ruleId: liquidSub ? 'draft_liquid_category' : 'draft_debt_category' };
  if (/^hybrid schemes?$/.test(family)) return { assetClass: 'hybrid', ruleId: 'draft_hybrid_category' };
  if (/^life cycle funds?$/.test(family) || /^solution oriented schemes?(?: \*\*)?$/.test(family) || /^children’s fund$/.test(family)) return { assetClass: 'other', ruleId: 'draft_multi_asset_or_legacy_quarantine' };
  if (/^(other scheme|exchange traded funds? \(etfs\)|index funds?|fund of funds scheme \(domestic\)|overseas fund of funds)$/.test(family)) return { assetClass: 'other', ruleId: 'draft_passive_name_rule_required' };
  if (/^elss$/i.test(categoryRaw.trim())) return { assetClass: 'equity', ruleId: 'draft_legacy_elss' };
  if (/^gilt$/i.test(categoryRaw.trim())) return { assetClass: 'debt', ruleId: 'draft_legacy_gilt' };
  return { assetClass: 'other', ruleId: 'UNMAPPED' };
}

const nonDomesticOrNonFund = /\b(overseas|international|global|foreign|nasdaq|hang\s*seng|gold|silver|commodity|commodities|reit|invit|real estate|s\s*&\s*p\s*(?:500|100|400|600|global|dow))\b/i;
const debtIndex = /\b(g[ -]?sec|government securities|sovereign|sdl|bond|debt|treasury|t[- ]?bill|target maturity|crisil-ibx)\b/i;
const liquidIndex = /\b(liquid|overnight|money market|1d rate)\b/i;
const equityIndex = /\b(equity|sensex|bank\s+nifty|nifty\s+(?:50|next\s+\d+|\d+|midcap|smallcap|large|bank|quality|momentum|dividend|auto|pharma|it)|bse\s+(?:sensex|top\s+\d+|total market|\d+)|nse\s+(?:\d+|\w+)|midcap|smallcap|large cap|msci india)\b/i;
function classifyPassiveCandidate(name, categoryRaw) {
  if (nonDomesticOrNonFund.test(name) || /overseas/i.test(categoryRaw)) return { assetClass: 'other', ruleId: 'PASSIVE_NON_DOMESTIC_OR_NON_EQUITY' };
  if (/\bhybrid\b/i.test(name) || / - Hybrid ETF$/i.test(categoryRaw)) return { assetClass: 'hybrid', ruleId: 'PASSIVE_EXPLICIT_HYBRID' };
  if (liquidIndex.test(name)) return { assetClass: 'liquid', ruleId: 'PASSIVE_LIQUID_NAME_CANDIDATE' };
  const debt = debtIndex.test(name);
  const equity = equityIndex.test(name);
  if (debt && equity) return { assetClass: 'other', ruleId: 'PASSIVE_AMBIGUOUS', candidates: ['debt', 'equity'] };
  if (debt) return { assetClass: 'debt', ruleId: 'PASSIVE_DEBT_NAME_CANDIDATE' };
  if (equity) return { assetClass: 'equity', ruleId: 'PASSIVE_EQUITY_NAME_CANDIDATE' };
  return { assetClass: 'other', ruleId: 'PASSIVE_UNMATCHED' };
}

function isPassiveFamily(categoryRaw) {
  const family = categoryRaw.split(' - ')[0]?.trim() ?? '';
  return /^(other scheme|exchange traded funds? \(etfs\)|index funds?|fund of funds scheme \(domestic\)|overseas fund of funds)$/i.test(family);
}

function parseNavFile(text) {
  const categories = new Map();
  const headers = new Map();
  const rows = [];
  const rejected = [];
  const seenCodes = new Set();
  const duplicateCodes = new Set();
  let categoryRaw = '';
  let headerRaw = '';
  let structure = 'unknown';
  let amc = '';
  const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    const line = raw.trim();
    if (!line || /^Scheme Code/i.test(line)) continue;
    const header = /^(Open|Close|Interval)\s+End(?:ed)?\s+Schemes?\s*\((.*)\)$/i.exec(line);
    if (header) {
      structure = header[1].toLowerCase() === 'open' ? 'open' : header[1].toLowerCase() === 'close' ? 'close' : 'interval';
      categoryRaw = header[2].trim();
      headerRaw = line;
      if (!headers.has(headerRaw)) headers.set(headerRaw, { categoryRaw, structure, line: index + 1, amc: '', row: null });
      continue;
    }
    if (line.includes(';')) {
      const fields = raw.split(';');
      const code = Number(fields[0]?.trim());
      const name = fields.length >= 4 ? fields.slice(3, fields.length >= 8 ? fields.length - 4 : 4).join(';').trim() : '';
      if (!Number.isInteger(code) || code <= 0 || !name) {
        if (/^\d+;/.test(line)) rejected.push({ line: index + 1, reason: 'invalid scheme code or missing scheme name', raw });
        continue;
      }
      if (!categories.has(categoryRaw)) categories.set(categoryRaw, { categoryRaw, schemes: 0, headers: new Set(), sampleName: name });
      const category = categories.get(categoryRaw);
      category.schemes++;
      category.headers.add(headerRaw);
      const record = { code, name, categoryRaw, headerRaw, structure, amc, raw, line: index + 1 };
      rows.push(record);
      if (seenCodes.has(code)) duplicateCodes.add(code);
      else seenCodes.add(code);
      const headerRecord = headers.get(headerRaw);
      if (headerRecord && !headerRecord.row) { headerRecord.amc = amc; headerRecord.row = record; }
      continue;
    }
    amc = line;
  }
  return { lines, categories, headers, rows, rejected, duplicateCodes };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'FundScope taxonomy C0 discovery' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function captureMfapiSample(nav) {
  const candidate = nav.rows.find(row => /debt scheme - banking and psu fund/i.test(row.categoryRaw)) ?? nav.rows[0];
  if (!candidate) throw new Error('No scheme row was parsed from AMFI NAVAll.txt.');
  const url = `${mfapi}/${candidate.code}`;
  const payload = await getJson(url);
  if (!payload.meta || Number(payload.meta.scheme_code) !== candidate.code) throw new Error(`MFapi metadata did not match AMFI scheme ${candidate.code}.`);
  return { source_url: url, captured_at: new Date().toISOString(), status: payload.status, meta: payload.meta, sample_data: Array.isArray(payload.data) ? payload.data.slice(0, 1) : [] };
}

function monthKey(offset) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - offset);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${date.getUTCFullYear()}`;
}

async function captureTerSample(nav) {
  const candidate = nav.rows.find(row => row.amc && row.categoryRaw);
  if (!candidate) throw new Error('No AMFI scheme row with an AMC was parsed.');
  const houses = await getJson(`${amfiApi}/populate-mf`);
  const house = houses.find(item => String(item.mfName ?? '').trim().toLowerCase() === candidate.amc.trim().toLowerCase());
  if (!house?.mfId) throw new Error(`AMFI AMC list did not map ${candidate.amc}.`);
  for (let offset = 0; offset < 8; offset++) {
    const month = monthKey(offset);
    const url = `${amfiApi}/populate-te-rdata-revised?MF_ID=${encodeURIComponent(house.mfId)}&Month=${encodeURIComponent(month)}&strCat=-1&strType=1&page=1&pageSize=10000`;
    const payload = await getJson(url);
    if (!Array.isArray(payload.data) || !payload.data.length) continue;
    return { source_url: url, captured_at: new Date().toISOString(), amc: house.mfName, requested_month: month, payload: { meta: payload.meta, data: payload.data.slice(0, 1) } };
  }
  throw new Error(`AMFI TER endpoint had no rows for ${candidate.amc} in the eight most recent month requests.`);
}

function makeDraft(nav) {
  const observed = [...nav.categories.values()].sort((a, b) => a.categoryRaw.localeCompare(b.categoryRaw)).map(item => {
    const [family = '', ...subParts] = item.categoryRaw.split(' - ');
    const proposed = draftCategoryOutcome(item.categoryRaw);
    return { category_raw: item.categoryRaw, family: family || null, sub_category: subParts.join(' - ') || null, scheme_count: item.schemes, observed_headers: [...item.headers].sort(), proposed_asset_class: proposed.assetClass, proposed_rule_id: proposed.ruleId, review_status: proposed.ruleId === 'UNMAPPED' || proposed.ruleId === 'draft_passive_name_rule_required' ? 'REVIEW_REQUIRED' : 'C0_HYPOTHESIS' };
  });
  for (const rule of observed) {
    if (rule.proposed_rule_id === 'draft_multi_asset_or_legacy_quarantine') rule.review_status = 'REVIEW_REQUIRED';
  }
  const observedFamilies = new Set(observed.map(rule => rule.family?.toLowerCase()).filter(Boolean));
  const normalizationAliases = [
    ...(observedFamilies.has('equity schemes') ? [{ observed_family: 'Equity Schemes', canonical_family: 'Equity Scheme', rationale: 'Observed plural and singular family spellings; compare classes before binding.' }] : []),
    ...(observedFamilies.has('hybrid schemes') ? [{ observed_family: 'Hybrid Schemes', canonical_family: 'Hybrid Scheme', rationale: 'Observed plural and singular family spellings; compare classes before binding.' }] : []),
    ...(observedFamilies.has('income/debt oriented schemes') ? [{ observed_family: 'Income/Debt Oriented Schemes', canonical_family: 'Debt Scheme', rationale: 'Legacy family explicitly identifies debt; retain raw value in provenance and verify against the SEBI circular.' }] : []),
    ...(observedFamilies.has('solution oriented schemes **') ? [{ observed_family: 'Solution Oriented Schemes **', canonical_family: 'Solution Oriented Scheme', rationale: 'Possible asterisk footnote variant; confirm in AMFI metadata before canonicalizing.' }] : []),
  ];
  return { taxonomy_version: 2, status: 'C0 discovery draft; not used by production classifier', source: navUrl, captured_at: new Date().toISOString(), observed_category_count: observed.length, normalization_aliases: normalizationAliases, rules: observed };
}

function renderReport(nav, fetchedAt, mfapiSample = null, terSample = null) {
  const categories = [...nav.categories.values()].sort((a, b) => a.categoryRaw.localeCompare(b.categoryRaw));
  const passiveRows = nav.rows.filter(row => isPassiveFamily(row.categoryRaw));
  const duplicateRows = nav.rows.length - new Set(nav.rows.map(row => row.code)).size;
  const currentOutcomes = new Map();
  for (const row of nav.rows) {
    const result = classifyWithCurrentConfig(row.categoryRaw, row.name);
    const key = `${row.categoryRaw}\u0000${result.assetClass}\u0000${result.ruleId}`;
    currentOutcomes.set(key, (currentOutcomes.get(key) ?? 0) + 1);
  }
  const output = [
    '# AMFI classification discovery (C0)',
    '',
    `Source: ${navUrl}`,
    `Fetched: ${fetchedAt}`,
    `Physical lines: ${nav.lines.length.toLocaleString('en-IN')}; parsed scheme rows: ${nav.rows.length.toLocaleString('en-IN')}; unique scheme codes: ${new Set(nav.rows.map(row => row.code)).size.toLocaleString('en-IN')}; repeated code rows: ${duplicateRows.toLocaleString('en-IN')}; rejected numeric rows: ${nav.rejected.length.toLocaleString('en-IN')}.`,
    `Distinct raw categories: ${categories.length}; distinct full headers: ${nav.headers.size}. The results below show the current v1 config result and a provisional v2 proposal. The proposal does not change production classifications.`,
    '',
    '| Schemes | Raw AMFI category | Current config outcome | C0 draft outcome | Observed header |',
    '|---:|---|---|---|---|',
    ...categories.map(item => {
      const current = [...currentOutcomes.entries()].filter(([key]) => key.startsWith(`${item.categoryRaw}\u0000`)).map(([key, count]) => {
        const [, assetClass, ruleId] = key.split('\u0000');
        return `${assetClass} / ${ruleId} (${count})`;
      }).join('; ');
      const draft = draftCategoryOutcome(item.categoryRaw);
      const header = [...item.headers].sort()[0] ?? '';
      return `| ${item.schemes} | ${item.categoryRaw.replaceAll('|', '\\|')} | ${current || 'no scheme rows'} | ${draft.assetClass} / ${draft.ruleId} | ${header.replaceAll('|', '\\|')} |`;
    }),
    '',
    `## Passive-family name review (${passiveRows.length.toLocaleString('en-IN')} scheme rows)`,
    '',
    'These are C0 name-rule candidates only; no name-derived class is bound by this report. Conflicting class tokens return `other / PASSIVE_AMBIGUOUS` for review.',
    '',
    '| Scheme code | Category | AMC | Scheme name | Candidate outcome |',
    '|---:|---|---|---|---|',
    ...passiveRows.map(row => {
      const result = classifyPassiveCandidate(row.name, row.categoryRaw);
      return `| ${row.code} | ${row.categoryRaw.replaceAll('|', '\\|')} | ${row.amc.replaceAll('|', '\\|')} | ${row.name.replaceAll('|', '\\|')} | ${result.assetClass} / ${result.ruleId}${result.candidates ? ` (${result.candidates.join(', ')})` : ''} |`;
    }),
    '',
    '## Parser diagnostics',
    '',
    `- Format fingerprint: ${nav.lines.find(line => /^Scheme Code/i.test(line.trim()))?.trim() ?? 'column header not found'}`,
    `- Distinct category header lines: ${nav.headers.size}`,
    `- Repeated scheme-code rows: ${duplicateRows}`,
    `- Rejected rows: ${nav.rejected.length}`,
    '- Parser shape is accepted for this discovery run only; production batch-failure semantics are not changed in C0.',
  ];
  if (mfapiSample) {
    const meta = mfapiSample.meta;
    output.push('', '## S2 MFapi metadata', '', `A real history response for AMFI code ${meta.scheme_code} returned \`meta.scheme_category=${meta.scheme_category}\`, \`meta.scheme_type=${meta.scheme_type}\`, \`meta.scheme_name\`, \`fund_house\`, \`isin_growth\`, and \`isin_div_reinvestment\`. The response status was ${mfapiSample.status}. Full response shape is in [mfapi-meta.sample.json](../tests/fixtures/mfapi-meta.sample.json).`);
  }
  if (terSample) {
    const meta = terSample.payload.meta;
    const first = terSample.payload.data[0];
    output.push('', '## S3 AMFI TER metadata', '', `The official TER response for ${terSample.amc}, month ${terSample.requested_month}, includes \`SchemeCat_Desc=${first.SchemeCat_Desc}\`, \`Scheme_Name\`, \`NSDLSchemeCode\`, Direct/Regular TER, and a \`meta\` page descriptor. It does not provide an AMFI Scheme Code in the sampled row. The request asked for pageSize 10000, but the response says pageSize ${meta.pageSize}, total ${meta.total}, pageCount ${meta.pageCount}; callers must request and collect all ${meta.pageCount} pages to see the full AMC dataset. See [amfi-ter.sample.json](../tests/fixtures/amfi-ter.sample.json).`);
  }
  output.push('', '## Prompt assumption check', '', '- Confirmed from raw AMFI strings: `Life Cycle Funds` is present; Sectoral and Thematic occur as separate categories and as an older combined category; plural Equity/Hybrid families and legacy `Income/Debt Oriented Schemes` coexist.', '- The Sectoral Debt examples are filed under `Income/Debt Oriented Schemes - Sectoral Fund`; the feed does not use the literal category string `Sectoral Debt Fund` in the observed set.', '- Header-only `Growth`, `Income`, `Gilt`, and `ELSS` also occur. `Growth` and `Income` do not identify an asset class and remain `other / UNMAPPED` in the draft.', '- The SEBI landing page confirms the stated circular title/date/number. Its linked PDF body could not be extracted during C0, so the detailed policy summary and the inferred August 2026 compliance deadline remain unverified.', '- Passive-name outcomes are candidate rules only; ambiguous and unmatched names remain quarantined as `other` pending C2 review.');
  if (nav.rejected.length) output.push('', 'Rejected row samples:', ...nav.rejected.slice(0, 30).map(row => `- line ${row.line}: ${row.reason} — ${row.raw}`));
  return { markdown: `${output.join('\n')}\n`, categories, passiveRows, draft: makeDraft(nav), diagnostics: { lines: nav.lines.length, parsedRows: nav.rows.length, uniqueCodes: new Set(nav.rows.map(row => row.code)).size, duplicateRows, rejectedRows: nav.rejected.length, distinctCategories: categories.length, distinctHeaders: nav.headers.size } };
}

const response = await fetch(navUrl, { headers: { 'user-agent': 'FundScope taxonomy C0 discovery' } });
if (!response.ok) throw new Error(`AMFI NAVAll.txt returned ${response.status} ${response.statusText}`);
const text = await response.text();
const fetchedAt = new Date().toISOString();
const nav = parseNavFile(text);
if (!nav.rows.length || !nav.categories.size || nav.rows.length / Math.max(1, nav.lines.filter(line => line.trim()).length) < 0.5) throw new Error('AMFI file shape is not credible for a discovery report; no data was written.');
let mfapiSample = null;
let terSample = null;

if (shouldWriteFixtures) {
  const fixtureDir = resolve(root, 'tests/fixtures');
  await mkdir(fixtureDir, { recursive: true });
  const excerpt = [nav.lines.find(line => /^Scheme Code/i.test(line.trim()))?.trim() ?? ''];
  for (const header of nav.headers.values()) {
    if (!header.row) continue;
    excerpt.push('', header.line ? nav.lines[header.line - 1] : '', '', header.amc, header.row.raw);
  }
  await writeFile(resolve(fixtureDir, 'amfi-navall.sample.txt'), `${excerpt.join('\n')}\n`, 'utf8');
  mfapiSample = await captureMfapiSample(nav);
  await writeFile(resolve(fixtureDir, 'mfapi-meta.sample.json'), `${JSON.stringify(mfapiSample, null, 2)}\n`, 'utf8');
  terSample = await captureTerSample(nav);
  await writeFile(resolve(fixtureDir, 'amfi-ter.sample.json'), `${JSON.stringify(terSample, null, 2)}\n`, 'utf8');
}

const report = renderReport(nav, fetchedAt, mfapiSample, terSample);
if (shouldWriteDraft) await writeFile(resolve(root, 'config/category-map-v2-draft.json'), `${JSON.stringify(report.draft, null, 2)}\n`, 'utf8');
if (shouldWriteReport) await writeFile(resolve(root, 'docs/classification-discovery-c0.md'), report.markdown, 'utf8');

if (args.has('--json')) {
  console.log(JSON.stringify({ source: navUrl, fetchedAt, diagnostics: report.diagnostics, categories: report.categories.map(item => ({ categoryRaw: item.categoryRaw, schemeCount: item.schemes, headerRaw: [...item.headers], current: classifyWithCurrentConfig(item.categoryRaw, nav.rows.find(row => row.categoryRaw === item.categoryRaw)?.name ?? ''), draft: draftCategoryOutcome(item.categoryRaw) })), passiveRows: report.passiveRows.map(row => ({ code: row.code, categoryRaw: row.categoryRaw, amc: row.amc, name: row.name, outcome: classifyPassiveCandidate(row.name, row.categoryRaw) })) }, null, 2));
} else if (shouldWriteReport) {
  console.log(`Wrote docs/classification-discovery-c0.md with ${report.diagnostics.distinctCategories} raw categories and ${report.passiveRows.length} passive-family rows.`);
  if (shouldWriteFixtures) console.log('Wrote AMFI NAVAll, MFapi metadata, and AMFI TER source fixtures under tests/fixtures/.');
  if (shouldWriteDraft) console.log('Wrote config/category-map-v2-draft.json. It is not consumed by the application.');
} else {
  console.log(report.markdown);
}
