import type { Fund } from '../types';

export interface UnclassifiedReasonGroup {
  reasonCode:string;
  funds:Fund[];
  activeCount:number;
  dormantCount:number;
  unknownLifecycleCount:number;
  sourceLabels:string[];
}

/** Group only the Unclassified asset class; unknown lifecycle stays visible instead of being counted as dormant. */
export function groupUnclassifiedByReason(funds:Fund[]):UnclassifiedReasonGroup[]{
  const groups=new Map<string,Fund[]>();
  for(const fund of funds){
    if(fund.assetClass!=='other')continue;
    const reason=fund.classificationReason||fund.classRuleId||'NO_REASON_CODE';
    groups.set(reason,[...(groups.get(reason)??[]),fund]);
  }
  return [...groups.entries()].map(([reasonCode,items])=>({
    reasonCode,
    funds:items,
    activeCount:items.filter(fund=>fund.lifecycle==='active').length,
    dormantCount:items.filter(fund=>fund.lifecycle==='dormant').length,
    unknownLifecycleCount:items.filter(fund=>fund.lifecycle!=='active'&&fund.lifecycle!=='dormant').length,
    sourceLabels:[...new Set(items.map(fund=>fund.schemeMaster?.categoryRaw||fund.classDetail?.s1.categoryRaw||fund.category).filter(Boolean))],
  })).sort((a,b)=>b.funds.length-a.funds.length||a.reasonCode.localeCompare(b.reasonCode));
}
