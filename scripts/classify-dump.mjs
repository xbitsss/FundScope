import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseAmfiNavAllFile } from '../src/domain/taxonomy/navFileParser.ts';
import { parseAmfiSchemeMasterCsv } from '../src/domain/parse/amfiSchemeMaster.ts';
import { parseAmfiAverageAumRows } from '../src/adapters/amfi_disclosures.ts';
import { classifyFromCategory } from '../src/domain/taxonomy/classify.ts';
import { classifyAmfiScheme } from '../src/domain/taxonomy/classifyV3.ts';
import { joinAmfiSchemeMaster } from '../src/domain/taxonomy/schemeMasterJoin.ts';

const now=new Date();
const timeoutMs=45_000;
const wait=(ms)=>new Promise((resolveWait)=>setTimeout(resolveWait,ms));
async function request(url,label){
  let error;
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const response=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'FundScope-category-inventory/1.0','Accept':'application/json,text/plain,text/csv,*/*'}});if(response.ok)return response;if(response.status<500&&response.status!==429)throw new Error(`${label} returned HTTP ${response.status}.`);error=new Error(`${label} returned HTTP ${response.status}.`);}
    catch(cause){error=cause instanceof Error?cause:new Error(`${label} failed.`);}
    finally{clearTimeout(timer);}
    if(attempt<3)await wait(500*2**attempt);
  }
  throw error??new Error(`${label} failed.`);
}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
const clean=(value)=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const month=String(now.getUTCMonth()+1).padStart(2,'0');const year=now.getUTCFullYear();
function periodEnd(period){const match=/([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})/.exec(period??'');if(!match)return null;const months={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};const index=months[match[2].toLowerCase()];return index===undefined?null:Math.floor(Date.UTC(Number(match[3]),index+1,0)/86_400_000);}
function collectCategoryFields(value,output=new Set(),seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return output;seen.add(value);
  if(Array.isArray(value)){for(const item of value)collectCategoryFields(item,output,seen);return output;}
  for(const [key,item] of Object.entries(value)){
    if(/(?:scheme)?category/i.test(key)&&typeof item==='string'&&item.trim())output.add(clean(item));
    else if(item&&typeof item==='object')collectCategoryFields(item,output,seen);
  }
  return output;
}
function aggregate(rows,newestNavDate){
  const groups=new Map();
  for(const row of rows){const key=JSON.stringify([row.headerRaw,row.categoryRaw,row.structure]);const item=groups.get(key)??{headerRaw:row.headerRaw,categoryRaw:row.categoryRaw,structure:row.structure,schemeCount:0,activeCount:0,sampleSchemeNames:[]};item.schemeCount++;if(row.navDate!==null&&newestNavDate-row.navDate<=10)item.activeCount++;if(item.sampleSchemeNames.length<3&&!item.sampleSchemeNames.includes(row.name))item.sampleSchemeNames.push(row.name);groups.set(key,item);}
  return [...groups.values()].sort((a,b)=>a.categoryRaw.localeCompare(b.categoryRaw)||a.headerRaw.localeCompare(b.headerRaw));
}
async function dumpTerCategories(amcs){
  const houses=await (await request('https://www.amfiindia.com/api/populate-mf','AMFI AMC list')).json();if(!Array.isArray(houses))throw new Error('AMFI AMC list is malformed.');
  const wanted=new Set(amcs.map(value=>value.normalize('NFKD').replace(/[^a-z0-9]+/gi,' ').trim().toLowerCase()));
  const matched=houses.flatMap((value)=>{const row=object(value);if(typeof row?.mfId!=='string'||typeof row?.mfName!=='string')return[];const key=row.mfName.normalize('NFKD').replace(/[^a-z0-9]+/gi,' ').trim().toLowerCase();return wanted.has(key)?[{id:row.mfId,name:row.mfName}]:[];});
  const categories=new Set();let pagesRead=0;
  for(const house of matched){let page=1;let pageCount=1;while(page<=pageCount&&page<=100){const url=`https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID=${encodeURIComponent(house.id)}&Month=${month}-${year}&strCat=-1&strType=1&page=${page}&pageSize=100`;const payload=object(await (await request(url,`AMFI TER ${house.name}`)).json());if(!Array.isArray(payload?.data))throw new Error(`AMFI TER data is malformed for ${house.name}.`);for(const row of payload.data)if(typeof row?.SchemeCat_Desc==='string'&&row.SchemeCat_Desc.trim())categories.add(clean(row.SchemeCat_Desc));const count=Number(object(payload.meta)?.pageCount);if(Number.isInteger(count)&&count>0)pageCount=count;page++;pagesRead++;if(page<=pageCount)await wait(120);}}
  return {period:`${month}-${year}`,amcCount:matched.length,pagesRead,categories:[...categories].sort((a,b)=>a.localeCompare(b))};
}
async function dumpAumCategories(){
  const root='https://www.amfiindia.com/api/average-aum-schemewise';const yearsPayload=object(await (await request(`${root}?strType=Typewise&MF_ID=0`,'AMFI AAUM year list')).json());const firstYear=object(yearsPayload?.data?.[0]);if(firstYear?.id===undefined)throw new Error('AMFI AAUM year list is malformed.');
  const periodPayload=object(await (await request(`${root}?fyId=${encodeURIComponent(firstYear.id)}&strType=Typewise&MF_ID=0`,'AMFI AAUM period list')).json());const period=object(object(periodPayload?.data)?.periods?.[0]);if(period?.id===undefined||typeof period.period!=='string')throw new Error('AMFI AAUM period list is malformed.');
  const report=await (await request(`${root}?fyId=${encodeURIComponent(firstYear.id)}&periodId=${encodeURIComponent(period.id)}&strType=Typewise&MF_ID=0`,'AMFI AAUM report')).json();const records=parseAmfiAverageAumRows(report,periodEnd(period.period)??0);const categories=[...collectCategoryFields(report)].sort((a,b)=>a.localeCompare(b));
  return {period:period.period,schemeRows:records.length,categories,categoryFieldPresent:categories.length>0};
}

const navResponse=await request('https://portal.amfiindia.com/spages/NAVAll.txt','AMFI NAVAll');const navParsed=parseAmfiNavAllFile(await navResponse.text());if(!navParsed.diagnostics.shapeValid)throw new Error(`AMFI NAVAll shape invalid (${navParsed.diagnostics.parsedRowCount}/${navParsed.diagnostics.candidateRowCount}).`);
const masterResponse=await request('https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0','AMFI Scheme Master');const masterParsed=parseAmfiSchemeMasterCsv(await masterResponse.text());if(!masterParsed.diagnostics.shapeValid)throw new Error(`AMFI Scheme Master shape invalid (${masterParsed.diagnostics.parsedRowCount}/${masterParsed.diagnostics.candidateRowCount}).`);
const newestNavDate=Math.max(...navParsed.schemes.flatMap(row=>row.navDate===null?[]:[row.navDate]));
const inventory=aggregate(navParsed.schemes,newestNavDate);
const join=joinAmfiSchemeMaster(navParsed.schemes,masterParsed.schemes);
const classified=navParsed.schemes.map(row=>{
  const master=join.rows.get(row.schemeCode)?.master;
  const v2=classifyFromCategory({categoryRaw:row.categoryRaw,schemeName:row.name});
  const v3=classifyAmfiScheme({categoryRaw:row.categoryRaw,name:row.name,structure:row.structure,navDate:row.navDate??newestNavDate,newestNavDate,schemeMaster:master??null});
  const active=row.navDate!==null&&newestNavDate-row.navDate<=10;
  return {row,master,v2,v3,active};
});
const held=classified.flatMap(({row,master,v3,active})=>v3.assetClass!=='other'?[]:[{schemeCode:row.schemeCode,schemeName:row.name,amc:row.amc,structure:row.structure,headerRaw:row.headerRaw,categoryRaw:row.categoryRaw,schemeMasterCategoryRaw:master?.categoryRaw??null,navDate:row.navDate,active, lifecycle:v3.lifecycle,lifecycleReason:v3.lifecycleReason??null,ruleId:v3.ruleId,reasonCode:v3.reason??v3.ruleId}]);
const previousHeld=classified.filter(({v2})=>v2.assetClass==='other');
const resolvedPreviousHeld=previousHeld.filter(({v3})=>v3.assetClass!=='other');
const ruleCounts=new Map();for(const item of classified){const key=JSON.stringify([item.v3.assetClass,item.v3.ruleId,item.v3.reason]);const current=ruleCounts.get(key)??{assetClass:item.v3.assetClass,ruleId:item.v3.ruleId,reasonCode:item.v3.reason,schemeCount:0,activeCount:0};current.schemeCount++;if(item.active)current.activeCount++;ruleCounts.set(key,current);}
const sourceCategoryCounts=new Map();for(const {row,master,active} of classified)for(const [source,raw] of [['S0',master?.categoryRaw??''],['S1',row.categoryRaw]]){const key=JSON.stringify([source,raw]);const current=sourceCategoryCounts.get(key)??{source,categoryRaw:raw,schemeCount:0,activeCount:0};current.schemeCount++;if(active)current.activeCount++;sourceCategoryCounts.set(key,current);}
const categoryRuleCoverage=[...sourceCategoryCounts.values()].map(item=>{const matching=classified.filter(({row,master})=>(item.source==='S0'?master?.categoryRaw:row.categoryRaw)===item.categoryRaw);return {...item,ruleOutcomes:[...new Set(matching.map(({v3})=>`${v3.assetClass}:${v3.ruleId}${v3.reason?`(${v3.reason})`:''}`))]};}).sort((a,b)=>a.source.localeCompare(b.source)||a.categoryRaw.localeCompare(b.categoryRaw));
const [ter,aum]=await Promise.all([dumpTerCategories([...new Set(navParsed.schemes.map(row=>row.amc))]),dumpAumCategories()]);
const priorHeldCount=previousHeld.length;const lifecycleCounts={active:classified.filter(item=>item.v3.lifecycle==='active').length,dormant:classified.filter(item=>item.v3.lifecycle==='dormant').length,unknown:classified.filter(item=>!item.v3.lifecycle).length};
const report={inventoryMode:'live-amfi',source:`Live AMFI NAVAll, Scheme Master, TER and AAUM observations fetched ${now.toISOString()}.`,activeCountsAvailable:true,sampleNamesAvailable:true,generatedAt:now.toISOString(),newestNavDate,schemeRowCount:navParsed.schemes.length,distinctCategoryCount:new Set(navParsed.schemes.map(row=>row.categoryRaw)).size,reportedPriorHeldOtherCount:priorHeldCount,reportedPriorHeldOtherSource:'Count from the current legacy classifier over this same live NAVAll file.',navAll:{rowCount:navParsed.schemes.length,physicalLineCount:navParsed.diagnostics.candidateRowCount,distinctCategoryHeaderCount:inventory.length,distinctCategoryStrings:[...new Set(navParsed.schemes.map(row=>row.categoryRaw))].sort((a,b)=>a.localeCompare(b)),joinDiagnostics:join.diagnostics},schemeMaster:{rowCount:masterParsed.schemes.length,headerCount:masterParsed.diagnostics.headerCount,rejectedRows:masterParsed.diagnostics.rejectedRows.length,distinctCategoryStrings:[...new Set(masterParsed.schemes.map(row=>row.categoryRaw).filter(Boolean))].sort((a,b)=>a.localeCompare(b))},amfiTer:ter,amfiAaum:aum,categories:inventory,classificationV3:{schemeCount:classified.length,activeCount:classified.filter(item=>item.active).length,dormantCount:lifecycleCounts.dormant,unknownLifecycleCount:lifecycleCounts.unknown,lifecycleCounts,staleNav11To90DaysCount:classified.filter(item=>item.v3.lifecycle==='active'&&!item.active).length,assetClassCounts:Object.fromEntries([...new Set(classified.map(item=>item.v3.assetClass))].map(asset=>[asset,classified.filter(item=>item.v3.assetClass===asset).length])),ruleCounts:[...ruleCounts.values()].sort((a,b)=>b.activeCount-a.activeCount||a.ruleId.localeCompare(b.ruleId)),sourceCategoryCounts:categoryRuleCoverage,previousTaxonomyHeld:{count:previousHeld.length,activeCount:previousHeld.filter(item=>item.active).length,resolvedByV3:resolvedPreviousHeld.length,stillUnclassified:previousHeld.length-resolvedPreviousHeld.length}},heldSchemes:{count:held.length,activeCount:held.filter(row=>row.active).length,dormantCount:held.filter(row=>row.lifecycle==='dormant').length,unknownLifecycleCount:held.filter(row=>!row.lifecycle).length,schemes:held}};
for(const target of ['docs/category-inventory.json','tests/fixtures/category-inventory.json']){const output=resolve(target);await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(report,null,2)}\n`,'utf8');}
console.log(JSON.stringify({navRows:navParsed.schemes.length,masterRows:masterParsed.schemes.length,join:join.diagnostics,distinctCategories:inventory.length,previousHeld:report.classificationV3.previousTaxonomyHeld,held:report.heldSchemes.count,activeHeld:report.heldSchemes.activeCount,terCategories:ter.categories.length,aumCategories:aum.categories.length,files:['docs/category-inventory.json','tests/fixtures/category-inventory.json']},null,2));
