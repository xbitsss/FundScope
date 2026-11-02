import { describe, expect, it } from 'vitest';
import type { ParsedSchemeRow } from '../../src/domain/taxonomy/navFileParser';
import type { ParsedAmfiSchemeMasterRow } from '../../src/domain/parse/amfiSchemeMaster';
import { joinAmfiSchemeMaster } from '../../src/domain/taxonomy/schemeMasterJoin';

const nav=(code:number,isinA:string|null):ParsedSchemeRow=>({schemeCode:code,isinA,isinB:null,name:`Scheme ${code}`,plan:'Direct',option:'Growth',nav:10,navDate:20_000,amc:'Example AMC',structure:'open',categoryRaw:'Equity Scheme - Large Cap Fund',headerRaw:'Open Ended Schemes(Equity Scheme - Large Cap Fund)',lineNumber:1});
const master=(code:number,isinGrowth:string|null):ParsedAmfiSchemeMasterRow=>({schemeCode:code,isinGrowth,isinReinvestment:null,amc:'Example AMC',name:`Scheme ${code}`,schemeType:'Open Ended',categoryRaw:'Equity Scheme - Large Cap Fund',navName:`Scheme ${code}`,minimumAmount:1000,launchDate:null,closureDate:null,lineNumber:1});

describe('AMFI Scheme Master joins',()=>{
  it('prefers scheme code and falls back to a unique ISIN match',()=>{
    const result=joinAmfiSchemeMaster([nav(1,'INF000A00001'),nav(2,'INF000A00002')],[master(1,'INF000A00001'),master(22,'INF000A00002')]);
    expect(result.rows.get(1)?.joinMethod).toBe('scheme_code');
    expect(result.rows.get(2)?.master.schemeCode).toBe(22);
    expect(result.rows.get(2)?.joinMethod).toBe('isin');
    expect(result.diagnostics).toMatchObject({navRows:2,masterRows:2,joined:2,orphanNavCodes:[],orphanMasterCodes:[]});
  });

  it('does not guess when a fallback ISIN is ambiguous',()=>{
    const result=joinAmfiSchemeMaster([nav(1,'INF000A00001')],[master(11,'INF000A00001'),master(12,'INF000A00001')]);
    expect(result.rows.has(1)).toBe(false);
    expect(result.diagnostics.joined).toBe(0);
    expect(result.diagnostics.orphanNavCodes).toEqual([1]);
  });
});
