import type { Fund, NavPoint } from '../domain/types';
import Database from '@tauri-apps/plugin-sql';
import { computeMetricBundle } from '../domain/metrics/compute';
import { classifyAssetClass, isAssetClass, TAXONOMY_VERSION } from '../domain/taxonomy/assetClass';

let dbPromise: Promise<Database> | null = null;
const isTauri = () => {
  const result='__TAURI_INTERNALS__' in window;
  console.log(`Environment detection: Tauri=${result}`);
  return result;
};
const openDb = () => {
  if(dbPromise)return dbPromise;
  console.log('Opening SQLite database: fundscope.db');
  dbPromise=Database.load('sqlite:fundscope.db');
  dbPromise.then(()=>console.log('SQLite database opened successfully')).catch(e=>{
    console.error('Failed to open SQLite database:',e);
  });
  return dbPromise;
};
const SQLITE_WRITE_BATCH_SIZE = 200;
const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
async function browserDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    console.log('Opening IndexedDB: fundscope-local');
    const req=indexedDB.open('fundscope-local',3);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('funds'))req.result.createObjectStore('funds',{keyPath:'code'});if(!req.result.objectStoreNames.contains('state'))req.result.createObjectStore('state',{keyPath:'key'});if(!req.result.objectStoreNames.contains('benchmark_series'))req.result.createObjectStore('benchmark_series',{keyPath:'schemeCode'});if(!req.result.objectStoreNames.contains('taxonomy'))req.result.createObjectStore('taxonomy',{keyPath:'schemeCode'});if(!req.result.objectStoreNames.contains('taxonomy_conflicts'))req.result.createObjectStore('taxonomy_conflicts',{keyPath:'id',autoIncrement:true});};
    req.onsuccess=()=>{console.log('IndexedDB opened successfully');resolve(req.result);};
    req.onerror=()=>{console.error('Failed to open IndexedDB:',req.error);reject(req.error);};
  });
}
export async function initializeRepository():Promise<void>{
  try{
    if(isTauri()){
      const db=await openDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS schemes (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS nav (scheme_code INTEGER NOT NULL, date INTEGER NOT NULL, nav REAL NOT NULL, PRIMARY KEY(scheme_code,date))`);
      await db.execute(`CREATE TABLE IF NOT EXISTS benchmark_series (scheme_code INTEGER PRIMARY KEY, scheme_name TEXT NOT NULL, fetched_at INTEGER NOT NULL, history TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS source_state (source_id TEXT PRIMARY KEY, fetched_at INTEGER, data_as_of INTEGER, status TEXT NOT NULL, detail TEXT)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS scheme_taxonomy (scheme_code INTEGER PRIMARY KEY, category_raw TEXT NOT NULL, sub_category TEXT NOT NULL, asset_class TEXT NOT NULL, rule_id TEXT NOT NULL, taxonomy_version INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS taxonomy_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme_code INTEGER NOT NULL, stored_category TEXT NOT NULL, incoming_category TEXT NOT NULL, stored_class TEXT NOT NULL, incoming_class TEXT NOT NULL, stored_rule TEXT NOT NULL, incoming_rule TEXT NOT NULL, stored_version INTEGER NOT NULL, incoming_version INTEGER NOT NULL, observed_at INTEGER NOT NULL, UNIQUE(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version))`);
      await backfillTaxonomy();
    }else{await browserDb();await backfillTaxonomy();}
  }catch(e){
    console.error('Database initialization failed:',e);
    throw new Error(`Database initialization failed: ${e instanceof Error?e.message:String(e)}`);
  }
}
export async function getLocalState<T>(key:string,fallback:T):Promise<T>{
  if(isTauri()){
    const db=await openDb();const rows=await db.select<{payload:string}[]>('SELECT payload FROM app_state WHERE state_key=$1',[key]);
    if(!rows[0])return fallback;
    try{return JSON.parse(rows[0].payload) as T;}catch{return fallback;}
  }
  const db=await browserDb();const row=await requestResult(db.transaction('state','readonly').objectStore('state').get(key)) as {key:string,value:T}|undefined;
  return row?.value??fallback;
}
export async function setLocalState<T>(key:string,value:T):Promise<void>{
  if(isTauri()){const db=await openDb();await db.execute('INSERT INTO app_state(state_key,payload) VALUES($1,$2) ON CONFLICT(state_key) DO UPDATE SET payload=excluded.payload',[key,JSON.stringify(value)]);return;}
  const db=await browserDb();const tx=db.transaction('state','readwrite');tx.objectStore('state').put({key,value});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export interface StoredBenchmarkSeries {schemeCode:number;schemeName:string;fetchedAt:number;history:NavPoint[]}
export async function getBenchmarkSeries(code:number):Promise<StoredBenchmarkSeries|null>{
  if(isTauri()){const db=await openDb();const rows=await db.select<{scheme_name:string;fetched_at:number;history:string}[]>('SELECT scheme_name,fetched_at,history FROM benchmark_series WHERE scheme_code=$1',[code]);const row=rows[0];return row?{schemeCode:code,schemeName:row.scheme_name,fetchedAt:row.fetched_at,history:JSON.parse(row.history) as NavPoint[]}:null;}
  const db=await browserDb();const row=await requestResult(db.transaction('benchmark_series','readonly').objectStore('benchmark_series').get(code)) as StoredBenchmarkSeries|undefined;return row??null;
}
export async function saveBenchmarkSeries(series:StoredBenchmarkSeries):Promise<void>{
  if(isTauri()){const db=await openDb();await db.execute('INSERT INTO benchmark_series(scheme_code,scheme_name,fetched_at,history) VALUES($1,$2,$3,$4) ON CONFLICT(scheme_code) DO UPDATE SET scheme_name=excluded.scheme_name,fetched_at=excluded.fetched_at,history=excluded.history',[series.schemeCode,series.schemeName,series.fetchedAt,JSON.stringify(series.history)]);return;}
  const db=await browserDb();const tx=db.transaction('benchmark_series','readwrite');tx.objectStore('benchmark_series').put(series);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export async function getFunds():Promise<Fund[]>{
  try{
    if(isTauri()){
      const db=await openDb();const rows=await db.select<{payload:string}[]>('SELECT payload FROM schemes');
      console.log(`Loaded ${rows.length} funds from SQLite`);
      return rows.map((row:{payload:string})=>normalizeFund(JSON.parse(row.payload) as Fund));
    }
    const db=await browserDb();const tx=db.transaction('funds','readonly');
    const funds=(await requestResult(tx.objectStore('funds').getAll()) as Fund[]).map(normalizeFund);
    console.log(`Loaded ${funds.length} funds from IndexedDB`);
    return funds;
  }catch(e){
    console.error('Failed to load funds:',e);
    throw new Error(`Failed to load funds: ${e instanceof Error?e.message:String(e)}`);
  }
}

function normalizeFund(fund:Fund):Fund{
  if(fund.classRuleId&&fund.taxonomyVersion)return fund;
  const classification=classifyAssetClass({categoryRaw:fund.category??'',name:fund.name??''});
  return {...fund,assetClass:classification.assetClass,classRuleId:classification.ruleId,taxonomyVersion:TAXONOMY_VERSION,subCategory:classification.subCategory||fund.subCategory};
}
async function backfillTaxonomy():Promise<void>{
  await recordTaxonomyObservations(await getFunds());
}
export async function reconcileFundTaxonomy(funds:Fund[]):Promise<Fund[]>{
  const normalized=funds.map(normalizeFund);await recordTaxonomyObservations(normalized);
  const rows=isTauri()?await (async()=>{const db=await openDb();return db.select<{scheme_code:number;sub_category:string;asset_class:string;rule_id:string;taxonomy_version:number}[]>('SELECT scheme_code,sub_category,asset_class,rule_id,taxonomy_version FROM scheme_taxonomy');})():await (async()=>{const db=await browserDb();return requestResult(db.transaction('taxonomy','readonly').objectStore('taxonomy').getAll()) as Promise<Array<{schemeCode:number;subCategory:string;assetClass:string;ruleId:string;taxonomyVersion:number}>>;})();
  const byCode=new Map(rows.map(row=>[isTauri()?Number((row as {scheme_code:number}).scheme_code):(row as {schemeCode:number}).schemeCode,row]));
  return normalized.map(fund=>{const row=byCode.get(fund.code);if(!row)return fund;const stored=row as {sub_category?:string;asset_class?:string;rule_id?:string;taxonomy_version?:number;subCategory?:string;assetClass?:string;ruleId?:string;taxonomyVersion?:number};const assetClass=stored.asset_class??stored.assetClass;const classRuleId=stored.rule_id??stored.ruleId;const taxonomyVersion=stored.taxonomy_version??stored.taxonomyVersion;const subCategory=stored.sub_category??stored.subCategory;if(!isAssetClass(assetClass)||!classRuleId||!taxonomyVersion)return fund;return {...fund,assetClass,classRuleId,taxonomyVersion,subCategory:subCategory??fund.subCategory};});
}
export async function saveFunds(funds:Fund[],onProgress?:(saved:number,total:number)=>void):Promise<void>{
  await recordTaxonomyObservations(funds.map(normalizeFund));
  if(isTauri()){
    const db=await openDb();
    for(let start=0;start<funds.length;start+=SQLITE_WRITE_BATCH_SIZE){
      const batch=funds.slice(start,start+SQLITE_WRITE_BATCH_SIZE);
      const values:string[]=[];const bindings:unknown[]=[];
      for(let index=0;index<batch.length;index++){
        const first=index*2+1;values.push(`($${first},$${first+1})`);
        const fund=batch[index]!;bindings.push(fund.code,JSON.stringify(fund));
      }
      await db.execute(`INSERT INTO schemes(scheme_code,payload) VALUES ${values.join(',')} ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload`,bindings);
      onProgress?.(Math.min(start+batch.length,funds.length),funds.length);
    }
  }else{
    const db=await browserDb();const tx=db.transaction('funds','readwrite');
    for(const fund of funds)tx.objectStore('funds').put(fund);
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
}
async function recordTaxonomyObservations(funds:Fund[]):Promise<void>{
  if(isTauri()){
    const db=await openDb();const now=Date.now();const existing=await db.select<{scheme_code:number;category_raw:string;asset_class:string;rule_id:string;taxonomy_version:number}[]>('SELECT scheme_code,category_raw,asset_class,rule_id,taxonomy_version FROM scheme_taxonomy');const byCode=new Map(existing.map(row=>[row.scheme_code,row]));const inserts:Fund[]=[];const conflicts:Array<{fund:Fund;stored:{category_raw:string;asset_class:string;rule_id:string;taxonomy_version:number}}>=[];
    for(const fund of funds){const stored=byCode.get(fund.code);if(!stored)inserts.push(fund);else if(stored.category_raw!==fund.category||stored.asset_class!==fund.assetClass||stored.rule_id!==fund.classRuleId||stored.taxonomy_version!==fund.taxonomyVersion)conflicts.push({fund,stored});}
    for(let start=0;start<inserts.length;start+=100){const batch=inserts.slice(start,start+100);const values:string[]=[];const bindings:unknown[]=[];for(let index=0;index<batch.length;index++){const position=index*7+1;values.push(`($${position},$${position+1},$${position+2},$${position+3},$${position+4},$${position+5},$${position+6},$${position+6})`);const fund=batch[index]!;bindings.push(fund.code,fund.category,fund.subCategory,fund.assetClass,fund.classRuleId,fund.taxonomyVersion,now);}await db.execute(`INSERT OR IGNORE INTO scheme_taxonomy(scheme_code,category_raw,sub_category,asset_class,rule_id,taxonomy_version,first_seen_at,last_seen_at) VALUES ${values.join(',')}`,bindings);}
    for(let start=0;start<conflicts.length;start+=80){const batch=conflicts.slice(start,start+80);const values:string[]=[];const bindings:unknown[]=[];for(let index=0;index<batch.length;index++){const position=index*10+1;values.push(`($${position},$${position+1},$${position+2},$${position+3},$${position+4},$${position+5},$${position+6},$${position+7},$${position+8},$${position+9})`);const {fund,stored}=batch[index]!;bindings.push(fund.code,stored.category_raw,fund.category,stored.asset_class,fund.assetClass,stored.rule_id,fund.classRuleId,stored.taxonomy_version,fund.taxonomyVersion,now);}await db.execute(`INSERT OR IGNORE INTO taxonomy_conflicts(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version,observed_at) VALUES ${values.join(',')}`,bindings);}
  }else{
    const db=await browserDb();const existing=await requestResult(db.transaction('taxonomy','readonly').objectStore('taxonomy').getAll()) as Array<{schemeCode:number;categoryRaw:string;assetClass:string;ruleId:string;taxonomyVersion:number;firstSeenAt:number;lastSeenAt:number}>;const byCode=new Map(existing.map(row=>[row.schemeCode,row]));const tx=db.transaction(['taxonomy','taxonomy_conflicts'],'readwrite');const taxonomy=tx.objectStore('taxonomy');const conflicts=tx.objectStore('taxonomy_conflicts');
    for(const fund of funds){const stored=byCode.get(fund.code);const now=Date.now();if(!stored)taxonomy.put({schemeCode:fund.code,categoryRaw:fund.category,subCategory:fund.subCategory,assetClass:fund.assetClass,ruleId:fund.classRuleId,taxonomyVersion:fund.taxonomyVersion,firstSeenAt:now,lastSeenAt:now});else{if(stored.categoryRaw!==fund.category||stored.assetClass!==fund.assetClass||stored.ruleId!==fund.classRuleId||stored.taxonomyVersion!==fund.taxonomyVersion)conflicts.add({schemeCode:fund.code,storedCategory:stored.categoryRaw,incomingCategory:fund.category,storedClass:stored.assetClass,incomingClass:fund.assetClass,storedRule:stored.ruleId,incomingRule:fund.classRuleId,storedVersion:stored.taxonomyVersion,incomingVersion:fund.taxonomyVersion,observedAt:now});taxonomy.put({...stored,lastSeenAt:now});}}
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
}
export async function updateHistory(code:number,history:NavPoint[],riskWindow=3,riskFreeRate=6.5):Promise<void>{
  const funds=await getFunds();const fund=funds.find(item=>item.code===code);if(!fund)return;
  fund.history=history;if(/growth/i.test(fund.option)&&!/bonus/i.test(fund.option)){const bundle=computeMetricBundle(fund,riskWindow,riskFreeRate);fund.metrics={...bundle.metrics,...Object.fromEntries(['aum_cr','ter_pct'].flatMap(id=>fund.metrics[id]!=null?[[id,fund.metrics[id]!]]:[]))};fund.metricReasons={...bundle.reasons,...Object.fromEntries(['aum_cr','ter_pct'].flatMap(id=>fund.metricReasons?.[id]?[[id,fund.metricReasons[id]!]]:[]))};}else fund.metrics={...Object.fromEntries(['aum_cr','ter_pct'].flatMap(id=>fund.metrics[id]!=null?[[id,fund.metrics[id]!]]:[]))};await saveFunds([fund]);
}
export async function sourceStatus():Promise<{fetchedAt:number|null,dataAsOf:number|null,status:string,detail:string|null}>{
  if(isTauri()){
    const db=await openDb();const rows=await db.select<{fetched_at:number|null,data_as_of:number|null,status:string,detail:string|null}[]>('SELECT fetched_at,data_as_of,status,detail FROM source_state WHERE source_id=$1',['amfi_nav']);
    const row=rows[0];return row?{fetchedAt:row.fetched_at,dataAsOf:row.data_as_of,status:row.status,detail:row.detail}:{fetchedAt:null,dataAsOf:null,status:'never',detail:null};
  }
  const db=await browserDb();const row=await requestResult(db.transaction('state','readonly').objectStore('state').get('amfi_nav')) as {fetchedAt:number|null,dataAsOf:number|null,status:string,detail:string|null}|undefined;
  return row??{fetchedAt:null,dataAsOf:null,status:'never',detail:null};
}
export async function setSourceStatus(status:{fetchedAt:number|null,dataAsOf:number|null,status:string,detail:string|null}):Promise<void>{
  if(isTauri()){
    const db=await openDb();await db.execute('INSERT INTO source_state(source_id,fetched_at,data_as_of,status,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id) DO UPDATE SET fetched_at=excluded.fetched_at,data_as_of=excluded.data_as_of,status=excluded.status,detail=excluded.detail',['amfi_nav',status.fetchedAt,status.dataAsOf,status.status,status.detail]);
  }else{
    const db=await browserDb();const tx=db.transaction('state','readwrite');tx.objectStore('state').put({...status,key:'amfi_nav'});
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
}
