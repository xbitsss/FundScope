import type { Fund, MetricReason, NavPoint } from '../types';
import type { BenchmarkSeriesById } from '../benchmarks/types';
import { benchmarkConfig, resolveBenchmark } from '../../config/benchmarks';
import { evaluateBenchmarkRegression } from '../benchmarks/gate';
import { alignNavLevels, alignedReturns as levelsToReturns } from '../stats/align';
import type { ReasonDetail } from '../governance/reasons';

const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!:((sorted[middle-1]??0)+(sorted[middle]??0))/2;};
const peerKey=(fund:Fund)=>`${fund.assetClass}\u0000${fund.subCategory}`;

/** Align price levels first, then calculate returns only across identical common-date intervals. */
export function alignedReturns(fundHistory:NavPoint[],benchmarkHistory:NavPoint[]):Array<[number,number]>{
  if(!fundHistory.length||!benchmarkHistory.length)return [];const from=Math.max(fundHistory[0]!.date,benchmarkHistory[0]!.date);const to=Math.min(fundHistory.at(-1)!.date,benchmarkHistory.at(-1)!.date);const levels=alignNavLevels(fundHistory,benchmarkHistory,from,to);if(!levels)return [];const returns=levelsToReturns(levels);if(!returns)return [];return Array.from({length:returns.nObs},(_,index)=>[returns.rf[index]!,returns.rb[index]!] as [number,number]);
}

const peerRankMetrics=[
  {id:'sharpe',lowerIsBetter:false},
  {id:'rolling_3y_average_return',lowerIsBetter:false},
  {id:'return_vs_subcategory_3y',lowerIsBetter:false},
  {id:'return_vs_subcategory_5y',lowerIsBetter:false},
  {id:'std_dev',lowerIsBetter:true},
  {id:'cagr_5y',lowerIsBetter:false},
  {id:'cagr_10y',lowerIsBetter:false},
] as const;

/** Cross-sectional calculations need only fund metrics, never the bulky NAV arrays. */
export function applyPeerMetrics(funds:Fund[]):Fund[]{
  const asOf=Math.max(0,...funds.map(fund=>fund.navDate));const groups=new Map<string,Fund[]>();
  const isActive=(fund:Fund)=>fund.structure==='open'&&fund.navDate>=asOf-10&&/growth/i.test(fund.option)&&!/bonus/i.test(fund.option);
  for(const fund of funds)if(isActive(fund)){const key=peerKey(fund);const group=groups.get(key)??[];group.push(fund);groups.set(key,group);}
  const stats=new Map<string,Map<number,{median:number;count:number}>>();
  const ranks=new Map<string,Map<number,Map<string,{rank:number;percentile:number;count:number}>>>();
  for(const [category,peers] of groups){
    const valuesByWindow=new Map<number,{median:number;count:number}>();
    for(const years of [1,3,5]){const values=peers.map(peer=>peer.metrics[`cagr_${years}y`]).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));if(values.length)valuesByWindow.set(years,{median:median(values),count:values.length});}
    const volatility=peers.map(peer=>peer.metrics.std_dev).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));if(volatility.length)valuesByWindow.set(-1,{median:median(volatility),count:volatility.length});
    const peerPe=peers.map(peer=>peer.metrics.pe_ratio).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));if(peerPe.length)valuesByWindow.set(-2,{median:median(peerPe),count:peerPe.length});
    const peerYtm=peers.map(peer=>peer.metrics.average_ytm).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));if(peerYtm.length)valuesByWindow.set(-3,{median:median(peerYtm),count:peerYtm.length});
    stats.set(category,valuesByWindow);
    const byCode=new Map<number,Map<string,{rank:number;percentile:number;count:number}>>();
    for(const metric of peerRankMetrics){
      const values=peers.flatMap(peer=>{const sourceId=metric.id==='return_vs_subcategory_3y'?'cagr_3y':metric.id==='return_vs_subcategory_5y'?'cagr_5y':metric.id;const value=peer.metrics[sourceId];return typeof value==='number'&&Number.isFinite(value)?[{code:peer.code,value}]:[];}).sort((left,right)=>metric.lowerIsBetter?left.value-right.value:right.value-left.value);
      let start=0;
      while(start<values.length){let end=start+1;while(end<values.length&&values[end]!.value===values[start]!.value)end++;const rank=((start+1)+end)/2;const percentile=values.length<=1?100:(values.length-rank)/(values.length-1)*100;for(let index=start;index<end;index++){const row=byCode.get(values[index]!.code)??new Map<string,{rank:number;percentile:number;count:number}>();row.set(metric.id,{rank,percentile,count:values.length});byCode.set(values[index]!.code,row);}start=end;}
    }
    ranks.set(category,byCode);
  }
  return funds.map(fund=>{const metrics={...fund.metrics};const reasons={...fund.metricReasons};const details={...fund.metricReasonDetails};const provenance={...fund.metricProvenance};const active=isActive(fund);const categoryStats=stats.get(peerKey(fund));
    for(const years of [1,3,5]){const id=`return_vs_subcategory_${years}y`;const own=metrics[`cagr_${years}y`];const peers=categoryStats?.get(years);if(active&&own!=null&&peers&&peers.count>=3){metrics[id]=own-peers.median;delete reasons[id];delete details[id];provenance[id]='PEER_MEDIAN';}else{metrics[id]=null;reasons[id]=own==null?'INSUFFICIENT_HISTORY':'TOO_FEW_SAMPLES';if(own!=null)details[id]={code:'TOO_FEW_SAMPLES',cause:'PEER_GROUP_BELOW_MIN',detail:{actual:peers?.count??0,required:3}};delete provenance[id];}}
    const peerVolatility=categoryStats?.get(-1);if(active&&peerVolatility&&peerVolatility.count>=3){metrics.category_std_dev=peerVolatility.median;delete reasons.category_std_dev;delete details.category_std_dev;provenance.category_std_dev='PEER_MEDIAN';}else{metrics.category_std_dev=null;reasons.category_std_dev=fund.metrics.std_dev==null?'INSUFFICIENT_HISTORY':'TOO_FEW_SAMPLES';if(fund.metrics.std_dev!=null)details.category_std_dev={code:'TOO_FEW_SAMPLES',cause:'PEER_GROUP_BELOW_MIN',detail:{actual:peerVolatility?.count??0,required:3}};delete provenance.category_std_dev;}
    const peerPeStats=categoryStats?.get(-2);if(active&&peerPeStats&&peerPeStats.count>=3){metrics.category_pe_ratio=peerPeStats.median;delete reasons.category_pe_ratio;delete details.category_pe_ratio;provenance.category_pe_ratio=provenance.category_pe_ratio??'PEER_MEDIAN';}
    const peerYtmStats=categoryStats?.get(-3);if(active&&peerYtmStats&&peerYtmStats.count>=3){metrics.category_ytm=peerYtmStats.median;delete reasons.category_ytm;delete details.category_ytm;provenance.category_ytm=provenance.category_ytm??'PEER_MEDIAN';}
    const peerRanks=ranks.get(peerKey(fund))?.get(fund.code);
    for(const metric of peerRankMetrics){const rankId=`peer_rank_${metric.id}`;const percentileId=`peer_percentile_${metric.id}`;const sourceId=metric.id==='return_vs_subcategory_3y'?'cagr_3y':metric.id==='return_vs_subcategory_5y'?'cagr_5y':metric.id;const result=peerRanks?.get(metric.id);if(active&&result&&result.count>=3){metrics[rankId]=result.rank;metrics[percentileId]=result.percentile;delete reasons[rankId];delete reasons[percentileId];delete details[rankId];delete details[percentileId];}else{metrics[rankId]=null;metrics[percentileId]=null;reasons[rankId]=!active?'NOT_APPLICABLE':fund.metrics[sourceId]==null?'INSUFFICIENT_HISTORY':'TOO_FEW_SAMPLES';reasons[percentileId]=reasons[rankId]!;if(!active){details[rankId]={code:'NOT_APPLICABLE',cause:'OUTSIDE_ACTIVE_PEER_UNIVERSE'};details[percentileId]={code:'NOT_APPLICABLE',cause:'OUTSIDE_ACTIVE_PEER_UNIVERSE'};}}}
    return {...fund,metrics,metricReasons:reasons,metricReasonDetails:details,metricProvenance:provenance};
  });
}

const benchmarkMetricIds=['beta','r_squared','jensen_alpha','treynor','information_ratio','tracking_error','upside_capture','downside_capture','benchmark_outperformance_ratio'];
/** Applies peer medians and obtains every benchmark-relative result through the typed compliance gate. */
export function applyRelativeMetrics(funds:Fund[],riskWindow:number,riskFreeRate:number,seriesById:BenchmarkSeriesById={}):Fund[]{
  const safeRiskWindow:1|3|5=riskWindow===1||riskWindow===5?riskWindow:3;
  return applyPeerMetrics(funds).map(fund=>{const metrics={...fund.metrics};const reasons={...fund.metricReasons};const details={...fund.metricReasonDetails};const provenance={...fund.metricProvenance};const flags={...fund.metricFlags};const resolution=resolveBenchmark(fund);const series=resolution.ok?seriesById[resolution.benchmark.id]:undefined;
    const result=evaluateBenchmarkRegression({fund,benchmarkHistory:series?.history??[],benchmarkAsOf:series?.history.at(-1)?.date??0,benchmarkReturnBasis:series?.returnBasis??'UNKNOWN',riskWindow:safeRiskWindow,riskFreeRate,maxSeriesAgeDays:benchmarkConfig?.max_series_age_days??10,fit:resolution.ok?resolution.fit:'category_standard'},resolution);metrics.benchmark_overlap_days=result.overlapDays;
    for(const id of benchmarkMetricIds){metrics[id]=result.metrics[id]??null;const reason=result.reasons[id];if(reason){reasons[id]=reason;const detail=result.reasonDetails[id];if(detail)details[id]=detail;}else{delete reasons[id];delete details[id];}if(metrics[id]!=null)provenance[id]='BENCHMARK_PROXY';else delete provenance[id];flags[id]=result.flags;}
    return {...fund,metrics,metricReasons:reasons,metricReasonDetails:details,metricProvenance:provenance,metricFlags:flags};
  });
}
