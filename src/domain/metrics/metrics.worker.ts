import type { Fund } from '../types';
import { applyLocalMetricBundle, computeMetricBundle } from './compute';
import { applyRelativeMetrics } from './relative';
import { applySebiHoldingHeuristics } from '../disclosures/sebiHeuristics';
import { markMissingDisclosureMetrics } from '../../adapters/amfi_disclosures';
import { fillBlankSchemeDimensions } from '../parse/schemeName';
import { applyClassificationPlausibility } from '../taxonomy/classificationPipeline';
import { buildGrowthChartModel, type GrowthChartInput } from './growthChart';

type MetricsRequest={type?:'metrics';funds:Fund[];seriesById:import('../benchmarks/types').BenchmarkSeriesById;riskWindow:1|3|5;riskFreeRate:number};
type ChartRequest={type:'growth-chart';funds:GrowthChartInput[];days:number};
self.onmessage=(event:MessageEvent<MetricsRequest|ChartRequest>)=>{
  if(event.data.type==='growth-chart'){
    try{self.postMessage({type:'growth-chart-result',model:buildGrowthChartModel(event.data.funds,event.data.days)});}catch(error){self.postMessage({type:'growth-chart-error',message:error instanceof Error?error.message:'Chart calculation failed.'});}
    return;
  }
  const {funds,seriesById,riskWindow,riskFreeRate}=event.data;
  const locallyComputed=funds.map(fillBlankSchemeDimensions).map(fund=>applyLocalMetricBundle(fund,computeMetricBundle(fund,riskWindow,riskFreeRate)));
  self.postMessage(applyClassificationPlausibility(applyRelativeMetrics(locallyComputed.map(markMissingDisclosureMetrics).map(applySebiHoldingHeuristics),riskWindow,riskFreeRate,seriesById),seriesById).map(fund=>({code:fund.code,metrics:fund.metrics,metricReasons:fund.metricReasons,metricReasonDetails:fund.metricReasonDetails,metricFlags:fund.metricFlags,metricProvenance:fund.metricProvenance,classDetail:fund.classDetail})));
};

export {};
