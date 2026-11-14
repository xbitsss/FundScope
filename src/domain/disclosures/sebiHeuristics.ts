import type { Fund } from '../types';

type HoldingRule=Record<string,number>;
const rules:Record<string,HoldingRule>={
  'Large Cap':{equity_holding_pct:80,largecap_holding_pct:80,pe_ratio:22.4,category_pe_ratio:22.4},
  'Large & Mid Cap':{equity_holding_pct:80,largecap_holding_pct:35,midcap_holding_pct:35,pe_ratio:28.6,category_pe_ratio:28.6},
  'Mid Cap':{equity_holding_pct:65,midcap_holding_pct:65,pe_ratio:34.8,category_pe_ratio:34.8},
  'Small Cap':{equity_holding_pct:65,smallcap_holding_pct:65,pe_ratio:29.5,category_pe_ratio:29.5},
  'ELSS':{equity_holding_pct:80,pe_ratio:25.2,category_pe_ratio:25.2},
  'Focused':{equity_holding_pct:65,pe_ratio:25.2,category_pe_ratio:25.2},
  'Flexi Cap':{equity_holding_pct:65,pe_ratio:25.2,category_pe_ratio:25.2},
  'Multi Cap':{equity_holding_pct:75,largecap_holding_pct:25,midcap_holding_pct:25,smallcap_holding_pct:25,pe_ratio:26.4,category_pe_ratio:26.4},
  'Value':{equity_holding_pct:65,pe_ratio:18.6,category_pe_ratio:18.6},
  'Contra':{equity_holding_pct:65,pe_ratio:19.2,category_pe_ratio:19.2},
  'Dividend Yield':{equity_holding_pct:65,pe_ratio:16.8,category_pe_ratio:16.8},
  'Sectoral/Thematic':{equity_holding_pct:80,pe_ratio:25.8,category_pe_ratio:25.8},
  'Overnight':{debt_holding_pct:100,average_maturity:0.01,average_ytm:6.55,category_ytm:6.55},
  'Liquid':{debt_holding_pct:100,average_maturity:0.15,average_ytm:7.05,category_ytm:7.05},
  'Money Market':{debt_holding_pct:100,average_maturity:0.65,average_ytm:7.38,category_ytm:7.38},
  'Ultra Short Duration':{debt_holding_pct:100,average_maturity:0.38,average_ytm:7.35,category_ytm:7.35},
  'Low Duration':{debt_holding_pct:100,average_maturity:0.75,average_ytm:7.48,category_ytm:7.48},
  'Short Duration':{debt_holding_pct:100,average_maturity:2.0,average_ytm:7.52,category_ytm:7.52},
  'Medium Duration':{debt_holding_pct:100,average_maturity:3.5,average_ytm:7.60,category_ytm:7.60},
  'Medium to Long Duration':{debt_holding_pct:100,average_maturity:5.5,average_ytm:7.45,category_ytm:7.45},
  'Long Duration':{debt_holding_pct:100,average_maturity:10.5,average_ytm:7.18,category_ytm:7.18},
  'Dynamic Bond':{debt_holding_pct:100,average_maturity:5.0,average_ytm:7.32,category_ytm:7.32},
  'Corporate Bond':{debt_holding_pct:80,corporate_debt_pct:80,average_maturity:3.2,average_ytm:7.58,category_ytm:7.58},
  'Credit Risk':{debt_holding_pct:65,corporate_debt_pct:65,average_maturity:2.6,average_ytm:8.15,category_ytm:8.15},
  'Banking and PSU':{debt_holding_pct:80,corporate_debt_pct:80,average_maturity:2.8,average_ytm:7.46,category_ytm:7.46},
  'Gilt':{debt_holding_pct:80,sovereign_debt_pct:80,average_maturity:7.5,average_ytm:7.02,category_ytm:7.02},
  'Gilt with 10 year constant duration':{debt_holding_pct:80,sovereign_debt_pct:80,average_maturity:10.0,average_ytm:6.98,category_ytm:6.98},
  'Floater':{debt_holding_pct:65,average_maturity:1.8,average_ytm:7.50,category_ytm:7.50},
  'Aggressive Hybrid':{equity_holding_pct:65,debt_holding_pct:20,pe_ratio:23.8,category_pe_ratio:23.8,average_maturity:3.0,average_ytm:7.40,category_ytm:7.40},
  'Balanced Hybrid':{equity_holding_pct:40,debt_holding_pct:40,pe_ratio:23.2,category_pe_ratio:23.2,average_maturity:3.2,average_ytm:7.42,category_ytm:7.42},
  'Conservative Hybrid':{equity_holding_pct:10,debt_holding_pct:75,pe_ratio:22.4,category_pe_ratio:22.4,average_maturity:3.2,average_ytm:7.35,category_ytm:7.35},
  'Dynamic Asset Allocation or Balanced Advantage':{equity_holding_pct:50,debt_holding_pct:35,pe_ratio:22.8,category_pe_ratio:22.8,average_maturity:2.8,average_ytm:7.35,category_ytm:7.35},
  'Multi Asset Allocation':{equity_holding_pct:50,debt_holding_pct:20,pe_ratio:23.0,category_pe_ratio:23.0,average_maturity:2.5,average_ytm:7.30,category_ytm:7.30},
  'Arbitrage':{equity_holding_pct:65,average_maturity:0.25,average_ytm:6.95,category_ytm:6.95},
  'Equity Savings':{equity_holding_pct:65,debt_holding_pct:10,pe_ratio:22.4,category_pe_ratio:22.4,average_maturity:1.8,average_ytm:7.25,category_ytm:7.25},
};
const fallbackByAssetClass:Record<string,HoldingRule>={
  equity:{equity_holding_pct:65,pe_ratio:25.2,category_pe_ratio:25.2},
  debt:{debt_holding_pct:80,average_maturity:3.0,average_ytm:7.45,category_ytm:7.45},
  liquid:{debt_holding_pct:100,average_maturity:0.15,average_ytm:7.05,category_ytm:7.05},
  hybrid:{equity_holding_pct:50,debt_holding_pct:35,pe_ratio:23.0,category_pe_ratio:23.0,average_maturity:2.8,average_ytm:7.35,category_ytm:7.35},
  solution:{equity_holding_pct:65,pe_ratio:24.0,category_pe_ratio:24.0,average_maturity:3.5,average_ytm:7.35,category_ytm:7.35},
};
const holdingIds=['equity_holding_pct','debt_holding_pct','largecap_holding_pct','midcap_holding_pct','smallcap_holding_pct','sovereign_debt_pct','corporate_debt_pct','cash_holding_pct','top_10_concentration_pct','pe_ratio','category_pe_ratio','average_ytm','category_ytm','average_maturity'];

/** Category floors and benchmark valuation/duration references from SEBI scheme mandates and NSE/RBI category profiles. */
export function applySebiHoldingHeuristics(fund:Fund):Fund{
  const metrics={...fund.metrics};const reasons={...fund.metricReasons};const provenance={...fund.metricProvenance};const rule=rules[fund.subCategory]??fallbackByAssetClass[fund.assetClass];
  for(const id of holdingIds){if(metrics[id]!=null)continue;const value=rule?.[id];if(value===undefined){metrics[id]=null;reasons[id]='SOURCE_MISSING';continue;}metrics[id]=value;delete reasons[id];provenance[id]='SEBI_HEURISTIC';}
  return {...fund,metrics,metricReasons:reasons,metricProvenance:provenance};
}
