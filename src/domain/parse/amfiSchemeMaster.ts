import { z } from 'zod';
import { parseAmfiDate } from './amfiDate';

export interface ParsedAmfiSchemeMasterRow {
  amc:string;
  schemeCode:number;
  name:string;
  schemeType:string;
  categoryRaw:string;
  navName:string;
  minimumAmount:number|null;
  launchDate:number|null;
  closureDate:number|null;
  isinGrowth:string|null;
  isinReinvestment:string|null;
  lineNumber:number;
}
export interface ParsedAmfiSchemeMaster {
  schemes:ParsedAmfiSchemeMasterRow[];
  diagnostics:{
    columnHeader:string;
    headerCount:number;
    candidateRowCount:number;
    parsedRowCount:number;
    rejectedRows:Array<{lineNumber:number;reason:string;raw:string}>;
    duplicateSchemeCodes:number[];
    shapeValid:boolean;
  };
}

const rowSchema=z.object({
  amc:z.string().min(1),schemeCode:z.number().int().positive(),name:z.string().min(1),
  schemeType:z.string(),categoryRaw:z.string(),navName:z.string(),minimumAmount:z.number().nonnegative().nullable(),
  launchDate:z.number().int().nullable(),closureDate:z.number().int().nullable(),
  isinGrowth:z.string().nullable(),isinReinvestment:z.string().nullable(),lineNumber:z.number().int().positive(),
});

type CsvRecord={fields:string[];lineNumber:number;raw:string};
function parseCsvRecords(text:string):CsvRecord[]{
  const records:CsvRecord[]=[];let fields:string[]=[];let field='';let quoted=false;let line=1;let recordLine=1;let raw='';
  for(let index=0;index<text.length;index++){
    const char=text[index]!;raw+=char;
    if(char==='"'){
      if(quoted&&text[index+1]==='"'){field+='"';raw+='"';index++;}
      else quoted=!quoted;
    }else if(char===','&&!quoted){fields.push(field.trim());field='';}
    else if((char==='\n'||char==='\r')&&!quoted){
      if(char==='\r'&&text[index+1]==='\n'){raw+='\n';index++;}
      fields.push(field.trim());
      if(fields.some(value=>value!==''))records.push({fields,lineNumber:recordLine,raw:raw.replace(/[\r\n]+$/,'')});
      fields=[];field='';raw='';line++;recordLine=line;
    }else{field+=char;if(char==='\n')line++;}
  }
  if(quoted)throw new Error('AMFI Scheme Master CSV contains an unterminated quoted field.');
  if(field||fields.length){fields.push(field.trim());if(fields.some(value=>value!==''))records.push({fields,lineNumber:recordLine,raw});}
  return records;
}
const headerKey=(value:string)=>value.normalize('NFKC').replace(/^\uFEFF/,'').trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const aliases={
  amc:['amc','amc name','asset management company'],
  schemeCode:['code','scheme code','amfi code','amfi scheme code'],
  name:['scheme name','name'],
  schemeType:['scheme type','type'],
  categoryRaw:['scheme category','category'],
  navName:['scheme nav name','nav scheme name','scheme nav'],
  minimumAmount:['scheme minimum amount','minimum amount','minimum investment'],
  launchDate:['launch date','scheme launch date'],
  closureDate:['closure date','scheme closure date','maturity date'],
} as const;
const findHeader=(headers:string[],keys:readonly string[])=>headers.findIndex(value=>keys.some(key=>value===key));
function cleanIsin(value:string|undefined):string|null{
  const cleaned=(value??'').replace(/\s+/g,'').toLocaleUpperCase('en');
  return cleaned&&cleaned!=='-'&&!/^n\.?a\.?$/i.test(cleaned)?cleaned:null;
}
function parseIsinPair(value:string|undefined):[string|null,string|null]{
  const cleaned=cleanIsin(value);if(!cleaned)return [null,null];
  if(cleaned.length===24&&/^[A-Z0-9]{24}$/.test(cleaned))return [cleaned.slice(0,12),cleaned.slice(12)];
  return [cleaned,null];
}
function parseDateCell(value:string|undefined,fieldName:string):number|null{
  const raw=value?.trim()??'';if(!raw||/^n\.?a\.?$/i.test(raw)||raw==='-')return null;
  const parsed=parseAmfiDate(raw);if(parsed===null)throw new Error(`INVALID_${fieldName.toUpperCase().replace(/\s+/g,'_')}`);return parsed;
}
function parseMoney(value:string|undefined):number|null{
  const raw=value?.trim()??'';if(!raw||raw==='-')return null;const parsed=Number(raw.replace(/[₹,$\s]/g,''));return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}

/** Parses AMFI's public scheme master. Unknown column layouts fail closed before rows are consumed. */
export function parseAmfiSchemeMasterCsv(text:string):ParsedAmfiSchemeMaster{
  const records=parseCsvRecords(text.replace(/^\uFEFF/,''));
  const headerRecord=records[0];if(!headerRecord)throw new Error('AMFI Scheme Master CSV is empty.');
  const headers=headerRecord.fields.map(headerKey);
  const indices=Object.fromEntries(Object.entries(aliases).map(([field,keys])=>[field,findHeader(headers,keys)])) as Record<keyof typeof aliases,number>;
  const missing=Object.entries(indices).filter(([,index])=>index<0).map(([name])=>name);
  const isinGrowthIndex=headers.findIndex(value=>value.includes('isin')&&(value.includes('growth')||value.includes('payout')));
  const isinReinvestmentIndex=headers.findIndex(value=>value.includes('isin')&&value.includes('reinvestment'));
  if(missing.length||isinGrowthIndex<0)throw new Error(`AMFI Scheme Master CSV header is not recognized; missing columns: ${[...missing,...(isinGrowthIndex<0?['isin']:[])].join(', ')}.`);
  const candidateRows=records.slice(1);const schemes:ParsedAmfiSchemeMasterRow[]=[];const rejectedRows:ParsedAmfiSchemeMaster['diagnostics']['rejectedRows']=[];const duplicateSchemeCodes:number[]=[];const seen=new Set<number>();
  for(const record of candidateRows){
    try{
      const values=record.fields;const requiredMax=Math.max(...Object.values(indices),isinGrowthIndex,isinReinvestmentIndex);
      if(values.length<=requiredMax)throw new Error('TOO_FEW_COLUMNS');
      const code=Number(values[indices.schemeCode]?.replace(/,/g,'').trim());if(!Number.isInteger(code)||code<=0)throw new Error('INVALID_SCHEME_CODE');
      if(seen.has(code)){duplicateSchemeCodes.push(code);continue;}seen.add(code);
      let isinGrowth:string|null;let isinReinvestment:string|null;
      if(isinReinvestmentIndex>=0&&isinReinvestmentIndex!==isinGrowthIndex){isinGrowth=cleanIsin(values[isinGrowthIndex]);isinReinvestment=cleanIsin(values[isinReinvestmentIndex]);}
      else [isinGrowth,isinReinvestment]=parseIsinPair(values[isinGrowthIndex]);
      const amount=parseMoney(values[indices.minimumAmount]);if(values[indices.minimumAmount]?.trim()&&amount===null)throw new Error('INVALID_MINIMUM_AMOUNT');
      const parsed=rowSchema.parse({
        amc:values[indices.amc]?.trim(),schemeCode:code,name:values[indices.name]?.trim(),schemeType:values[indices.schemeType]?.trim()??'',
        categoryRaw:values[indices.categoryRaw]?.trim()??'',navName:values[indices.navName]?.trim()??'',minimumAmount:amount,
        launchDate:parseDateCell(values[indices.launchDate],'launch_date'),closureDate:parseDateCell(values[indices.closureDate],'closure_date'),
        isinGrowth,isinReinvestment,lineNumber:record.lineNumber,
      });
      schemes.push(parsed);
    }catch(error){rejectedRows.push({lineNumber:record.lineNumber,reason:error instanceof Error?error.message:'INVALID_ROW',raw:record.raw});}
  }
  const parsedRowCount=schemes.length;const candidateRowCount=candidateRows.length;
  return {schemes,diagnostics:{columnHeader:headerRecord.fields.join(','),headerCount:headers.length,candidateRowCount,parsedRowCount,rejectedRows,duplicateSchemeCodes,shapeValid:parsedRowCount>0&&parsedRowCount/Math.max(candidateRowCount,1)>=0.8}};
}
