import type { AssetClass } from './assetClass';
import { classifyAmfiScheme, type AmfiSchemeClassification } from './classifyV3';
import type { ParsedAmfiSchemeMasterRow } from '../parse/amfiSchemeMaster';
import type { SchemeStructure } from './navFileParser';

export type ClassificationStatus = 'CONFIRMED' | 'UNCONFIRMED' | 'CONFLICT_STALE' | 'CONFLICT';
export interface ClassificationSignal {
  sourceId:'s0_amfi_master'|'s1_navall'|'s2_mfapi'|'s3_amfi_ter'|'s4_amfi_aum';
  categoryRaw:string; assetClass:AssetClass; ruleId:string; observedAt:number; schemeName?:string; subCategory?:string;
}
export interface ClassificationDetail {
  s0?:ClassificationSignal; s1:ClassificationSignal & {headerRaw?:string}; s2?:ClassificationSignal;
  s3?:ClassificationSignal; s4?:ClassificationSignal; evaluatedAt:number; flags:string[];
  conflictFirstSeenAt?:number; conflictObservations?:number;
  review?:{action:'accept_s1'|'rebind_other';reviewedAt:number;categoryRaw:string;note?:string};
}
export interface ClassificationConsensus extends AmfiSchemeClassification { status:ClassificationStatus; detail:ClassificationDetail }
export interface PreviousConflict {count:number;firstSeenAt:number;lastSeenAt:number}

export function previousConflictFrom(detail:ClassificationDetail|undefined,status:ClassificationStatus|undefined):PreviousConflict|undefined{
  if(!detail||(status!=='CONFLICT'&&status!=='CONFLICT_STALE'))return undefined;
  return {count:detail.conflictObservations??1,firstSeenAt:detail.conflictFirstSeenAt??detail.evaluatedAt,lastSeenAt:detail.evaluatedAt};
}

export function reconcileClassification(input:{
  s0?:{categoryRaw:string;observedAt:number;schemeMaster?:Pick<ParsedAmfiSchemeMasterRow,'categoryRaw'|'closureDate'>};
  s1:{categoryRaw:string;headerRaw?:string;observedAt:number;structure?:SchemeStructure;navDate?:number;newestNavDate?:number};
  /** MFapi is retained for transparency and never participates in votes. */
  s2?:{categoryRaw?:string|null;observedAt:number};
  s3?:{categoryRaw?:string|null;observedAt:number};
  s4?:{categoryRaw?:string|null;observedAt:number};
  schemeName:string; evaluatedAt?:number; previousConflict?:PreviousConflict; previousReview?:ClassificationDetail['review'];
}):ClassificationConsensus{
  const evaluatedAt=input.evaluatedAt??Date.now();const structure=input.s1.structure??'unknown';const navDate=input.s1.navDate??Math.floor(input.s1.observedAt/86_400_000);const newestNavDate=input.s1.newestNavDate??navDate;
  const classify=(categoryRaw:string,source:'AMFI_SCHEME_MASTER'|'AMFI_NAVALL'|'AMFI_TER'|'AMFI_AAUM')=>classifyAmfiScheme({categoryRaw,name:input.schemeName,structure,navDate,newestNavDate,schemeMaster:source==='AMFI_SCHEME_MASTER'?(input.s0?.schemeMaster??(input.s0?{categoryRaw:input.s0.categoryRaw,closureDate:null}:undefined)):undefined,source,nowDay:Math.floor(evaluatedAt/86_400_000)});
  const s0=input.s0?.categoryRaw?{sourceId:'s0_amfi_master' as const,categoryRaw:input.s0.categoryRaw,observedAt:input.s0.observedAt,...(()=>{const r=classifyAmfiScheme({categoryRaw:input.s0!.categoryRaw,name:input.schemeName,structure,navDate,newestNavDate,schemeMaster:input.s0!.schemeMaster,source:'AMFI_SCHEME_MASTER',nowDay:Math.floor(evaluatedAt/86_400_000)});return {assetClass:r.assetClass,ruleId:r.ruleId,subCategory:r.subCategory,schemeName:input.schemeName};})()}:undefined;
  const s1Class=classify(input.s1.categoryRaw,'AMFI_NAVALL');
  const s1:ClassificationSignal&{headerRaw?:string}={sourceId:'s1_navall',categoryRaw:input.s1.categoryRaw,observedAt:input.s1.observedAt,assetClass:s1Class.assetClass,ruleId:s1Class.ruleId,subCategory:s1Class.subCategory,schemeName:input.schemeName,...(input.s1.headerRaw?{headerRaw:input.s1.headerRaw}:{})};
  const createSignal=(categoryRaw:string|null|undefined,sourceId:'s2_mfapi'|'s3_amfi_ter'|'s4_amfi_aum',observedAt:number):ClassificationSignal|undefined=>{
    if(!categoryRaw?.trim())return undefined;
    if(sourceId==='s2_mfapi'){const informative=classifyAmfiScheme({categoryRaw,name:input.schemeName,structure,navDate,newestNavDate,source:'AMFI_RULE'});return {sourceId,categoryRaw,observedAt,assetClass:informative.assetClass,ruleId:informative.ruleId,subCategory:informative.subCategory,schemeName:input.schemeName};}
    const source=sourceId==='s3_amfi_ter'?'AMFI_TER':'AMFI_AAUM';const result=classify(categoryRaw,source);return {sourceId,categoryRaw,observedAt,assetClass:result.assetClass,ruleId:result.ruleId,subCategory:result.subCategory,schemeName:input.schemeName};
  };
  const s2=createSignal(input.s2?.categoryRaw,'s2_mfapi',input.s2?.observedAt??evaluatedAt);const s3=createSignal(input.s3?.categoryRaw,'s3_amfi_ter',input.s3?.observedAt??evaluatedAt);const s4=createSignal(input.s4?.categoryRaw,'s4_amfi_aum',input.s4?.observedAt??evaluatedAt);
  let classification=classify(input.s1.categoryRaw,input.s0?.categoryRaw?'AMFI_SCHEME_MASTER':'AMFI_NAVALL');
  const review=input.previousReview&&(input.previousReview.categoryRaw===input.s1.categoryRaw||input.previousReview.categoryRaw===input.s0?.categoryRaw)?input.previousReview:undefined;
  if(review?.action==='accept_s1')classification=s1Class;
  if(review?.action==='rebind_other')classification={...classification,assetClass:'other',group:'Unclassified',subCategory:'Not specified',reason:'USER_REBIND_OTHER',ruleId:'USER_REBIND_OTHER',management:'Not specified',riskBand:'Not specified'};
  const genericS0=Boolean(input.s0?.categoryRaw&&['income','growth','other scheme'].includes(input.s0.categoryRaw.trim().toLocaleLowerCase('en')));
  const signals=[genericS0?undefined:s0,s1,s3,s4].filter((signal):signal is ClassificationSignal=>Boolean(signal));
  const classified=signals.filter(signal=>signal.assetClass!=='other'&&!signal.ruleId.startsWith('RULE_NAME_KEYWORD'));
  const conflicts=classified.filter(signal=>signal.assetClass!==classification.assetClass);
  const leafCounts=new Map<string,number>();for(const signal of classified){if(signal.assetClass!==classification.assetClass)continue;const leaf=`${signal.assetClass}:${signal.subCategory?.toLocaleLowerCase('en')}`;leafCounts.set(leaf,(leafCounts.get(leaf)??0)+1);}
  let status:ClassificationStatus=[...leafCounts.values()].some(count=>count>=2)?'CONFIRMED':'UNCONFIRMED';let conflictFirstSeenAt:number|undefined;let conflictObservations:number|undefined;
  if(conflicts.length){const latestAmfiAt=Math.max(...signals.map(signal=>signal.observedAt));const staleConflict=conflicts.some(signal=>latestAmfiAt-signal.observedAt>3*86_400_000);const previous=input.previousConflict;conflictFirstSeenAt=previous?.firstSeenAt??evaluatedAt;conflictObservations=(previous?.count??0)+1;const persistent=conflictObservations>=2&&evaluatedAt-conflictFirstSeenAt>=3*86_400_000;status=staleConflict&&!persistent?'CONFLICT_STALE':'CONFLICT';}
  if(status==='CONFLICT'&&review?.action==='accept_s1')status='UNCONFIRMED';
  if(status!=='CONFLICT'&&status!=='CONFLICT_STALE'){conflictFirstSeenAt=undefined;conflictObservations=undefined;}
  const detail:ClassificationDetail={...(s0?{s0}:{}),s1,...(s2?{s2}:{}),...(s3?{s3}:{}),...(s4?{s4}:{}),evaluatedAt,flags:[...classification.flags,...(review?.action==='accept_s1'?['REVIEWED_S1']:[]),...(review?.action==='rebind_other'?['USER_REBIND_OTHER']:[])],...(conflictFirstSeenAt!==undefined?{conflictFirstSeenAt,conflictObservations}:{}),...(review?{review}:{})};
  return {...classification,status,detail};
}
