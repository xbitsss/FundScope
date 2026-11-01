import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { z } from 'zod';
import { parseAmfiNavAllFile, parsedAmfiNavToFunds } from '../domain/parse/amfi';
import { previousConflictFrom, reconcileClassification } from '../domain/taxonomy/consensus';
import type { Fund, NavPoint } from '../domain/types';
import { getFunds, reconcileFundTaxonomy, saveFunds, saveSchemeMasterRows, setSourceStatus } from './persistence';

const apiNavSchema=z.object({meta:z.object({fund_house:z.string().optional(),scheme_type:z.string().optional(),scheme_category:z.string().optional(),scheme_code:z.number(),scheme_name:z.string()}).passthrough(),data:z.array(z.object({date:z.string(),nav:z.string()})),status:z.string()});
const monthMap:Record<string,number>={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function parseMfapiDate(raw:string):number|null{const m=/^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);if(!m)return null;return Math.floor(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]))/86400000);}
const safeFetch=(url:string,init?:RequestInit)=>('__TAURI_INTERNALS__' in window?tauriFetch(url,init):fetch(url,init));
async function fetchWithTimeout(url:string,init:RequestInit|undefined,timeoutMs:number):Promise<Response>{
  const controller=new AbortController();const callerSignal=init?.signal;const abortFromCaller=()=>controller.abort(callerSignal?.reason);
  if(callerSignal?.aborted)abortFromCaller();else callerSignal?.addEventListener('abort',abortFromCaller,{once:true});
  const timer=window.setTimeout(()=>controller.abort(new Error('Request timed out.')),timeoutMs);
  try{return await safeFetch(url,{...init,signal:controller.signal});}
  catch(error){if(controller.signal.aborted&&!callerSignal?.aborted)throw new Error(`Request timed out after ${Math.round(timeoutMs/1000)} seconds.`);throw error;}
  finally{window.clearTimeout(timer);callerSignal?.removeEventListener('abort',abortFromCaller);}
}
function errorMessage(error:unknown):string{
  if(error instanceof Error)return error.message;
  if(typeof error==='string')return error;
  try{return JSON.stringify(error);}catch{return 'Unknown network error';}
}
export async function refreshCatalog(riskWindow=3,riskFreeRate=6.5,onStage?:(stage:string)=>void):Promise<{funds:Fund[],asOf:number}>{
  try{
    onStage?.('Downloading the AMFI catalog…');
    const response=await fetchWithTimeout('https://portal.amfiindia.com/spages/NAVAll.txt',undefined,20_000);
    if(!response.ok)throw new Error(`AMFI returned HTTP ${response.status}`);
    const text=await response.text();onStage?.('Reading scheme data…');const parsed=parseAmfiNavAllFile(text);
    if(!parsed.diagnostics.shapeValid)throw new Error(`AMFI file shape check failed: ${parsed.diagnostics.parsedRowCount}/${parsed.diagnostics.candidateRowCount} data rows parsed; cached catalog was kept.`);
    const cached=await getFunds();const cachedByCode=new Map(cached.map(fund=>[fund.code,fund]));const parsedFunds=parsedAmfiNavToFunds(parsed).map(fund=>{const prior=cachedByCode.get(fund.code);if(!prior)return fund;const consensus=reconcileClassification({s1:{categoryRaw:fund.category,headerRaw:fund.headerRaw,observedAt:fund.navDate*86_400_000},s2:prior.classDetail?.s2?{categoryRaw:prior.classDetail.s2.categoryRaw,observedAt:prior.classDetail.s2.observedAt}:undefined,s3:prior.classDetail?.s3?{categoryRaw:prior.classDetail.s3.categoryRaw,observedAt:prior.classDetail.s3.observedAt}:undefined,schemeName:fund.name,evaluatedAt:Date.now(),previousConflict:previousConflictFrom(prior.classDetail,prior.classStatus),previousReview:prior.classDetail?.review});return {...fund,classStatus:consensus.status,classDetail:consensus.detail};});const funds=await reconcileFundTaxonomy(parsedFunds);
    if(!funds.length)throw new Error('AMFI returned no usable NAV rows.');
    await saveSchemeMasterRows(parsed.schemes,funds,cached);
    onStage?.(`Preparing ${funds.length.toLocaleString('en-IN')} schemes…`);
    const byCode=cachedByCode;
    for(const fund of funds){
      const prior=byCode.get(fund.code);
      if(prior){
        const history=[...prior.history];const latest=history.at(-1);
        if(!latest||fund.navDate>latest.date)history.push({date:fund.navDate,nav:fund.nav});
        fund.history=history;fund.historyFetchedAt=prior.historyFetchedAt;fund.metricsNavAsOf=prior.metricsNavAsOf;
        fund.metrics={...prior.metrics};fund.metricReasons={...prior.metricReasons};fund.metricReasonDetails={...prior.metricReasonDetails};fund.metricFlags={...prior.metricFlags};fund.metricProvenance={...prior.metricProvenance};fund.metricAsOf={...prior.metricAsOf};
      }else fund.metrics={};
    }
    await saveFunds(funds,(saved,total)=>onStage?.(`Saving scheme data… ${saved.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')}`));
    const asOf=Math.max(...funds.map(f=>f.navDate));
    await setSourceStatus({fetchedAt:Date.now(),dataAsOf:asOf*86400000,status:'ok',detail:`${funds.length.toLocaleString('en-IN')} schemes loaded from AMFI.`});
    onStage?.('Catalog ready.');
    return {funds,asOf};
  }catch(error){
    const message=errorMessage(error);
    await setSourceStatus({fetchedAt:Date.now(),dataAsOf:null,status:'error',detail:message});
    throw error;
  }
}
export interface LoadedSchemeHistory { history: NavPoint[]; schemeCategory: string | null; schemeName: string; fetchedAt: number }
export async function loadSchemeHistoryWithMetadata(code:number, signal?:AbortSignal):Promise<LoadedSchemeHistory>{
  let lastError:unknown;
  for(let attempt=0;attempt<4;attempt++){
    try{
      const response=await fetchWithTimeout(`https://api.mfapi.in/mf/${code}`,{signal},12_000);
      if(response.status===429||response.status>=500){if(attempt===3)throw new Error(`MFapi returned HTTP ${response.status}`);const header=response.headers.get('retry-after');const retryMs=header&&Number.isFinite(Number(header))?Math.max(500,Number(header)*1000):500*2**attempt;await new Promise(resolve=>setTimeout(resolve,retryMs));continue;}
      if(!response.ok)throw new Error(`MFapi returned HTTP ${response.status}`);
      const payload=apiNavSchema.parse(await response.json());if(payload.status!=='SUCCESS')throw new Error(`MFapi status: ${payload.status}`);
      const history=payload.data.flatMap(item=>{const date=parseMfapiDate(item.date);const nav=Number(item.nav);return date!==null&&Number.isFinite(nav)&&nav>0?[{date,nav}]:[];}).reverse();
      if(!history.length)throw new Error('MFapi returned an empty history.');
      return {history,schemeCategory:payload.meta.scheme_category??null,schemeName:payload.meta.scheme_name,fetchedAt:Date.now()};
    }catch(error){lastError=error;if(signal?.aborted||attempt===3)throw error;const message=error instanceof Error?error.message:'';if(/timed out/i.test(message)||(/HTTP 4\d\d/.test(message)&&!message.includes('HTTP 429')))throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt));}
  }
  throw lastError instanceof Error?lastError:new Error('Unable to load MFapi history.');
}
export async function loadSchemeHistory(code:number,signal?:AbortSignal):Promise<NavPoint[]>{return (await loadSchemeHistoryWithMetadata(code,signal)).history;}
export async function backfillSelectedHistory(funds:Fund[],codes:number[],onProgress:(done:number,total:number)=>void):Promise<{updated:Fund[],loaded:number,failed:number}>{
  let next=0,done=0,loaded=0,failed=0;const byCode=new Map(funds.map(fund=>[fund.code,fund]));const updated:Fund[]=[];
  const worker=async()=>{
    while(true){
      const index=next++;if(index>=codes.length)return;
      const code=codes[index]!;
      try{const result=await loadSchemeHistoryWithMetadata(code);const fund=byCode.get(code);if(!fund)throw new Error('Scheme is not in the local catalog.');fund.history=result.history;fund.historyFetchedAt=result.fetchedAt;
        if(result.schemeCategory){const s1ObservedAt=fund.classDetail?.s1.observedAt??fund.navDate*86_400_000;const consensus=reconcileClassification({s1:{categoryRaw:fund.category,headerRaw:fund.headerRaw,observedAt:s1ObservedAt},s2:{categoryRaw:result.schemeCategory,observedAt:result.fetchedAt},s3:fund.classDetail?.s3?{categoryRaw:fund.classDetail.s3.categoryRaw,observedAt:fund.classDetail.s3.observedAt}:undefined,schemeName:fund.name,evaluatedAt:result.fetchedAt,previousConflict:previousConflictFrom(fund.classDetail,fund.classStatus),previousReview:fund.classDetail?.review});fund.classStatus=consensus.status;fund.classDetail=consensus.detail;}
        updated.push(fund);loaded++;}catch{failed++;}
      done++;onProgress(done,codes.length);
      if(next<codes.length)await new Promise(resolve=>setTimeout(resolve,120));
    }
  };
  await Promise.all(Array.from({length:Math.min(3,codes.length)},worker));
  // Persist each successfully fetched series immediately. Metric computation runs
  // in the Web Worker in the caller, keeping long NAV loops off the UI thread.
  if(updated.length)await saveFunds(updated);
  return {updated,loaded,failed};
}
