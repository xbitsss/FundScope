import tree from '../../../config/taxonomy-tree.json';
import type { AssetClass } from './assetClass';
import { normalizeCategory, normalizeCategoryText } from './categoryNormalize';
import type { ParsedAmfiSchemeMasterRow } from '../parse/amfiSchemeMaster';

export type TaxonomySource = 'AMFI_SCHEME_MASTER' | 'AMFI_NAVALL' | 'AMFI_TER' | 'AMFI_AAUM' | 'AMFI_RULE';
export interface TaxonomyProvenance { ruleId:string; source:TaxonomySource }
export interface AmfiSchemeClassification {
  assetClass:AssetClass; group:string; subCategory:string; management:'Active'|'Passive'|'Not specified';
  riskBand:'Low'|'Medium'|'High'|'Not specified'; philosophy:'Value'|'Contra'|'Blend/Unspecified';
  speciality:string[]; lifecycle:'active'|'dormant'; lifecycleReason?:'CLOSED'|'NO_RECENT_NAV'; reason:string|null;
  ruleId:string; flags:string[]; provenance:Record<string,TaxonomyProvenance>;
}

const aliases=(tree.aliases.subcategory as Record<string,string>);
const leafIndex=new Map<string,{asset:string;group:string;canonical:string}>();
for(const asset of tree.assets){for(const group of asset.groups){for(const category of group.categories){leafIndex.set(category.toLocaleLowerCase('en'),{asset:asset.id,group:group.label,canonical:category});}}}
const normalize=(value:string)=>normalizeCategoryText(value).toLocaleLowerCase('en').replace(/\bchildrens'/g,"children's").replace(/\s+/g,' ').trim();
const contains=(value:string,patterns:RegExp[])=>patterns.some(pattern=>pattern.test(value));
const fallbackSub=(value:string)=>value.trim().replace(/\s+(?:funds?|etfs?)$/i,'').trim()||'Not specified';

function underlying(name:string):{asset:AssetClass;group:string;sub:string;rule:string}|null{
  const value=normalize(name);
  if(/\bgold\b/.test(value))return {asset:'commodity',group:'Precious metals',sub:'Gold',rule:'RULE_NAME_KEYWORD_GOLD'};
  if(/\bsilver\b/.test(value))return {asset:'commodity',group:'Precious metals',sub:'Silver',rule:'RULE_NAME_KEYWORD_SILVER'};
  if(/capital protection/.test(value))return {asset:'hybrid',group:'Allocation',sub:'Capital Protection',rule:'RULE_NAME_KEYWORD_CAPITAL_PROTECTION'};
  if(/multi asset|multi-asset/.test(value))return {asset:'hybrid',group:'Allocation',sub:'Multi Asset Allocation',rule:'RULE_NAME_KEYWORD_HYBRID'};
  if(/hybrid|balanced|allocation/.test(value))return {asset:'hybrid',group:'Allocation',sub:/equity savings/.test(value)?'Equity Savings':'Dynamic Asset Allocation / Balanced Advantage',rule:'RULE_NAME_KEYWORD_HYBRID'};
  if(/retirement|children|pension/.test(value))return {asset:'solution',group:'Goal-based',sub:/children/.test(value)?"Children's":/pension/.test(value)?'Pension':'Retirement',rule:'RULE_NAME_KEYWORD_SOLUTION'};
  if(/g[s-]?sec|sdl|gilt|bond|target maturity|t[s-]?bill|liquid|overnight|debt/.test(value))return {asset:/liquid|overnight|money market/.test(value)?'liquid':'debt',group:/liquid|overnight/.test(value)?'Overnight & Liquid':/corporate|banking and psu|credit risk/.test(value)?'Credit':'Long & Dynamic',sub:/liquid/.test(value)?'Liquid':/overnight/.test(value)?'Overnight':/gilt|g-sec/.test(value)?'Gilt':/corporate bond/.test(value)?'Corporate Bond':/banking and psu/.test(value)?'Banking & PSU':/index|nifty|sensex/.test(value)?'Debt Index Fund':'Other Debt',rule:'RULE_NAME_KEYWORD_DEBT'};
  if(/equity|nifty|sensex|bank|midcap|smallcap|largecap|flexi|elss|nasdaq|index/.test(value))return {asset:'equity',group:/elss/.test(value)?'Tax saving':/sector|thematic/.test(value)?'Thematic':'Market-cap',sub:/elss/.test(value)?'ELSS':/flexi/.test(value)?'Flexi Cap':/small/.test(value)?'Small Cap':/large\s*(?:and|&)\s*mid/.test(value)?'Large & Mid Cap':/mid/.test(value)?'Mid Cap':/large/.test(value)?'Large Cap':/sector|thematic/.test(value)?'Sectoral/Thematic':'Equity Index Fund',rule:'RULE_NAME_KEYWORD_EQUITY'};
  return null;
}

function assetGroup(category:string,name:string,structure:'open'|'close'|'interval'|'unknown'):{asset:AssetClass;group:string;sub:string;rule:string;reason:string|null;speciality:string[];passive:boolean;active:boolean}{
  const normalized=normalizeCategory(category);let family=normalize(normalized.family??'');const fullRaw=normalize(category);if(/^children'?s fund$/.test(family))family='solution oriented scheme';if(/^life cycle funds?$/.test(family))family='life cycle funds';const subRaw=normalize(normalized.sub??category);let subAlias=aliases[subRaw]??aliases[`${subRaw} fund`]??fallbackSub(normalized.sub??category);
  if(/elss/.test(subRaw))subAlias='ELSS';
  if(/sectoral\s*\/\s*thematic/.test(subRaw))subAlias='Sectoral/Thematic';
  if(/^sectoral(?: fund)?$/.test(subRaw)&&/equity scheme/.test(family))subAlias='Sectoral/Thematic';
  if(/^fixed term plan$/.test(subRaw))subAlias='Fixed Maturity Plan';
  if(/^long term(?: fund)?$/.test(subRaw))subAlias='Long Duration';
  if(/^short term(?: fund)?$/.test(subRaw))subAlias='Short Duration';
  if(/^medium term(?: fund)?$/.test(subRaw))subAlias='Medium Duration';
  if(/^medium to long term(?: fund)?$/.test(subRaw))subAlias='Medium to Long Duration';
  if(/^ultra short term(?: fund)?$/.test(subRaw))subAlias='Ultra Short Duration';
  if(/children'?s fund/.test(subRaw))subAlias="Children's";
  if(/life cycle fund with maturity/.test(subRaw))subAlias='Life Cycle';
  const isEtf=/exchange traded funds|\betfs?\b/.test(family)||/\betfs?\b/.test(fullRaw);
  const isIndex=/index funds|\bindex fund/.test(family)||/\bindex fund/.test(fullRaw);
  const isFof=/fund of funds|\bfof\b|overseas fund/.test(family)||/fund of funds|\bfof\b/.test(fullRaw);
  const isPassiveFamily=isEtf||isIndex;
  const specialities=[...(isEtf?['ETF']:[]),...(isIndex?['Index']:[]),...(isFof?['Fund of Funds']:[])];
  if(/overseas|global|international|investing overseas/.test(`${family} ${subRaw} ${normalize(name)}`))specialities.push('International');
  if(/fixed maturity|fixed term|\bfmp\b/.test(`${subRaw} ${normalize(name)}`))specialities.push('Fixed Maturity Plan');
  if(/capital protection/.test(normalize(name)))specialities.push('Capital Protection');
  if(/sectoral|thematic/.test(`${subRaw} ${normalize(name)}`))specialities.push('Sectoral/Thematic');
  if(/retirement|children|pension/.test(`${subRaw} ${normalize(name)}`))specialities.push('Solution-oriented');
  const entry=leafIndex.get(subAlias.toLocaleLowerCase('en'));
  if(entry&&entry.asset!=='other'){if(entry.asset==='commodity')specialities.push('Gold/Silver');const passive=isPassiveFamily||(isFof&&/\b(?:index|etf)\b/.test(normalize(name)));return {asset:entry.asset as AssetClass,group:entry.group,sub:entry.canonical,rule:`AMFI_LEAF_${entry.canonical.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}`,reason:null,speciality:[...new Set(specialities)],passive,active:!passive&&!isFof&&['equity','debt','hybrid'].includes(entry.asset)};}
  let inference:ReturnType<typeof underlying>=null;
  let reason:string|null=null;let asset:AssetClass='other';let group='Unclassified';let sub='Not specified';let rule='AMFI_CATEGORY_UNMAPPED';
  if(isEtf&&/other etfs?/.test(subRaw)){const metal=/\bgold\b/.test(normalize(name))?'Gold':/\bsilver\b/.test(normalize(name))?'Silver':null;if(metal){asset='commodity';group='Precious metals';sub=metal;rule=`RULE_NAME_KEYWORD_${metal.toUpperCase()}`;}else reason='ETF_UNDERLYING_UNKNOWN';}
  else if(isEtf&&/hybrid etf/.test(fullRaw)){asset='hybrid';group='Allocation';sub='Hybrid ETF';rule='AMFI_ETF_HYBRID';}
  else if(isEtf&&/debt etf/.test(fullRaw)){asset='debt';group='Credit';sub='Debt ETF';rule='AMFI_ETF_DEBT';}
  else if(isEtf&&/equity etf/.test(fullRaw)){asset='equity';group='Thematic';sub='Equity ETF';rule='AMFI_ETF_EQUITY';}
  else if(isEtf&&/overseas|investing overseas/.test(fullRaw)){asset='equity';group='Thematic';sub='International ETF';rule='AMFI_ETF_OVERSEAS';}
  else if(isEtf||/other etf/.test(fullRaw)){inference=underlying(name);if(inference){({asset,group,sub,rule}=inference);}else reason='ETF_UNDERLYING_UNKNOWN';}
  else if(isIndex&&/debt funds/.test(fullRaw)){asset='debt';group='Long & Dynamic';sub='Debt Index Fund';rule='AMFI_INDEX_DEBT';}
  else if(isIndex&&/equity funds/.test(fullRaw)){asset='equity';group='Market-cap';sub='Equity Index Fund';rule='AMFI_INDEX_EQUITY';}
  else if(isIndex&&/hybrid fund/.test(fullRaw)){asset='hybrid';group='Allocation';sub='Hybrid Index Fund';rule='AMFI_INDEX_HYBRID';}
  else if(isIndex){inference=underlying(name);if(inference){({asset,group,sub,rule}=inference);}else reason='INDEX_UNDERLYING_UNKNOWN';}
  else if(isFof){inference=underlying(name);if(inference){({asset,group,sub,rule}=inference);}else reason='FOF_UNDERLYING_UNKNOWN';}
  else if(/^income$/.test(subRaw)){
    if(structure==='close'||structure==='interval'){asset='debt';group='Short & Medium';sub=/fixed maturity|fixed term|\bfmp\b|series\b/.test(normalize(name))?'Fixed Maturity Plan':'Close-ended income';rule=sub==='Fixed Maturity Plan'?'LEGACY_INCOME_FMP':'LEGACY_INCOME_DEBT';if(sub==='Fixed Maturity Plan')specialities.push('Fixed Maturity Plan');}
    else reason='LEGACY_INCOME_UNKNOWN';
  }
  else if(/^growth$/.test(subRaw)){inference=underlying(name);if(inference){({asset,group,sub,rule}=inference);}else reason='LEGACY_GROWTH_UNKNOWN';}
  else if(/life cycle funds?/.test(family)||/life cycle fund with maturity/.test(subRaw)){asset='solution';group='Goal-based';sub='Life Cycle';rule='AMFI_SOLUTION_LIFE_CYCLE';specialities.push('Solution-oriented');}
  else if(/children'?s fund/.test(family)){asset='solution';group='Goal-based';sub="Children's";rule='AMFI_SOLUTION_CHILDREN';specialities.push('Solution-oriented');}
  else if(/fixed maturity|fixed term|\bfmp\b/.test(normalize(name))){asset='debt';group='Short & Medium';sub='Fixed Maturity Plan';rule='AMFI_DEBT_FMP';specialities.push('Fixed Maturity Plan');}
  else if(/^other debt scheme$/.test(subRaw)){asset='debt';group='Short & Medium';sub='Other Debt';rule='AMFI_DEBT_OTHER';}
  else if(/^sectoral(?: fund)?$/.test(subRaw)&&/debt scheme/.test(family)){asset='debt';group='Credit';sub='Sectoral Debt';rule='AMFI_DEBT_SECTORAL';}
  else if(/ultra short to short term/.test(subRaw)){asset='debt';group='Ultra-short & Money';sub='Ultra Short to Short Term';rule='AMFI_DEBT_ULTRA_SHORT_TO_SHORT';}
  else if(family&&(/equity scheme/.test(family)||/debt scheme/.test(family)||/hybrid scheme/.test(family)||/solution oriented/.test(family))){reason='AMFI_CATEGORY_UNMAPPED';}
  else if(asset==='other')reason=/^growth$/.test(subRaw)?'LEGACY_GROWTH_UNKNOWN':'AMFI_CATEGORY_UNMAPPED';
  if(reason)rule=reason;
  const isPassive=Boolean(isPassiveFamily||(isFof&&/\b(?:index|etf)\b/.test(normalize(name))));
  const isActive=!isPassive&&!isFof&&asset!=='other'&&['equity','debt','hybrid'].includes(asset);
  if(asset==='commodity')specialities.push('Gold/Silver');
  if(specialities.includes('Fixed Maturity Plan')||sub==='Fixed Maturity Plan')specialities.push('Fixed Maturity Plan');
  return {asset,group,sub,rule,reason,speciality:[...new Set(specialities)],passive:isPassive,active:isActive};
}

export function classifyAmfiScheme(input:{categoryRaw:string;name:string;structure:'open'|'close'|'interval'|'unknown';navDate:number;newestNavDate:number;schemeMaster?:Pick<ParsedAmfiSchemeMasterRow,'categoryRaw'|'closureDate'>|null;source?:TaxonomySource;nowDay?:number}):AmfiSchemeClassification{
  const s0=input.schemeMaster?.categoryRaw?.trim()??(input.source==='AMFI_SCHEME_MASTER'?input.categoryRaw.trim():'');const generic=(raw:string)=>['income','growth','other scheme','not specified'].includes(normalize(raw));
  const categoryRaw=s0&&!generic(s0)?s0:input.categoryRaw;const source:TaxonomySource=s0&&!generic(s0)?'AMFI_SCHEME_MASTER':input.source??'AMFI_NAVALL';
  const result=assetGroup(categoryRaw,input.name,input.structure);const selectedRaw=normalize(categoryRaw);
  const riskRule=(tree.risk_band_rules as Array<{pattern:string;value:'Low'|'Medium'|'High'}>).find(item=>new RegExp(item.pattern,'i').test(result.sub));
  const riskBand=result.asset==='other'?'Not specified':riskRule?.value??'High';
  const nowDay=input.nowDay??Math.floor(Date.now()/86_400_000);const closed=input.schemeMaster?.closureDate!==null&&input.schemeMaster?.closureDate!==undefined&&input.schemeMaster.closureDate<nowDay;
  const oldNav=input.newestNavDate-input.navDate>tree.dormant_nav_days;
  const lifecycle=closed||(!input.schemeMaster?.closureDate&&oldNav)?'dormant':'active';
  const fields=['assetClass','group','subCategory','management','riskBand','philosophy','speciality','lifecycle'];
  const provenance:Record<string,TaxonomyProvenance>={};for(const field of fields)provenance[field]={ruleId:result.rule,source:field==='lifecycle'?'AMFI_NAVALL':source};
  const flags:string[]=[];if(result.rule.startsWith('RULE_NAME_KEYWORD'))flags.push('RULE_NAME_KEYWORD');if(s0&&source==='AMFI_SCHEME_MASTER')flags.push('S0_PRIMARY');if(result.reason)flags.push(result.reason);
  if(result.speciality.includes('Fixed Maturity Plan'))provenance.speciality={ruleId:'SPECIALITY_FIXED_MATURITY',source:'AMFI_NAVALL'};
  if(result.speciality.includes('Capital Protection'))provenance.speciality={ruleId:'SPECIALITY_CAPITAL_PROTECTION',source:'AMFI_NAVALL'};
  return {assetClass:result.asset,group:result.group,subCategory:result.sub,management:result.passive?'Passive':result.active?'Active':'Not specified',riskBand,philosophy:/\bvalue\b/.test(selectedRaw)?'Value':/\bcontra\b/.test(selectedRaw)?'Contra':'Blend/Unspecified',speciality:result.speciality,lifecycle,...(closed?{lifecycleReason:'CLOSED' as const}:oldNav?{lifecycleReason:'NO_RECENT_NAV' as const}:{}),reason:result.reason,ruleId:result.rule,flags,provenance};
}
