import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { groupUnclassifiedByReason } from '../../src/domain/taxonomy/reviewQueue';

const fund=(code:number,values:Partial<Fund>):Fund=>({code,isinGrowth:null,isinReinvestment:null,name:`Fund ${code}`,amc:'AMC',category:'Category',assetClass:'other',classRuleId:'UNCLASSIFIED',taxonomyVersion:3,subCategory:'Not specified',structure:'open',plan:'Direct',option:'Growth',nav:10,navDate:20_000,history:[],metrics:{},...values});

describe('unclassified review queue',()=>{
  it('groups by explicit reason and reports active, dormant, and unknown lifecycle separately',()=>{
    const groups=groupUnclassifiedByReason([
      fund(1,{classificationReason:'LEGACY_INCOME_UNKNOWN',lifecycle:'dormant',lifecycleReason:'CLOSED'}),
      fund(2,{classificationReason:'LEGACY_INCOME_UNKNOWN',lifecycle:'active'}),
      fund(3,{classificationReason:'LEGACY_INCOME_UNKNOWN'}),
      fund(4,{classificationReason:'ETF_UNDERLYING_UNKNOWN',lifecycle:'dormant'}),
      fund(5,{assetClass:'equity',classificationReason:null,lifecycle:'active'}),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({reasonCode:'LEGACY_INCOME_UNKNOWN',activeCount:1,dormantCount:1,unknownLifecycleCount:1,funds:[expect.objectContaining({code:1}),expect.objectContaining({code:2}),expect.objectContaining({code:3})]});
    expect(groups[1]).toMatchObject({reasonCode:'ETF_UNDERLYING_UNKNOWN',activeCount:0,dormantCount:1,unknownLifecycleCount:0});
  });

  it('uses source raw values for rule review and exports unclassified source coverage',()=>{
    const groups=groupUnclassifiedByReason([fund(7,{category:'NAV label',schemeMaster:{name:'Master name',schemeType:'Equity',categoryRaw:'Master category',navName:'',minimumAmount:null,launchDate:null,closureDate:null,isinGrowth:null,isinReinvestment:null,joinMethod:'scheme_code'},classDetail:{s1:{sourceId:'s1_navall',categoryRaw:'NAV category',assetClass:'other',ruleId:'X',observedAt:1},evaluatedAt:1,flags:[]}})]);
    expect(groups[0]?.sourceLabels).toEqual(['Master category']);
  });
});
