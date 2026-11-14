import type { Fund } from '../types';
import { applyPeerMetrics } from './relative';
import type { PeerGroupMode, ScoreFactor } from '../scoring/engine';

type PeerResult=Pick<Fund,'code'|'metrics'|'metricReasons'|'metricReasonDetails'|'metricProvenance'>;

/** Recomputes peer markers and persistent model scores without copying NAV arrays into another worker. */
export function computePeerMetricsInWorker(funds:Fund[],factors?:ScoreFactor[],peerGroup?:PeerGroupMode):Promise<Fund[]>{
  if(typeof Worker==='undefined'||funds.length<100)return Promise.resolve(applyPeerMetrics(funds,factors,peerGroup));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./peerMetrics.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(event:MessageEvent<PeerResult[]>)=>{const byCode=new Map(event.data.map(result=>[result.code,result]));worker.terminate();resolve(funds.map(fund=>{const result=byCode.get(fund.code);return result?{...fund,metrics:{...fund.metrics,...result.metrics},metricReasons:{...fund.metricReasons,...result.metricReasons},metricReasonDetails:{...fund.metricReasonDetails,...result.metricReasonDetails},metricProvenance:{...fund.metricProvenance,...result.metricProvenance}}:fund;}));};
    worker.onerror=error=>{worker.terminate();reject(error);};
    worker.postMessage({funds:funds.map(fund=>({...fund,history:[]})),factors,peerGroup});
  });
}
