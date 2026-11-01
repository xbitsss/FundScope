import type { Fund } from '../types';
import { applyLocalMetricBundle, computeMetricBundle } from './compute';
import { applyRelativeMetrics } from './relative';
import { applySebiHoldingHeuristics } from '../disclosures/sebiHeuristics';
import { markMissingDisclosureMetrics } from '../../adapters/amfi_disclosures';
import { fillBlankSchemeDimensions } from '../parse/schemeName';
import { applyClassificationPlausibility } from '../taxonomy/classificationPipeline';

self.onmessage=(event:MessageEvent<{funds:Fund[];seriesById:import('../benchmarks/types').BenchmarkSeriesById;riskWindow:1|3|5;riskFreeRate:number}>)=>{
  const {funds,seriesById,riskWindow,riskFreeRate}=event.data;
  const locallyComputed=funds.map(fillBlankSchemeDimensions).map(fund=>applyLocalMetricBundle(fund,computeMetricBundle(fund,riskWindow,riskFreeRate)));
  self.postMessage(applyClassificationPlausibility(applyRelativeMetrics(locallyComputed.map(markMissingDisclosureMetrics).map(applySebiHoldingHeuristics),riskWindow,riskFreeRate,seriesById),seriesById).map(fund=>({code:fund.code,metrics:fund.metrics,metricReasons:fund.metricReasons,metricReasonDetails:fund.metricReasonDetails,metricFlags:fund.metricFlags,metricProvenance:fund.metricProvenance,classDetail:fund.classDetail})));
};

export {};
