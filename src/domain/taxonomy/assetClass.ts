import source from '../../../config/category-map.json';
import { classifyAssetClass as classify, classifyFromCategory } from './classify';
import { normalizeCategory } from './categoryNormalize';

export const ASSET_CLASSES = ['equity', 'debt', 'hybrid', 'solution', 'commodity', 'liquid', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export const TAXONOMY_VERSION: number = source.taxonomy_version;

export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

/** Kept as a compatibility helper for the benchmark registry. */
export function categorySubcategory(categoryRaw: string): string {
  return normalizeCategory(categoryRaw).sub ?? categoryRaw.trim();
}

export function classifyAssetClass(input: { categoryRaw: string; name: string }) {
  return classify(input);
}

export { classifyFromCategory };
