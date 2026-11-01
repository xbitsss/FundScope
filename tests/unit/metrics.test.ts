import { describe, expect, it } from 'vitest';
import { computeMetricBundle, computeMetrics } from '../../src/domain/metrics/compute';

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
    expect(bundle.metrics.rolling_3y_average_return).toBeCloseTo(10,4);
  });
});
