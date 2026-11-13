import { describe, expect, it } from 'vitest';
import { assessHistoryCoverage } from '../../etl/historyQuality.mjs';

describe('ETL history coverage gate',()=>{
  it('measures the catalog coverage instead of the current retry batch failure rate',()=>{
    const funds=Array.from({length:14_214},(_,index)=>({code:index+1,history:index<14_206?[{date:1,nav:1}]:[]}));
    const result=assessHistoryCoverage(funds);
    expect(result.withHistory).toBe(14_206);
    expect(result.missing).toBe(8);
    expect(result.coverage).toBeGreaterThan(0.999);
    expect(result.passes).toBe(true);
  });

  it('blocks publishing when retained catalog history is below the floor',()=>{
    const funds=Array.from({length:100},(_,index)=>({code:index+1,history:index<94?[{date:1,nav:1}]:[]}));
    const result=assessHistoryCoverage(funds);
    expect(result.coverage).toBe(0.94);
    expect(result.passes).toBe(false);
  });

  it('does not treat an empty catalog as valid history coverage',()=>{
    expect(assessHistoryCoverage([]).passes).toBe(false);
  });
});
