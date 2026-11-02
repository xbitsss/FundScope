import { describe, expect, it } from 'vitest';
import { parseAmfiSchemeMasterCsv } from '../../src/domain/parse/amfiSchemeMaster';

const joinedIsinHeader='AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,Scheme Minimum Amount,Launch Date, Closure Date,ISIN Div Payout/ ISIN GrowthISIN Div Reinvestment';

describe('AMFI Scheme Master CSV',()=>{
  it('parses the live header shape, BOM, quoted commas, and a concatenated ISIN pair',()=>{
    const csv=[
      `\uFEFF${joinedIsinHeader}`,
      '"Example AMC, Limited",123456,"Example Large Cap Fund",Open Ended,Equity Scheme - Large Cap Fund,"Example Large Cap Fund - Direct Growth",5000,01-Jan-2020,,INF209K01157INF209K01CE5',
    ].join('\r\n');
    const parsed=parseAmfiSchemeMasterCsv(csv);
    expect(parsed.diagnostics).toMatchObject({shapeValid:true,parsedRowCount:1,rejectedRows:[]});
    expect(parsed.schemes[0]).toMatchObject({
      schemeCode:123456,amc:'Example AMC, Limited',name:'Example Large Cap Fund',schemeType:'Open Ended',
      categoryRaw:'Equity Scheme - Large Cap Fund',navName:'Example Large Cap Fund - Direct Growth',
      minimumAmount:5000,launchDate:expect.any(Number),closureDate:null,
      isinGrowth:'INF209K01157',isinReinvestment:'INF209K01CE5',
    });
  });

  it('accepts separate ISIN columns and rejects unknown header shapes closed',()=>{
    const separate=[
      'AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,Scheme Minimum Amount,Launch Date,Closure Date,ISIN Growth,ISIN Div Reinvestment',
      'Example AMC,123457,Example Debt Fund,Open Ended,Debt Scheme - Liquid Fund,Example Debt Fund,1000,02-Jan-2020,03-Jan-2025,INF123A01001,INF123A01019',
    ].join('\n');
    expect(parseAmfiSchemeMasterCsv(separate).schemes[0]).toMatchObject({isinGrowth:'INF123A01001',isinReinvestment:'INF123A01019',closureDate:expect.any(Number)});
    expect(()=>parseAmfiSchemeMasterCsv('Code,Name\n123,Example')).toThrow(/header/i);
  });
});
