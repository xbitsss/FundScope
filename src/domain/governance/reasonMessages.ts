import type { ReasonDetail } from './reasons';

/** Single user-facing catalog for null benchmark and metric explanations. */
export function reasonMessage(detail:ReasonDetail|undefined,metricLabel:string):string{
  if(!detail)return `${metricLabel} source is not recorded.`;
  switch(detail.code){
    case 'NA_CATEGORY':if(detail.cause==='CLASSIFICATION_UNCERTAIN')return `${metricLabel} not applicable: this scheme's category is reported inconsistently across data sources (AMFI: ${detail.s1Class}${detail.s2Class?`, MFapi: ${detail.s2Class}`:''}${detail.s3Class?`, AMFI disclosure: ${detail.s3Class}`:''}) and is under review.`;return detail.cause==='ASSET_CLASS_MISMATCH'?`${metricLabel} not applicable: ${detail.fundAssetClass} cannot be compared with a ${detail.benchmarkAssetClass??'different-class'} benchmark.`:`${metricLabel} not applicable: this scheme is quarantined as an unclassified asset category.`;
    case 'NO_BENCHMARK':
      if(detail.cause==='UNMAPPED_CATEGORY')return `${metricLabel} unavailable: no benchmark is defined for ${detail.subCategory} funds.`;
      if(detail.cause==='UNRESOLVED_PROXY')return `${metricLabel} unavailable: the configured benchmark for ${detail.subCategory} has not been verified.`;
      if(detail.cause==='SERIES_STALE')return `${metricLabel} unavailable: benchmark history is stale${detail.lastDate?` (last value ${detail.lastDate})`:''}.`;
      return `${metricLabel} unavailable: verified benchmark history has not been loaded.`;
    case 'INSUFFICIENT_HISTORY':return detail.cause==='OVERLAP_BELOW_MIN'?`${metricLabel} unavailable: requires ${detail.required} overlapping trading days with the benchmark (currently ${detail.actual} days available).`:`${metricLabel} unavailable: the ${detail.window??'requested'} window needs ${detail.required} years of history (this fund has ${detail.actual.toFixed(1)} years).`;
    case 'DATA_GAPS':return `${metricLabel} unavailable: the aligned source histories contain gaps or invalid observations.`;
    case 'TOO_FEW_SAMPLES':return `${metricLabel} unavailable: too few observations${detail.detail?.actual!==undefined?` (${detail.detail.actual})`:''} in this return regime.`;
    case 'ZERO_DENOMINATOR':return `${metricLabel} unavailable: the benchmark variance is too small for a stable regression.`;
    case 'SOURCE_MISSING':return `${metricLabel} unavailable: no verified source is available.`;
    case 'UNAVAILABLE_SOURCE':return `${metricLabel} unavailable: the source is not available.`;
    case 'INSUFFICIENT_ALIGNED_HISTORY':return `${metricLabel} unavailable: insufficient aligned benchmark history.`;
  }
}
