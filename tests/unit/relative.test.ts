import { describe, expect, it } from 'vitest';
import { applyRelativeMetrics } from '../../src/domain/metrics/relative';
import { evaluateBenchmarkRegression } from '../../src/domain/benchmarks/gate';
import type { BenchmarkResolution } from '../../src/config/benchmarks';
import { benchmarkConfigValidation, resolveBenchmark, validateBenchmarkConfig } from '../../src/config/benchmarks';
import { applyDisclosures, parseAmfiAverageAumRows, parseDisclosureCsv } from '../../src/adapters/amfi_disclosures';
import { applySebiHoldingHeuristics } from '../../src/domain/disclosures/sebiHeuristics';
import type { Fund, NavPoint } from '../../src/domain/types';

const fund=(code:number,cagr=10):Fund=>({code,isinGrowth:null,isinReinvestment:null,name:`Fund ${code}`,amc:'AMC',category:'Equity Scheme - Flexi Cap Fund',assetClass:'equity',classRuleId:'equity_flexi_cap',taxonomyVersion:1,subCategory:'Flexi Cap',structure:'open',plan:'Direct',option:'Growth',nav:100,navDate:1,history:[],metrics:{cagr_1y:cagr,cagr_3y:cagr,cagr_5y:cagr},metricReasons:{}});
const series=(multiplier:number):NavPoint[]=>{let nav=100;return Array.from({length:500},(_,index)=>{if(index)nav*=1+(.0003+(index%7)*.00004)*multiplier;return {date:20_000+index,nav};});};

describe('relative and disclosure engines',()=>{
  it('fails closed when a category has no verified proxy instead of selecting an equity fallback',()=>{
    const resolution=resolveBenchmark(fund(1));
    expect(resolution.ok).toBe(false);
    if(!resolution.ok)expect(resolution.reason).toMatchObject({code:'NO_BENCHMARK',cause:'UNRESOLVED_PROXY'});
  });
  it('keeps the production registry schema and taxonomy references valid',()=>{
    expect(benchmarkConfigValidation.ok).toBe(true);
  });
  it('rejects a benchmark config with a cross-asset category mapping',()=>{
    const result=validateBenchmarkConfig({schema_version:1,taxonomy_version:1,benchmarks:[{id:'debt',display_name:'Debt',asset_class:'debt',kind:'proxy',status:'unresolved',provider:'mfapi',scheme_code:null,verification:null}],category_map:[{asset_class:'equity',sub_category:'Large Cap',benchmark_id:'debt',fit:'category_standard'}],overrides:[]});
    expect(result.ok).toBe(false);
    if(!result.ok)expect(result.errors.join(' ')).toContain('class mismatch');
  });
  it('calculates peer-relative returns from the local sub-category median',()=>{
    const result=applyRelativeMetrics([fund(1,12),fund(2,10),fund(3,8)],3,6.5);
    expect(result[0]!.metrics.return_vs_subcategory_3y).toBe(2);
    expect(result[0]!.metricProvenance?.return_vs_subcategory_3y).toBe('PEER_MEDIAN');
  });
  it('exposes category standard deviation as the active peer median volatility',()=>{
    const peers=[12,10,8].map((volatility,index)=>({...fund(index+1),metrics:{...fund(index+1).metrics,std_dev:volatility}}));
    const result=applyRelativeMetrics(peers,3,6.5);
    expect(result.map(item=>item.metrics.category_std_dev)).toEqual([10,10,10]);
    expect(result[0]!.metricProvenance?.category_std_dev).toBe('PEER_MEDIAN');
  });
  it('uses an exact-date join for benchmark regression',()=>{
    const fundHistory=series(2);const resolution:BenchmarkResolution={ok:true,fit:'category_standard',benchmark:{id:'test',display_name:'Test benchmark',asset_class:'equity',kind:'proxy',status:'verified',provider:'mfapi',scheme_code:1,verification:{verified_at:'2026-10-13',scheme_name:'Test',isin:null,first_nav_date:'2025-12-01',last_nav_date:'2026-10-13',return_basis:'TRI',checks:['test fixture']}}};
    const evaluated=evaluateBenchmarkRegression({fund:{...fund(1),history:fundHistory,nav:fundHistory.at(-1)!.nav,navDate:fundHistory.at(-1)!.date},benchmarkHistory:series(1),benchmarkAsOf:20_499,benchmarkReturnBasis:'TRI',riskWindow:1,riskFreeRate:6.5,maxSeriesAgeDays:10,fit:'category_standard'},resolution);
    const metrics=evaluated.metrics;
    expect(metrics.beta).toBeCloseTo(2,4);
    expect(metrics.tracking_error).toBeGreaterThan(0);
  });
  it('returns an explicit minimum-overlap reason below 200 aligned returns',()=>{
    const fundHistory=series(1);const benchmarkHistory=series(1).slice(-200);const resolution:BenchmarkResolution={ok:true,fit:'category_standard',benchmark:{id:'test',display_name:'Test benchmark',asset_class:'equity',kind:'proxy',status:'verified',provider:'mfapi',scheme_code:1,verification:{verified_at:'2026-10-13',scheme_name:'Test',isin:null,first_nav_date:'2025-12-01',last_nav_date:'2026-10-13',return_basis:'TRI',checks:['test fixture']}}};
    const result=evaluateBenchmarkRegression({fund:{...fund(1),history:fundHistory,nav:fundHistory.at(-1)!.nav,navDate:fundHistory.at(-1)!.date},benchmarkHistory,benchmarkAsOf:20_499,benchmarkReturnBasis:'TRI',riskWindow:1,riskFreeRate:6.5,maxSeriesAgeDays:10,fit:'category_standard'},resolution);
    expect(result.metrics.beta).toBeNull();
    expect(result.reasonDetails.beta).toMatchObject({code:'INSUFFICIENT_HISTORY',cause:'OVERLAP_BELOW_MIN',required:200,actual:199});
  });
  it('requires scheme-code keyed disclosure records',()=>{
    expect(parseDisclosureCsv('scheme_code,aum_cr,ter_pct\n123,456.7,0.42')).toEqual([{schemeCode:123,aumCr:456.7,terPct:0.42,source:'AMFI_DISCLOSURE'}]);
    expect(parseDisclosureCsv('scheme_name,aum_cr\nA fund,123')).toEqual([]);
  });
  it('parses official scheme-level quarterly AAUM by AMFI code',()=>{
    const rows=parseAmfiAverageAumRows({data:[{schemes:[{AMFI_Code:123,AverageAumForTheMonth:{ExcludingFundOfFundsDomesticButIncludingFundOfFundsOverseas:500,FundOfFundsDomestic:25}}]}]},20_000);
    expect(rows).toEqual([{schemeCode:123,aumCr:525,source:'AMFI_DISCLOSURE',asOf:20_000}]);
  });
  it('tracks disclosure provenance and SEBI profile bounds separately from reported holdings',()=>{
    const imported=applyDisclosures([fund(1)], [{schemeCode:1,aumCr:525,source:'AMFI_DISCLOSURE',asOf:20_000}])[0]!;
    expect(imported.metrics.aum_cr).toBe(525);
    expect(imported.metricProvenance?.aum_cr).toBe('AMFI_DISCLOSURE');
    expect(imported.metricAsOf?.aum_cr).toBe(20_000);
    const heuristic=applySebiHoldingHeuristics(fund(2));
    expect(heuristic.metrics.equity_holding_pct).toBe(65);
    expect(heuristic.metricProvenance?.equity_holding_pct).toBe('SEBI_HEURISTIC');
    expect(heuristic.metricReasons?.cash_holding_pct).toBe('SOURCE_MISSING');
  });
});
