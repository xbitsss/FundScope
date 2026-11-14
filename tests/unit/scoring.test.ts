import { describe, expect, it } from 'vitest';
import { applyPersistentScores, DEFAULT_SCORE_FACTORS, hasCurrentPersistentScores, rankFunds, SCORE_METRIC_ID } from '../../src/domain/scoring/engine';
import { applyPeerMetrics } from '../../src/domain/metrics/relative';
import { ScreenerEngine } from '../../src/engine/core';
import { defaultScreenerFilters } from '../../src/domain/screener/filters';
import type { Fund } from '../../src/domain/types';

const fund=(code:number,cagr:number,drawdown:number,subCategory='Large Cap'):Fund=>({
  code,isinGrowth:null,isinReinvestment:null,name:`Fund ${code}`,amc:'Example AMC',
  category:`Equity Scheme - ${subCategory} Fund`,assetClass:'equity',classRuleId:'equity_large_cap',
  taxonomyVersion:3,subCategory,structure:'open',plan:'Direct',option:'Growth',nav:10,navDate:20_000,
  history:[],metrics:{cagr_3y:cagr,max_drawdown:drawdown,sharpe:cagr/10,std_dev:Math.abs(drawdown)/2,rolling_3y_average_return:cagr,cagr_5y:cagr},
});

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

  it('assigns identical tie-aware scores when funds have identical metric values',()=>{
    const tiedA=fund(1,15,-12),tiedB=fund(2,15,-12),lower=fund(3,10,-20);
    const results=rankFunds([tiedA,tiedB,lower],[{id:'cagr_3y',weight:50,direction:'higher'},{id:'max_drawdown',weight:50,direction:'higher'}]);
    const scoreA=results.find(row=>row.fund.code===1)?.score;
    const scoreB=results.find(row=>row.fund.code===2)?.score;
    expect(scoreA).toBe(scoreB);
    expect(scoreA).toBe(75);
  });

  it('precomputes and persists composite_score in applyPeerMetrics and applyPersistentScores',()=>{
    const universe=[
      fund(1,18,-10,'Large Cap'),
      fund(2,14,-14,'Large Cap'),
      fund(3,11,-18,'Large Cap'),
      fund(4,22,-15,'Mid Cap'),
      fund(5,16,-20,'Mid Cap'),
      fund(6,12,-25,'Mid Cap'),
    ];
    const withPeers=applyPeerMetrics(universe,DEFAULT_SCORE_FACTORS,'subcategory');
    expect(hasCurrentPersistentScores(withPeers,DEFAULT_SCORE_FACTORS,'subcategory')).toBe(true);
    for(const item of withPeers){
      expect(typeof item.metrics[SCORE_METRIC_ID]).toBe('number');
    }
    expect(withPeers[0]!.metrics[SCORE_METRIC_ID]!).toBeGreaterThan(withPeers[1]!.metrics[SCORE_METRIC_ID]!);
    expect(withPeers[1]!.metrics[SCORE_METRIC_ID]!).toBeGreaterThan(withPeers[2]!.metrics[SCORE_METRIC_ID]!);
  });

  it('keeps scores invariant across screener filters and on-demand NAV history loads',()=>{
    const universe=applyPersistentScores([
      {...fund(1,18,-10,'Large Cap'),amc:'Alpha AMC'},
      {...fund(2,14,-14,'Large Cap'),amc:'Beta AMC'},
      {...fund(3,11,-18,'Large Cap'),amc:'Alpha AMC'},
      {...fund(4,20,-12,'Mid Cap'),amc:'Beta AMC'},
    ],DEFAULT_SCORE_FACTORS,'subcategory');
    const engine=new ScreenerEngine(universe);
    const fullQuery=engine.query(defaultScreenerFilters,{id:'score',desc:true},20_000*86_400_000,DEFAULT_SCORE_FACTORS);
    const filteredQuery=engine.query({...defaultScreenerFilters,amcs:['Alpha AMC']},{id:'score',desc:true},20_000*86_400_000,DEFAULT_SCORE_FACTORS);
    expect(fullQuery.scores?.[0]).toBeCloseTo(universe[0]!.metrics.composite_score!,2);
    expect(filteredQuery.scores?.[0]).toBeCloseTo(fullQuery.scores![0]!,5);
    expect(filteredQuery.scores?.[2]).toBeCloseTo(fullQuery.scores![2]!,5);
  });
});
