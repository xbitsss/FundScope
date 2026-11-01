import source from '../../../config/category-map.json';
import { normalizeCategory, normalizeCategoryText } from './categoryNormalize';
import { classifyPassive } from './indexRules';
import type { AssetClass } from './assetClass';

type FamilyRule = { id: string; family: string; asset_class: AssetClass };
type SubcategoryRule = { id: string; family: string; sub_categories: string[]; asset_class: AssetClass };
type ExactRule = { id: string; category: string; asset_class: AssetClass };
const familyRules = source.family_rules as FamilyRule[];
const subcategoryRules = source.subcategory_rules as SubcategoryRule[];
const exactRules = source.exact_category_rules as ExactRule[];
const passiveFamilies = new Set((source.passive_families as string[]).map((family) => family.toLocaleLowerCase('en')));
const acknowledgedUnmapped = new Set((source.acknowledged_unmapped as Array<{ category: string }>).map(({ category }) => category.toLocaleLowerCase('en')));

export type ClassificationResult =
  | { ok: true; assetClass: AssetClass; ruleId: string; categoryKey: string; family: string | null; subCategory: string; flags: string[] }
  | { ok: false; assetClass: 'other'; ruleId: 'UNMAPPED'; categoryKey: string; family: string | null; subCategory: string; flags: string[]; acknowledged: boolean };

const lower = (value: string | null | undefined) => normalizeCategory(value ?? '').family?.toLocaleLowerCase('en') ?? normalizeCategoryText(value ?? '').toLocaleLowerCase('en');

/** The regulator category is the only primary classification input. */
export function classifyFromCategory(input: { categoryRaw: string; schemeName?: string }): ClassificationResult {
  const normalized = normalizeCategory(input.categoryRaw);
  const categoryOnly = normalized.sub ?? '';
  const exact = exactRules.find((rule) => lower(rule.category) === lower(categoryOnly));
  if (exact) return { ok: true, assetClass: exact.asset_class, ruleId: exact.id, categoryKey: normalized.key, family: normalized.family, subCategory: categoryOnly, flags: [] };

  const subcategory = subcategoryRules.find((rule) =>
    lower(rule.family) === lower(normalized.family) && rule.sub_categories.some((value) => lower(value) === lower(normalized.sub)),
  );
  if (subcategory) return { ok: true, assetClass: subcategory.asset_class, ruleId: subcategory.id, categoryKey: normalized.key, family: normalized.family, subCategory: categoryOnly, flags: [] };

  const familyRule = familyRules.find((rule) => lower(rule.family) === lower(normalized.family));
  if (familyRule) return { ok: true, assetClass: familyRule.asset_class, ruleId: familyRule.id, categoryKey: normalized.key, family: normalized.family, subCategory: categoryOnly, flags: [] };

  if (normalized.family && passiveFamilies.has(lower(normalized.family))) {
    const passive = classifyPassive(input.schemeName ?? '');
    return { ok: true, assetClass: passive.assetClass, ruleId: passive.ruleId, categoryKey: normalized.key, family: normalized.family, subCategory: categoryOnly, flags: passive.flags };
  }

  return {
    ok: false,
    assetClass: 'other',
    ruleId: 'UNMAPPED',
    categoryKey: normalized.key,
    family: normalized.family,
    subCategory: categoryOnly,
    flags: [],
    acknowledged: acknowledgedUnmapped.has(lower(categoryOnly)),
  };
}

export function classifyAssetClass(input: { categoryRaw: string; name: string }): { assetClass: AssetClass; ruleId: string; subCategory: string; flags: string[]; categoryKey: string; mapped: boolean } {
  const result = classifyFromCategory({ categoryRaw: input.categoryRaw, schemeName: input.name });
  return { assetClass: result.assetClass, ruleId: result.ruleId, subCategory: result.subCategory, flags: result.flags, categoryKey: result.categoryKey, mapped: result.ok };
}
