import { applyDisclosures, normalizeDisclosureName, parseAmfiAverageAumRows, parseDisclosureCsv, parseDisclosureWorkbook, workbookHasIndustryAumOnly, type DisclosureRecord } from '../adapters/amfi_disclosures';
import type { Fund } from '../domain/types';
import { getFunds, saveFunds } from './persistence';
import { recordSourceSchemeMapping } from './persistence';
import { previousConflictFrom, reconcileClassification } from '../domain/taxonomy/consensus';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const safeFetch=(url:string,init?:RequestInit)=>url.startsWith('/')?fetch(url,init):('__TAURI_INTERNALS__' in window?tauriFetch(url,init):fetch(url,init));

const AMFI_MONTHLY_URL='https://www.amfiindia.com/research-information/amfi-monthly';

/** Fetches an approved AMFI CSV export and persists only rows carrying an AMFI scheme code. */
export async function ingestAmfiDisclosure(url:string):Promise<{updated:Fund[];records:number}>{
  const response=await safeFetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`Disclosure source returned HTTP ${response.status}`);
  const funds=await getFunds();const contentType=response.headers.get('content-type')??'';const records=/excel|spreadsheet|octet-stream/i.test(contentType)||/\.xlsx?(?:\?|$)/i.test(url)?parseDisclosureWorkbook(await response.arrayBuffer(),funds):parseDisclosureCsv(await response.text());if(!records.length)throw new Error('Disclosure payload contained no scheme-code keyed AUM or TER records.');
  const updated=applyDisclosures(funds,records);await saveFunds(updated);return {updated,records:records.length};
}

/** Discovers and ingests the newest Excel report linked by AMFI's official monthly-data page. */
export async function ingestLatestAmfiMonthlyDisclosure(fundsInput?:Fund[]):Promise<{updated:Fund[];records:number;asOfMonth:string|null}>{
  const funds=fundsInput??await getFunds();const page=await safeFetch(AMFI_MONTHLY_URL,{cache:'no-store'});if(!page.ok)throw new Error(`AMFI monthly index returned HTTP ${page.status}`);
  const html=await page.text();const doc=new DOMParser().parseFromString(html,'text/html');
  const link=[...doc.querySelectorAll('a[href]')].find(anchor=>/excel/i.test(anchor.textContent??'')&&/\.(xlsx?|xls)(?:\?|$)/i.test(anchor.getAttribute('href')??''));
  if(!link)throw new Error('AMFI monthly index did not expose an Excel download link.');
  const url=new URL(link.getAttribute('href')!,AMFI_MONTHLY_URL).href;
  if(localStorage.getItem('fundscope-amfi-monthly-url')===url)return {updated:funds,records:0,asOfMonth:null};
  const file=await safeFetch(url,{cache:'no-store'});if(!file.ok)throw new Error(`AMFI spreadsheet returned HTTP ${file.status}`);const data=await file.arrayBuffer();
  const records=parseDisclosureWorkbook(data,funds);if(!records.length){if(workbookHasIndustryAumOnly(data)){const reportName=new URL(url).pathname.split('/').at(-1)??'';const match=/^am([a-z]{3})(20\d{2})repo/i.exec(reportName);const monthMap:Record<string,string>={jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December'};const period=match?`${monthMap[match[1]!.toLowerCase()]??match[1]} ${match[2]}`:'Latest report';const message=`${period} · industry category totals only; no scheme-level AUM/TER`;localStorage.setItem('fundscope-amfi-monthly-url',url);localStorage.setItem('fundscope-amfi-monthly-status',message);return {updated:funds,records:0,asOfMonth:period};}throw new Error('AMFI monthly workbook had no supported scheme-level AUM/TER columns or unambiguous scheme joins.');}
  const reportName=new URL(url).pathname.split('/').at(-1)??'';const monthMatch=/^am([a-z]{3})(20\d{2})repo/i.exec(reportName);const monthMap:Record<string,string>={jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December'};const asOfMonth=monthMatch?`${monthMap[monthMatch[1]!.toLowerCase()]??monthMatch[1]} ${monthMatch[2]}`:null;
  const updated=applyDisclosures(funds,records);await saveFunds(updated);localStorage.setItem('fundscope-amfi-monthly-url',url);localStorage.setItem('fundscope-amfi-monthly-status',`${asOfMonth??'Latest report'} · ${records.length} scheme rows`);return {updated,records:records.length,asOfMonth};
}

/** Development and self-hosted override path. Blank or absent files are a valid no-op. */
export async function loadLocalDisclosureOverrides():Promise<DisclosureRecord[]>{
  try{const response=await safeFetch('/config/local_overrides/disclosures.csv',{cache:'no-store'});return response.ok?parseDisclosureCsv(await response.text(),'LOCAL_OVERRIDE'):[];}catch{return [];}
}

export async function applyLocalDisclosureOverrides(funds:Fund[]):Promise<Fund[]>{
  const overrides=await loadLocalDisclosureOverrides();return overrides.length?applyDisclosures(funds,overrides):funds;
}

const reportJson=async(url:string)=>{const response=await safeFetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`AMFI disclosure returned HTTP ${response.status}`);const payload=parseObject(await response.json());if(!payload)throw new Error('AMFI returned an invalid disclosure response.');return payload;};
function quarterEndEpoch(period:string):number|null{const months:Record<string,number>={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};const match=/([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})/.exec(period);if(!match)return null;const month=months[match[2]!.toLowerCase()];return month===undefined?null:Math.floor(Date.UTC(Number(match[3]),month+1,0)/86_400_000);}

/** Pulls the latest official scheme-wise AMFI AAUM report. AMFI scheme codes are the join key. */
export async function ingestLatestAmfiAverageAum(fundsInput?:Fund[]):Promise<{updated:Fund[];records:number;period:string}>{
  const funds=fundsInput??await getFunds();const root='https://www.amfiindia.com/api/average-aum-schemewise';const base=`${root}?strType=Typewise&MF_ID=0`;
  const years=await reportJson(base);if(!Array.isArray(years.data)||!years.data.length)throw new Error('AMFI Average AUM did not publish a financial-year list.');
  const year=parseObject(years.data[0]);if(year?.id===undefined)throw new Error('AMFI Average AUM financial-year metadata is invalid.');
  const periodPayload=await reportJson(`${root}?fyId=${encodeURIComponent(String(year.id))}&strType=Typewise&MF_ID=0`);const periodData=parseObject(periodPayload.data);const periods=periodData?.periods;
  if(!Array.isArray(periods)||!periods.length)throw new Error('AMFI Average AUM did not publish a reporting period.');
  const periodRow=parseObject(periods[0]);if(periodRow?.id===undefined||typeof periodRow.period!=='string')throw new Error('AMFI Average AUM reporting period is invalid.');
  const period=periodRow.period;const cacheKey=`${year.id}:${periodRow.id}`;if(localStorage.getItem('fundscope-amfi-aum-period')===cacheKey)return {updated:funds,records:0,period};
  const report=await reportJson(`${root}?fyId=${encodeURIComponent(String(year.id))}&periodId=${encodeURIComponent(String(periodRow.id))}&strType=Typewise&MF_ID=0`);
  if(!Array.isArray(report.data))throw new Error('AMFI Average AUM scheme rows are missing.');const asOf=quarterEndEpoch(period);if(asOf===null)throw new Error(`AMFI reporting period could not be dated: ${period}`);
  const records=parseAmfiAverageAumRows(report,asOf);
  if(!records.length)throw new Error('AMFI Average AUM report contained no scheme-code keyed values.');const updated=applyDisclosures(await getFunds(),records);await saveFunds(updated);localStorage.setItem('fundscope-amfi-aum-period',cacheKey);localStorage.setItem('fundscope-amfi-aum-status',`${period} · ${records.length.toLocaleString('en-IN')} scheme AAUM values`);return {updated,records:records.length,period};
}

type AmfiHouse={mfId:string;mfName:string};
type AmfiTerRow={Scheme_Name:string;TER_Date:string;R_TER:string;D_TER:string;SchemeCat_Desc?:string;NSDLSchemeCode?:string};
const parseObject=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

const terBaseName=(value:string)=>normalizeDisclosureName(value).replace(/\b(?:direct|regular) plan\b.*$/,'').replace(/\b(?:growth|idcw|dividend payout|dividend reinvestment|bonus)\b(?: option)?$/,'').trim();

/** Fetches all AMFI TER pages; S3 is attached only for a unique AMC + normalized-name match. */
export async function ingestCurrentMonthAmfiTer(fundsInput?:Fund[],onProgress?:(done:number,total:number)=>void):Promise<{updated:Fund[];records:number;failed:number;month:string}>{
  const funds=fundsInput??await getFunds();const now=new Date();const month=`${String(now.getUTCMonth()+1).padStart(2,'0')}-${now.getUTCFullYear()}`;
  if(localStorage.getItem('fundscope-amfi-ter-month')===month)return {updated:funds,records:0,failed:0,month};
  const housesResponse=await safeFetch('https://www.amfiindia.com/api/populate-mf',{cache:'no-store'});if(!housesResponse.ok)throw new Error(`AMFI AMC list returned HTTP ${housesResponse.status}`);
  const housePayload:unknown=await housesResponse.json();if(!Array.isArray(housePayload))throw new Error('AMFI returned an invalid AMC list.');
  const relevantNames=new Set(funds.map(fund=>normalizeDisclosureName(fund.amc)));const houses=(housePayload as unknown[]).flatMap(item=>{const record=parseObject(item);return typeof record?.mfId==='string'&&typeof record.mfName==='string'&&relevantNames.has(normalizeDisclosureName(record.mfName))?[{mfId:record.mfId,mfName:record.mfName}]:[];});
  if(!houses.length)throw new Error('AMFI AMC names did not match the local scheme catalogue.');
  const recordsByCode=new Map<number,DisclosureRecord>();const s3ByCode=new Map<number,{row:AmfiTerRow;amc:string;matchedAt:number;observedAt:number}>();let failed=0;
  for(let index=0;index<houses.length;index++){
    const house=houses[index]!;const rows:AmfiTerRow[]=[];let pageCount=1;let page=1;let requestFailed=false;
    while(page<=pageCount&&page<=100){let pageRows:AmfiTerRow[]|null=null;for(let attempt=0;attempt<3&&!pageRows;attempt++){try{const url=`https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID=${encodeURIComponent(house.mfId)}&Month=${encodeURIComponent(month)}&strCat=-1&strType=1&page=${page}&pageSize=100`;const response=await safeFetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const payload=parseObject(await response.json());if(!Array.isArray(payload?.data))throw new Error('Malformed AMFI TER response.');pageRows=payload.data as AmfiTerRow[];const meta=parseObject(payload.meta);const pages=Number(meta?.pageCount);if(Number.isInteger(pages)&&pages>0)pageCount=pages;}catch{if(attempt<2)await wait(1000*(attempt+1));}}
      if(!pageRows){requestFailed=true;break;}rows.push(...pageRows);page++;if(page<=pageCount)await wait(150);
    }
    if(requestFailed||page<=pageCount){failed++;onProgress?.(index+1,houses.length);if(index+1<houses.length)await wait(1000);continue;}
    const schemeRows=new Map<string,AmfiTerRow>();for(const row of rows){if(typeof row.Scheme_Name!=='string'||typeof row.TER_Date!=='string')continue;const key=terBaseName(row.Scheme_Name);const prior=schemeRows.get(key);if(!prior||row.TER_Date>prior.TER_Date)schemeRows.set(key,row);}
    const byName=new Map<string,Fund[]>();for(const fund of funds){if(normalizeDisclosureName(fund.amc)!==normalizeDisclosureName(house.mfName))continue;const key=terBaseName(fund.name);const matches=byName.get(key)??[];matches.push(fund);byName.set(key,matches);}
    for(const [name,row] of schemeRows){const matched=byName.get(name);if(!matched?.length)continue;const distinctCategories=new Set(matched.map(fund=>fund.subCategory));if(distinctCategories.size>1)continue;const terDate=Date.parse(row.TER_Date);if(!Number.isFinite(terDate))continue;const asOf=Math.floor(terDate/86_400_000);const matchedAt=Date.now();for(const fund of matched){const raw=fund.plan==='Direct'?row.D_TER:fund.plan==='Regular'?row.R_TER:undefined;if(raw!=null&&String(raw).trim()!==''){const terPct=Number(raw);if(Number.isFinite(terPct)&&terPct>=0&&terPct<=20)recordsByCode.set(fund.code,{schemeCode:fund.code,terPct,source:'AMFI_DISCLOSURE',asOf});}if(typeof row.SchemeCat_Desc==='string'&&row.SchemeCat_Desc.trim())s3ByCode.set(fund.code,{row,amc:house.mfName,matchedAt,observedAt:asOf*86_400_000});}}
    onProgress?.(index+1,houses.length);if(index+1<houses.length)await wait(1000);
  }
  const records=[...recordsByCode.values()];const latestFunds=await getFunds();const updated=applyDisclosures(latestFunds,records).map(fund=>{const signal=s3ByCode.get(fund.code);if(!signal)return fund;const consensus=reconcileClassification({s1:{categoryRaw:fund.category,headerRaw:fund.headerRaw,observedAt:fund.classDetail?.s1.observedAt??fund.navDate*86_400_000},s2:fund.classDetail?.s2?{categoryRaw:fund.classDetail.s2.categoryRaw,observedAt:fund.classDetail.s2.observedAt}:undefined,s3:{categoryRaw:signal.row.SchemeCat_Desc!,observedAt:signal.observedAt},schemeName:fund.name,previousConflict:previousConflictFrom(fund.classDetail,fund.classStatus),previousReview:fund.classDetail?.review});return {...fund,classStatus:consensus.status,classDetail:consensus.detail};});await saveFunds(updated);
  for(const [code,signal] of s3ByCode)await recordSourceSchemeMapping({schemeCode:code,sourceId:'s3_amfi_ter',sourceSchemeCode:signal.row.NSDLSchemeCode??signal.row.Scheme_Name,sourceName:signal.row.Scheme_Name,joinMethod:'AMC + exact normalized scheme family name',confidence:'high · unique name/category match',matchedAt:signal.matchedAt});
  if(failed===0){localStorage.setItem('fundscope-amfi-ter-month',month);localStorage.setItem('fundscope-amfi-ter-status',`${month} · ${records.length.toLocaleString('en-IN')} scheme-plan TER values`);}
  return {updated,records:records.length,failed,month};
}
