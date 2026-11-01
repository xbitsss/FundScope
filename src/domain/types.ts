import type { AssetClass } from './taxonomy/assetClass';
import type { ClassificationDetail, ClassificationStatus } from './taxonomy/consensus';
import type { ReasonCode, ReasonDetail } from './governance/reasons';
export interface NavPoint { date: number; nav: number }
export type MetricReason = ReasonCode;
export type MetricProvenance = 'DIRECT_FEED' | 'LOCAL_NAV' | 'PEER_MEDIAN' | 'BENCHMARK_PROXY' | 'AMFI_DISCLOSURE' | 'LOCAL_OVERRIDE' | 'SEBI_HEURISTIC';
export interface Fund {
  code: number; isinGrowth: string | null; isinReinvestment: string | null; name: string;
  amc: string; category: string; assetClass: AssetClass; classRuleId:string; taxonomyVersion:number; subCategory: string;
  headerRaw?:string; classStatus?:ClassificationStatus; classDetail?:ClassificationDetail;
  structure: 'open' | 'close' | 'interval' | 'unknown'; plan: 'Direct' | 'Regular' | 'Unknown';
  option: string; nav: number; navDate: number; history: NavPoint[]; historyFetchedAt?:number; historyStatus?:'ok'|'pending'|'failed'; historyAttempts?:number; historyLastError?:string; historyNextRetryAt?:number; metricsNavAsOf?:number; metrics: Record<string, number | null>; metricReasons?: Record<string, MetricReason>; metricReasonDetails?:Record<string,ReasonDetail>; metricFlags?:Record<string,string[]>; metricProvenance?: Record<string, MetricProvenance>; metricAsOf?: Record<string, number>;
}
export type MetricAvailability = 'available' | 'unavailable' | 'computed';
export interface MetricDefinition {
  id: string; label: string; group: string; unit: '%' | 'ratio' | 'years' | '₹ Cr' | 'enum';
  direction: 'higher' | 'lower' | 'neutral'; description: string; availability: MetricAvailability;
}
