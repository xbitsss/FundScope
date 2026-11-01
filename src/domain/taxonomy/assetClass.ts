import source from '../../../config/category-map.json';

export const ASSET_CLASSES=['equity','debt','hybrid','liquid','other'] as const;
export type AssetClass=(typeof ASSET_CLASSES)[number];
export const TAXONOMY_VERSION=source.taxonomy_version;
type CategoryRule={id:string;asset_class:AssetClass;family:string;sub_categories?:string[];name_patterns?:string[]};
const rules=(source.rules as CategoryRule[]).map(rule=>({...rule,patterns:rule.name_patterns?.map(pattern=>new RegExp(pattern,'i'))}));

export function isAssetClass(value:unknown):value is AssetClass{return typeof value==='string'&&(ASSET_CLASSES as readonly string[]).includes(value);}
export function categorySubcategory(categoryRaw:string):string{
  const tail=categoryRaw.split(' - ').slice(1).join(' - ')||categoryRaw;
  return tail.replace(/\s+Fund$/i,'').trim();
}
export function classifyAssetClass(input:{categoryRaw:string;name:string}):{assetClass:AssetClass;ruleId:string;subCategory:string}{
  const subCategory=categorySubcategory(input.categoryRaw);const family=input.categoryRaw.split(' - ')[0]?.trim()??'';
  for(const rule of rules){
    if(rule.family!=='*'&&family.toLowerCase()!==rule.family.toLowerCase())continue;
    if(rule.sub_categories&&!rule.sub_categories.includes('*')&&!rule.sub_categories.some(value=>value.toLowerCase()===subCategory.toLowerCase()))continue;
    if(rule.patterns?.length&&!rule.patterns.some(pattern=>pattern.test(input.name)))continue;
    return {assetClass:rule.asset_class,ruleId:rule.id,subCategory};
  }
  return {assetClass:'other',ruleId:'quarantine_default',subCategory};
}
