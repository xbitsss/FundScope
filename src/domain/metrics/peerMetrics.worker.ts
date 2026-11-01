import type { Fund } from '../types';
import { applyPeerMetrics } from './relative';

type PeerResult=Pick<Fund,'code'|'metrics'|'metricReasons'|'metricReasonDetails'|'metricProvenance'>;
type WorkerScope={onmessage:((event:MessageEvent<Fund[]>)=>void)|null;postMessage:(message:PeerResult[])=>void};
const scope=self as unknown as WorkerScope;
scope.onmessage=(event:MessageEvent<Fund[]>)=>{
  const summaryFunds=event.data.map(fund=>({...fund,history:[]}));
  const results=applyPeerMetrics(summaryFunds) as PeerResult[];
  scope.postMessage(results);
};
