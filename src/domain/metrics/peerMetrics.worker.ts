import type { Fund } from '../types';
import { applyPeerMetrics } from './relative';
import type { PeerGroupMode, ScoreFactor } from '../scoring/engine';

type PeerResult=Pick<Fund,'code'|'metrics'|'metricReasons'|'metricReasonDetails'|'metricProvenance'>;
type WorkerInput=Fund[]|{funds:Fund[];factors?:ScoreFactor[];peerGroup?:PeerGroupMode};
type WorkerScope={onmessage:((event:MessageEvent<WorkerInput>)=>void)|null;postMessage:(message:PeerResult[])=>void};
const scope=self as unknown as WorkerScope;
scope.onmessage=(event:MessageEvent<WorkerInput>)=>{
  const rawFunds=Array.isArray(event.data)?event.data:event.data.funds;
  const factors=Array.isArray(event.data)?undefined:event.data.factors;
  const peerGroup=Array.isArray(event.data)?undefined:event.data.peerGroup;
  const summaryFunds=rawFunds.map(fund=>({...fund,history:[]}));
  const results=applyPeerMetrics(summaryFunds,factors,peerGroup) as PeerResult[];
  scope.postMessage(results);
};
