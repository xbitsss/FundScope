import type { Fund } from '../types';
import { normalizeFilterText } from '../search/normalize';

export interface MetricFilter { id:string; min:number|null; max:number|null; excludeMissing:boolean }
export type StructureFilter='open'|'close'|'interval'|'unknown';
export type PlanFilter='Direct'|'Regular'|'Unknown';
export type OptionFilter='Growth'|'IDCW'|'Unknown';
export type ScreenerFacet='structure'|'plan'|'option'|'categories'|'amcs'|'assetClasses'|'statuses'|'hideStaleNav'|'metrics'|'search';
export interface ScreenerFilters { search:string; structure:StructureFilter[]; plan:PlanFilter[]; option:OptionFilter[]; categories:string[]; amcs:string[]; assetClasses:string[]; statuses:string[]; hideStaleNav:boolean; metrics:MetricFilter[] }
export interface FunnelStep { step:string; remaining:number }
export interface FilterResult { rows:Fund[]; funnel:FunnelStep[] }
export interface FacetOption { value:string; count:number; disabled:boolean }
export interface ScreenerView extends FilterResult {
  facets: Record<'categories'|'amcs'|'assetClasses'|'statuses', FacetOption[]>;
}

/** The research universe is intentionally narrow; an empty selection means no restriction. */
export const defaultScreenerFilters:ScreenerFilters={search:'',structure:['open'],plan:['Direct'],option:['Growth'],categories:[],amcs:[],assetClasses:[],statuses:[],hideStaleNav:false,metrics:[]};
const norm=(value:unknown)=>normalizeFilterText(value);
const explicit=(value:string, choices:readonly string[])=>choices.includes(value)?value:'Unknown';
const structureOf=(fund:Fund):StructureFilter=>explicit(fund.structure,['open','close','interval','unknown']) as StructureFilter;
const planOf=(fund:Fund):PlanFilter=>explicit(fund.plan,['Direct','Regular']) as PlanFilter;
const optionOf=(fund:Fund):OptionFilter=>/growth/i.test(fund.option??'')&&!/bonus/i.test(fund.option??'')?'Growth':/idcw|dividend|payout|reinvest/i.test(fund.option??'')?'IDCW':'Unknown';
const selected=(value:unknown, values:readonly string[])=>!values.length||values.some(item=>norm(item)===norm(value));
const searchable=(fund:Fund)=>[fund.name,fund.amc,fund.subCategory,fund.category,fund.option,fund.plan,fund.assetClass].map(norm);

function acceptsMetric(fund:Fund, filter:MetricFilter){const value=fund.metrics?.[filter.id];if(typeof value!=='number'||!Number.isFinite(value))return !(filter.excludeMissing||filter.min!==null||filter.max!==null);return (filter.min===null||value>=filter.min)&&(filter.max===null||value<=filter.max);}
function accepts(fund:Fund, filters:ScreenerFilters, now:number, include:ReadonlySet<ScreenerFacet>){
  const has=(facet:ScreenerFacet)=>include.has(facet);
  if(has('structure')&&!selected(structureOf(fund),filters.structure))return false;
  if(has('plan')&&!selected(planOf(fund),filters.plan))return false;
  if(has('option')&&!selected(optionOf(fund),filters.option))return false;
  if(has('categories')&&!selected(fund.subCategory||'Unknown',filters.categories))return false;
  if(has('amcs')&&!selected(fund.amc||'Unknown',filters.amcs))return false;
  if(has('assetClasses')&&!selected(fund.assetClass||'Unknown',filters.assetClasses))return false;
  if(has('statuses')&&!selected(fund.classStatus||'Unknown',filters.statuses))return false;
  if(has('hideStaleNav')&&filters.hideStaleNav&&(!Number.isFinite(fund.navDate)||now/86_400_000-fund.navDate>10))return false;
  if(has('metrics')&&!filters.metrics.every(filter=>acceptsMetric(fund,filter)))return false;
  const query=norm(filters.search); if(has('search')&&query&&!searchable(fund).some(value=>value.includes(query)))return false;
  return true;
}

const ordered:Array<[string,ScreenerFacet]>=[['Open-ended','structure'],['Plan','plan'],['Option','option'],['Categories','categories'],['Fund houses','amcs'],['Asset class','assetClasses'],['Classification','statuses'],['NAV freshness','hideStaleNav'],['Metrics','metrics'],['Search','search']];
const allFacets=new Set<ScreenerFacet>(ordered.map(([,facet])=>facet));
const valuesFor=(fund:Fund,facet:ScreenerFacet):string=>facet==='structure'?structureOf(fund):facet==='plan'?planOf(fund):facet==='option'?optionOf(fund):facet==='categories'?fund.subCategory||'Unknown':facet==='amcs'?fund.amc||'Unknown':facet==='assetClasses'?fund.assetClass||'Unknown':fund.classStatus||'Unknown';
const indexedFacets=['categories','amcs','assetClasses','statuses'] as const;
const facetLabel=(fund:Fund,facet:typeof indexedFacets[number])=>String(valuesFor(fund,facet)||'Unknown').trim()||'Unknown';
const orderedFacetIndex=new Map(ordered.map(([,facet],index)=>[facet,index]));

/** Computes visible rows and all checklist counts in one pass over the catalog. */
export function computeScreenerView(funds:Fund[],filters:ScreenerFilters,now=Date.now()):ScreenerView{
  const selections={
    structure:new Set(filters.structure.map(norm)),
    plan:new Set(filters.plan.map(norm)),
    option:new Set(filters.option.map(norm)),
    categories:new Set(filters.categories.map(norm)),
    amcs:new Set(filters.amcs.map(norm)),
    assetClasses:new Set(filters.assetClasses.map(norm)),
    statuses:new Set(filters.statuses.map(norm)),
  };
  const query=norm(filters.search);
  const labels:Record<typeof indexedFacets[number],Map<string,string>>={categories:new Map(),amcs:new Map(),assetClasses:new Map(),statuses:new Map()};
  const counts:Record<typeof indexedFacets[number],Map<string,number>>={categories:new Map(),amcs:new Map(),assetClasses:new Map(),statuses:new Map()};
  const rows:Fund[]=[];
  const funnelCounts=Array<number>(ordered.length+1).fill(0);
  funnelCounts[0]=funds.length;

  for(const fund of funds){
    const values={
      structure:structureOf(fund),
      plan:planOf(fund),
      option:optionOf(fund),
      categories:facetLabel(fund,'categories'),
      amcs:facetLabel(fund,'amcs'),
      assetClasses:facetLabel(fund,'assetClasses'),
      statuses:facetLabel(fund,'statuses'),
    };
    for(const facet of indexedFacets){const label=values[facet];const key=norm(label);if(key&&!labels[facet].has(key))labels[facet].set(key,label);}

    const checks=[
      !selections.structure.size||selections.structure.has(norm(values.structure)),
      !selections.plan.size||selections.plan.has(norm(values.plan)),
      !selections.option.size||selections.option.has(norm(values.option)),
      !selections.categories.size||selections.categories.has(norm(values.categories)),
      !selections.amcs.size||selections.amcs.has(norm(values.amcs)),
      !selections.assetClasses.size||selections.assetClasses.has(norm(values.assetClasses)),
      !selections.statuses.size||selections.statuses.has(norm(values.statuses)),
      !filters.hideStaleNav||(Number.isFinite(fund.navDate)&&now/86_400_000-fund.navDate<=10),
      filters.metrics.every(filter=>acceptsMetric(fund,filter)),
      !query||[fund.name,fund.amc,fund.subCategory,fund.category,fund.option,fund.plan,fund.assetClass].some(value=>norm(value).includes(query)),
    ];

    let prefix=true;
    for(let index=0;index<checks.length;index++){prefix=prefix&&checks[index]!;if(prefix)funnelCounts[index+1]=funnelCounts[index+1]!+1;}
    if(prefix)rows.push(fund);

    for(const facet of indexedFacets){
      const excludedIndex=orderedFacetIndex.get(facet)!;
      let matchesOthers=true;
      for(let index=0;index<checks.length;index++)if(index!==excludedIndex&&!checks[index]){matchesOthers=false;break;}
      if(matchesOthers){const key=norm(values[facet]);counts[facet].set(key,(counts[facet].get(key)??0)+1);}
    }
  }

  const facetResults=Object.fromEntries(indexedFacets.map(facet=>[
    facet,[...labels[facet].entries()].map(([key,value])=>{const count=counts[facet].get(key)??0;return {value,count,disabled:count===0};}).sort((a,b)=>a.value.localeCompare(b.value)),
  ])) as ScreenerView['facets'];
  return {rows,funnel:[{step:'All funds',remaining:funds.length},...ordered.map(([step],index)=>({step,remaining:funnelCounts[index+1]??funds.length}))],facets:facetResults};
}

export function applyFilters(funds:Fund[],filters:ScreenerFilters,now=Date.now()):FilterResult{const {rows,funnel}=computeScreenerView(funds,filters,now);return {rows,funnel};}

const fixedValues:Partial<Record<ScreenerFacet,string[]>>={structure:['open','close','interval','unknown'],plan:['Direct','Regular','Unknown'],option:['Growth','IDCW','Unknown']};
/** Counts values against every other filter; zero-count choices stay visible but disabled. */
export function facetOptions(funds:Fund[],filters:ScreenerFilters,facet:ScreenerFacet,now=Date.now()):FacetOption[]{
  if(facet==='categories'||facet==='amcs'||facet==='assetClasses'||facet==='statuses')return computeScreenerView(funds,filters,now).facets[facet];
  const other=new Set(allFacets);other.delete(facet);const candidates=funds.filter(fund=>accepts(fund,filters,now,other));const labels=new Map<string,string>();for(const value of fixedValues[facet]??funds.map(fund=>valuesFor(fund,facet))){const label=String(value||'Unknown').trim()||'Unknown';if(!labels.has(norm(label)))labels.set(norm(label),label);}return [...labels.values()].map(value=>{const count=candidates.filter(fund=>norm(valuesFor(fund,facet))===norm(value)).length;return {value,count,disabled:count===0};}).sort((a,b)=>a.value.localeCompare(b.value));
}
/** Each changed facet is one active filter, regardless of its selected value count. */
export function activeFacetCount(filters:ScreenerFilters):number{const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);return Number(Boolean(filters.search.trim()))+Number(!same(filters.structure,defaultScreenerFilters.structure))+Number(!same(filters.plan,defaultScreenerFilters.plan))+Number(!same(filters.option,defaultScreenerFilters.option))+Number(filters.categories.length>0)+Number(filters.amcs.length>0)+Number(filters.assetClasses.length>0)+Number(filters.statuses.length>0)+Number(filters.hideStaleNav)+Number(filters.metrics.length>0);}
/** Reads legacy pipe/sentinel screens without preserving their old state model. */
export function migrateSavedScreen(value:unknown):ScreenerFilters{const legacy=value&&typeof value==='object'?value as Record<string,unknown>:{};const list=(input:unknown,sentinel:string)=>Array.isArray(input)?input.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean):typeof input==='string'&&norm(input)!==norm(sentinel)?input.split('|').map(item=>item.trim()).filter(Boolean):[];const rawMetrics=legacy.metrics??legacy.addedFilters;const metrics=Array.isArray(rawMetrics)?rawMetrics.filter((item:unknown):item is MetricFilter=>Boolean(item)&&typeof item==='object'&&typeof (item as MetricFilter).id==='string'):[];return {search:typeof legacy.search==='string'?legacy.search:'',structure:list(legacy.structure,'All structures') as StructureFilter[],plan:legacy.plan==='Both'||legacy.plan==='All'?[]:list(legacy.plan,'All plans') as PlanFilter[],option:legacy.option==='All'?[]:list(legacy.option,'All options') as OptionFilter[],categories:list(legacy.categories??legacy.category,'All categories'),amcs:list(legacy.amcs??legacy.amc,'All AMCs'),assetClasses:list(legacy.assetClasses??legacy.assetClassFilter,'All asset classes'),statuses:list(legacy.statuses??legacy.classificationStatusFilter,'All statuses'),hideStaleNav:legacy.hideStaleNav===true,metrics};}
