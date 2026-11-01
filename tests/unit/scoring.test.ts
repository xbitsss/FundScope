import { describe, expect, it } from 'vitest';
import { rankFunds } from '../../src/domain/scoring/engine';
import type { Fund } from '../../src/domain/types';

const fund=(code:number,cagr:number,drawdown:number):Fund=>({code,isinGrowth:null,isinReinvestment:null,name:`Fund ${code}`,amc:'Example AMC',category:'Equity Scheme - Large Cap Fund',assetClass:'equity',classRuleId:'equity_large_cap',taxonomyVersion:1,subCategory:'Large Cap',structure:'open',plan:'Direct',option:'Growth',nav:10,navDate:20_000,history:[],metrics:{cagr_3y:cagr,max_drawdown:drawdown}});

describe('peer score engine',()=>{
  it('rewards higher returns and lower drawdown according to factor direction',()=>{
    const results=rankFunds([fund(1,10,-30),fund(2,15,-10)],[{id:'cagr_3y',weight:50,direction:'higher'},{id:'max_drawdown',weight:50,direction:'higher'}]);
    expect(results.find(row=>row.fund.code===2)?.score).toBe(100);
    expect(results.find(row=>row.fund.code===1)?.score).toBe(0);
  });
  it('scores missing values as zero without redistributing their weight',()=>{
    const a=fund(1,10,-20),b=fund(2,20,-10),missing=fund(3,30,-5);missing.metrics.cagr_3y=null;missing.metrics.max_drawdown=null;
    const results=rankFunds([a,b,missing],[{id:'cagr_3y',weight:60,direction:'higher'},{id:'max_drawdown',weight:40,direction:'higher'}]);
    expect(results.find(row=>row.fund.code===1)?.score).toBe(0);
    expect(results.find(row=>row.fund.code===2)?.score).toBe(100);
    expect(results.find(row=>row.fund.code===3)?.score).toBe(0);
    expect(results.find(row=>row.fund.code===3)?.contributions).toEqual({cagr_3y:0,max_drawdown:0});
  });
  it('lowers a fund score when one weighted metric is missing',()=>{
    const complete=fund(1,10,-20),missing=fund(2,20,-10);missing.metrics.max_drawdown=null;
    const results=rankFunds([complete,missing],[{id:'cagr_3y',weight:50,direction:'higher'},{id:'max_drawdown',weight:50,direction:'higher'}]);
    expect(results.find(row=>row.fund.code===2)?.score).toBe(50);
  });
});
