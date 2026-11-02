import type { Fund, NavPoint } from '../domain/types';
import Database from '@tauri-apps/plugin-sql';
import { computeMetricBundle } from '../domain/metrics/compute';
import { classifyAssetClass, isAssetClass, TAXONOMY_VERSION } from '../domain/taxonomy/assetClass';
import { previousConflictFrom, reconcileClassification } from '../domain/taxonomy/consensus';
import { normalizeCategory } from '../domain/taxonomy/categoryNormalize';
import type { ParsedSchemeRow } from '../domain/taxonomy/navFileParser';
import type { ParsedAmfiSchemeMasterRow } from '../domain/parse/amfiSchemeMaster';

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
    const req=indexedDB.open('fundscope-local',7);
    req.onupgradeneeded=(event)=>{const database=req.result;const transaction=req.transaction;if(event.oldVersion>0&&transaction){for(const name of Array.from(database.objectStoreNames)){const backup=`backup_v7_${name}`;if(database.objectStoreNames.contains(backup))continue;const source=transaction.objectStore(name);const target=database.createObjectStore(backup,{keyPath:source.keyPath as string|string[],autoIncrement:source.autoIncrement});source.openCursor().onsuccess=cursorEvent=>{const cursor=(cursorEvent.target as IDBRequest<IDBCursorWithValue|null>).result;if(cursor){target.put(cursor.value);cursor.continue();}};}}if(!database.objectStoreNames.contains('funds'))database.createObjectStore('funds',{keyPath:'code'});if(!database.objectStoreNames.contains('nav_history'))database.createObjectStore('nav_history',{keyPath:'code'});if(!database.objectStoreNames.contains('state'))database.createObjectStore('state',{keyPath:'key'});if(!database.objectStoreNames.contains('benchmark_series'))database.createObjectStore('benchmark_series',{keyPath:'schemeCode'});if(!database.objectStoreNames.contains('taxonomy'))database.createObjectStore('taxonomy',{keyPath:'schemeCode'});if(!database.objectStoreNames.contains('taxonomy_conflicts'))database.createObjectStore('taxonomy_conflicts',{keyPath:'id',autoIncrement:true});if(!database.objectStoreNames.contains('category_history'))database.createObjectStore('category_history',{keyPath:['schemeCode','sourceId','categoryRaw']});if(!database.objectStoreNames.contains('unmapped_categories'))database.createObjectStore('unmapped_categories',{keyPath:['categoryKey','sourceId']});if(!database.objectStoreNames.contains('unmapped_category_members'))database.createObjectStore('unmapped_category_members',{keyPath:['schemeCode','categoryKey','sourceId']});if(!database.objectStoreNames.contains('classification_audit'))database.createObjectStore('classification_audit',{keyPath:'id',autoIncrement:true});if(!database.objectStoreNames.contains('source_scheme_map'))database.createObjectStore('source_scheme_map',{keyPath:['schemeCode','sourceId','sourceSchemeCode','sourceName']});if(!database.objectStoreNames.contains('scheme_master'))database.createObjectStore('scheme_master',{keyPath:'schemeCode'});};
    req.onsuccess=()=>{console.log('IndexedDB opened successfully');resolve(req.result);};
    req.onerror=()=>{console.error('Failed to open IndexedDB:',req.error);reject(req.error);};
  });
}
export async function initializeRepository():Promise<void>{
  try{
    if(isTauri()){
      const db=await openDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS schemes (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS scheme_master (scheme_code INTEGER PRIMARY KEY,payload TEXT NOT NULL,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS nav (scheme_code INTEGER NOT NULL, date INTEGER NOT NULL, nav REAL NOT NULL, PRIMARY KEY(scheme_code,date))`);
      await db.execute(`CREATE TABLE IF NOT EXISTS benchmark_series (scheme_code INTEGER PRIMARY KEY, scheme_name TEXT NOT NULL, fetched_at INTEGER NOT NULL, history TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS source_state (source_id TEXT PRIMARY KEY, fetched_at INTEGER, data_as_of INTEGER, status TEXT NOT NULL, detail TEXT)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS scheme_taxonomy (scheme_code INTEGER PRIMARY KEY, category_raw TEXT NOT NULL, sub_category TEXT NOT NULL, asset_class TEXT NOT NULL, rule_id TEXT NOT NULL, taxonomy_version INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, class_status TEXT NOT NULL DEFAULT 'UNCONFIRMED', class_detail TEXT, class_checked_at INTEGER)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
      await backupBeforeTaxonomyMigration(db);
      await ensureTaxonomyColumns(db);
      await db.execute(`CREATE TABLE IF NOT EXISTS taxonomy_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme_code INTEGER NOT NULL, stored_category TEXT NOT NULL, incoming_category TEXT NOT NULL, stored_class TEXT NOT NULL, incoming_class TEXT NOT NULL, stored_rule TEXT NOT NULL, incoming_rule TEXT NOT NULL, stored_version INTEGER NOT NULL, incoming_version INTEGER NOT NULL, observed_at INTEGER NOT NULL, UNIQUE(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version))`);
      await db.execute(`CREATE TABLE IF NOT EXISTS scheme_category_history (scheme_code INTEGER NOT NULL,source_id TEXT NOT NULL,category_raw TEXT NOT NULL,structure TEXT,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(scheme_code,source_id,category_raw)) WITHOUT ROWID`);
      await db.execute(`CREATE TABLE IF NOT EXISTS unmapped_categories (category_key TEXT NOT NULL,source_id TEXT NOT NULL,sample_raw TEXT NOT NULL,scheme_count INTEGER NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(category_key,source_id)) WITHOUT ROWID`);
      await db.execute(`CREATE TABLE IF NOT EXISTS unmapped_category_members (scheme_code INTEGER NOT NULL,category_key TEXT NOT NULL,source_id TEXT NOT NULL,sample_raw TEXT NOT NULL,PRIMARY KEY(scheme_code,category_key,source_id)) WITHOUT ROWID`);
      await db.execute(`CREATE TABLE IF NOT EXISTS classification_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,scheme_code INTEGER NOT NULL,audited_at INTEGER NOT NULL,auditor TEXT,sid_category TEXT NOT NULL,sid_url TEXT,expected_class TEXT NOT NULL,agrees INTEGER NOT NULL,notes TEXT)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS source_scheme_map (scheme_code INTEGER NOT NULL,source_id TEXT NOT NULL,source_scheme_code TEXT NOT NULL,source_name TEXT NOT NULL,join_method TEXT NOT NULL,confidence TEXT NOT NULL,matched_at INTEGER NOT NULL,PRIMARY KEY(scheme_code,source_id,source_scheme_code,source_name)) WITHOUT ROWID`);
      await migrateTaxonomyPayloads();
      await backfillTaxonomy();
    }else{await browserDb();await migrateTaxonomyPayloads();await backfillTaxonomy();}
  }catch(e){
    console.error('Database initialization failed:',e);
    throw new Error(`Database initialization failed: ${e instanceof Error?e.message:String(e)}`);
  }
}
async function ensureTaxonomyColumns(db:Database):Promise<void>{
  const columns=await db.select<{name:string}[]>('PRAGMA table_info(scheme_taxonomy)');const names=new Set(columns.map(column=>column.name));
  if(!names.has('class_status'))await db.execute(`ALTER TABLE scheme_taxonomy ADD COLUMN class_status TEXT NOT NULL DEFAULT 'UNCONFIRMED'`);
  if(!names.has('class_detail'))await db.execute(`ALTER TABLE scheme_taxonomy ADD COLUMN class_detail TEXT`);
  if(!names.has('class_checked_at'))await db.execute(`ALTER TABLE scheme_taxonomy ADD COLUMN class_checked_at INTEGER`);
}
async function backupBeforeTaxonomyMigration(db:Database):Promise<void>{
  const applied=await db.select<{value:string}[]>('SELECT value FROM schema_meta WHERE key=$1',['taxonomy_v2_backup']);
  if(applied[0])return;
  await db.execute('CREATE TABLE IF NOT EXISTS schemes_taxonomy_v2_backup AS SELECT * FROM schemes');
  await db.execute('CREATE TABLE IF NOT EXISTS scheme_taxonomy_v2_backup AS SELECT * FROM scheme_taxonomy');
  await db.execute('INSERT INTO schema_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['taxonomy_v2_backup',new Date().toISOString()]);
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
export interface SchemeMasterRecord {schemeCode:number;name:string;amc:string;categoryRaw:string;headerRaw:string;structure:ParsedSchemeRow['structure'];plan:string|null;option:string|null;isinA:string|null;isinB:string|null;nav:number|null;navDate:number|null;amfiSchemeMaster?:ParsedAmfiSchemeMasterRow;assetClass:Fund['assetClass'];classRuleId:string;classStatus:NonNullable<Fund['classStatus']>;classDetail:Fund['classDetail'];taxonomyVersion:number;firstSeenAt:number;lastSeenAt:number}
export async function saveSchemeMasterRows(rows:ParsedSchemeRow[],currentFunds:Fund[],cachedFunds:Fund[]):Promise<void>{
  const now=Date.now();const current=new Map(currentFunds.map(fund=>[fund.code,fund]));const cached=new Map(cachedFunds.map(fund=>[fund.code,fund]));
  const records=rows.map(row=>{const latest=current.get(row.schemeCode);const prior=cached.get(row.schemeCode);const classification=latest??(()=>{const s1ObservedAt=row.navDate===null?now:row.navDate*86_400_000;const consensus=reconcileClassification({s1:{categoryRaw:row.categoryRaw,headerRaw:row.headerRaw,observedAt:s1ObservedAt},s2:prior?.classDetail?.s2?{categoryRaw:prior.classDetail.s2.categoryRaw,observedAt:prior.classDetail.s2.observedAt}:undefined,s3:prior?.classDetail?.s3?{categoryRaw:prior.classDetail.s3.categoryRaw,observedAt:prior.classDetail.s3.observedAt}:undefined,schemeName:row.name,previousConflict:previousConflictFrom(prior?.classDetail,prior?.classStatus),previousReview:prior?.classDetail?.review});return {assetClass:consensus.assetClass,classRuleId:consensus.ruleId,classStatus:consensus.status,classDetail:consensus.detail};})();return {row,classification};});
  if(isTauri()){const db=await openDb();const existing=await db.select<{scheme_code:number;payload:string;first_seen_at:number}[]>('SELECT scheme_code,payload,first_seen_at FROM scheme_master');const firstSeen=new Map(existing.map(item=>[item.scheme_code,item.first_seen_at]));for(let start=0;start<records.length;start+=100){const batch=records.slice(start,start+100);const values:string[]=[];const bindings:unknown[]=[];for(let i=0;i<batch.length;i++){const pos=i*4+1;const {row,classification}=batch[i]!;const payload:SchemeMasterRecord={schemeCode:row.schemeCode,name:row.name,amc:row.amc,categoryRaw:row.categoryRaw,headerRaw:row.headerRaw,structure:row.structure,plan:row.plan,option:row.option,isinA:row.isinA,isinB:row.isinB,nav:row.nav,navDate:row.navDate,assetClass:classification.assetClass,classRuleId:classification.classRuleId,classStatus:classification.classStatus??'UNCONFIRMED',classDetail:classification.classDetail,taxonomyVersion:TAXONOMY_VERSION,firstSeenAt:firstSeen.get(row.schemeCode)??now,lastSeenAt:now};values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3})`);bindings.push(row.schemeCode,JSON.stringify(payload),payload.firstSeenAt,now);}await db.execute(`INSERT INTO scheme_master(scheme_code,payload,first_seen_at,last_seen_at) VALUES ${values.join(',')} ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload,last_seen_at=excluded.last_seen_at`,bindings);}}
  else{const db=await browserDb();const existing=await requestResult(db.transaction('scheme_master','readonly').objectStore('scheme_master').getAll()) as Array<SchemeMasterRecord&{firstSeenAt:number}>;const firstSeen=new Map(existing.map(item=>[item.schemeCode,item.firstSeenAt]));const tx=db.transaction('scheme_master','readwrite');for(const {row,classification} of records){tx.objectStore('scheme_master').put({schemeCode:row.schemeCode,name:row.name,amc:row.amc,categoryRaw:row.categoryRaw,headerRaw:row.headerRaw,structure:row.structure,plan:row.plan,option:row.option,isinA:row.isinA,isinB:row.isinB,nav:row.nav,navDate:row.navDate,assetClass:classification.assetClass,classRuleId:classification.classRuleId,classStatus:classification.classStatus,classDetail:classification.classDetail,taxonomyVersion:TAXONOMY_VERSION,firstSeenAt:firstSeen.get(row.schemeCode)??now,lastSeenAt:now});}await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
}

/** Stores every raw S0 master record, including entries without a current NAVAll quote. */
export async function saveAmfiSchemeMasterRows(rows:ParsedAmfiSchemeMasterRow[]):Promise<void>{
  if(!rows.length)return;const now=Date.now();
  if(isTauri()){
    const db=await openDb();const existing=await db.select<{scheme_code:number;payload:string;first_seen_at:number}[]>('SELECT scheme_code,payload,first_seen_at FROM scheme_master');const byCode=new Map(existing.map(row=>[row.scheme_code,row]));
    for(let start=0;start<rows.length;start+=100){const batch=rows.slice(start,start+100);const values:string[]=[];const bindings:unknown[]=[];for(let index=0;index<batch.length;index++){const row=batch[index]!;const prior=byCode.get(row.schemeCode);let priorPayload:Record<string,unknown>={};try{priorPayload=prior?JSON.parse(prior.payload) as Record<string,unknown>:{ };}catch{}const firstSeenAt=prior?.first_seen_at??now;const payload={...priorPayload,schemeCode:row.schemeCode,amfiSchemeMaster:row,firstSeenAt,lastSeenAt:now};const pos=index*4+1;values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3})`);bindings.push(row.schemeCode,JSON.stringify(payload),firstSeenAt,now);}await db.execute(`INSERT INTO scheme_master(scheme_code,payload,first_seen_at,last_seen_at) VALUES ${values.join(',')} ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload,last_seen_at=excluded.last_seen_at`,bindings);}
    return;
  }
  const db=await browserDb();const existing=await requestResult(db.transaction('scheme_master','readonly').objectStore('scheme_master').getAll()) as Array<Partial<SchemeMasterRecord>&{schemeCode:number;firstSeenAt?:number}>;const byCode=new Map(existing.map(row=>[row.schemeCode,row]));const tx=db.transaction('scheme_master','readwrite');for(const row of rows){const prior=byCode.get(row.schemeCode);tx.objectStore('scheme_master').put({...prior,schemeCode:row.schemeCode,amfiSchemeMaster:row,firstSeenAt:prior?.firstSeenAt??now,lastSeenAt:now});}await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}

function normalizeFund(fund:Fund,newestNavDate=fund.navDate):Fund{
  if(fund.classRuleId&&fund.taxonomyVersion===TAXONOMY_VERSION&&fund.classStatus&&fund.classDetail&&fund.classificationProvenance&&fund.lifecycle)return fund;
  const observedAt=fund.classDetail?.s1.observedAt??fund.navDate*86_400_000;
  const s0=fund.schemeMaster?.categoryRaw?.trim();
  const consensus=reconcileClassification({...(s0?{s0:{categoryRaw:s0,observedAt,schemeMaster:{categoryRaw:s0,closureDate:fund.schemeMaster?.closureDate??null}}}:{}),s1:{categoryRaw:fund.category??'',headerRaw:fund.headerRaw,observedAt,structure:fund.structure,navDate:fund.navDate,newestNavDate},s2:fund.classDetail?.s2?{categoryRaw:fund.classDetail.s2.categoryRaw,observedAt:fund.classDetail.s2.observedAt}:undefined,s3:fund.classDetail?.s3?{categoryRaw:fund.classDetail.s3.categoryRaw,observedAt:fund.classDetail.s3.observedAt}:undefined,s4:fund.classDetail?.s4?{categoryRaw:fund.classDetail.s4.categoryRaw,observedAt:fund.classDetail.s4.observedAt}:undefined,schemeName:fund.name,previousConflict:previousConflictFrom(fund.classDetail,fund.classStatus),previousReview:fund.classDetail?.review});
  return {...fund,assetClass:consensus.assetClass,classRuleId:consensus.ruleId,taxonomyVersion:TAXONOMY_VERSION,classStatus:consensus.status,classDetail:consensus.detail,subCategory:consensus.subCategory,group:consensus.group,management:consensus.management,riskBand:consensus.riskBand,philosophy:consensus.philosophy,speciality:consensus.speciality,lifecycle:consensus.lifecycle,classificationReason:consensus.reason,classificationProvenance:consensus.provenance};
}
async function migrateTaxonomyPayloads():Promise<void>{
  if(isTauri()){
    const db=await openDb();const rows=await db.select<{scheme_code:number;payload:string}[]>('SELECT scheme_code,payload FROM schemes');const funds=rows.flatMap(row=>{try{return [JSON.parse(row.payload) as Fund];}catch{return [];}});const newestNavDate=Math.max(0,...funds.map(fund=>fund.navDate));const changed=funds.flatMap(fund=>fund.taxonomyVersion===TAXONOMY_VERSION&&fund.classStatus&&fund.classDetail&&fund.classificationProvenance&&fund.lifecycle?[]:[normalizeFund(fund,newestNavDate)]);
    for(let start=0;start<changed.length;start+=SQLITE_WRITE_BATCH_SIZE){const batch=changed.slice(start,start+SQLITE_WRITE_BATCH_SIZE);for(const fund of batch)await db.execute('UPDATE schemes SET payload=$1 WHERE scheme_code=$2',[JSON.stringify(fund),fund.code]);}
    await db.execute('INSERT INTO schema_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['taxonomy_version',String(TAXONOMY_VERSION)]);
    await db.execute('INSERT INTO schema_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['migration_0003_classification_v2','applied']);
    return;
  }
  const db=await browserDb();const stored=await requestResult(db.transaction('funds','readonly').objectStore('funds').getAll()) as Fund[];const newestNavDate=Math.max(0,...stored.map(fund=>fund.navDate));const changed=stored.filter(fund=>fund.taxonomyVersion!==TAXONOMY_VERSION||!fund.classStatus||!fund.classDetail||!fund.classificationProvenance||!fund.lifecycle).map(fund=>normalizeFund(fund,newestNavDate));if(!changed.length)return;const tx=db.transaction('funds','readwrite');for(const fund of changed)tx.objectStore('funds').put(fund);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
async function backfillTaxonomy():Promise<void>{
  await recordTaxonomyObservations(await getFunds());
}
export async function reconcileFundTaxonomy(funds:Fund[]):Promise<Fund[]>{
  const normalized=funds.map(normalizeFund);await recordTaxonomyObservations(normalized);
  const rows=isTauri()?await (async()=>{const db=await openDb();return db.select<{scheme_code:number;category_raw:string;sub_category:string;asset_class:string;rule_id:string;taxonomy_version:number;class_status:string;class_detail:string|null}[]>('SELECT scheme_code,category_raw,sub_category,asset_class,rule_id,taxonomy_version,class_status,class_detail FROM scheme_taxonomy');})():await (async()=>{const db=await browserDb();return requestResult(db.transaction('taxonomy','readonly').objectStore('taxonomy').getAll()) as Promise<Array<{schemeCode:number;categoryRaw:string;subCategory:string;assetClass:string;ruleId:string;taxonomyVersion:number;classStatus?:string;classDetail?:Fund['classDetail']}>>;})();
  const byCode=new Map(rows.map(row=>[isTauri()?Number((row as {scheme_code:number}).scheme_code):(row as {schemeCode:number}).schemeCode,row]));
  return normalized.map(fund=>{const row=byCode.get(fund.code);if(!row)return enforceClassificationMetricGate(fund);const stored=row as {category_raw?:string;sub_category?:string;asset_class?:string;rule_id?:string;taxonomy_version?:number;class_status?:string;class_detail?:string|null;categoryRaw?:string;subCategory?:string;assetClass?:string;ruleId?:string;taxonomyVersion?:number;classStatus?:string;classDetail?:Fund['classDetail']};const assetClass=stored.asset_class??stored.assetClass;const classRuleId=stored.rule_id??stored.ruleId;const taxonomyVersion=stored.taxonomy_version??stored.taxonomyVersion;const subCategory=stored.sub_category??stored.subCategory;const boundCategory=stored.category_raw??stored.categoryRaw;const storedStatus=stored.class_status??stored.classStatus;const storedDetail=typeof stored.class_detail==='string'?safeParseClassDetail(stored.class_detail):stored.classDetail;if(!isAssetClass(assetClass)||!classRuleId||!taxonomyVersion)return enforceClassificationMetricGate(fund);const userRebound=classRuleId==='USER_REBIND_OTHER';const drift=taxonomyVersion===TAXONOMY_VERSION&&assetClass!==fund.assetClass&&!userRebound;if(!drift)return enforceClassificationMetricGate({...fund,assetClass,classRuleId,taxonomyVersion,subCategory:subCategory??fund.subCategory,classStatus:(storedStatus as Fund['classStatus'])??fund.classStatus,classDetail:storedDetail??fund.classDetail});const detail=fund.classDetail?{...fund.classDetail,flags:[...new Set([...fund.classDetail.flags,'CATEGORY_DRIFT'])]}:fund.classDetail;const reason={code:'NA_CATEGORY' as const,cause:'CLASSIFICATION_UNCERTAIN' as const,fundAssetClass:assetClass,subCategory:subCategory??fund.subCategory,s1Class:fund.classDetail?.s1.assetClass??fund.assetClass,s2Class:fund.classDetail?.s2?.assetClass,s3Class:fund.classDetail?.s3?.assetClass};const gated=['beta','jensen_alpha','treynor','tracking_error','r_squared','upside_capture','downside_capture','information_ratio','benchmark_outperformance_ratio'];return enforceClassificationMetricGate({...fund,assetClass,classRuleId,taxonomyVersion,subCategory:subCategory??fund.subCategory,classStatus:'CONFLICT' as const,classDetail:detail,metrics:{...fund.metrics,...Object.fromEntries(gated.map(id=>[id,null]))},metricReasons:{...fund.metricReasons,...Object.fromEntries(gated.map(id=>[id,'NA_CATEGORY']))},metricReasonDetails:{...fund.metricReasonDetails,...Object.fromEntries(gated.map(id=>[id,reason]))},category:boundCategory||fund.category});});
}
function safeParseClassDetail(raw:string):Fund['classDetail']{try{return JSON.parse(raw) as Fund['classDetail'];}catch{return undefined;}}
export async function saveFunds(funds:Fund[],onProgress?:(saved:number,total:number)=>void):Promise<void>{
  funds=funds.map(fund=>enforceClassificationMetricGate(normalizeFund(fund)));await recordTaxonomyObservations(funds);
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
/** Replace the local catalogue with a verified snapshot while preserving user settings and audit stores. */
export interface StoredNavHistory { code:number; snapshotId:string; points:NavPoint[]; loadedAt:number }
export async function getNavHistory(code:number):Promise<StoredNavHistory|null>{
  if(isTauri())return null;
  const db=await browserDb();const row=await requestResult(db.transaction('nav_history','readonly').objectStore('nav_history').get(code)) as StoredNavHistory|undefined;return row??null;
}
export async function saveNavHistory(record:StoredNavHistory):Promise<void>{
  if(isTauri())return;
  const db=await browserDb();const tx=db.transaction('nav_history','readwrite');tx.objectStore('nav_history').put(record);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export async function replaceFunds(funds:Fund[],snapshotId=''):Promise<void>{
  if(isTauri()){
    const db=await openDb();
    await db.execute('DELETE FROM schemes');
  }else{
    const db=await browserDb();const old=await requestResult(db.transaction('funds','readonly').objectStore('funds').getAll()) as Fund[];const previousSnapshot=await requestResult(db.transaction('state','readonly').objectStore('state').get('snapshot_id')) as {key:string;value:string}|undefined;const preserve=Boolean(snapshotId&&previousSnapshot?.value===snapshotId);const byCode=new Map(old.map(fund=>[fund.code,fund]));const tx=db.transaction(['funds','nav_history','state'],'readwrite');tx.objectStore('funds').clear();for(const fund of funds){const prior=byCode.get(fund.code);tx.objectStore('funds').put(preserve&&prior?.history?.length?{...fund,history:prior.history,historyFetchedAt:prior.historyFetchedAt}:fund);}if(snapshotId)tx.objectStore('state').put({key:'snapshot_id',value:snapshotId});
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  if(isTauri())await saveFunds(funds);
}
const benchmarkGatedMetrics=['beta','r_squared','jensen_alpha','treynor','information_ratio','tracking_error','upside_capture','downside_capture','benchmark_outperformance_ratio'];
function enforceClassificationMetricGate(fund:Fund):Fund{
  if(fund.classStatus!=='CONFLICT'&&fund.classStatus!=='CONFLICT_STALE'&&fund.assetClass!=='other')return fund;
  const reason=fund.classStatus==='CONFLICT'||fund.classStatus==='CONFLICT_STALE'?{code:'NA_CATEGORY' as const,cause:'CLASSIFICATION_UNCERTAIN' as const,fundAssetClass:fund.assetClass,subCategory:fund.subCategory,s1Class:fund.classDetail?.s1.assetClass??fund.assetClass,s2Class:fund.classDetail?.s2?.assetClass,s3Class:fund.classDetail?.s3?.assetClass}:{code:'NA_CATEGORY' as const,cause:'UNCLASSIFIED_FUND' as const,fundAssetClass:fund.assetClass,subCategory:fund.subCategory};
  return {...fund,metrics:{...fund.metrics,...Object.fromEntries(benchmarkGatedMetrics.map(id=>[id,null]))},metricReasons:{...fund.metricReasons,...Object.fromEntries(benchmarkGatedMetrics.map(id=>[id,'NA_CATEGORY']))},metricReasonDetails:{...fund.metricReasonDetails,...Object.fromEntries(benchmarkGatedMetrics.map(id=>[id,reason]))}};
}
export interface ClassificationDiagnostics {unmapped:Array<{categoryKey:string;sourceId:string;sampleRaw:string;schemeCount:number;firstSeen:number;lastSeen:number}>;conflicts:Array<{schemeCode:number;storedCategory:string;incomingCategory:string;storedClass:string;incomingClass:string;storedRule:string;incomingRule:string;storedVersion:number;incomingVersion:number;observedAt:number}>;auditCount:number;agreements:number;disagreements:number;lastAuditAt:number|null}
export async function getClassificationDiagnostics():Promise<ClassificationDiagnostics>{
  if(isTauri()){const db=await openDb();const [unmapped,conflicts,audit]=await Promise.all([db.select<ClassificationDiagnostics['unmapped']>('SELECT category_key AS categoryKey,source_id AS sourceId,sample_raw AS sampleRaw,scheme_count AS schemeCount,first_seen AS firstSeen,last_seen AS lastSeen FROM unmapped_categories ORDER BY scheme_count DESC'),db.select<ClassificationDiagnostics['conflicts']>('SELECT scheme_code AS schemeCode,stored_category AS storedCategory,incoming_category AS incomingCategory,stored_class AS storedClass,incoming_class AS incomingClass,stored_rule AS storedRule,incoming_rule AS incomingRule,stored_version AS storedVersion,incoming_version AS incomingVersion,observed_at AS observedAt FROM taxonomy_conflicts ORDER BY observed_at DESC LIMIT 500'),db.select<{count:number;agreements:number;disagreements:number;last:number|null}[]>('SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN agrees=1 THEN 1 ELSE 0 END),0) AS agreements,COALESCE(SUM(CASE WHEN agrees=0 THEN 1 ELSE 0 END),0) AS disagreements,MAX(audited_at) AS last FROM classification_audit')]);return {unmapped,conflicts,auditCount:audit[0]?.count??0,agreements:audit[0]?.agreements??0,disagreements:audit[0]?.disagreements??0,lastAuditAt:audit[0]?.last??null};}
  const db=await browserDb();const [unmapped,conflicts,audits]=await Promise.all([requestResult(db.transaction('unmapped_categories','readonly').objectStore('unmapped_categories').getAll()) as Promise<ClassificationDiagnostics['unmapped']>,requestResult(db.transaction('taxonomy_conflicts','readonly').objectStore('taxonomy_conflicts').getAll()) as Promise<Array<ClassificationDiagnostics['conflicts'][number]&{id:number}>>,requestResult(db.transaction('classification_audit','readonly').objectStore('classification_audit').getAll()) as Promise<Array<{auditedAt:number;agrees:boolean}>>]);return {unmapped,conflicts:conflicts.sort((a,b)=>b.observedAt-a.observedAt).slice(0,500),auditCount:audits.length,agreements:audits.filter(item=>item.agrees).length,disagreements:audits.filter(item=>!item.agrees).length,lastAuditAt:audits.reduce<number|null>((last,item)=>last===null||item.auditedAt>last?item.auditedAt:last,null)};
}
export async function recordSourceSchemeMapping(row:{schemeCode:number;sourceId:string;sourceSchemeCode:string;sourceName:string;joinMethod:string;confidence:string;matchedAt:number}):Promise<void>{if(isTauri()){const db=await openDb();await db.execute('INSERT INTO source_scheme_map(scheme_code,source_id,source_scheme_code,source_name,join_method,confidence,matched_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(scheme_code,source_id,source_scheme_code,source_name) DO UPDATE SET join_method=excluded.join_method,confidence=excluded.confidence,matched_at=excluded.matched_at',[row.schemeCode,row.sourceId,row.sourceSchemeCode,row.sourceName,row.joinMethod,row.confidence,row.matchedAt]);return;}const db=await browserDb();const tx=db.transaction('source_scheme_map','readwrite');tx.objectStore('source_scheme_map').put(row);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export async function recordClassificationDecision(code:number,action:'accept_s1'|'rebind_other',note=''):Promise<void>{
  const funds=await getFunds();const fund=funds.find(item=>item.code===code);if(!fund)throw new Error(`Scheme ${code} is not in the local catalog.`);
  const now=Date.now();const acceptedCategory=action==='accept_s1'?(fund.classDetail?.s1.categoryRaw??fund.category):fund.category;const review={action,reviewedAt:now,categoryRaw:acceptedCategory,...(note?{note}:{})};const observedAt=fund.classDetail?.s1.observedAt??fund.navDate*86_400_000;const consensus=reconcileClassification({...(fund.schemeMaster?.categoryRaw?{s0:{categoryRaw:fund.schemeMaster.categoryRaw,observedAt,schemeMaster:{categoryRaw:fund.schemeMaster.categoryRaw,closureDate:fund.schemeMaster.closureDate}}}:{}),s1:{categoryRaw:fund.category,headerRaw:fund.headerRaw,observedAt,structure:fund.structure,navDate:fund.navDate,newestNavDate:fund.navDate},s2:fund.classDetail?.s2?{categoryRaw:fund.classDetail.s2.categoryRaw,observedAt:fund.classDetail.s2.observedAt}:undefined,s3:fund.classDetail?.s3?{categoryRaw:fund.classDetail.s3.categoryRaw,observedAt:fund.classDetail.s3.observedAt}:undefined,s4:fund.classDetail?.s4?{categoryRaw:fund.classDetail.s4.categoryRaw,observedAt:fund.classDetail.s4.observedAt}:undefined,schemeName:fund.name,evaluatedAt:now,previousReview:review});const updated=enforceClassificationMetricGate({...fund,...consensus,assetClass:consensus.assetClass,classRuleId:consensus.ruleId,category:acceptedCategory,subCategory:consensus.subCategory,taxonomyVersion:TAXONOMY_VERSION,classStatus:consensus.status,classDetail:consensus.detail,group:consensus.group,management:consensus.management,riskBand:consensus.riskBand,philosophy:consensus.philosophy,speciality:consensus.speciality,lifecycle:consensus.lifecycle,classificationReason:consensus.reason,classificationProvenance:consensus.provenance});
  const auditor='local-user';const auditNote=`${action}${note?`: ${note}`:''}`;
  if(isTauri()){
    const db=await openDb();await db.execute('INSERT INTO classification_audit(scheme_code,audited_at,auditor,sid_category,sid_url,expected_class,agrees,notes) VALUES($1,$2,$3,$4,NULL,$5,1,$6)',[code,now,auditor,fund.classDetail?.s1.categoryRaw??fund.category,updated.assetClass,auditNote]);
    await db.execute('UPDATE scheme_taxonomy SET category_raw=$1,sub_category=$2,asset_class=$3,rule_id=$4,class_status=$5,class_detail=$6,class_checked_at=$7 WHERE scheme_code=$8',[acceptedCategory,updated.subCategory,updated.assetClass,updated.classRuleId,updated.classStatus??'UNCONFIRMED',updated.classDetail?JSON.stringify(updated.classDetail):null,now,code]);
  }else{
    const db=await browserDb();const stored=await requestResult(db.transaction('taxonomy','readonly').objectStore('taxonomy').get(code)) as Record<string,unknown>|undefined;const tx=db.transaction(['classification_audit','taxonomy'],'readwrite');tx.objectStore('classification_audit').add({schemeCode:code,auditedAt:now,auditor,sidCategory:fund.classDetail?.s1.categoryRaw??fund.category,sidUrl:null,expectedClass:updated.assetClass,agrees:true,notes:auditNote});if(stored)tx.objectStore('taxonomy').put({...stored,categoryRaw:acceptedCategory,subCategory:updated.subCategory,assetClass:updated.assetClass,ruleId:updated.classRuleId,classStatus:updated.classStatus??'UNCONFIRMED',classDetail:updated.classDetail,classCheckedAt:now});
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  await saveFunds([updated]);
}
export async function importClassificationAudit(records:Array<{schemeCode:number;auditor:string;sidCategory:string;sidUrl:string|null;expectedClass:string;agrees:boolean;notes:string|null}>):Promise<{imported:number;disagreements:number}>{
  if(records.some(item=>!Number.isInteger(item.schemeCode)||item.schemeCode<=0||!item.sidCategory.trim()||!isAssetClass(item.expectedClass)))throw new Error('Audit CSV has an invalid scheme code, category, or expected class.');
  const now=Date.now();if(isTauri()){const db=await openDb();for(let start=0;start<records.length;start+=80){const batch=records.slice(start,start+80);for(const item of batch)await db.execute('INSERT INTO classification_audit(scheme_code,audited_at,auditor,sid_category,sid_url,expected_class,agrees,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[item.schemeCode,now,item.auditor,item.sidCategory,item.sidUrl,item.expectedClass,item.agrees?1:0,item.notes]);}}else{const db=await browserDb();const tx=db.transaction('classification_audit','readwrite');for(const item of records)tx.objectStore('classification_audit').add({...item,auditedAt:now});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  return {imported:records.length,disagreements:records.filter(item=>!item.agrees).length};
}
async function recordTaxonomyObservations(funds:Fund[]):Promise<void>{
  const now=Date.now();
  const observations=funds.flatMap(fund=>[
    ...(fund.schemeMaster?.categoryRaw?[{schemeCode:fund.code,sourceId:'s0_amfi_master',categoryRaw:fund.schemeMaster.categoryRaw,structure:null,observedAt:fund.schemeMaster.launchDate!==null?fund.schemeMaster.launchDate*86_400_000:(fund.classDetail?.evaluatedAt??now),ruleId:fund.classDetail?.s0?.ruleId??fund.classRuleId}]:[]),
    {schemeCode:fund.code,sourceId:'s1_navall',categoryRaw:fund.category,structure:fund.structure,observedAt:fund.classDetail?.s1.observedAt??fund.navDate*86_400_000,ruleId:fund.classDetail?.s1.ruleId??fund.classRuleId},
    ...(fund.classDetail?.s2?[{schemeCode:fund.code,sourceId:'s2_mfapi',categoryRaw:fund.classDetail.s2.categoryRaw,structure:null,observedAt:fund.classDetail.s2.observedAt,ruleId:fund.classDetail.s2.ruleId}]:[]),
    ...(fund.classDetail?.s3?[{schemeCode:fund.code,sourceId:'s3_amfi_ter',categoryRaw:fund.classDetail.s3.categoryRaw,structure:null,observedAt:fund.classDetail.s3.observedAt,ruleId:fund.classDetail.s3.ruleId}]:[]),
    ...(fund.classDetail?.s4?[{schemeCode:fund.code,sourceId:'s4_amfi_aum',categoryRaw:fund.classDetail.s4.categoryRaw,structure:null,observedAt:fund.classDetail.s4.observedAt,ruleId:fund.classDetail.s4.ruleId}]:[]),
  ]);
  const isUnresolvedRule=(ruleId:string)=>ruleId==='UNMAPPED'||ruleId==='AMFI_CATEGORY_UNMAPPED'||ruleId==='LEGACY_INCOME_UNKNOWN'||ruleId==='LEGACY_GROWTH_UNKNOWN'||ruleId.endsWith('_UNDERLYING_UNKNOWN')||ruleId==='PASSIVE_AMBIGUOUS'||ruleId==='PASSIVE_UNMATCHED';
  const unmapped=observations.filter(item=>isUnresolvedRule(item.ruleId)).map(item=>({schemeCode:item.schemeCode,categoryKey:normalizeCategory(item.categoryRaw).key,sourceId:item.sourceId,sampleRaw:item.categoryRaw}));
  const signalDisagreements=funds.flatMap(fund=>[fund.classDetail?.s0,fund.classDetail?.s1,fund.classDetail?.s3,fund.classDetail?.s4].filter(signal=>signal?.sourceId!=='s1_navall').flatMap(signal=>signal&&isUnresolvedRule(signal.ruleId)===false&&signal.assetClass!=='other'&&signal.assetClass!==fund.assetClass?[{schemeCode:fund.code,storedCategory:fund.classDetail?.s0?.categoryRaw??fund.category,incomingCategory:signal.categoryRaw,storedClass:fund.classDetail?.s0?.assetClass??fund.assetClass,incomingClass:signal.assetClass,storedRule:fund.classDetail?.s0?.ruleId??fund.classRuleId,incomingRule:signal.ruleId,storedVersion:fund.taxonomyVersion,incomingVersion:fund.taxonomyVersion,observedAt:fund.classDetail?.evaluatedAt??now}]:[]));
  if(isTauri()){
    const db=await openDb();const existing=await db.select<{scheme_code:number;category_raw:string;sub_category:string;asset_class:string;rule_id:string;taxonomy_version:number;first_seen_at:number;class_status:string;class_detail:string|null}[]>('SELECT scheme_code,category_raw,sub_category,asset_class,rule_id,taxonomy_version,first_seen_at,class_status,class_detail FROM scheme_taxonomy');const byCode=new Map(existing.map(row=>[row.scheme_code,row]));const inserts:Fund[]=[];const bumps:Array<{fund:Fund;stored:(typeof existing)[number]}>=[];const conflicts:Array<{fund:Fund;stored:(typeof existing)[number]}>=[];const updates:Array<Fund>=[];
    for(const fund of funds){const stored=byCode.get(fund.code);if(!stored){inserts.push(fund);continue;}if(stored.taxonomy_version<fund.taxonomyVersion){bumps.push({fund,stored});continue;}if(stored.taxonomy_version===fund.taxonomyVersion&&stored.rule_id==='USER_REBIND_OTHER'){updates.push({...fund,assetClass:'other',classRuleId:'USER_REBIND_OTHER',classStatus:stored.class_status as Fund['classStatus']??'UNCONFIRMED',classDetail:stored.class_detail?safeParseClassDetail(stored.class_detail):fund.classDetail});continue;}if(stored.taxonomy_version===fund.taxonomyVersion&&stored.asset_class!==fund.assetClass){conflicts.push({fund,stored});continue;}if(stored.taxonomy_version===fund.taxonomyVersion){updates.push(fund);}}
    const insertTaxonomy=async(batch:Fund[],upsert=false)=>{for(let start=0;start<batch.length;start+=80){const slice=batch.slice(start,start+80);const values:string[]=[];const bindings:unknown[]=[];for(let i=0;i<slice.length;i++){const pos=i*10+1;values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3},$${pos+4},$${pos+5},$${pos+6},$${pos+6},$${pos+7},$${pos+8},$${pos+9})`);const fund=slice[i]!;bindings.push(fund.code,fund.category,fund.subCategory,fund.assetClass,fund.classRuleId,fund.taxonomyVersion,now,fund.classStatus??'UNCONFIRMED',fund.classDetail?JSON.stringify(fund.classDetail):null,now);}const suffix=upsert?' ON CONFLICT(scheme_code) DO UPDATE SET category_raw=excluded.category_raw,sub_category=excluded.sub_category,asset_class=excluded.asset_class,rule_id=excluded.rule_id,taxonomy_version=excluded.taxonomy_version,last_seen_at=excluded.last_seen_at,class_status=excluded.class_status,class_detail=excluded.class_detail,class_checked_at=excluded.class_checked_at':'';await db.execute(`INSERT ${upsert?'':'OR IGNORE '}INTO scheme_taxonomy(scheme_code,category_raw,sub_category,asset_class,rule_id,taxonomy_version,first_seen_at,last_seen_at,class_status,class_detail,class_checked_at) VALUES ${values.join(',')}${suffix}`,bindings);}};
    await insertTaxonomy(inserts);await insertTaxonomy(bumps.map(item=>item.fund),true);
    const changed=[...bumps,...conflicts];for(let start=0;start<changed.length;start+=80){const batch=changed.slice(start,start+80);const values:string[]=[];const bindings:unknown[]=[];for(let i=0;i<batch.length;i++){const pos=i*10+1;values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3},$${pos+4},$${pos+5},$${pos+6},$${pos+7},$${pos+8},$${pos+9})`);const {fund,stored}=batch[i]!;bindings.push(fund.code,stored.category_raw,fund.category,stored.asset_class,fund.assetClass,stored.rule_id,fund.classRuleId,stored.taxonomy_version,fund.taxonomyVersion,now);}await db.execute(`INSERT OR IGNORE INTO taxonomy_conflicts(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version,observed_at) VALUES ${values.join(',')}`,bindings);}
    for(let start=0;start<signalDisagreements.length;start+=80){const batch=signalDisagreements.slice(start,start+80);const values:string[]=[];const bindings:unknown[]=[];for(let i=0;i<batch.length;i++){const pos=i*10+1;values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3},$${pos+4},$${pos+5},$${pos+6},$${pos+7},$${pos+8},$${pos+9})`);const item=batch[i]!;bindings.push(item.schemeCode,item.storedCategory,item.incomingCategory,item.storedClass,item.incomingClass,item.storedRule,item.incomingRule,item.storedVersion,item.incomingVersion,item.observedAt);}await db.execute(`INSERT OR IGNORE INTO taxonomy_conflicts(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version,observed_at) VALUES ${values.join(',')}`,bindings);}
    await insertTaxonomy(updates,true);
    for(let start=0;start<conflicts.length;start+=80){const batch=conflicts.slice(start,start+80);for(const {fund,stored} of batch){const detail={...(fund.classDetail??{}),flags:[...new Set([...(fund.classDetail?.flags??[]),'CATEGORY_DRIFT'])]};await db.execute('UPDATE scheme_taxonomy SET class_status=$1,class_detail=$2,class_checked_at=$3,last_seen_at=$3 WHERE scheme_code=$4',['CONFLICT',JSON.stringify(detail),now,fund.code]);void stored;}}
    for(let start=0;start<observations.length;start+=100){const batch=observations.slice(start,start+100);const values:string[]=[];const bindings:unknown[]=[];for(let i=0;i<batch.length;i++){const pos=i*6+1;values.push(`($${pos},$${pos+1},$${pos+2},$${pos+3},$${pos+4},$${pos+5})`);const item=batch[i]!;bindings.push(item.schemeCode,item.sourceId,item.categoryRaw,item.structure,item.observedAt,item.observedAt);}await db.execute(`INSERT INTO scheme_category_history(scheme_code,source_id,category_raw,structure,first_seen,last_seen) VALUES ${values.join(',')} ON CONFLICT(scheme_code,source_id,category_raw) DO UPDATE SET structure=excluded.structure,last_seen=excluded.last_seen`,bindings);}
    for(const item of unmapped){await db.execute('INSERT INTO unmapped_category_members(scheme_code,category_key,source_id,sample_raw) VALUES($1,$2,$3,$4) ON CONFLICT(scheme_code,category_key,source_id) DO UPDATE SET sample_raw=excluded.sample_raw',[item.schemeCode,item.categoryKey,item.sourceId,item.sampleRaw]);await db.execute('INSERT INTO unmapped_categories(category_key,source_id,sample_raw,scheme_count,first_seen,last_seen) VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(category_key,source_id) DO UPDATE SET sample_raw=excluded.sample_raw,scheme_count=(SELECT COUNT(*) FROM unmapped_category_members WHERE category_key=$1 AND source_id=$2),last_seen=excluded.last_seen',[item.categoryKey,item.sourceId,item.sampleRaw,now,now]);}
  }else{
    const db=await browserDb();
    const [existing,members,oldSummaries,oldConflicts]=await Promise.all([
      requestResult(db.transaction('taxonomy','readonly').objectStore('taxonomy').getAll()) as Promise<Array<{schemeCode:number;categoryRaw:string;subCategory:string;assetClass:string;ruleId:string;taxonomyVersion:number;firstSeenAt:number;lastSeenAt:number;classStatus?:string;classDetail?:Fund['classDetail']}>>,
      requestResult(db.transaction('unmapped_category_members','readonly').objectStore('unmapped_category_members').getAll()) as Promise<typeof unmapped>,
      requestResult(db.transaction('unmapped_categories','readonly').objectStore('unmapped_categories').getAll()) as Promise<Array<{categoryKey:string;sourceId:string;firstSeen:number}>>,
      requestResult(db.transaction('taxonomy_conflicts','readonly').objectStore('taxonomy_conflicts').getAll()) as Promise<Array<{schemeCode:number;storedCategory:string;incomingCategory:string;storedClass:string;incomingClass:string;storedRule:string;incomingRule:string;storedVersion:number;incomingVersion:number}>>,
    ]);
    const byCode=new Map(existing.map(row=>[row.schemeCode,row]));const memberByKey=new Map(members.map(item=>[`${item.schemeCode}\u0000${item.categoryKey}\u0000${item.sourceId}`,item]));for(const item of unmapped)memberByKey.set(`${item.schemeCode}\u0000${item.categoryKey}\u0000${item.sourceId}`,item);const conflictKey=(item:{schemeCode:number;storedCategory:string;incomingCategory:string;storedClass:string;incomingClass:string;storedRule:string;incomingRule:string;storedVersion:number;incomingVersion:number})=>[item.schemeCode,item.storedCategory,item.incomingCategory,item.storedClass,item.incomingClass,item.storedRule,item.incomingRule,item.storedVersion,item.incomingVersion].join('\u0000');const conflictKeys=new Set(oldConflicts.map(conflictKey));
    const grouped=new Map<string,typeof unmapped>();for(const item of memberByKey.values()){const key=`${item.categoryKey}\u0000${item.sourceId}`;grouped.set(key,[...(grouped.get(key)??[]),item]);}
    const tx=db.transaction(['taxonomy','taxonomy_conflicts','category_history','unmapped_categories','unmapped_category_members'],'readwrite');const taxonomy=tx.objectStore('taxonomy');const conflictsStore=tx.objectStore('taxonomy_conflicts');
    for(const fund of funds){const stored=byCode.get(fund.code);if(!stored){taxonomy.put({schemeCode:fund.code,categoryRaw:fund.category,subCategory:fund.subCategory,assetClass:fund.assetClass,ruleId:fund.classRuleId,taxonomyVersion:fund.taxonomyVersion,classStatus:fund.classStatus??'UNCONFIRMED',classDetail:fund.classDetail,classCheckedAt:now,firstSeenAt:now,lastSeenAt:now});continue;}if(stored.taxonomyVersion<fund.taxonomyVersion){const conflict={schemeCode:fund.code,storedCategory:stored.categoryRaw,incomingCategory:fund.category,storedClass:stored.assetClass,incomingClass:fund.assetClass,storedRule:stored.ruleId,incomingRule:fund.classRuleId,storedVersion:stored.taxonomyVersion,incomingVersion:fund.taxonomyVersion,observedAt:now};const key=conflictKey(conflict);if(!conflictKeys.has(key)){conflictsStore.add(conflict);conflictKeys.add(key);}taxonomy.put({schemeCode:fund.code,categoryRaw:fund.category,subCategory:fund.subCategory,assetClass:fund.assetClass,ruleId:fund.classRuleId,taxonomyVersion:fund.taxonomyVersion,classStatus:fund.classStatus??'UNCONFIRMED',classDetail:fund.classDetail,classCheckedAt:now,firstSeenAt:stored.firstSeenAt,lastSeenAt:now});continue;}if(stored.taxonomyVersion===fund.taxonomyVersion&&stored.ruleId==='USER_REBIND_OTHER'){taxonomy.put({...stored,classStatus:stored.classStatus??'UNCONFIRMED',lastSeenAt:now});continue;}if(stored.taxonomyVersion===fund.taxonomyVersion&&stored.assetClass!==fund.assetClass){const detail={...(fund.classDetail??{}),flags:[...new Set([...(fund.classDetail?.flags??[]),'CATEGORY_DRIFT'])]};taxonomy.put({...stored,classStatus:'CONFLICT',classDetail:detail,classCheckedAt:now,lastSeenAt:now});const conflict={schemeCode:fund.code,storedCategory:stored.categoryRaw,incomingCategory:fund.category,storedClass:stored.assetClass,incomingClass:fund.assetClass,storedRule:stored.ruleId,incomingRule:fund.classRuleId,storedVersion:stored.taxonomyVersion,incomingVersion:fund.taxonomyVersion,observedAt:now};const key=conflictKey(conflict);if(!conflictKeys.has(key)){conflictsStore.add(conflict);conflictKeys.add(key);}continue;}taxonomy.put({...stored,categoryRaw:fund.category,subCategory:fund.subCategory,ruleId:fund.classRuleId,classStatus:fund.classStatus??'UNCONFIRMED',classDetail:fund.classDetail,classCheckedAt:now,lastSeenAt:now});}
    for(const item of signalDisagreements){const key=conflictKey(item);if(!conflictKeys.has(key)){conflictsStore.add(item);conflictKeys.add(key);}}
    const historyStore=tx.objectStore('category_history');for(const item of observations)historyStore.put({schemeCode:item.schemeCode,sourceId:item.sourceId,categoryRaw:item.categoryRaw,structure:item.structure,firstSeen:item.observedAt,lastSeen:item.observedAt});const memberStore=tx.objectStore('unmapped_category_members');for(const item of unmapped)memberStore.put(item);
    const oldSummaryByKey=new Map(oldSummaries.map(item=>[`${item.categoryKey}\u0000${item.sourceId}`,item]));const unmappedStore=tx.objectStore('unmapped_categories');for(const [key,items] of grouped){const [categoryKey,sourceId]=key.split('\u0000');const first=items[0]!;unmappedStore.put({categoryKey,sourceId,sampleRaw:first.sampleRaw,schemeCount:items.length,firstSeen:oldSummaryByKey.get(key)?.firstSeen??now,lastSeen:now});}
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
