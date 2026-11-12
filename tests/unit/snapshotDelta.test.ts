import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { applySnapshotDelta, buildSnapshotDelta } from '../../src/adapters/snapshot/delta';

const fund=(code:number,values:Partial<Fund>={}):Fund=>({code,isinGrowth:null,isinReinvestment:null,name:`Scheme ${code}`,amc:'AMC',category:'Equity',assetClass:'equity',classRuleId:'TEST',taxonomyVersion:3,subCategory:'Large Cap',structure:'open',plan:'Direct',option:'Growth',nav:20,navDate:20_500,history:[],metrics:{cagr_3y:10,sharpe:1},metricReasons:{},...values});

describe('encrypted snapshot index deltas',()=>{
  it('patches list fields and metric values, adds new funds, removes absent funds, and keeps cached NAV history',()=>{
    const history=[{date:20_499,nav:19.8},{date:20_500,nav:20}];
    const base=[fund(1,{history,classDetail:{flags:[]} as Fund['classDetail']}),fund(2)];
    const latest=[fund(1,{nav:21,navDate:20_501,metrics:{cagr_3y:11,sharpe:1.1},metricReasons:{ter_pct:'SOURCE_MISSING'}}),fund(3,{name:'New scheme',nav:25,navDate:20_503,metrics:{cagr_3y:null},metricReasons:{cagr_3y:'INSUFFICIENT_HISTORY'}})];
    const delta=buildSnapshotDelta(base,latest,'snapshot-a','snapshot-b');
    const patched=applySnapshotDelta(base,delta,'snapshot-a','snapshot-b',2);
    expect(patched.map(item=>item.code)).toEqual([1,3]);
    expect(patched[0]).toMatchObject({nav:21,navDate:20_501,history,metrics:{cagr_3y:11,sharpe:1.1},metricReasons:{ter_pct:'SOURCE_MISSING'}});
    expect(patched[0]!.classDetail).toBeUndefined();
    expect(patched[1]).toMatchObject({code:3,name:'New scheme',nav:25,navDate:20_503,metrics:{cagr_3y:null},metricReasons:{cagr_3y:'INSUFFICIENT_HISTORY'}});
  });

  it('rejects the wrong base, wrong count, malformed rows and duplicate updates for full-index fallback',()=>{
    const base=[fund(1)];const latest=[fund(1,{nav:21})];const delta=buildSnapshotDelta(base,latest,'snapshot-a','snapshot-b');
    expect(()=>applySnapshotDelta(base,delta,'snapshot-old','snapshot-b',1)).toThrow(/cached snapshot/);
    expect(()=>applySnapshotDelta(base,delta,'snapshot-a','snapshot-b',2)).toThrow(/counts/);
    expect(()=>applySnapshotDelta(base,{...delta,upserts:[...delta.upserts,...delta.upserts]},'snapshot-a','snapshot-b',1)).toThrow(/invalid or duplicate/);
    expect(()=>applySnapshotDelta(base,{...delta,upserts:[{...delta.upserts[0]!,fields:{nav:-1}}]},'snapshot-a','snapshot-b',1)).toThrow(/invalid or duplicate/);
  });
});
