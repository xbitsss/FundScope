import { z } from 'zod';
import source from '../../config/benchmarks.json';
import taxonomySource from '../../config/category-map.json';
import { isAssetClass, TAXONOMY_VERSION, type AssetClass } from '../domain/taxonomy/assetClass';
import type { Fund } from '../domain/types';
import type { ReasonDetail } from '../domain/governance/reasons';

const verificationSchema=z.object({verified_at:z.string().min(1),scheme_name:z.string().min(1),isin:z.string().nullable(),first_nav_date:z.string().min(1),last_nav_date:z.string().min(1),checks:z.array(z.string().min(1)).min(1)});
const proxySchema=z.object({id:z.string().min(1),display_name:z.string().min(1),asset_class:z.enum(['equity','debt','hybrid','liquid','other']),kind:z.literal('proxy'),status:z.enum(['verified','unresolved']),provider:z.literal('mfapi'),scheme_code:z.number().int().positive().nullable(),verification:verificationSchema.nullable()});
const componentSchema=z.object({benchmark_id:z.string().min(1),weight:z.number().positive().max(1)});
const compositeSchema=z.object({id:z.string().min(1),display_name:z.string().min(1),asset_class:z.enum(['equity','debt','hybrid','liquid','other']),kind:z.literal('composite'),status:z.enum(['verified','unresolved']),components:z.array(componentSchema),rebalance:z.literal('daily')});
const benchmarkSchema=z.union([proxySchema,compositeSchema]);
const categorySchema=z.object({asset_class:z.enum(['equity','debt','hybrid','liquid','other']),sub_category:z.string().min(1),benchmark_id:z.string().min(1).nullable(),fit:z.enum(['category_standard','broad_approx']).nullable()});
const configSchema=z.object({schema_version:z.literal(1),taxonomy_version:z.number().int().positive(),max_series_age_days:z.number().int().positive().default(10),benchmarks:z.array(benchmarkSchema),category_map:z.array(categorySchema),overrides:z.array(z.object({scheme_code:z.number().int().positive(),benchmark_id:z.string().min(1),reason:z.string().min(1)})).default([])});
export type BenchmarkConfig=z.infer<typeof configSchema>;
export type BenchmarkDefinition=z.infer<typeof benchmarkSchema>;
export type BenchmarkFit='category_standard'|'broad_approx';
export type BenchmarkResolution={ok:true;benchmark:BenchmarkDefinition;fit:BenchmarkFit}|{ok:false;reason:ReasonDetail};

export function validateBenchmarkConfig(input:unknown):{ok:true;config:BenchmarkConfig}|{ok:false;errors:string[]} {
  const parsed=configSchema.safeParse(input);if(!parsed.success)return {ok:false,errors:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`)};
  const config=parsed.data;const errors:string[]=[];const ids=new Set<string>();
  if(config.taxonomy_version!==TAXONOMY_VERSION)errors.push(`taxonomy_version must equal ${TAXONOMY_VERSION}`);
  for(const benchmark of config.benchmarks){if(ids.has(benchmark.id))errors.push(`duplicate benchmark id: ${benchmark.id}`);ids.add(benchmark.id);if(benchmark.kind==='proxy'&&benchmark.status==='verified'&&(!benchmark.scheme_code||!benchmark.verification))errors.push(`verified proxy ${benchmark.id} needs a scheme_code and verification block`);if(benchmark.kind==='proxy'&&benchmark.status==='unresolved'&&(benchmark.scheme_code!==null||benchmark.verification!==null))errors.push(`unresolved proxy ${benchmark.id} must not contain an accepted code or verification`);if(benchmark.kind==='proxy'&&benchmark.status==='verified'&&benchmark.verification){const first=Date.parse(benchmark.verification.first_nav_date);const last=Date.parse(benchmark.verification.last_nav_date);const verified=Date.parse(benchmark.verification.verified_at);if(!Number.isFinite(first)||!Number.isFinite(last)||!Number.isFinite(verified)||first>last||last>verified)errors.push(`verified proxy ${benchmark.id} has invalid verification dates`);}}
  const byId=new Map(config.benchmarks.map(benchmark=>[benchmark.id,benchmark]));const categoryKeys=new Set<string>();const knownCategories=new Set((taxonomySource.rules as Array<{sub_categories?:string[]}>).flatMap(rule=>rule.sub_categories??[]).filter(item=>item!=='*').map(item=>item.toLocaleLowerCase()));
  for(const category of config.category_map){const key=`${category.asset_class}\u0000${category.sub_category}`;if(categoryKeys.has(key))errors.push(`duplicate category mapping: ${category.asset_class}/${category.sub_category}`);categoryKeys.add(key);if(!knownCategories.has(category.sub_category.toLocaleLowerCase()))errors.push(`category ${category.sub_category} is not present in the versioned taxonomy`);if(category.benchmark_id===null){if(category.fit!==null)errors.push(`unmapped category ${category.sub_category} must use fit null`);continue;}const benchmark=byId.get(category.benchmark_id);if(!benchmark){errors.push(`category ${category.sub_category} references missing benchmark ${category.benchmark_id}`);continue;}if(benchmark.asset_class!==category.asset_class)errors.push(`class mismatch for ${category.sub_category}: ${category.asset_class} mapped to ${benchmark.asset_class}`);if(category.fit===null)errors.push(`mapped category ${category.sub_category} requires a fit`);}
  for(const benchmark of config.benchmarks){if(benchmark.kind!=='composite')continue;let total=0;let hasEquity=false;let hasDebtOrLiquid=false;if(benchmark.components.length<2)errors.push(`composite ${benchmark.id} needs at least two components`);for(const component of benchmark.components){total+=component.weight;const target=byId.get(component.benchmark_id);if(!target){errors.push(`composite ${benchmark.id} references missing ${component.benchmark_id}`);continue;}if(target.kind!=='proxy')errors.push(`composite ${benchmark.id} cannot contain another composite`);if(target.asset_class==='equity')hasEquity=true;if(target.asset_class==='debt'||target.asset_class==='liquid')hasDebtOrLiquid=true;}if(Math.abs(total-1)>1e-9)errors.push(`composite ${benchmark.id} weights must sum to 1`);if(benchmark.asset_class==='hybrid'&&(!hasEquity||!hasDebtOrLiquid))errors.push(`hybrid composite ${benchmark.id} needs equity and debt/liquid components`);if(benchmark.status==='verified'&&benchmark.components.some(component=>byId.get(component.benchmark_id)?.status!=='verified'))errors.push(`composite ${benchmark.id} cannot be verified while a component is unresolved`);}
  for(const override of config.overrides)if(!byId.has(override.benchmark_id))errors.push(`override ${override.scheme_code} references missing benchmark ${override.benchmark_id}`);
  return errors.length?{ok:false,errors}:{ok:true,config};
}

const validation=validateBenchmarkConfig(source);
export const benchmarkConfigValidation=validation.ok?{ok:true as const,config:validation.config,errors:[] as string[]}:{ok:false as const,config:null,errors:validation.errors};
export const benchmarkConfig=benchmarkConfigValidation.config;

export function resolveBenchmark(fund:Pick<Fund,'code'|'assetClass'|'subCategory'>,config:BenchmarkConfig|null=benchmarkConfig):BenchmarkResolution{
  if(!isAssetClass(fund.assetClass)||fund.assetClass==='other')return {ok:false,reason:{code:'NA_CATEGORY',cause:'UNCLASSIFIED_FUND',fundAssetClass:String(fund.assetClass),subCategory:fund.subCategory}};
  if(!config)return {ok:false,reason:{code:'NO_BENCHMARK',cause:'UNRESOLVED_PROXY',subCategory:fund.subCategory}};
  const override=config.overrides.find(item=>item.scheme_code===fund.code);const category=config.category_map.find(item=>item.asset_class===fund.assetClass&&item.sub_category===fund.subCategory);
  const benchmarkId=override?.benchmark_id??category?.benchmark_id;
  if(!benchmarkId)return {ok:false,reason:{code:'NO_BENCHMARK',cause:'UNMAPPED_CATEGORY',subCategory:fund.subCategory}};
  const benchmark=config.benchmarks.find(item=>item.id===benchmarkId);
  if(!benchmark||benchmark.status!=='verified')return {ok:false,reason:{code:'NO_BENCHMARK',cause:'UNRESOLVED_PROXY',subCategory:fund.subCategory,benchmarkId}};
  if(benchmark.asset_class!==fund.assetClass)return {ok:false,reason:{code:'NA_CATEGORY',cause:'ASSET_CLASS_MISMATCH',fundAssetClass:fund.assetClass,benchmarkAssetClass:benchmark.asset_class,subCategory:fund.subCategory}};
  return {ok:true,benchmark,fit:category?.fit??'category_standard'};
}
