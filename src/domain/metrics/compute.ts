import type { Fund, MetricReason, NavPoint } from '../types';

export type MetricBundle={metrics:Record<string,number|null>;reasons:Record<string,MetricReason>};
const riskIds=['std_dev','max_drawdown','var_95','semi_deviation','tail_risk_ratio','gain_loss_ratio','sharpe','sortino','omega','calmar'];
const nullMetric=(out:MetricBundle,id:string,reason:MetricReason)=>{out.metrics[id]=null;out.reasons[id]=reason;};
export function applyLocalMetricBundle(fund:Fund,bundle:MetricBundle):Fund{
  const metrics={...fund.metrics};const reasons={...fund.metricReasons};const metricProvenance={...fund.metricProvenance};
  for(const [id,value] of Object.entries(bundle.metrics)){
    const provenance=metricProvenance[id];
    if(metrics[id]!=null&&provenance&&provenance!=='LOCAL_NAV')continue;
    metrics[id]=value;
    if(value==null){if(bundle.reasons[id])reasons[id]=bundle.reasons[id]!;delete metricProvenance[id];}
    else{delete reasons[id];metricProvenance[id]='LOCAL_NAV';}
  }
  return {...fund,metrics,metricReasons:reasons,metricProvenance};
}
function nearestObserved(series:NavPoint[],target:number,maxDrift=31):NavPoint|undefined{let candidate:NavPoint|undefined;let distance=Infinity;for(const point of series){const nextDistance=Math.abs(point.date-target);if(nextDistance<distance){candidate=point;distance=nextDistance;}if(point.date>target+maxDrift)break;}return distance<=maxDrift?candidate:undefined;}

function rollingReturns(series:NavPoint[],years:number):number[]{
  const windows:number[]=[];const span=years*365.2425;let endIndex=0;
  for(let index=0;index<series.length;index+=21){const start=series[index]!;const target=start.date+span;while(endIndex<series.length&&series[endIndex]!.date<target)endIndex++;const after=series[endIndex];const before=endIndex>0?series[endIndex-1]:undefined;const end=before&&after?(Math.abs(before.date-target)<=Math.abs(after.date-target)?before:after):before??after;
    if(end&&Math.abs(end.date-target)<=31&&end.date-start.date>=years*360&&start.nav>0)windows.push((Math.pow(end.nav/start.nav,365.2425/(end.date-start.date))-1)*100);
  }
  return windows;
}

export function computeMetricBundle(fund:Pick<Fund,'history'|'nav'|'navDate'>,riskWindow=3,riskFreeRate=6.5,hurdleRate=riskFreeRate):MetricBundle{
  const series=[...fund.history].sort((a,b)=>a.date-b.date);const out:MetricBundle={metrics:{},reasons:{}};const latest=series.at(-1);
  if(!latest||series.length<2){for(const id of ['scheme_vintage_years','absolute_return_3m','absolute_return_6m','cagr_1y','cagr_3y','cagr_5y','cagr_10y','rolling_3y_average_return','rolling_3y_consistency','rolling_5y_consistency',...riskIds])nullMetric(out,id,'INSUFFICIENT_HISTORY');return out;}
  out.metrics.scheme_vintage_years=(latest.date-series[0]!.date)/365.2425;
  const atYears=(years:number):number|null=>{const id=`cagr_${years}y`;const start=nearestObserved(series,latest.date-years*365.2425);if(!start||latest.date-start.date<years*360||start.nav<=0){nullMetric(out,id,'INSUFFICIENT_HISTORY');return null;}return (Math.pow(latest.nav/start.nav,365.2425/(latest.date-start.date))-1)*100;};
  for(const years of [1,3,5,10])out.metrics[`cagr_${years}y`]=atYears(years);
  for(const [id,days] of [['absolute_return_3m',91],['absolute_return_6m',182]] as const){const start=nearestObserved(series,latest.date-days,21);if(!start||latest.date-start.date<days-21||start.nav<=0)nullMetric(out,id,'INSUFFICIENT_HISTORY');else out.metrics[id]=(latest.nav/start.nav-1)*100;}
  for(const years of [3,5]){const windows=rollingReturns(series,years);const id=`rolling_${years}y_consistency`;out.metrics[id]=windows.length?windows.filter(value=>value>hurdleRate).length/windows.length*100:null;if(!windows.length)nullMetric(out,id,'INSUFFICIENT_HISTORY');if(years===3){out.metrics.rolling_3y_average_return=windows.length?windows.reduce((sum,value)=>sum+value,0)/windows.length:null;if(!windows.length)nullMetric(out,'rolling_3y_average_return','INSUFFICIENT_HISTORY');}}
  const windowed=series.filter(point=>point.date>=latest.date-riskWindow*365.2425);const returns:number[]=[];for(let index=1;index<windowed.length;index++){const prev=windowed[index-1]!,current=windowed[index]!;if(current.date-prev.date<=7&&prev.nav>0)returns.push(current.nav/prev.nav-1);}
  if(returns.length<30){for(const id of riskIds)nullMetric(out,id,series.length<30?'INSUFFICIENT_HISTORY':'DATA_GAPS');return out;}
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length;const std=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1));const downside=returns.filter(value=>value<0);const dd=Math.sqrt(downside.reduce((a,b)=>a+b*b,0)/returns.length);const sorted=[...returns].sort((a,b)=>a-b);const q=sorted[Math.floor(sorted.length*.05)]!;let peak=windowed[0]!.nav,maxDrawdown=0;for(const point of windowed){peak=Math.max(peak,point.nav);maxDrawdown=Math.min(maxDrawdown,(point.nav/peak-1)*100);}const annual=(Math.pow(1+mean,252)-1)*100;const dailyRf=Math.pow(1+riskFreeRate/100,1/252)-1;const sharpe=std?(mean-dailyRf)/std*Math.sqrt(252):null;const positives=returns.filter(value=>value>0);
  out.metrics.std_dev=std*Math.sqrt(252)*100;out.metrics.max_drawdown=maxDrawdown;out.metrics.var_95=Math.max(0,-q*100);out.metrics.semi_deviation=dd*Math.sqrt(252)*100;out.metrics.tail_risk_ratio=mean&&q!==0?Math.abs(sorted.slice(0,Math.max(1,Math.floor(sorted.length*.05))).reduce((a,b)=>a+b,0)/Math.max(1,Math.floor(sorted.length*.05))/mean):null;out.metrics.gain_loss_ratio=downside.length?positives.reduce((a,b)=>a+b,0)/positives.length/Math.abs(downside.reduce((a,b)=>a+b,0)/downside.length):null;out.metrics.sharpe=sharpe;out.metrics.sortino=dd?(mean-dailyRf)/dd*Math.sqrt(252):null;out.metrics.omega=downside.length?positives.reduce((a,b)=>a+b,0)/Math.abs(downside.reduce((a,b)=>a+b,0)):null;out.metrics.calmar=maxDrawdown<0?annual/Math.abs(maxDrawdown):null;
  return out;
}
export function computeMetrics(fund:Pick<Fund,'history'|'nav'|'navDate'>,riskWindow=3,riskFreeRate=6.5,hurdleRate=riskFreeRate):Record<string,number|null>{return computeMetricBundle(fund,riskWindow,riskFreeRate,hurdleRate).metrics;}
export function growthSeries(history:NavPoint[],days=365*5):NavPoint[]{const end=history.at(-1);if(!end)return[];const result=history.filter(point=>point.date>=end.date-days);const base=result[0]?.nav;return base?result.map(point=>({date:point.date,nav:point.nav/base*10000})):[];}
