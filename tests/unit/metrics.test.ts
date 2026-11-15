import { describe, expect, it } from 'vitest';
import { computeMetricBundle, computeMetrics } from '../../src/domain/metrics/compute';
import { metricRegistry } from '../../src/domain/metrics/registry';
import { explainMetricForFund } from '../../src/domain/metrics/insights';
import type { Fund } from '../../src/domain/types';

describe('NAV metric calculations',()=>{
  it('keeps long-window CAGR unavailable when the history is too short',()=>{
    const metrics=computeMetrics({history:[{date:20_000,nav:10},{date:20_365,nav:11}],nav:11,navDate:20_365});
    expect(metrics.cagr_1y).toBeCloseTo(10,0);
    expect(metrics.cagr_3y).toBeNull();
    expect(metrics.scheme_vintage_years).toBeCloseTo(1,1);
  });
  it('returns null risk metrics rather than invented values without enough observations',()=>{
    const history=Array.from({length:8},(_,i)=>({date:20_000+i,nav:10+i*.02}));
    const metrics=computeMetrics({history,nav:history.at(-1)!.nav,navDate:history.at(-1)!.date});
    expect(metrics.std_dev).toBeNull();
    expect(metrics.sharpe).toBeNull();
  });
  it('computes 3M and 6M returns from local NAV history',()=>{
    const history=[{date:10_000,nav:100},{date:10_091,nav:110},{date:10_182,nav:121}];
    const metrics=computeMetrics({history,nav:121,navDate:10_182});
    expect(metrics.absolute_return_3m).toBeCloseTo(10,6);
    expect(metrics.absolute_return_6m).toBeCloseTo(21,6);
  });
  it('labels insufficient local history instead of estimating a return',()=>{
    const bundle=computeMetricBundle({history:[{date:10_000,nav:100}],nav:100,navDate:10_000});
    expect(bundle.metrics.absolute_return_3m).toBeNull();
    expect(bundle.reasons.absolute_return_3m).toBe('INSUFFICIENT_HISTORY');
    expect(bundle.metrics.scheme_vintage_years).toBeNull();
    expect(bundle.reasons.scheme_vintage_years).toBe('INSUFFICIENT_HISTORY');
    expect(bundle.metrics.cagr_1y).toBeNull();
  });
  it('computes the arithmetic mean of observed rolling 3Y CAGRs',()=>{
    const history=Array.from({length:1_500},(_,index)=>({date:10_000+index,nav:100*Math.pow(1.1,index/365.2425)}));
    const bundle=computeMetricBundle({history,nav:history.at(-1)!.nav,navDate:history.at(-1)!.date});
    expect(bundle.metrics.rolling_3y_average_return).toBeCloseTo(10,3);
  });
  it('generates fund-contextual explanations for every metric in the registry',()=>{
    const sampleFund:Fund={
      code:120401,isinGrowth:null,isinReinvestment:null,name:'Example Flexi Cap Fund',amc:'Example AMC',
      category:'Equity Scheme - Flexi Cap Fund',assetClass:'equity',classRuleId:'equity_flexi_cap',
      taxonomyVersion:3,subCategory:'Flexi Cap',structure:'open',plan:'Direct',option:'Growth',
      nav:42.5,navDate:20_500,history:[],
      metrics:{cagr_3y:16.4,return_vs_subcategory_3y:2.1,sharpe:1.35,sortino:1.85,std_dev:12.2,category_std_dev:13.8,beta:0.88,max_drawdown:-14.5,ter_pct:0.55,aum_cr:8400},
    };
    for(const metric of metricRegistry){
      const insight=explainMetricForFund(sampleFund,metric,3);
      expect(insight.whatItTellsYou.length).toBeGreaterThan(20);
      expect(insight.inContext.length).toBeGreaterThan(20);
    }
  });
});
