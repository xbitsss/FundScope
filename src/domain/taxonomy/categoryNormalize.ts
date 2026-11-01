import source from '../../../config/category-map.json';

export interface NormalizedCategory {
  raw: string;
  family: string | null;
  sub: string | null;
  key: string;
  legacyShape: boolean;
}

type Alias = { alias: string; canonical: string };
type SubAlias = { family: string; alias: string; canonical: string };
const familyAliases = source.family_aliases as Alias[];
const subcategoryAliases = source.subcategory_aliases as SubAlias[];

export function normalizeCategoryText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasValue(value: string, aliases: Alias[]): string {
  const normalized = normalizeCategoryText(value).toLocaleLowerCase('en');
  return aliases.find((entry) => normalizeCategoryText(entry.alias).toLocaleLowerCase('en') === normalized)?.canonical ?? value;
}

function canonicalFamily(value: string): string {
  return normalizeCategoryText(aliasValue(value, familyAliases));
}

function canonicalSubcategory(family: string, value: string): string {
  const normalizedFamily = normalizeCategoryText(family).toLocaleLowerCase('en');
  const normalizedValue = normalizeCategoryText(value).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
  const match = subcategoryAliases.find((entry) =>
    normalizeCategoryText(entry.family).toLocaleLowerCase('en') === normalizedFamily &&
    normalizeCategoryText(entry.alias).replace(/\s+(?:funds?|etfs?)$/i, '').toLocaleLowerCase('en') === normalizedValue.toLocaleLowerCase('en'),
  );
  return normalizeCategoryText(match?.canonical ?? normalizedValue).replace(/\s+(?:funds?|etfs?)$/i, '').trim();
}

export function normalizeCategory(raw: string): NormalizedCategory {
  const normalizedRaw = normalizeCategoryText(raw);
  const separator = normalizedRaw.indexOf(' - ');
  if (separator < 0) {
    const value = normalizedRaw;
    return { raw, family: null, sub: value || null, key: `legacy|${value.toLocaleLowerCase('en')}`, legacyShape: true };
  }
  const family = canonicalFamily(normalizedRaw.slice(0, separator));
  const sub = canonicalSubcategory(family, normalizedRaw.slice(separator + 3));
  return { raw, family, sub, key: `${family.toLocaleLowerCase('en')}|${(sub ?? '').toLocaleLowerCase('en')}`, legacyShape: false };
}

export function normalizeCategoryKey(raw: string): string {
  return normalizeCategory(raw).key;
}
