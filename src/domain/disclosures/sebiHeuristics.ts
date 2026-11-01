import type { Fund, MetricReason } from '../types';

type HoldingRule=Record<string,number>;
const rules:Record<string,HoldingRule>={
  'Large Cap':{equity_holding_pct:80,largecap_holding_pct:80},
  'Large & Mid Cap':{equity_holding_pct:80,largecap_holding_pct:35,midcap_holding_pct:35},
  'Mid Cap':{equity_holding_pct:65,midcap_holding_pct:65},
  'Small Cap':{equity_holding_pct:65,smallcap_holding_pct:65},
  'ELSS':{equity_holding_pct:80},
  'Focused':{equity_holding_pct:65},
  'Flexi Cap':{equity_holding_pct:65},
  'Multi Cap':{equity_holding_pct:75,largecap_holding_pct:25,midcap_holding_pct:25,smallcap_holding_pct:25},
  'Corporate Bond':{debt_holding_pct:80,corporate_debt_pct:80},
  'Gilt':{debt_holding_pct:80,sovereign_debt_pct:80},
};
const holdingIds=['equity_holding_pct','debt_holding_pct','largecap_holding_pct','midcap_holding_pct','smallcap_holding_pct','sovereign_debt_pct','corporate_debt_pct','cash_holding_pct','top_10_concentration_pct'];

/** Category floors from SEBI scheme mandates. They are profile bounds, never reported portfolio holdings. */
export function applySebiHoldingHeuristics(fund:Fund):Fund{
  const metrics={...fund.metrics};const reasons={...fund.metricReasons};const provenance={...fund.metricProvenance};const rule=rules[fund.subCategory];
  for(const id of holdingIds){if(metrics[id]!=null)continue;const value=rule?.[id];if(value===undefined){metrics[id]=null;reasons[id]='SOURCE_MISSING';continue;}metrics[id]=value;delete reasons[id];provenance[id]='SEBI_HEURISTIC';}
  return {...fund,metrics,metricReasons:reasons,metricProvenance:provenance};
}
