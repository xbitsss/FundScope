import type { Fund } from '../types';
import { normalizeFilterText } from '../search/normalize';

export interface MetricFilter{id:string;min:number|null;max:number|null;excludeMissing:boolean}
export type StructureFilter='open'|'close'|'interval'|'unknown';
export type PlanFilter='Direct'|'Regular'|'Unknown';
export type OptionFilter='Growth'|'IDCW'|'Unknown';
export type ArrayFacet='management'|'structure'|'plan'|'option'|'categories'|'amcs'|'assetClasses'|'statuses'|'riskBands'|'philosophies'|'specialities'|'groups'|'lifecycle';
export type ScreenerFacet=ArrayFacet|'hideStaleNav'|'metrics'|'search';
export interface ScreenerFilters{search:string;structure:StructureFilter[];plan:PlanFilter[];option:OptionFilter[];categories:string[];amcs:string[];assetClasses:string[];statuses:string[];management:string[];riskBands:string[];philosophies:string[];specialities:string[];groups:string[];lifecycle:string[];hideStaleNav:boolean;metrics:MetricFilter[]}
export interface FunnelStep{step:string;remaining:number}
export interface FilterResult{rows:Fund[];funnel:FunnelStep[]}
export interface FacetOption{value:string;count:number;disabled:boolean}
const arrayFacets:ArrayFacet[]=['management','structure','plan','option','assetClasses','riskBands','philosophies','specialities','groups','categories','amcs','statuses','lifecycle'];
export interface ScreenerView extends FilterResult{facets:Record<ArrayFacet,FacetOption[]>}

/** Empty selection means no restriction; defaults define the starter research universe. */
export const defaultScreenerFilters:ScreenerFilters={search:'',structure:['open'],plan:['Direct'],option:['Growth'],categories:[],amcs:[],assetClasses:[],statuses:[],management:[],riskBands:[],philosophies:[],specialities:[],groups:[],lifecycle:['active'],hideStaleNav:false,metrics:[]};
const norm=(value:unknown)=>normalizeFilterText(value);
const explicit=(value:string,choices:readonly string[])=>choices.includes(value)?value:'Unknown';
const structureOf=(fund:Fund):StructureFilter=>explicit(fund.structure,['open','close','interval','unknown']) as StructureFilter;
const planOf=(fund:Fund):PlanFilter=>explicit(fund.plan,['Direct','Regular']) as PlanFilter;
const optionOf=(fund:Fund):OptionFilter=>/growth/i.test(fund.option??'')&&!/bonus/i.test(fund.option??'')?'Growth':/idcw|dividend|payout|reinvest/i.test(fund.option??'')?'IDCW':'Unknown';
const getValues=(fund:Fund,facet:ArrayFacet):string[]=>{
  if(facet==='management')return [fund.management||'Not specified'];
  if(facet==='structure')return [structureOf(fund)];
  if(facet==='plan')return [planOf(fund)];
  if(facet==='option')return [optionOf(fund)];
  if(facet==='categories')return [fund.subCategory||'Not specified'];
  if(facet==='amcs')return [fund.amc||'Unknown'];
  if(facet==='assetClasses')return [fund.assetClass||'other'];
  if(facet==='statuses')return [fund.classStatus||'Unknown'];
  if(facet==='riskBands')return [fund.riskBand||'Not specified'];
  if(facet==='philosophies')return [fund.philosophy||'Blend/Unspecified'];
  if(facet==='specialities')return fund.speciality?.length?fund.speciality:['None'];
  if(facet==='groups')return [fund.group||'Unclassified'];
  return [fund.lifecycle||'active'];
};
const matches=(fund:Fund,facet:ArrayFacet,selection:readonly string[])=>!selection.length||getValues(fund,facet).some(value=>selection.some(item=>norm(item)===norm(value)));
const freshness=(fund:Fund,now:number)=>Number.isFinite(fund.navDate)&&now/86_400_000-fund.navDate<=10;
function acceptsMetric(fund:Fund,filter:MetricFilter){const value=fund.metrics?.[filter.id];if(typeof value!=='number'||!Number.isFinite(value))return !(filter.excludeMissing||filter.min!==null||filter.max!==null);return (filter.min===null||value>=filter.min)&&(filter.max===null||value<=filter.max);}
const queryMatches=(fund:Fund,query:string)=>[fund.name,fund.amc,fund.subCategory,fund.group,fund.category,fund.option,fund.plan,fund.assetClass,fund.management,...(fund.speciality??[])].map(norm).some(value=>value.includes(query));
const ordered:Array<[string,ScreenerFacet]>=[['Management','management'],['Structure','structure'],['Asset','assetClasses'],['Risk (category-implied)','riskBands'],['Investment philosophy','philosophies'],['Investment speciality','specialities'],['Category group','groups'],['Category','categories'],['Fund house','amcs'],['Classification status','statuses'],['Lifecycle','lifecycle'],['Plan','plan'],['Option','option'],['NAV freshness','hideStaleNav'],['Metrics','metrics'],['Search','search']];
const fixedValues:Partial<Record<ArrayFacet,string[]>>={management:['Active','Passive','Not specified'],structure:['open','close','interval','unknown'],plan:['Direct','Regular','Unknown'],option:['Growth','IDCW','Unknown'],riskBands:['Low','Medium','High','Not specified'],philosophies:['Value','Contra','Blend/Unspecified'],lifecycle:['active','dormant']};
function checkFund(fund:Fund,filters:ScreenerFilters,facet:ScreenerFacet,now:number):boolean{
  if(arrayFacets.includes(facet as ArrayFacet))return matches(fund,facet as ArrayFacet,filters[facet as ArrayFacet]);
  if(facet==='hideStaleNav')return !filters.hideStaleNav||freshness(fund,now);
  if(facet==='metrics')return filters.metrics.every(filter=>acceptsMetric(fund,filter));
  const query=norm(filters.search);return !query||queryMatches(fund,query);
}
function fieldLabels(fund:Fund,facet:ArrayFacet){return [...new Set(getValues(fund,facet).map(value=>String(value||'Unknown').trim()||'Unknown'))];}

/** Rows, facets, and the funnel share one normalized filter definition. Counts exclude only their own facet. */
export function computeScreenerView(funds:Fund[],filters:ScreenerFilters,now=Date.now()):ScreenerView{
  const rows:Fund[]=[];const allLabels=Object.fromEntries(arrayFacets.map(facet=>[facet,new Map<string,string>()])) as Record<ArrayFacet,Map<string,string>>;const counts=Object.fromEntries(arrayFacets.map(facet=>[facet,new Map<string,number>()])) as Record<ArrayFacet,Map<string,number>>;const funnelCounts=Array<number>(ordered.length).fill(0);
  for(const fund of funds){for(const facet of arrayFacets)for(const label of fieldLabels(fund,facet)){const key=norm(label);if(key&&!allLabels[facet].has(key))allLabels[facet].set(key,label);}
    const checks=ordered.map(([,facet])=>checkFund(fund,filters,facet,now));let prefix=true;for(let index=0;index<checks.length;index++){prefix=prefix&&checks[index]!;if(prefix)funnelCounts[index]=funnelCounts[index]!+1;}if(prefix)rows.push(fund);
    for(const facet of arrayFacets){const excludedIndex=ordered.findIndex(([,id])=>id===facet);if(checks.some((value,index)=>index!==excludedIndex&&!value))continue;for(const label of fieldLabels(fund,facet)){const key=norm(label);counts[facet].set(key,(counts[facet].get(key)??0)+1);}}
  }
  const facets=Object.fromEntries(arrayFacets.map(facet=>{const names=new Map(allLabels[facet]);for(const value of fixedValues[facet]??[])if(!names.has(norm(value)))names.set(norm(value),value);const options=[...names.entries()].map(([key,value])=>{const count=counts[facet].get(key)??0;return {value,count,disabled:count===0};}).sort((a,b)=>a.value.localeCompare(b.value));return [facet,options];})) as ScreenerView['facets'];
  return {rows,funnel:ordered.map(([step],index)=>({step,remaining:funnelCounts[index]??funds.length})),facets};
}
export function applyFilters(funds:Fund[],filters:ScreenerFilters,now=Date.now()):FilterResult{const {rows,funnel}=computeScreenerView(funds,filters,now);return {rows,funnel};}
/** Empty means unrestricted; represent an explicit all-selection canonically as empty. */
export function collapseFacetSelection(selected:readonly string[],selectable:readonly string[],known:readonly string[]=selectable):string[]{const selectedKeys=new Set(selected.map(norm));const selectableKeys=new Set(selectable.map(norm).filter(Boolean));const knownKeys=new Set(known.map(norm).filter(Boolean));if(selectableKeys.size>0&&[...selectableKeys].every(key=>selectedKeys.has(key)))return [];return [...new Set(selected.filter(value=>knownKeys.has(norm(value))))];}
/** Unlike a filter match, checkbox state is explicit: an unrestricted [] has no checked rows. */
export function isFacetOptionSelected(selected:readonly string[],value:string):boolean{return selected.some(item=>norm(item)===norm(value));}
export function facetOptions(funds:Fund[],filters:ScreenerFilters,facet:ScreenerFacet,now=Date.now()):FacetOption[]{if(arrayFacets.includes(facet as ArrayFacet))return computeScreenerView(funds,filters,now).facets[facet as ArrayFacet];return computeScreenerView(funds,filters,now).rows.map(fund=>({value:fund.code.toString(),count:1,disabled:false}));}
export function activeFacetCount(filters:ScreenerFilters):number{const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);return Number(Boolean(filters.search.trim()))+Number(!same(filters.structure,defaultScreenerFilters.structure))+Number(!same(filters.plan,defaultScreenerFilters.plan))+Number(!same(filters.option,defaultScreenerFilters.option))+Number(filters.categories.length>0)+Number(filters.amcs.length>0)+Number(filters.assetClasses.length>0)+Number(filters.statuses.length>0)+Number(filters.management.length>0)+Number(filters.riskBands.length>0)+Number(filters.philosophies.length>0)+Number(filters.specialities.length>0)+Number(filters.groups.length>0)+Number(!same(filters.lifecycle,defaultScreenerFilters.lifecycle))+Number(filters.hideStaleNav)+Number(filters.metrics.length>0);}
/** Reads saved-screen v2, legacy pipe values, or an older object without retaining sentinels. */
export function migrateSavedScreen(value:unknown):ScreenerFilters{const legacy=value&&typeof value==='object'?value as Record<string,unknown>:{};const list=(input:unknown,sentinel:string)=>Array.isArray(input)?input.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean):typeof input==='string'&&norm(input)!==norm(sentinel)?input.split('|').map(item=>item.trim()).filter(Boolean):[];const rawMetrics=legacy.metrics??legacy.addedFilters;const metrics=Array.isArray(rawMetrics)?rawMetrics.filter((item:unknown):item is MetricFilter=>Boolean(item)&&typeof item==='object'&&typeof (item as MetricFilter).id==='string'):[];const structure=list(legacy.structure,'All structures') as StructureFilter[];const lifecycle=list(legacy.lifecycle,'All lifecycle');return {search:typeof legacy.search==='string'?legacy.search.trim():'',structure:Object.hasOwn(legacy,'structure')?structure:['open'],plan:legacy.plan==='Both'||legacy.plan==='All'?[]:list(legacy.plan,'All plans') as PlanFilter[],option:legacy.option==='All'?[]:list(legacy.option,'All options') as OptionFilter[],categories:list(legacy.categories??legacy.category,'All categories'),amcs:list(legacy.amcs??legacy.amc,'All AMCs'),assetClasses:list(legacy.assetClasses??legacy.assetClassFilter,'All asset classes'),statuses:list(legacy.statuses??legacy.classificationStatusFilter,'All statuses'),management:list(legacy.management,'All management'),riskBands:list(legacy.riskBands,'All risk bands'),philosophies:list(legacy.philosophies,'All philosophies'),specialities:list(legacy.specialities,'All specialities'),groups:list(legacy.groups,'All groups'),lifecycle:Object.hasOwn(legacy,'lifecycle')?lifecycle:['active'],hideStaleNav:legacy.hideStaleNav===true,metrics};}
