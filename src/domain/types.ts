import type { AssetClass } from './taxonomy/assetClass';
import type { ClassificationDetail, ClassificationStatus } from './taxonomy/consensus';
import type { ReasonCode, ReasonDetail } from './governance/reasons';
import type { TaxonomyProvenance } from './taxonomy/classifyV3';
export interface NavPoint { date: number; nav: number }
export interface AmfiSchemeMasterData {
  name:string;
  schemeType:string;
  categoryRaw:string;
  navName:string;
  minimumAmount:number|null;
  launchDate:number|null;
  closureDate:number|null;
  isinGrowth:string|null;
  isinReinvestment:string|null;
  joinMethod:'scheme_code'|'isin';
}
export type MetricReason = ReasonCode;
export type MetricProvenance = 'DIRECT_FEED' | 'LOCAL_NAV' | 'PEER_MEDIAN' | 'BENCHMARK_PROXY' | 'AMFI_DISCLOSURE' | 'LOCAL_OVERRIDE' | 'SEBI_HEURISTIC';
export interface Fund {
  code: number; isinGrowth: string | null; isinReinvestment: string | null; name: string;
  amc: string; category: string; assetClass: AssetClass; classRuleId:string; taxonomyVersion:number; subCategory: string;
  schemeMaster?:AmfiSchemeMasterData;
  management?:'Active'|'Passive'|'Not specified'; group?:string; riskBand?:'Low'|'Medium'|'High'|'Not specified';
  philosophy?:'Value'|'Contra'|'Blend/Unspecified'; speciality?:string[]; lifecycle?:'active'|'dormant';
  lifecycleReason?:'CLOSED'|'NO_RECENT_NAV';
  classificationReason?:string|null; classificationProvenance?:Record<string,TaxonomyProvenance>;
  headerRaw?:string; classStatus?:ClassificationStatus; classDetail?:ClassificationDetail;
  structure: 'open' | 'close' | 'interval' | 'unknown'; plan: 'Direct' | 'Regular' | 'Unknown';
  option: string; nav: number; navDate: number; history: NavPoint[]; historyFetchedAt?:number; historyStatus?:'ok'|'pending'|'failed'; historyAttempts?:number; historyLastError?:string; historyNextRetryAt?:number; metricsNavAsOf?:number; metrics: Record<string, number | null>; metricReasons?: Record<string, MetricReason>; metricReasonDetails?:Record<string,ReasonDetail>; metricFlags?:Record<string,string[]>; metricProvenance?: Record<string, MetricProvenance>; metricAsOf?: Record<string, number>;
}
export type MetricAvailability = 'available' | 'unavailable' | 'computed';
export interface MetricDefinition {
  id: string; label: string; group: string; unit: '%' | 'ratio' | 'years' | '₹ Cr' | 'enum';
  direction: 'higher' | 'lower' | 'neutral'; description: string; availability: MetricAvailability;
}
