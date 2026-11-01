import type { Fund, MetricReason, NavPoint } from '../types';
import type { BenchmarkResolution } from '../../config/benchmarks';
import type { MetricOutcome, ReasonDetail } from '../governance/reasons';
import { alignNavLevels, alignedReturns, expectedWeekdays } from '../stats/align';
import { regressionStats } from '../stats/regression.internal';
import type { AssetClass } from '../taxonomy/assetClass';
import type { AlignedReturns } from '../stats/align';

const gateBrand:unique symbol=Symbol('FundScopeGateApproved');
const metricIds=['beta','r_squared','jensen_alpha','treynor','information_ratio','tracking_error','upside_capture','downside_capture','benchmark_outperformance_ratio'] as const;
type RegressionInput={fund:Fund;benchmarkHistory:NavPoint[];benchmarkAsOf:number;riskWindow:1|3|5;riskFreeRate:number;maxSeriesAgeDays:number;fit:'category_standard'|'broad_approx'};
type ApprovedInput=RegressionInput&{benchmarkAssetClass:string};
export type GateApproved={readonly [gateBrand]:true;readonly input:ApprovedInput;readonly aligned:AlignedReturns;readonly overlapDays:number};
export type RegressionGateResult={metrics:Record<string,number|null>;reasons:Record<string,MetricReason>;reasonDetails:Record<string,ReasonDetail>;flags:string[];overlapDays:number|null};
const failure=(reason:ReasonDetail,overlapDays:number|null=null):RegressionGateResult=>({metrics:Object.fromEntries(metricIds.map(id=>[id,null])),reasons:Object.fromEntries(metricIds.map(id=>[id,reason.code])),reasonDetails:Object.fromEntries(metricIds.map(id=>[id,reason])),flags:[],overlapDays});

function approve(input:ApprovedInput):GateApproved|ReasonDetail{
  const fund=input.fund;
  if(!['equity','debt','hybrid','liquid','other'].includes(fund.assetClass)||fund.assetClass==='other')return {code:'NA_CATEGORY',cause:'UNCLASSIFIED_FUND',fundAssetClass:fund.assetClass,subCategory:fund.subCategory};
  if(input.benchmarkAssetClass!==fund.assetClass)return {code:'NA_CATEGORY',cause:'ASSET_CLASS_MISMATCH',fundAssetClass:fund.assetClass,benchmarkAssetClass:input.benchmarkAssetClass as AssetClass,subCategory:fund.subCategory};
  if(!input.benchmarkHistory.length)return {code:'NO_BENCHMARK',cause:'SERIES_NOT_LOADED',subCategory:fund.subCategory};
  const latestBenchmark=input.benchmarkHistory.at(-1)?.date??0;const age=fund.navDate-latestBenchmark;
  if(age>input.maxSeriesAgeDays)return {code:'NO_BENCHMARK',cause:'SERIES_STALE',subCategory:fund.subCategory,lastDate:new Date(latestBenchmark*86_400_000).toLocaleDateString('en-IN')};
  const history=[...fund.history].sort((a,b)=>a.date-b.date);const latest=history.at(-1);const first=history[0];const availableYears=latest&&first?(latest.date-first.date)/365.25:0;
  if(!latest||!first||availableYears<input.riskWindow)return {code:'INSUFFICIENT_HISTORY',cause:'WINDOW_NOT_COVERED',required:input.riskWindow,actual:Number(availableYears.toFixed(1)),unit:'years',window:`${input.riskWindow}y` as '1y'|'3y'|'5y'};
  const from=latest.date-input.riskWindow*365.25;const alignedLevels=alignNavLevels(history,input.benchmarkHistory,from,latest.date);
  if(!alignedLevels)return {code:'DATA_GAPS',cause:'INVALID_OR_UNSORTED_SERIES'};
  const aligned=alignedReturns(alignedLevels);if(!aligned)return {code:'DATA_GAPS',cause:'INVALID_ALIGNED_SERIES'};
  if(aligned.nObs<200)return {code:'INSUFFICIENT_HISTORY',cause:'OVERLAP_BELOW_MIN',required:200,actual:aligned.nObs,unit:'days',window:`${input.riskWindow}y` as '1y'|'3y'|'5y'};
  const weekdays=expectedWeekdays(from,latest.date);if(weekdays>0&&aligned.nObs<weekdays*0.85*0.96)return {code:'DATA_GAPS',cause:'ALIGNED_COVERAGE_BELOW_THRESHOLD',detail:{expectedWeekdays:weekdays,actual:aligned.nObs}};
  const average=aligned.rb.reduce((sum,value)=>sum+value,0)/aligned.nObs;const variance=aligned.rb.reduce((sum,value)=>sum+(value-average)**2,0)/aligned.nObs;
  if(variance<=1e-12)return {code:'ZERO_DENOMINATOR',cause:'BENCHMARK_VARIANCE'};
  return {[gateBrand]:true,input,aligned,overlapDays:aligned.nObs};
}

export function runBenchmarkRegression(approved:GateApproved):RegressionGateResult{
  const stats=regressionStats(approved.aligned.rf,approved.aligned.rb,approved.input.riskFreeRate);if(!stats)return failure({code:'ZERO_DENOMINATOR',cause:'REGRESSION_DENOMINATOR'},approved.overlapDays);
  const metrics:Record<string,number|null>={beta:stats.beta,r_squared:stats.rSquared,jensen_alpha:stats.alpha,treynor:stats.treynor,information_ratio:stats.informationRatio,tracking_error:stats.trackingError,upside_capture:stats.upsideCapture,downside_capture:stats.downsideCapture,benchmark_overlap_days:approved.overlapDays,benchmark_outperformance_ratio:null};
  const reasons:Record<string,MetricReason>={};const reasonDetails:Record<string,ReasonDetail>={};
  if(stats.treynor===null){reasons.treynor='ZERO_DENOMINATOR';reasonDetails.treynor={code:'ZERO_DENOMINATOR',cause:'BETA_ZERO'};}
  if(stats.informationRatio===null){reasons.information_ratio='ZERO_DENOMINATOR';reasonDetails.information_ratio={code:'ZERO_DENOMINATOR',cause:'ACTIVE_VARIANCE_ZERO'};}
  for(const id of ['upside_capture','downside_capture'] as const)if(metrics[id]===null){reasons[id]='TOO_FEW_SAMPLES';reasonDetails[id]={code:'TOO_FEW_SAMPLES',cause:'RETURN_REGIME_SAMPLE_COUNT'};}
  reasons.benchmark_outperformance_ratio='INSUFFICIENT_HISTORY';reasonDetails.benchmark_outperformance_ratio={code:'INSUFFICIENT_HISTORY',cause:'OVERLAP_BELOW_MIN',required:250,actual:0,unit:'windows',window:`${approved.input.riskWindow}y` as '1y'|'3y'|'5y'};
  const flags:string[]=[];if(stats.lowR2)flags.push('LOW_R2');if(approved.input.fund.assetClass==='equity'&&stats.betaOutlier)flags.push('BETA_OUTLIER');if(approved.input.fit==='broad_approx')flags.push('PROXY_APPROX');
  return {metrics,reasons,reasonDetails,flags,overlapDays:approved.overlapDays};
}

export function evaluateBenchmarkRegression(input:RegressionInput,resolution:BenchmarkResolution):RegressionGateResult{
  if(!resolution.ok)return failure(resolution.reason);
  const approved=approve({...input,benchmarkAssetClass:resolution.benchmark.asset_class,fit:resolution.fit});
  return 'code' in approved?failure(approved):runBenchmarkRegression(approved);
}

export function metricOutcomes(result:RegressionGateResult):Record<string,MetricOutcome>{
  return Object.fromEntries(Object.entries(result.metrics).filter(([id])=>id!=='benchmark_overlap_days').map(([id,value])=>[id,value==null?{ok:false,reason:result.reasonDetails[id]??{code:result.reasons[id]??'NO_BENCHMARK',cause:'NO_VALID_VALUE'}}:{ok:true,value,flags:result.flags}])) as Record<string,MetricOutcome>;
}
