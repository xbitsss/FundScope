import type { AssetClass } from '../taxonomy/assetClass';

export type ReasonCode='NA_CATEGORY'|'NO_BENCHMARK'|'INSUFFICIENT_HISTORY'|'DATA_GAPS'|'TOO_FEW_SAMPLES'|'ZERO_DENOMINATOR'|'SOURCE_MISSING'|'UNAVAILABLE_SOURCE'|'INSUFFICIENT_ALIGNED_HISTORY';
export type ReasonDetail=
  |{code:'NA_CATEGORY';cause:'ASSET_CLASS_MISMATCH'|'UNCLASSIFIED_FUND';fundAssetClass:AssetClass| string;benchmarkAssetClass?:AssetClass;subCategory:string}
  |{code:'NA_CATEGORY';cause:'CLASSIFICATION_UNCERTAIN';fundAssetClass:AssetClass|string;subCategory:string;s1Class:AssetClass|string;s2Class?:AssetClass|string;s3Class?:AssetClass|string}
  |{code:'NO_BENCHMARK';cause:'UNMAPPED_CATEGORY'|'UNRESOLVED_PROXY'|'SERIES_NOT_LOADED'|'SERIES_STALE';subCategory:string;benchmarkId?:string;lastDate?:string}
  |{code:'INSUFFICIENT_HISTORY';cause:'WINDOW_NOT_COVERED'|'OVERLAP_BELOW_MIN';required:number;actual:number;unit:'days'|'years'|'windows';window?:'1y'|'3y'|'5y'}
  |{code:'DATA_GAPS'|'TOO_FEW_SAMPLES'|'ZERO_DENOMINATOR'|'SOURCE_MISSING'|'UNAVAILABLE_SOURCE'|'INSUFFICIENT_ALIGNED_HISTORY';cause?:string;detail?:Record<string,string|number>};
export type MetricOutcome={ok:true;value:number;flags?:string[]}|{ok:false;reason:ReasonDetail};
