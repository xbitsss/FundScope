import type { Fund } from '../domain/types';
import * as XLSX from 'xlsx';

export type DisclosureRecord={schemeCode:number;aumCr?:number;terPct?:number;source:'AMFI_DISCLOSURE'|'LOCAL_OVERRIDE';asOf?:number};
const objectValue=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const numberValue=(value:string|undefined)=>{if(!value)return undefined;const parsed=Number(value.replace(/[₹,%,$,\s]/g,''));return Number.isFinite(parsed)?parsed:undefined;};
const headerKey=(header:string)=>header.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_');
export const normalizeDisclosureName=(name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const splitCsvLine=(line:string)=>{const values:string[]=[];let value='',quoted=false;for(let index=0;index<line.length;index++){const char=line[index]!;if(char==='"'){if(quoted&&line[index+1]==='"'){value+='"';index++;}else quoted=!quoted;}else if(char===','&&!quoted){values.push(value.trim());value='';}else value+=char;}values.push(value.trim());return values;};

/** Parses audited exports only. Ambiguous name-only rows are intentionally rejected. */
export function parseDisclosureCsv(text:string,source:DisclosureRecord['source']='AMFI_DISCLOSURE'):DisclosureRecord[]{
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());if(lines.length<2)return [];
  const headers=splitCsvLine(lines[0]!).map(headerKey);const codeIndex=headers.findIndex(header=>['scheme_code','schemecode','amfi_code'].includes(header));const aumIndex=headers.findIndex(header=>['aum_cr','aum','average_aum_cr'].includes(header));const terIndex=headers.findIndex(header=>['ter_pct','ter','expense_ratio','total_expense_ratio'].includes(header));
  if(codeIndex<0)return [];
  return lines.slice(1).flatMap(line=>{const values=splitCsvLine(line);const schemeCode=Number(values[codeIndex]);if(!Number.isInteger(schemeCode)||schemeCode<=0)return [];const aumCr=numberValue(values[aumIndex]);const terPct=numberValue(values[terIndex]);return aumCr===undefined&&terPct===undefined?[]:[{schemeCode,aumCr,terPct,source}];});
}

/** Parses AMFI's official scheme-wise AAUM API payload; output units are crore. */
export function parseAmfiAverageAumRows(payload:unknown,asOf:number):DisclosureRecord[]{
  const root=objectValue(payload);if(!Array.isArray(root?.data))return [];const records:DisclosureRecord[]=[];
  for(const houseValue of root.data){const house=objectValue(houseValue);if(!Array.isArray(house?.schemes))continue;for(const schemeValue of house.schemes){const scheme=objectValue(schemeValue);const schemeCode=Number(scheme?.AMFI_Code);const aum=objectValue(scheme?.AverageAumForTheMonth);if(!Number.isInteger(schemeCode)||schemeCode<=0||!aum)continue;const primary=Number(aum.ExcludingFundOfFundsDomesticButIncludingFundOfFundsOverseas??0);const domesticFof=Number(aum.FundOfFundsDomestic??0);const aumCr=primary+domesticFof;if(Number.isFinite(aumCr)&&aumCr>0)records.push({schemeCode,aumCr,source:'AMFI_DISCLOSURE',asOf});}}
  return records;
}

/** Parses official AMFI Excel exports, joining by scheme code or unique full scheme name. */
export function parseDisclosureWorkbook(data:ArrayBuffer,funds:Fund[],source:DisclosureRecord['source']='AMFI_DISCLOSURE'):DisclosureRecord[]{
  const workbook=XLSX.read(data,{type:'array',cellDates:false});const byName=new Map<string,Fund[]>();
  for(const fund of funds){const name=normalizeDisclosureName(fund.name);const matches=byName.get(name)??[];matches.push(fund);byName.set(name,matches);}
  const records=new Map<number,DisclosureRecord>();
  for(const sheetName of workbook.SheetNames){const sheet=workbook.Sheets[sheetName];if(!sheet)continue;const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:''});
    for(let rowIndex=0;rowIndex<Math.min(rows.length,40);rowIndex++){
      const headers=(rows[rowIndex]??[]).map(value=>headerKey(String(value)));const codeIndex=headers.findIndex(header=>['scheme_code','scheme_code_','schemecode','amfi_code'].includes(header));const nameIndex=headers.findIndex(header=>['scheme_name','scheme','name','scheme_name_'].includes(header));const aumIndex=headers.findIndex(header=>['aum_cr','aum','average_aum_cr','a_u_m'].includes(header));const terIndex=headers.findIndex(header=>['ter_pct','ter','expense_ratio','total_expense_ratio'].includes(header));
      if((codeIndex<0&&nameIndex<0)||(aumIndex<0&&terIndex<0))continue;
      for(const row of rows.slice(rowIndex+1)){const values=row??[];let code=codeIndex>=0?Number(values[codeIndex]):NaN;
        if(!Number.isInteger(code)||code<=0){const rawName=nameIndex>=0?String(values[nameIndex]??''):'';const matches=byName.get(normalizeDisclosureName(rawName))??[];if(matches.length!==1)continue;code=matches[0]!.code;}
        const aumCr=numberValue(String(values[aumIndex]??''));const terPct=numberValue(String(values[terIndex]??''));if(aumCr===undefined&&terPct===undefined)continue;
        records.set(code,{schemeCode:code,aumCr,terPct,source});
      }
      break;
    }
  }
  return [...records.values()];
}

export function workbookHasIndustryAumOnly(data:ArrayBuffer):boolean{
  const workbook=XLSX.read(data,{type:'array',cellDates:false});const report=workbook.Sheets.MCR_MonthlyReport;if(!report)return false;
  const rows=XLSX.utils.sheet_to_json<unknown[]>(report,{header:1,raw:true,defval:''});const text=rows.slice(0,8).flat().map(value=>String(value).toLowerCase()).join(' ');
  const headers=rows.flat().map(value=>headerKey(String(value)));
  return /monthly report/.test(text)&&headers.some(header=>header.includes('net_assets_under_management'))&&!headers.some(header=>['scheme_code','schemecode','amfi_code'].includes(header));
}

export function applyDisclosures(funds:Fund[],records:DisclosureRecord[]):Fund[]{
  const byCode=new Map(records.map(record=>[record.schemeCode,record]));return funds.map(fund=>{const record=byCode.get(fund.code);const metrics={...fund.metrics};const reasons={...fund.metricReasons};const provenance={...fund.metricProvenance};const metricAsOf={...fund.metricAsOf};
    for(const [id,value] of [['aum_cr',record?.aumCr],['ter_pct',record?.terPct]] as const){if(value===undefined){if(metrics[id]==null)reasons[id]='SOURCE_MISSING';continue;}if(record?.source==='AMFI_DISCLOSURE'&&provenance[id]==='LOCAL_OVERRIDE')continue;metrics[id]=value;delete reasons[id];provenance[id]=record!.source==='LOCAL_OVERRIDE'?'LOCAL_OVERRIDE':'AMFI_DISCLOSURE';if(record?.asOf!==undefined)metricAsOf[id]=record.asOf;}
    return {...fund,metrics,metricReasons:reasons,metricProvenance:provenance,metricAsOf};
  });
}

export function markMissingDisclosureMetrics(fund:Fund):Fund{
  const metrics={...fund.metrics};const reasons={...fund.metricReasons};
  for(const id of ['aum_cr','ter_pct'])if(metrics[id]==null)reasons[id]='SOURCE_MISSING';
  return {...fund,metrics,metricReasons:reasons};
}
