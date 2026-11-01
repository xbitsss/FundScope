import { z } from 'zod';
import type { Fund, NavPoint } from '../domain/types';
import { benchmarkConfig, resolveBenchmark, type BenchmarkDefinition } from '../config/benchmarks';
import type { BenchmarkSeriesById } from '../domain/benchmarks/types';
import { getBenchmarkSeries, saveBenchmarkSeries } from './persistence';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { alignByDate } from '../domain/stats/align';

const apiSchema=z.object({meta:z.object({scheme_code:z.number(),scheme_name:z.string()}).passthrough(),data:z.array(z.object({date:z.string(),nav:z.string()})),status:z.string()});
const epochDay=(value:string):number|null=>{const match=/^(\d{2})-(\d{2})-(\d{4})$/.exec(value);return match?Math.floor(Date.UTC(Number(match[3]),Number(match[2])-1,Number(match[1]))/86_400_000):null;};
const fetchSource=(url:string)=>('__TAURI_INTERNALS__' in window?tauriFetch(url,{cache:'no-store'}):fetch(url,{cache:'no-store'}));

async function historyForProxy(code:number,name:string):Promise<{history:NavPoint[];schemeName:string;fetchedAt:number}>{
  const cached=await getBenchmarkSeries(code);if(cached?.history.length&&Date.now()-cached.fetchedAt<86_400_000)return {history:cached.history,schemeName:cached.schemeName,fetchedAt:cached.fetchedAt};
  try{
    const response=await fetchSource(`https://api.mfapi.in/mf/${code}`);if(!response.ok)throw new Error(`MFapi benchmark request returned HTTP ${response.status}`);
    const payload=apiSchema.parse(await response.json());if(payload.status!=='SUCCESS'||payload.meta.scheme_code!==code)throw new Error('MFapi returned a different or unsuccessful benchmark series.');
    const history=payload.data.flatMap(point=>{const date=epochDay(point.date);const nav=Number(point.nav);return date!==null&&Number.isFinite(nav)&&nav>0?[{date,nav}]:[];}).reverse();
    if(!history.length)throw new Error('MFapi benchmark response did not contain usable NAV history.');
    const fetchedAt=Date.now();await saveBenchmarkSeries({schemeCode:code,schemeName:payload.meta.scheme_name||name,fetchedAt,history});return {history,schemeName:payload.meta.scheme_name||name,fetchedAt};
  }catch(error){if(cached?.history.length)return {history:cached.history,schemeName:cached.schemeName,fetchedAt:cached.fetchedAt};throw error;}
}

export function buildCompositeSeries(components:Array<{history:NavPoint[];weight:number}>):NavPoint[]{
  if(components.length<2||Math.abs(components.reduce((sum,component)=>sum+component.weight,0)-1)>1e-9)return [];
  const latestStart=Math.max(...components.map(component=>component.history[0]?.date??Infinity));const earliestEnd=Math.min(...components.map(component=>component.history.at(-1)?.date??-Infinity));if(!Number.isFinite(latestStart)||latestStart>=earliestEnd)return [];
  let dates=components[0]!.history.map(point=>point.date).filter(date=>date>=latestStart&&date<=earliestEnd);for(const component of components.slice(1)){const set=new Set(component.history.map(point=>point.date));dates=dates.filter(date=>set.has(date));}
  if(dates.length<2)return [];const lookups=components.map(component=>new Map(component.history.map(point=>[point.date,point.nav])));const levels:NavPoint[]=[{date:dates[0]!,nav:100}];let nav=100;
  for(let index=1;index<dates.length;index++){const before=dates[index-1]!;const after=dates[index]!;if(after-before>7)continue;let blendedReturn=0;for(let component=0;component<components.length;component++){const oldLevel=lookups[component]!.get(before);const newLevel=lookups[component]!.get(after);if(!oldLevel||!newLevel)return [];blendedReturn+=components[component]!.weight*(newLevel/oldLevel-1);}nav*=1+blendedReturn;levels.push({date:after,nav});}
  return levels;
}

function definitionById(id:string):BenchmarkDefinition|undefined{return benchmarkConfig?.benchmarks.find(benchmark=>benchmark.id===id);}
function componentProxyIds(benchmark:BenchmarkDefinition):string[]{return benchmark.kind==='proxy'?[benchmark.id]:benchmark.components.map(component=>component.benchmark_id);}

export async function loadCachedBenchmarkSeries(benchmarkId:string):Promise<NavPoint[]|null>{
  const benchmark=definitionById(benchmarkId);if(!benchmark||benchmark.status!=='verified')return null;
  if(benchmark.kind==='proxy'){if(benchmark.scheme_code===null)return null;return (await getBenchmarkSeries(benchmark.scheme_code))?.history??null;}
  const loaded=[] as Array<{history:NavPoint[];weight:number}>;for(const component of benchmark.components){const definition=definitionById(component.benchmark_id);if(!definition||definition.kind!=='proxy'||definition.scheme_code===null)return null;const saved=await getBenchmarkSeries(definition.scheme_code);if(!saved)return null;loaded.push({history:saved.history,weight:component.weight});}return buildCompositeSeries(loaded);
}

/** Resolves only verified configuration entries and returns separate benchmark histories for the worker. */
export async function attachBenchmarkHistories(funds:Fund[]):Promise<{funds:Fund[];seriesById:BenchmarkSeriesById}>{
  if(!benchmarkConfig)return {funds,seriesById:{}};
  const needed=new Map<string,BenchmarkDefinition>();
  for(const fund of funds){const resolution=resolveBenchmark(fund);if(!resolution.ok)continue;for(const componentId of componentProxyIds(resolution.benchmark)){const definition=definitionById(componentId);if(definition?.kind==='proxy'&&definition.status==='verified')needed.set(definition.id,definition);}}
  const byId=new Map<string,{history:NavPoint[];fetchedAt:number;schemeName:string}>();
  await Promise.all([...needed].map(async([id,benchmark])=>{if(benchmark.kind!=='proxy'||benchmark.scheme_code===null)return;try{const result=await historyForProxy(benchmark.scheme_code,benchmark.display_name);byId.set(id,result);}catch{/* unresolved at runtime becomes a typed NO_BENCHMARK reason in the gate */}}));
  const seriesById:BenchmarkSeriesById={};for(const fund of funds){const resolution=resolveBenchmark(fund);if(!resolution.ok)continue;const benchmark=resolution.benchmark;let history:NavPoint[]=[];let fetchedAt=Date.now();let ready=true;
    if(benchmark.kind==='proxy'){const loaded=byId.get(benchmark.id);if(!loaded)ready=false;else{history=loaded.history;fetchedAt=loaded.fetchedAt;}}
    else{const histories=benchmark.components.map(component=>({definition:definitionById(component.benchmark_id),loaded:byId.get(component.benchmark_id),weight:component.weight}));if(histories.some(item=>item.definition?.kind!=='proxy'||!item.loaded))ready=false;else{history=buildCompositeSeries(histories.map(item=>({history:item.loaded!.history,weight:item.weight})));fetchedAt=Math.min(...histories.map(item=>item.loaded!.fetchedAt));}}
    if(ready)seriesById[benchmark.id]={benchmarkId:benchmark.id,displayName:benchmark.display_name,assetClass:benchmark.asset_class,kind:benchmark.kind,history,fetchedAt};
  }
  return {funds,seriesById};
}
