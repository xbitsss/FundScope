import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadTaxonomyConfig(root) {
  const [categoryMap, passive] = await Promise.all([
    readFile(resolve(root, 'config/category-map.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'config/passive-rules.json'), 'utf8').then(JSON.parse),
  ]);
  return { categoryMap, passive };
}

export function classifyCategory(categoryRaw, schemeName, { categoryMap, passive }) {
  const normalize = value => value.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').replace(/[‘’]/g, "'").replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  const lower = value => normalize(value ?? '').toLocaleLowerCase('en');
  const category = normalize(categoryRaw ?? '');
  const separator = category.indexOf(' - ');
  let family = null;
  let subCategory = category;
  if (separator >= 0) {
    const rawFamily = category.slice(0, separator);
    family = categoryMap.family_aliases.find(item => lower(item.alias) === lower(rawFamily))?.canonical ?? rawFamily;
    const rawSub = category.slice(separator + 3).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
    const alias = categoryMap.subcategory_aliases.find(item => lower(item.family) === lower(family) && lower(item.alias.replace(/\s+(?:funds?|etfs?)$/i, '')) === lower(rawSub));
    subCategory = (alias?.canonical ?? rawSub).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
  }
  const exact = categoryMap.exact_category_rules.find(rule => lower(rule.category) === lower(subCategory));
  if (exact) return { assetClass: exact.asset_class, ruleId: exact.id, mapped: true };
  const sub = categoryMap.subcategory_rules.find(rule => lower(rule.family) === lower(family) && rule.sub_categories.some(item => lower(item) === lower(subCategory)));
  if (sub) return { assetClass: sub.asset_class, ruleId: sub.id, mapped: true };
  const familyRule = categoryMap.family_rules.find(rule => lower(rule.family) === lower(family));
  if (familyRule) return { assetClass: familyRule.asset_class, ruleId: familyRule.id, mapped: true };
  if (categoryMap.passive_families.some(item => lower(item) === lower(family))) {
    const matches = passive.rules.filter(rule => new RegExp(rule.pattern, 'i').test(schemeName ?? ''));
    const classes = [...new Set(matches.map(rule => rule.asset_class))];
    if (classes.length > 1) return { assetClass: 'other', ruleId: 'PASSIVE_AMBIGUOUS', mapped: true };
    if (matches.length) return { assetClass: matches[0].asset_class, ruleId: matches[0].id, mapped: true };
    return { assetClass: 'other', ruleId: 'PASSIVE_UNMATCHED', mapped: true };
  }
  const acknowledged = categoryMap.acknowledged_unmapped.some(item => lower(item.category) === lower(subCategory));
  return { assetClass: 'other', ruleId: 'UNMAPPED', mapped: false, acknowledged };
}

export function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value.trim()); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index]?.startsWith('--')) values[argv[index].slice(2)] = argv[index + 1]?.startsWith('--') || !argv[index + 1] ? true : argv[++index];
  }
  return values;
}
