import { useMemo } from 'react';
import type { Fund } from '../domain/types';
import { benchmarkConfig, resolveBenchmark } from '../config/benchmarks';
import { reasonMessage } from '../domain/governance/reasonMessages';

const labels:Record<string,string>={beta:'Beta',r_squared:'R-squared',jensen_alpha:'Jensen alpha',treynor:'Treynor ratio',information_ratio:'Information ratio',tracking_error:'Tracking error',upside_capture:'Upside capture',downside_capture:'Downside capture'};

/** A compact explanation of the same verified-only benchmark decision used by the worker. */
export function FundBenchmarkSection({fund}:{fund:Fund}){
  const resolution=useMemo(()=>resolveBenchmark(fund),[fund.code,fund.assetClass,fund.subCategory]);
  const metricId='beta';
  const reason=resolution.ok?fund.metricReasonDetails?.[metricId]:resolution.reason;
  const fallbackReason=resolution.ok?undefined:resolution.reason;
  const ready=resolution.ok&&fund.metrics.beta!=null;
  const pendingBenchmarkId=!resolution.ok&&resolution.reason.code==='NO_BENCHMARK'?resolution.reason.benchmarkId:undefined;
  const pendingBenchmark=pendingBenchmarkId?benchmarkConfig?.benchmarks.find(item=>item.id===pendingBenchmarkId):undefined;
  const benchmarkName=resolution.ok?resolution.benchmark.display_name:pendingBenchmark?.display_name;
  const unavailableLabel=!resolution.ok&&resolution.reason.code==='NO_BENCHMARK'&&resolution.reason.cause==='UNRESOLVED_PROXY'?'Pending verification':!resolution.ok&&resolution.reason.code==='NO_BENCHMARK'&&resolution.reason.cause==='UNMAPPED_CATEGORY'?'Not mapped':'Unavailable';
  const reasonText=reasonMessage(reason??fallbackReason,labels[metricId]!);
  const benchmarkStatus=resolution.ok?`${benchmarkName}${ready?' · verified proxy':' · configured, series check pending'}`:pendingBenchmark?`${pendingBenchmark.display_name} · ${reasonMessage(resolution.reason,'Benchmark')}`:reasonMessage(resolution.reason,'Benchmark');
  return <div className={`drawer-benchmark${ready?' benchmark-ready':''}`}>
    <small>BENCHMARK</small>
    <b>{ready?benchmarkName:resolution.ok?'Series unavailable':unavailableLabel}</b>
    <span>{benchmarkStatus}{!ready?` · ${resolution.ok?fund.metricReasons?.[metricId]??'NO_BENCHMARK':resolution.reason.code}`:''}</span>
    {ready&&<span>{(fund.metrics.benchmark_overlap_days??0).toLocaleString('en-IN')} aligned daily returns</span>}
    {!ready&&<span>{reasonText}</span>}
  </div>;
}
