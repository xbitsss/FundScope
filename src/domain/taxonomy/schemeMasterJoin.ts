import type { ParsedAmfiSchemeMasterRow } from '../parse/amfiSchemeMaster';
import type { ParsedSchemeRow } from './navFileParser';

export interface JoinedSchemeMasterRow { master:ParsedAmfiSchemeMasterRow;joinMethod:'scheme_code'|'isin' }
export interface SchemeMasterJoinResult {
  rows:Map<number,JoinedSchemeMasterRow>;
  diagnostics:{navRows:number;masterRows:number;joined:number;joinRate:number;bySchemeCode:number;byIsin:number;orphanNavCodes:number[];orphanMasterCodes:number[]};
}
const cleanIsin=(value:string|null|undefined)=>value?.replace(/\s+/g,'').toLocaleUpperCase('en')??'';

/** Join AMFI's two official catalogs by scheme code, then by a unique ISIN only. */
export function joinAmfiSchemeMaster(navRows:ParsedSchemeRow[],masterRows:ParsedAmfiSchemeMasterRow[]):SchemeMasterJoinResult{
  const masterByCode=new Map(masterRows.map(row=>[row.schemeCode,row]));
  const masterByIsin=new Map<string,ParsedAmfiSchemeMasterRow[]>();
  for(const row of masterRows)for(const raw of [row.isinGrowth,row.isinReinvestment]){
    const isin=cleanIsin(raw);if(!isin)continue;
    const matches=masterByIsin.get(isin)??[];if(!matches.some(item=>item.schemeCode===row.schemeCode))matches.push(row);masterByIsin.set(isin,matches);
  }
  const joined=new Map<number,JoinedSchemeMasterRow>();const matchedMasterCodes=new Set<number>();let bySchemeCode=0;let byIsin=0;
  for(const row of navRows){
    const exact=masterByCode.get(row.schemeCode);
    if(exact){joined.set(row.schemeCode,{master:exact,joinMethod:'scheme_code'});matchedMasterCodes.add(exact.schemeCode);bySchemeCode++;continue;}
    const candidates=new Map<number,ParsedAmfiSchemeMasterRow>();
    for(const raw of [row.isinA,row.isinB]){const isin=cleanIsin(raw);if(!isin)continue;for(const candidate of masterByIsin.get(isin)??[])candidates.set(candidate.schemeCode,candidate);}
    if(candidates.size!==1)continue;
    const match=[...candidates.values()][0]!;joined.set(row.schemeCode,{master:match,joinMethod:'isin'});matchedMasterCodes.add(match.schemeCode);byIsin++;
  }
  const orphanNavCodes=navRows.filter(row=>!joined.has(row.schemeCode)).map(row=>row.schemeCode);
  const orphanMasterCodes=masterRows.filter(row=>!matchedMasterCodes.has(row.schemeCode)).map(row=>row.schemeCode);
  return {rows:joined,diagnostics:{navRows:navRows.length,masterRows:masterRows.length,joined:joined.size,joinRate:navRows.length?joined.size/navRows.length:0,bySchemeCode,byIsin,orphanNavCodes,orphanMasterCodes}};
}
