import type { Fund } from '../types';
import { applyLocalMetricBundle, computeMetricBundle } from './compute';
import { applyRelativeMetrics } from './relative';
import { applySebiHoldingHeuristics } from '../disclosures/sebiHeuristics';
import { markMissingDisclosureMetrics } from '../../adapters/amfi_disclosures';
import { fillBlankSchemeDimensions } from '../parse/schemeName';
import { attachBenchmarkHistories } from '../../app/benchmarks';
import { applyClassificationPlausibility } from '../taxonomy/classificationPipeline';
import type { GrowthChartInput, GrowthChartModel } from './growthChart';

export function computeGrowthChartInWorker(funds:GrowthChartInput[],days=365*5,signal?:AbortSignal):Promise<GrowthChartModel>{
  if(typeof Worker==='undefined')return Promise.reject(new Error('A chart worker is not available in this runtime.'));
  if(signal?.aborted)return Promise.reject(new DOMException('Chart calculation was cancelled.','AbortError'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./metrics.worker.ts',import.meta.url),{type:'module',name:'fundscope-growth-chart'});
    const cleanup=()=>{signal?.removeEventListener('abort',onAbort);worker.terminate();};
    const onAbort=()=>{cleanup();reject(new DOMException('Chart calculation was cancelled.','AbortError'));};
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.onmessage=event=>{if(event.data?.type==='growth-chart-result'){cleanup();resolve(event.data.model as GrowthChartModel);}else if(event.data?.type==='growth-chart-error'){cleanup();reject(new Error(event.data.message??'Chart calculation failed.'));}};
    worker.onerror=error=>{cleanup();reject(error);};
    try{worker.postMessage({type:'growth-chart',funds,days});}catch(error){cleanup();reject(error);}
  });
}

const computeLocally=(funds:Fund[],riskWindow:number,riskFreeRate:number)=>funds.map(fund=>{
  return applyLocalMetricBundle(fund,computeMetricBundle(fund,riskWindow,riskFreeRate));
});

export async function computeFundsInWorker(funds:Fund[],riskWindow:number,riskFreeRate:number,options:{fetchBenchmarkSeries?:boolean}={}):Promise<Fund[]>{
  const prepared=funds.map(fillBlankSchemeDimensions);
  const {funds:withBenchmarks,seriesById}=options.fetchBenchmarkSeries===false?{funds:prepared,seriesById:{}}:await attachBenchmarkHistories(prepared);
  if(typeof Worker==='undefined'||prepared.length<100)return applyClassificationPlausibility(applyRelativeMetrics(computeLocally(withBenchmarks,riskWindow,riskFreeRate).map(markMissingDisclosureMetrics).map(applySebiHoldingHeuristics),riskWindow,riskFreeRate,seriesById),seriesById).filter(fund=>prepared.some(original=>original.code===fund.code));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./metrics.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=event=>{
      const computed=new Map((event.data as {code:number;metrics:Fund['metrics'];metricReasons:NonNullable<Fund['metricReasons']>;metricReasonDetails:Fund['metricReasonDetails'];metricFlags:Fund['metricFlags'];metricProvenance:Fund['metricProvenance'];classDetail:Fund['classDetail']}[]).map(item=>[item.code,item]));
      worker.terminate();resolve(prepared.map(fund=>({...fund,...computed.get(fund.code)})));
    };
    worker.onerror=error=>{worker.terminate();reject(error);};worker.postMessage({funds:withBenchmarks,seriesById,riskWindow,riskFreeRate});
  });
}
