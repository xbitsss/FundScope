import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { decodeFundColumns, encodeFundColumns } from '../../src/adapters/snapshot/columnar';

const fund=(code:number,values:Partial<Fund>):Fund=>({code,isinGrowth:null,isinReinvestment:null,name:`Scheme ${code}`,amc:'Test AMC',category:'Equity - Flexi Cap',assetClass:'equity',classRuleId:'TEST',taxonomyVersion:3,subCategory:'Flexi Cap',structure:'open',plan:'Direct',option:'Growth',nav:24.125,navDate:20_500,history:[{date:20_499,nav:24}],metrics:{cagr_1y:12.3456789,cagr_3y:null},metricReasons:{cagr_3y:'INSUFFICIENT_HISTORY'},speciality:['Index','Large Cap'],lifecycle:'active',...values});

describe('columnar snapshot codec',()=>{
  it('round-trips list columns and metrics without embedding NAV history or detail payloads',()=>{
    const original=[fund(123,{name:'Nifty 50 Index Fund',amc:'AMC A'}),fund(456,{plan:'Unknown',option:'IDCW Payout',metrics:{cagr_1y:null},metricReasons:{cagr_1y:'DATA_GAPS'},classDetail:undefined})];
    const decoded=decodeFundColumns(encodeFundColumns(original));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({code:123,name:'Nifty 50 Index Fund',subCategory:'Flexi Cap',assetClass:'equity',speciality:['Index','Large Cap'],nav:24.125,navDate:20_500,history:[]});
    expect(decoded[0]!.metrics.cagr_1y).toBeCloseTo(12.3456789,5);
    expect(decoded[0]!.metricReasons?.cagr_3y).toBe('INSUFFICIENT_HISTORY');
    expect(decoded[1]!.metricReasons?.cagr_1y).toBe('DATA_GAPS');
    expect(decoded[0]!.classDetail).toBeUndefined();
  });

  it('rejects truncated and unknown-format columnar buffers',()=>{
    expect(()=>decodeFundColumns(new Uint8Array([1,2]))).toThrow(/truncated/);
    const invalid=new Uint8Array([0,0,0,0]);
    expect(()=>decodeFundColumns(invalid)).toThrow(/truncated/);
  });
});
