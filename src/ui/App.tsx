import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Activity, AlertTriangle, ArrowDown, ArrowDownUp, ArrowUp, BadgeCheck, Bookmark, Check, ChevronDown, CircleHelp, Database, Download, Filter, Gauge, GitCompareArrows, LockKeyhole, Menu, Moon, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, TableProperties, Trash2, Upload, X } from 'lucide-react';
import { metricRegistry } from '../domain/metrics/registry';
import { explainMetricForFund } from '../domain/metrics/insights';
import type { Fund, MetricDefinition, NavPoint } from '../domain/types';
import { applyPersistentScores, computeScoreArray, DEFAULT_SCORE_FACTORS, hasCurrentPersistentScores, PRESET_SCORE_MODELS, SCORE_METRIC_ID, SCORE_MODEL_HASH_METRIC_ID, scoreFactorsSignature, type PeerGroupMode, type ScoreFactor, type ScoreModelPreset } from '../domain/scoring/engine';
import { getClassificationDiagnostics, getFundIndexBuffer, getFunds, getLocalState, importClassificationAudit, initializeRepository, loadFundDetails, recordClassificationDecision, saveFundMetrics, saveFunds, setLocalState, sourceStatus, waitForNormalizedStorage } from '../app/persistence';
import { refreshCatalog } from '../app/refresh';
import { ensureFundMetricsComputed, hasAuthoritativeMetrics, loadSelectedHistories, prefetchSchemeHistory } from '../app/historyLoader';
import { applyLocalDisclosureOverrides, ingestCurrentMonthAmfiTer, ingestLatestAmfiAverageAum } from '../app/disclosures';
import { DEFAULT_RISK_FREE_RATE_PERCENT, INDUSTRY_RISK_FREE_BENCHMARK } from '../domain/metrics/compute';
import { computeFundsInWorker, computeGrowthChartInWorker } from '../domain/metrics/workerClient';
import { nearestGrowthPoint, type GrowthChartModel } from '../domain/metrics/growthChart';
import { computePeerMetricsInWorker } from '../domain/metrics/peerMetricsClient';
import { FundBenchmarkSection } from './FundBenchmarkSection';
import { reasonMessage } from '../domain/governance/reasonMessages';
import { benchmarkConfig, benchmarkConfigValidation } from '../config/benchmarks';
import { TAXONOMY_VERSION } from '../domain/taxonomy/assetClass';
import { classificationMessages, rerunClassification, summarizeClassification } from '../app/services/ClassificationService';
import { parseClassificationAuditCsv, renderClassificationAuditSample } from '../domain/taxonomy/auditCsv';
import { groupUnclassifiedByReason } from '../domain/taxonomy/reviewQueue';
import { getUnlockedSnapshotManifest, loadSnapshotDetails, loadSnapshotHistories } from '../adapters/snapshot/browserReader';

const historyArrayIds=new WeakMap<NavPoint[],number>();
let nextHistoryArrayId=0;
function historyArrayId(history:NavPoint[]):number{let id=historyArrayIds.get(history);if(id===undefined){id=++nextHistoryArrayId;historyArrayIds.set(history,id);}return id;}
import { normalizeFilterText } from '../domain/search/normalize';
import { finishPerfMeasurement, getPerfMeasurements, isPerfEnabled, startPerfMeasurement, subscribePerfMeasurements } from '../app/perf';
import { activeFacetCount, collapseFacetSelection, computeScreenerView, defaultScreenerFilters, isFacetOptionSelected, type ArrayFacet, type ScreenerFilters } from '../domain/screener/filters';
import { fromSavedScreen, screenerReducer } from '../app/screenerStore';
import { ScreenerEngineClient } from '../engine/engineClient';
import { arrayFacets } from '../domain/screener/filters';
import { facetOptionsFromCounts, type EngineCategoryTree, type EngineQueryResult } from '../engine/core';
import { AppliedFilters, FilterChip, type AppliedFilter } from './filters/AppliedFilters';
import { formatRangeChip } from '../domain/screener/appliedFilters';
import type { ScatterPreferences } from './scatter/types';
import { defaultScatterPreferences, parseScatterPreferences } from './scatter/preferences';
import { formatEpochDay, formatEpochMs } from '../domain/scatter/presentation';
import scatterPresets from '../../config/scatter-presets.json';
import { colorPalette } from './colorPalette';

const hostedWeb = import.meta.env.MODE === 'web';
const ScatterTab = lazy(() => import('./scatter/ScatterTab').then(module => ({ default: module.ScatterTab })));

type Route='screener'|'compare'|'score'|'health'|'governance'|'settings';
type MetricFilter={id:string,min:number|null,max:number|null,excludeMissing:boolean};
type SavedScoreModel={id?:string;name:string;description?:string;factors:ScoreFactor[];peerGroup?:PeerGroupMode;savedAt:number;dataAsOf?:number|null};
type BackendOpState={title:string;subtitle:string;badge?:string}|null;
type PersistedScoreCache={modelHash:number;savedAt:number;scores:Record<number,number>};
type SavedScreen={name:string;version:5;filters:ScreenerFilters;sort:{id:string;desc:boolean};density:'comfortable'|'compact';riskWindow:1|3|5;scatter?:ScatterPreferences};
type SourceState={fetchedAt:number|null,dataAsOf:number|null,status:string,detail:string|null};
const EMPTY_INDICES=new Uint32Array(0);
const dateText=(epoch:number|null)=>formatEpochDay(epoch);
const pct=(n:number|null|undefined)=>n==null?'—':`${n>=0?'+':''}${n.toFixed(2)}%`;
const fmt=(n:number|null|undefined, unit:'%'|'ratio'|'years'|'₹ Cr'|'enum'='%', decimals=2)=>n==null?'—':unit==='years'?`${n.toFixed(1)} yrs`:unit==='₹ Cr'?`₹${n.toLocaleString('en-IN',{maximumFractionDigits:0})} Cr`:unit==='ratio'?n.toFixed(decimals):`${n.toFixed(decimals)}%`;
const initialFactors:ScoreFactor[]=DEFAULT_SCORE_FACTORS;
const yieldToPaint=()=>new Promise<void>(resolve=>window.requestAnimationFrame(()=>window.setTimeout(resolve,16)));
function slugModelId(name:string):string{return normalizeFilterText(name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'custom-model';}
function readSavedScoreModels():ScoreModelPreset[]{
  try{
    const raw=JSON.parse(localStorage.getItem('fundscope-score-models')||'[]');
    const custom:ScoreModelPreset[]=Array.isArray(raw)?raw.filter((m):m is ScoreModelPreset=>Boolean(m&&typeof m==='object'&&typeof m.name==='string'&&Array.isArray(m.factors))).map(m=>({
      id:m.id||slugModelId(m.name),
      name:m.name,
      description:m.description||'Custom multi-factor score model saved on this device.',
      peerGroup:m.peerGroup??'subcategory',
      factors:m.factors,
      builtIn:false,
      savedAt:typeof m.savedAt==='number'?m.savedAt:Date.now(),
      dataAsOf:m.dataAsOf??null,
    })):[];
    const customById=new Map(custom.map(m=>[m.id,m]));
    const merged:ScoreModelPreset[]=[...custom];
    for(const preset of PRESET_SCORE_MODELS){
      if(!customById.has(preset.id)&&!custom.some(m=>normalizeFilterText(m.name)===normalizeFilterText(preset.name))){
        merged.push(preset);
      }
    }
    return merged;
  }catch{return [...PRESET_SCORE_MODELS];}
}
function persistCustomScoreModels(models:ScoreModelPreset[]):void{
  const custom=models.filter(m=>!m.builtIn);
  try{localStorage.setItem('fundscope-score-models',JSON.stringify(custom));}catch{}
  void setLocalState('score-models-list',custom).catch(()=>undefined);
}
function readPersistedScoreCache():PersistedScoreCache|null{
  try{
    const parsed=JSON.parse(localStorage.getItem('fundscope-persisted-scores')||'null') as PersistedScoreCache|null;
    return parsed&&typeof parsed.modelHash==='number'&&parsed.scores&&typeof parsed.scores==='object'?parsed:null;
  }catch{return null;}
}
function writePersistedScoreCache(modelHash:number,scoresArray:Float32Array,funds:readonly Fund[],savedAt:number):void{
  const scores:Record<number,number>={};
  for(let i=0;i<funds.length;i++){
    const v=scoresArray[i]!;
    if(Number.isFinite(v))scores[funds[i]!.code]=Number(v.toFixed(2));
  }
  const payload:PersistedScoreCache={modelHash,savedAt,scores};
  try{localStorage.setItem('fundscope-persisted-scores',JSON.stringify(payload));}catch{}
  void setLocalState('persisted-scores',payload).catch(()=>undefined);
}
function hydrateOrComputePersistentScores(funds:Fund[],factors:ScoreFactor[],peerGroup:PeerGroupMode):Fund[]{
  if(!funds.length||hasCurrentPersistentScores(funds,factors,peerGroup))return funds;
  const expectedHash=scoreFactorsSignature(factors,peerGroup);
  const cached=readPersistedScoreCache();
  if(cached&&Math.round(cached.modelHash)===expectedHash){
    const scores=new Float32Array(funds.length).fill(Number.NaN);
    let hits=0;
    for(let i=0;i<funds.length;i++){
      const v=cached.scores[funds[i]!.code];
      if(typeof v==='number'&&Number.isFinite(v)){scores[i]=v;hits++;}
    }
    if(hits>0)return applyPersistentScores(funds,factors,peerGroup,{scores,modelHash:expectedHash});
  }
  return applyPersistentScores(funds,factors,peerGroup);
}
function readScatterPreferences():ScatterPreferences{try{return parseScatterPreferences(JSON.parse(localStorage.getItem('fundscope-scatter-preferences')||'null'))??defaultScatterPreferences;}catch{return defaultScatterPreferences;}}
const cleanLabel=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const uniqueTextLabels=(values:unknown[])=>{const labels=new Map<string,string>();for(const raw of values){const value=cleanLabel(raw);const key=normalizeFilterText(value);if(value&&key!=='unknown'&&!labels.has(key))labels.set(key,value);}return [...labels.values()].sort((a,b)=>a.localeCompare(b));};
const parseSavedScreen=(raw:string):SavedScreen|null=>{try{const value=JSON.parse(raw) as Record<string,unknown>;if(!value||typeof value!=='object'||typeof value.name!=='string')return null;const sort=value.sort&&typeof value.sort==='object'&&typeof (value.sort as {id?:unknown}).id==='string'&&typeof (value.sort as {desc?:unknown}).desc==='boolean'?value.sort as SavedScreen['sort']:{id:'name',desc:false};const riskWindow=value.riskWindow===1||value.riskWindow===5?value.riskWindow:3;return {name:value.name.trim().slice(0,100)||'Saved screen',version:5,filters:fromSavedScreen(value),sort,density:value.density==='compact'?'compact':'comfortable',riskWindow,scatter:parseScatterPreferences(value.scatter)};}catch{return null;}};
const readSavedScreens=()=>{try{const value:unknown=JSON.parse(localStorage.getItem('fundscope-screens')||'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&parseSavedScreen(item)!==null):[];}catch{return[];}};
const needsHistory=(fund:Fund)=>fund.history.length===0||fund.historyFetchedAt===undefined||Date.now()-fund.historyFetchedAt>7*86_400_000;
const DEFAULT_TABLE_METRIC_IDS=['cagr_1y','cagr_3y','cagr_5y','sharpe','std_dev','max_drawdown'] as const;
const RETURN_COLOR_METRIC_IDS=new Set(['absolute_return_3m','absolute_return_6m','cagr_1y','cagr_3y','cagr_5y','cagr_10y','rolling_1y_average_return','rolling_3y_average_return','return_vs_subcategory_3y','return_vs_subcategory_5y','max_drawdown']);
const VIRTUAL_OVERSCAN=18;

export interface AppProps { initialFunds?: Fund[]; initialSource?: SourceState; onLock?: () => void; sessionDays?: string; onSessionDaysChange?: (value:string)=>void; onFirstRows?:()=>void; snapshotUpdate?: {keyChanged:boolean;applying?:boolean;error?:string} | null; onApplySnapshotUpdate?:()=>void }
function App({initialFunds,initialSource,onLock,sessionDays='30',onSessionDaysChange,onFirstRows,snapshotUpdate,onApplySnapshotUpdate}:AppProps={}){
  const [route,setRoute]=useState<Route>('screener'); const [funds,setFunds]=useState<Fund[]>(()=>initialFunds??[]); const [isLoading,setIsLoading]=useState(()=>initialFunds===undefined);
  const [refreshing,setRefreshing]=useState(false); const [refreshStage,setRefreshStage]=useState(''); const [refreshError,setRefreshError]=useState(''); const [historyError,setHistoryError]=useState(''); const [status,setStatus]=useState<SourceState>(()=>initialSource??{fetchedAt:null,dataAsOf:null,status:'never',detail:null}); const [dbError,setDbError]=useState<string | null>(null);
  const refreshLock=useRef(false);
  const fundsRef=useRef(funds);const [cellChanges,setCellChanges]=useState<Record<string,'up'|'down'>>({});const cellChangesRef=useRef<Record<string,'up'|'down'>>({});const cellChangesTimer=useRef<number|undefined>(undefined);
  const applyRefreshedFunds=(next:Fund[],options:{silent?:boolean}={})=>{const previousByCode=new Map(fundsRef.current.map(fund=>[fund.code,fund]));const changes:Record<string,'up'|'down'>={};if(!options.silent){for(const fund of next){const previous=previousByCode.get(fund.code);if(!previous)continue;for(const [metricId,value] of Object.entries(fund.metrics??{})){const oldValue=previous.metrics?.[metricId];if(oldValue==null||value==null||!Number.isFinite(oldValue)||!Number.isFinite(value)||oldValue===value)continue;changes[`${fund.code}:${metricId}`]=value>oldValue?'up':'down';}}}fundsRef.current=next;setFunds(next);if(Object.keys(changes).length){const combined={...cellChangesRef.current,...changes};cellChangesRef.current=combined;if(cellChangesTimer.current!==undefined)window.clearTimeout(cellChangesTimer.current);setCellChanges(combined);cellChangesTimer.current=window.setTimeout(()=>{cellChangesRef.current={};setCellChanges({});},1000);}};
  const historyLock=useRef(false);const pauseHistoryRef=useRef(false);const autoAttemptedHistory=useRef<Set<number>>(new Set());const [historyRunning,setHistoryRunning]=useState(false);const [historyPaused,setHistoryPaused]=useState(false);const [historyPrefetchVersion,setHistoryPrefetchVersion]=useState(0);const [unavailableCodes,setUnavailableCodes]=useState<Set<number>>(()=>new Set());
  const hoverPrefetchTimer=useRef<number|undefined>(undefined);const hoverPrefetchAbort=useRef<AbortController|null>(null);
  const scheduleRowPrefetch=(code:number)=>{if(hoverPrefetchTimer.current!==undefined)window.clearTimeout(hoverPrefetchTimer.current);hoverPrefetchTimer.current=window.setTimeout(()=>{hoverPrefetchAbort.current?.abort();const controller=new AbortController();hoverPrefetchAbort.current=controller;void prefetchSchemeHistory(code,hostedWeb,controller.signal);},180);};
  const cancelRowPrefetch=()=>{if(hoverPrefetchTimer.current!==undefined){window.clearTimeout(hoverPrefetchTimer.current);hoverPrefetchTimer.current=undefined;}};
  const searchInput=useRef<HTMLInputElement>(null);
  const mainContentRef=useRef<HTMLElement>(null);
  const filterPanelRef=useRef<HTMLElement>(null);const filterToggleRef=useRef<HTMLButtonElement>(null);
  const screenOptionsRef=useRef<HTMLDivElement>(null);
  const sidebarPickerRef=useRef<HTMLDivElement>(null);
  const tableScrollRef=useRef<HTMLDivElement>(null);const tableFrame=useRef<number|undefined>(undefined);const [tableViewport,setTableViewport]=useState({top:0,height:680});
  const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('fundscope-theme')==='dark'?'dark':'light');
  const [panelOpen,setPanelOpen]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(min-width: 768px)').matches); const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const [screenerFilters,dispatchFilters]=useReducer(screenerReducer,defaultScreenerFilters);
  const engineClientRef=useRef<ScreenerEngineClient|null>(null);if(!engineClientRef.current)engineClientRef.current=new ScreenerEngineClient();
  const engineClient=engineClientRef.current;const latestQueryId=useRef(0);
  const appStartedAt=useRef<number|undefined>(undefined);if(appStartedAt.current===undefined&&isPerfEnabled())appStartedAt.current=performance.now();
  const [perfMeasurements,setPerfMeasurements]=useState(getPerfMeasurements);
  const firstRowsSent=useRef(false);const onFirstRowsRef=useRef(onFirstRows);onFirstRowsRef.current=onFirstRows;
  const [engineReady,setEngineReady]=useState(false);const [engineResult,setEngineResult]=useState<EngineQueryResult|null>(null);const [categoryTree,setCategoryTree]=useState<EngineCategoryTree[]>([]);const [filterUpdating,setFilterUpdating]=useState(false);const [engineError,setEngineError]=useState('');
  const search=screenerFilters.search; const plan=screenerFilters.plan.length===1?screenerFilters.plan[0]:'Both'; const option=screenerFilters.option.length===1?screenerFilters.option[0]:'All'; const structure=screenerFilters.structure.length===1?screenerFilters.structure[0]:'All'; const hideStaleNav=screenerFilters.hideStaleNav;
  const addedFilters=screenerFilters.metrics;
  const setSearch=(value:string)=>dispatchFilters({type:'patch',patch:{search:value}}); const setPlan=(value:string)=>dispatchFilters({type:'setFacet',facet:'plan',values:value==='Both'?[]:[value]}); const setOption=(value:string)=>dispatchFilters({type:'setFacet',facet:'option',values:value==='All'?[]:[value]}); const setStructure=(value:string)=>dispatchFilters({type:'setFacet',facet:'structure',values:value==='All'?[]:[value]}); const setHideStaleNav=(value:boolean)=>dispatchFilters({type:'patch',patch:{hideStaleNav:value}});
  const setArrayFacet=(facet:ArrayFacet,values:string[])=>{const options=filterResult.facets[facet];dispatchFilters({type:'setFacet',facet,values:collapseFacetSelection(values,options.filter(item=>!item.disabled).map(item=>item.value),options.map(item=>item.value))});};
  const setAddedFilters=(next:MetricFilter[]|((old:MetricFilter[])=>MetricFilter[]))=>dispatchFilters({type:'patch',patch:{metrics:typeof next==='function'?next(screenerFilters.metrics):next}});
  const [picker,setPicker]=useState(false); const [sidebarPicker,setSidebarPicker]=useState(false); const [pickerQuery,setPickerQuery]=useState(''); const [detail,setDetail]=useState<Fund|null>(null);
  const [visibleMetricIds,setVisibleMetricIds]=useState<string[]>(()=>{try{const saved=JSON.parse(localStorage.getItem('fundscope-visible-metrics')||'null');return Array.isArray(saved)&&saved.length?saved.filter((id):id is string=>typeof id==='string'):[...DEFAULT_TABLE_METRIC_IDS];}catch{return [...DEFAULT_TABLE_METRIC_IDS];}});
  const [scatterPreferences,setScatterPreferences]=useState<ScatterPreferences>(readScatterPreferences);
  const [scatterHydrated,setScatterHydrated]=useState(false);
  const [undoToast,setUndoToast]=useState(false);const undoFiltersRef=useRef<ScreenerFilters|null>(null);const undoFiltersTimer=useRef<number|undefined>(undefined);
  const loadedSnapshotDetails=useRef<Set<number>>(new Set());
  const [sort,setSort]=useState<{id:string;desc:boolean}>({id:'name',desc:false}); const [selected,setSelected]=useState<number[]>([]); const [density,setDensity]=useState<'comfortable'|'compact'>(()=>{const saved=localStorage.getItem('fundscope-density');return saved==='comfortable'||saved==='compact'?saved:window.matchMedia('(max-width: 767px)').matches?'compact':'comfortable';}); const [riskWindow,setRiskWindowRaw]=useState<1|3|5>(()=>{const value=Number(localStorage.getItem('fundscope-risk-window')||3);return value===1||value===5?value:3;});
  const [fetchedPct,setFetchedPct]=useState({done:0,total:0}); const [factors,setFactors]=useState<ScoreFactor[]>(initialFactors); const [peerGroup,setPeerGroup]=useState<PeerGroupMode>('subcategory'); const [scoreSavedAt,setScoreSavedAt]=useState<number|null>(null); const [modelName,setModelName]=useState('JPMC multi-factor model'); const [modelSaved,setModelSaved]=useState(false);const modelSavedTimer=useRef<number|undefined>(undefined);const riskFree=DEFAULT_RISK_FREE_RATE_PERCENT; const [activeModel,setActiveModel]=useState(false);
  const [savedModels,setSavedModels]=useState<ScoreModelPreset[]>(readSavedScoreModels);
  const [backendOp,setBackendOp]=useState<BackendOpState>(null);
  const [scoreSyncVersion,setScoreSyncVersion]=useState(0);
  const [aumStatus,setAumStatus]=useState(()=>localStorage.getItem('fundscope-amfi-aum-status')||'Not checked');const [terStatus,setTerStatus]=useState(()=>localStorage.getItem('fundscope-amfi-ter-status')||'Not checked');
  const historyNeeds=(fund:Fund)=>needsHistory(fund)&&!unavailableCodes.has(fund.code);
  const metricChangeClass=(code:number,metricId:string)=>{const direction=cellChanges[`${code}:${metricId}`];return direction?`cell-${direction}`:undefined;};
  const metricValueClass=(code:number,metricId:string,value:number|null|undefined)=>{const change=metricChangeClass(code,metricId);if(!RETURN_COLOR_METRIC_IDS.has(metricId)||value==null||!Number.isFinite(value)||value===0)return change;const tone=value>0?'val-pos':'val-neg';return change?`${tone} ${change}`:tone;};
  const snapshotCoverage=hostedWeb?(getUnlockedSnapshotManifest()?.coverage??null):null;
  const [savedScreens,setSavedScreens]=useState<string[]>(readSavedScreens);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('fundscope-theme',theme);const color=theme==='dark'?'#0b0f14':'#f7f8fa';document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta=>{meta.content=color;});},[theme]);
  useEffect(()=>{fundsRef.current=funds;},[funds]);
  useEffect(()=>{if(initialFunds===undefined)return;const enriched=initialFunds.map(fund=>ensureFundMetricsComputed(fund,riskWindow,riskFree));const scored=hydrateOrComputePersistentScores(enriched,factors,peerGroup);applyRefreshedFunds(scored,{silent:true});setDetail(current=>{if(!current)return null;const refreshed=scored.find(fund=>fund.code===current.code);return refreshed?ensureFundMetricsComputed({...current,...refreshed},riskWindow,riskFree):null;});},[initialFunds]);
  useEffect(()=>isPerfEnabled()?subscribePerfMeasurements(setPerfMeasurements):undefined,[]);
  useEffect(()=>{let alive=true;void getLocalState<ScatterPreferences|null>('scatter-preferences',null).then(saved=>{if(!alive)return;try{if(!localStorage.getItem('fundscope-scatter-preferences')&&saved)setScatterPreferences(parseScatterPreferences(saved)??defaultScatterPreferences);}catch{}setScatterHydrated(true);}).catch(()=>{if(alive)setScatterHydrated(true);});return()=>{alive=false;};},[]);
  useEffect(()=>{let alive=true;void getLocalState<ScoreModelPreset[]|null>('score-models-list',null).then(saved=>{if(!alive||!Array.isArray(saved)||!saved.length)return;setSavedModels(current=>{const customIds=new Set(current.filter(m=>!m.builtIn).map(m=>m.id));const merged=[...current.filter(m=>!m.builtIn)];for(const item of saved){const id=item.id||slugModelId(item.name);if(!customIds.has(id)){merged.push({...item,id,builtIn:false});customIds.add(id);}}for(const preset of PRESET_SCORE_MODELS){if(!customIds.has(preset.id)&&!merged.some(m=>normalizeFilterText(m.name)===normalizeFilterText(preset.name)))merged.push(preset);}return merged;});}).catch(()=>undefined);return()=>{alive=false;};},[]);
  useEffect(()=>{if(!scatterHydrated)return;try{localStorage.setItem('fundscope-scatter-preferences',JSON.stringify(scatterPreferences));}catch{}void setLocalState('scatter-preferences',scatterPreferences).catch(()=>undefined);},[scatterPreferences,scatterHydrated]);
  useEffect(()=>{localStorage.setItem('fundscope-density',density);},[density]);
  useEffect(()=>{try{localStorage.setItem('fundscope-visible-metrics',JSON.stringify(visibleMetricIds));}catch{}},[visibleMetricIds]);
  useEffect(()=>()=>{if(modelSavedTimer.current!==undefined)window.clearTimeout(modelSavedTimer.current);if(undoFiltersTimer.current!==undefined)window.clearTimeout(undoFiltersTimer.current);if(cellChangesTimer.current!==undefined)window.clearTimeout(cellChangesTimer.current);if(hoverPrefetchTimer.current!==undefined)window.clearTimeout(hoverPrefetchTimer.current);hoverPrefetchAbort.current?.abort();},[]);
  useEffect(()=>{const onKeyDown=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setRoute('screener');searchInput.current?.focus();}};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown);},[]);
  useEffect(()=>{if(!picker&&!sidebarPicker)return;const onPointerDown=(event:PointerEvent)=>{if(!(event.target instanceof Node))return;if(picker&&!screenOptionsRef.current?.contains(event.target))setPicker(false);if(sidebarPicker&&!sidebarPickerRef.current?.contains(event.target))setSidebarPicker(false);};const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){setPicker(false);setSidebarPicker(false);}};document.addEventListener('pointerdown',onPointerDown);window.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('keydown',onKeyDown);};},[picker,sidebarPicker]);
  const recomputeAll=(windowYears:number,rate:number)=>{void (async()=>{setBackendOp({title:`Recomputing ${windowYears}Y risk & benchmark metrics…`,subtitle:'Updating volatility, Sharpe, Sortino, and peer-normalized scores in background worker.',badge:'WORKER ENGINE'});await yieldToPaint();try{const updated=(await computeFundsInWorker(fundsRef.current.filter(fund=>fund.history.length>0),windowYears,rate,{fetchBenchmarkSeries:!hostedWeb})).map(fund=>({...fund,metricsNavAsOf:fund.history.at(-1)?.date}));const computedByCode=new Map(updated.map(fund=>[fund.code,fund]));const merged=fundsRef.current.map(fund=>computedByCode.get(fund.code)??fund);const peers=await computePeerMetricsInWorker(merged,factors,peerGroup);const {scores,modelHash}=computeScoreArray(peers,factors,peerGroup);await engineClient.updateScores(scores,modelHash).catch(()=>undefined);applyRefreshedFunds(peers);setScoreSyncVersion(v=>v+1);const saveStarted=startPerfMeasurement();void saveFundMetrics(peers).then(()=>finishPerfMeasurement('saveFunds after recomputeAll',saveStarted,`${peers.length.toLocaleString('en-IN')} metric rows`)).catch(()=>undefined);}finally{setBackendOp(null);}})();};
  const setRiskWindow=(value:number)=>{const next=value as 1|3|5;setRiskWindowRaw(next);localStorage.setItem('fundscope-risk-window',String(next));recomputeAll(next,riskFree);};
  useEffect(()=>{try{localStorage.removeItem('fundscope-risk-free');}catch{}},[]);
  const loadHistory=async(codes:number[],sourceFunds=funds,signal?:AbortSignal)=>{
    const requested=[...new Set(codes)];
    if(!requested.length||historyLock.current)return;
    historyLock.current=true;pauseHistoryRef.current=false;setHistoryPaused(false);setHistoryRunning(true);setHistoryError('');setFetchedPct({done:0,total:requested.length});
    try{
      const result=await loadSelectedHistories(requested,sourceFunds,{hostedWeb,riskWindow,riskFreeRate:riskFree,preserveExistingMetrics:true,onProgress:(done,total)=>setFetchedPct({done,total}),signal});
      if(result.loadedCodes.length){
        const fundsByCode=new Map(result.funds.map(fund=>[fund.code,ensureFundMetricsComputed(fund,riskWindow,riskFree)]));
        const nextFunds=fundsRef.current.map(fund=>fundsByCode.get(fund.code)??fund);
        applyRefreshedFunds(nextFunds,{silent:true});
        setDetail(current=>{if(!current)return null;const updated=fundsByCode.get(current.code);return updated?ensureFundMetricsComputed({...current,...updated},riskWindow,riskFree):current;});
      }
      if(signal?.aborted)return;
      const loaded=new Set(result.loadedCodes);const failed=new Map(result.failedCodes.map(item=>[item.code,item.reason]));
      setUnavailableCodes(current=>{const next=new Set(current);for(const code of loaded)next.delete(code);for(const code of failed.keys())next.add(code);return next;});
      if(failed.size){const firstReason=failed.values().next().value as string|undefined;setHistoryError(`${failed.size.toLocaleString('en-IN')} NAV ${failed.size===1?'history could not':'histories could not'} be loaded${firstReason?`: ${firstReason}`:'.'} You can retry the failed schemes.`);}
    }catch(error){
      if(signal?.aborted)return;
      const message=errorText(error);setHistoryError(`NAV history load failed: ${message}`);setUnavailableCodes(current=>new Set([...current,...requested]));
    }finally{historyLock.current=false;pauseHistoryRef.current=false;setHistoryPaused(false);setHistoryRunning(false);setHistoryPrefetchVersion(value=>value+1);}
  };
  useEffect(()=>{if(initialFunds!==undefined)return;let alive=true;(async()=>{try{await initializeRepository();const [cached,source,savedModel]=await Promise.all([getFunds(),sourceStatus(),getLocalState<SavedScoreModel|null>('score-model',null)]);if(!alive)return;const activeFactors=savedModel?.factors?.length?savedModel.factors:DEFAULT_SCORE_FACTORS;const activePeerGroup=savedModel?.peerGroup??'subcategory';if(savedModel?.factors?.length){setModelName(savedModel.name);setFactors(savedModel.factors);if(savedModel.peerGroup)setPeerGroup(savedModel.peerGroup);setScoreSavedAt(savedModel.savedAt);}const enrichedCached=cached.map(fund=>ensureFundMetricsComputed(fund,riskWindow,riskFree));const hasScores=hasCurrentPersistentScores(enrichedCached,activeFactors,activePeerGroup);const initialScored=hasScores?enrichedCached:hydrateOrComputePersistentScores(enrichedCached,activeFactors,activePeerGroup);setFunds(initialScored);setStatus(source);setIsLoading(false);setDbError(null);if(!hasScores&&initialScored.length>0){void saveFundMetrics(initialScored).catch(()=>undefined);}if(initialScored.some(fund=>fund.history.length>=2&&!hasAuthoritativeMetrics(fund,fund.history.at(-1)?.date))){void computePeerMetricsInWorker(initialScored,activeFactors,activePeerGroup).then(async peers=>{if(!alive)return;applyRefreshedFunds(peers,{silent:true});await saveFundMetrics(peers);}).catch(()=>undefined);}if(!hostedWeb){const cacheIsFresh=initialScored.length>0&&source.fetchedAt!==null&&Date.now()-source.fetchedAt<12*3_600_000;if(!cacheIsFresh){void refresh();}void waitForNormalizedStorage().then(async ready=>{if(!alive||!ready||refreshLock.current||initialScored.length>0)return;const latest=(await getFunds()).map(fund=>ensureFundMetricsComputed(fund,riskWindow,riskFree));if(alive&&!refreshLock.current&&latest.length>0)setFunds(hydrateOrComputePersistentScores(latest,activeFactors,activePeerGroup));});}}catch(e){if(alive){console.error('App initialization failed:',e);setIsLoading(false);setDbError(errorText(e));setRefreshError(errorText(e));}}})();return()=>{alive=false;};},[initialFunds]);
  useEffect(()=>{if(initialFunds===undefined)return;let alive=true;const timer=window.setTimeout(()=>{void getLocalState<SavedScoreModel|null>('score-model',null).then(saved=>{if(alive&&saved?.factors?.length){const nextPeerGroup=saved.peerGroup??'subcategory';setModelName(saved.name);setFactors(saved.factors);setPeerGroup(nextPeerGroup);setScoreSavedAt(saved.savedAt);if(!hasCurrentPersistentScores(fundsRef.current,saved.factors,nextPeerGroup)){const scored=hydrateOrComputePersistentScores(fundsRef.current,saved.factors,nextPeerGroup);applyRefreshedFunds(scored,{silent:true});void saveFundMetrics(scored).catch(()=>undefined);}}}).catch(()=>undefined);},750);return()=>{alive=false;window.clearTimeout(timer);};},[initialFunds]);
  const refresh=async()=>{
    if(hostedWeb){setRefreshError('This hosted data snapshot refreshes automatically each night.');return;}
    if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);setRefreshError('');setRefreshStage('Connecting to AMFI…');
    try{
      const result=await refreshCatalog(riskWindow,riskFree,setRefreshStage);const withOverrides=await applyLocalDisclosureOverrides(result.funds);const staleMetrics=withOverrides.filter(fund=>fund.history.length>0&&(fund.metricsNavAsOf!==fund.history.at(-1)?.date||fund.metricProvenance?.beta!=='BENCHMARK_PROXY'));const recalculated=staleMetrics.length?await computeFundsInWorker(staleMetrics,riskWindow,riskFree):[];const recalculatedByCode=new Map(recalculated.map(fund=>[fund.code,{...fund,metricsNavAsOf:fund.history.at(-1)?.date}]));const prepared=withOverrides.map(fund=>ensureFundMetricsComputed(recalculatedByCode.get(fund.code)??fund,riskWindow,riskFree));const computed=await computePeerMetricsInWorker(prepared,factors,peerGroup);const {scores,modelHash}=computeScoreArray(computed,factors,peerGroup);writePersistedScoreCache(modelHash,scores,computed,Date.now());await saveFundMetrics(computed);setScoreSavedAt(Date.now());applyRefreshedFunds(computed);setStatus(await sourceStatus());
      void (async()=>{
        let latest=computed;let changed=false;
        try{setAumStatus('Fetching latest published AAUM…');const aum=await ingestLatestAmfiAverageAum(latest);latest=aum.updated;if(aum.records){changed=true;setAumStatus(`${aum.period} · ${aum.records.toLocaleString('en-IN')} scheme AAUM values`);}else setAumStatus(localStorage.getItem('fundscope-amfi-aum-status')||`${aum.period} · AAUM already current`);}
        catch(error){setAumStatus(`Needs attention: ${errorText(error)}`);}
        try{const ter=await ingestCurrentMonthAmfiTer(latest,(done,total)=>setTerStatus(`Fetching current-month AMFI TER · ${done}/${total} AMCs`));latest=ter.updated;if(ter.records){changed=true;const message=ter.failed?`${ter.month} · ${ter.records.toLocaleString('en-IN')} TER values · ${ter.failed} AMC requests failed`:`${ter.month} · ${ter.records.toLocaleString('en-IN')} scheme-plan TER values`;setTerStatus(message);if(!ter.failed)localStorage.setItem('fundscope-amfi-ter-status',message);}else if(localStorage.getItem('fundscope-amfi-ter-status'))setTerStatus(localStorage.getItem('fundscope-amfi-ter-status')!);}
        catch(error){setTerStatus(`Needs attention: ${errorText(error)}`);}
        if(changed)applyRefreshedFunds(latest,{silent:true});
      })();
    }catch(error){setRefreshError(errorText(error));setStatus(await sourceStatus().catch(()=>status));}
    finally{setRefreshing(false);setRefreshStage('');refreshLock.current=false;}
  };
  useEffect(()=>()=>engineClient.terminate(),[engineClient]);
  useEffect(()=>{let alive=true;setEngineReady(false);engineClient.load(funds,getFundIndexBuffer(funds)).then(index=>{if(!alive)return;setCategoryTree(index.categoryTree);setEngineReady(true);setEngineError('');}).catch(error=>{if(alive){setEngineReady(false);setEngineError(errorText(error));}});return()=>{alive=false;};},[engineClient,funds]);
  useEffect(()=>{if(!engineReady)return;let alive=true;setFilterUpdating(true);const expected=++latestQueryId.current;engineClient.query(screenerFilters,sort,Date.now(),activeModel?factors:[]).then(({result})=>{if(!alive||expected!==latestQueryId.current)return;setEngineResult(result);setFilterUpdating(false);setEngineError('');if(!firstRowsSent.current){firstRowsSent.current=true;finishPerfMeasurement('time to first result window',appStartedAt.current,`${result.indices.length.toLocaleString('en-IN')} matching rows`);performance.mark?.('unlock.firstRows');onFirstRowsRef.current?.();}}).catch(error=>{if(alive&&expected===latestQueryId.current){setFilterUpdating(false);setEngineError(errorText(error));}});return()=>{alive=false;};},[engineClient,engineReady,screenerFilters,sort,activeModel,factors,peerGroup,scoreSyncVersion]);
  const filterResult=useMemo(()=>engineResult?{rows:[],funnel:engineResult.funnel,facets:facetOptionsFromCounts(engineResult.facets)}:computeScreenerView([],screenerFilters),[engineResult,screenerFilters]);
  const categoryOptions=filterResult.facets.categories;
  const amcOptions=filterResult.facets.amcs;
  const assetClassOptions=filterResult.facets.assetClasses;
  const statusOptions=filterResult.facets.statuses;
  const categoryCounts=useMemo(()=>Object.fromEntries(categoryOptions.map(item=>[item.value,item.count])),[categoryOptions]);
  const amcs=useMemo(()=>amcOptions.map(item=>item.value),[amcOptions]);
  const amcCounts=useMemo(()=>Object.fromEntries(amcOptions.map(item=>[item.value,item.count])),[amcOptions]);
  const assetClassCounts=useMemo(()=>Object.fromEntries(assetClassOptions.map(item=>[item.value,item.count])),[assetClassOptions]);
  const classificationStatusCounts=useMemo(()=>Object.fromEntries(statusOptions.map(item=>[item.value,item.count])),[statusOptions]);
  const facetData=useMemo(()=>Object.fromEntries(arrayFacets.map(facet=>{const options=filterResult.facets[facet];return [facet,{values:options.map(item=>item.value),counts:Object.fromEntries(options.map(item=>[item.value,item.count]))}];})),[filterResult.facets]) as Record<ArrayFacet,{values:string[];counts:Record<string,number>}>;
  const countsForFacet=(facet:ArrayFacet)=>facetData[facet].counts;
  const valuesForFacet=(facet:ArrayFacet)=>facetData[facet].values;
  const matchIndices=engineResult?.indices??EMPTY_INDICES;
  const matchedCount=engineResult?.total??0;
  const scopedFunds=useMemo(()=>route==='health'||route==='compare'||route==='score'?Array.from(matchIndices,index=>funds[index]).filter((fund):fund is Fund=>Boolean(fund)):[],[route,matchIndices,funds]);
  const filtered=scopedFunds;
  // Scoring ranks each factor across the entire filtered universe. Keep that work
  // off the normal screener path: most users are sorting raw metrics, not scores.
  const scores=engineResult?.scores;
  const tableMetrics=useMemo(()=>{
    const ids=new Set<string>(visibleMetricIds);
    for(const filter of addedFilters)ids.add(filter.id);
    return [...ids].flatMap(id=>{const metric=metricRegistry.find(item=>item.id===id);return metric?[metric]:[];});
  },[visibleMetricIds,addedFilters]);
  const tableColumnCount=4+tableMetrics.length+Number(activeModel);
  const hasActiveFilters=activeFacetCount(screenerFilters)>0;
  const activeFilterCount=activeFacetCount(screenerFilters);
  const hasAdvancedFilters=screenerFilters.philosophies.length>0||screenerFilters.specialities.length>0||screenerFilters.statuses.length>0||screenerFilters.structure.length!==defaultScreenerFilters.structure.length||screenerFilters.lifecycle.length!==defaultScreenerFilters.lifecycle.length;
  const appliedFilters=useMemo<AppliedFilter[]>(()=>{
    const result:AppliedFilter[]=[];
    const addFacet=(id:string,label:string,values:readonly string[],defaults:readonly string[]=[])=>{
      if(values.length===defaults.length&&values.every((value,index)=>value===defaults[index]))return;
      if(!values.length)return;
      result.push({id,label,values:values.map(value=>({key:value,label:checklistLabel(label,value)}))});
    };
    addFacet('management','Management',screenerFilters.management);
    addFacet('structure','Structure',screenerFilters.structure,defaultScreenerFilters.structure);
    addFacet('assetClasses','Asset',screenerFilters.assetClasses);
    addFacet('riskBands','Risk · category-implied',screenerFilters.riskBands);
    addFacet('philosophies','Philosophy',screenerFilters.philosophies);
    addFacet('specialities','Speciality',screenerFilters.specialities);
    addFacet('groups','Category group',screenerFilters.groups);
    addFacet('categories','Categories',screenerFilters.categories);
    addFacet('amcs','Fund houses',screenerFilters.amcs);
    addFacet('statuses','Classification',screenerFilters.statuses);
    addFacet('lifecycle','Lifecycle',screenerFilters.lifecycle,defaultScreenerFilters.lifecycle);
    addFacet('plan','Plan',screenerFilters.plan,defaultScreenerFilters.plan);
    addFacet('option','Option',screenerFilters.option,defaultScreenerFilters.option);
    if(!screenerFilters.structure.length&&defaultScreenerFilters.structure.length)result.push({id:'structure',label:'Structure',values:[{key:'__all',label:'All structures'}]});
    if(!screenerFilters.plan.length&&defaultScreenerFilters.plan.length)result.push({id:'plan',label:'Plan',values:[{key:'__all',label:'Both plans'}]});
    if(!screenerFilters.lifecycle.length&&defaultScreenerFilters.lifecycle.length)result.push({id:'lifecycle',label:'Lifecycle',values:[{key:'__all',label:'All lifecycle states'}]});
    if(screenerFilters.search.trim())result.push({id:'search',label:'Search',values:[{key:screenerFilters.search,label:screenerFilters.search.trim()}]});
    if(screenerFilters.hideStaleNav)result.push({id:'hideStaleNav',label:'NAV freshness',values:[{key:'stale',label:'Hide stale NAV (>10 days)'}]});
    for(const filter of screenerFilters.metrics){const metric=metricRegistry.find(item=>item.id===filter.id);if(!metric)continue;const active=filter.min!==null||filter.max!==null||filter.excludeMissing;const range=formatRangeChip(metric.label,filter,metric.unit);result.push({id:`metric:${filter.id}`,label:metric.label,values:[],rangeText:active?(filter.min===null&&filter.max===null?`${metric.label}: Exclude missing values`:filter.excludeMissing?`${range} · exclude missing`:range):`${metric.label}: Any value`});}
    return result;
  },[screenerFilters]);
  const resetFilters=()=>{dispatchFilters({type:'reset'});setUndoToast(false);};
  const zeroFunnelStep=filterResult.funnel.find(step=>step.remaining===0)?.step;
  const removeZeroStep=()=>{if(!zeroFunnelStep)return;const facetByStep:Record<string,ArrayFacet>={'Management':'management','Structure':'structure','Asset':'assetClasses','Risk (category-implied)':'riskBands','Investment philosophy':'philosophies','Investment speciality':'specialities','Category group':'groups','Category':'categories','Fund house':'amcs','Classification status':'statuses','Lifecycle':'lifecycle'};const facet=facetByStep[zeroFunnelStep];if(facet){setArrayFacet(facet,[]);return;}if(zeroFunnelStep==='Plan'){setPlan('Both');return;}if(zeroFunnelStep==='Option'){setOption('All');return;}if(zeroFunnelStep==='NAV freshness'){setHideStaleNav(false);return;}if(zeroFunnelStep==='Metrics'){setAddedFilters([]);return;}if(zeroFunnelStep==='Search')setSearch('');};
  const catalogStale=status.dataAsOf!==null&&Number.isFinite(status.dataAsOf)&&Date.now()-status.dataAsOf>10*86_400_000;
  useEffect(()=>{if(!['name','category','nav','navDate','score'].includes(sort.id)&&!tableMetrics.some(metric=>metric.id===sort.id))setSort({id:'cagr_3y',desc:true});},[sort.id,tableMetrics]);
  useEffect(()=>{
    const element=tableScrollRef.current;
    if(!element)return;
    const syncHeight=()=>setTableViewport(current=>current.height===element.clientHeight?current:{top:element.scrollTop,height:Math.max(320,element.clientHeight)});
    syncHeight();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(syncHeight);
    observer.observe(element);
    return()=>observer.disconnect();
  },[route]);
  const rowHeight=density==='compact'?36:48;const virtualStart=Math.max(0,Math.floor(Math.max(0,tableViewport.top-36)/rowHeight)-VIRTUAL_OVERSCAN);const virtualEnd=Math.min(matchedCount,Math.ceil((tableViewport.top+tableViewport.height)/rowHeight)+VIRTUAL_OVERSCAN);const rowItems=useMemo(()=>{const items:Array<{fund:Fund;score:number|null;index:number}>=[];for(let position=virtualStart;position<virtualEnd;position++){const index=matchIndices[position]!;const fund=funds[index];if(fund){const value=scores?.[index];items.push({fund,score:value!==undefined&&Number.isFinite(value)?value:null,index});}}return items;},[funds,matchIndices,scores,virtualStart,virtualEnd]);const onTableScroll=(event:React.UIEvent<HTMLDivElement>)=>{const target=event.currentTarget;if(tableFrame.current!==undefined)cancelAnimationFrame(tableFrame.current);tableFrame.current=requestAnimationFrame(()=>setTableViewport({top:target.scrollTop,height:target.clientHeight}));};
  const queryResetKey=useMemo(()=>JSON.stringify({screenerFilters,sort,activeModel}),[screenerFilters,sort,activeModel]);
  useEffect(()=>{tableScrollRef.current?.scrollTo({top:0,behavior:'instant' as ScrollBehavior});setTableViewport(current=>({...current,top:0}));},[queryResetKey]);
  const addFilter=(id:string)=>{setAddedFilters(old=>old.some(f=>f.id===id)?old:[...old,{id,min:null,max:null,excludeMissing:false}]);setVisibleMetricIds(old=>old.includes(id)?old:[...old,id]);setPicker(false);setSidebarPicker(false);setPickerQuery('');};
  const toggleVisibleMetric=(id:string)=>{setVisibleMetricIds(old=>old.includes(id)?(old.length>1?old.filter(item=>item!==id):old):[...old,id]);};
  const removeFilter=(id:string)=>setAddedFilters(old=>old.filter(f=>f.id!==id));
  const matchCatalogCategories=(patterns:readonly string[])=>{
    const allCats=categoryOptions.map(item=>item.value);
    const matched=allCats.filter(cat=>patterns.some(p=>normalizeFilterText(cat).includes(normalizeFilterText(p))));
    return matched.length?matched:[...patterns];
  };
  const applyQuickPreset=(preset:'all'|'large'|'flexi'|'mid_small'|'passive'|'elss'|'debt'|'high_cagr'|'high_sharpe')=>{
    if(preset==='all'){resetFilters();setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='large'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,assetClasses:['equity'],categories:matchCatalogCategories(['Large Cap'])}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='flexi'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,assetClasses:['equity'],categories:matchCatalogCategories(['Flexi Cap','Multi Cap'])}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='mid_small'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,assetClasses:['equity'],categories:matchCatalogCategories(['Mid Cap','Small Cap'])}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='passive'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,management:['Passive']}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='elss'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,categories:matchCatalogCategories(['ELSS','Tax'])}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='debt'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,assetClasses:['debt','liquid']}});setSort({id:'cagr_1y',desc:true});return;}
    if(preset==='high_cagr'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,metrics:[{id:'cagr_3y',min:15,max:null,excludeMissing:true}]}});setSort({id:'cagr_3y',desc:true});return;}
    if(preset==='high_sharpe'){dispatchFilters({type:'patch',patch:{...defaultScreenerFilters,metrics:[{id:'sharpe',min:1,max:null,excludeMissing:true}]}});setSort({id:'sharpe',desc:true});}
  };
  const removeAppliedValue=(id:string,valueKey:string)=>{
    if(id==='search'){setSearch('');return;}
    if(id==='hideStaleNav'){setHideStaleNav(false);return;}
    if(id.startsWith('metric:')){removeFilter(id.slice('metric:'.length));return;}
    if(arrayFacets.includes(id as ArrayFacet)){
      const facet=id as ArrayFacet;const current=screenerFilters[facet];
      const next=valueKey==='__all'?[]:current.filter(value=>value!==valueKey);
      setArrayFacet(facet,next.length?next:defaultScreenerFilters[facet]);
    }
  };
  const clearAppliedFilter=(id:string)=>{
    if(id==='search'){setSearch('');return;}
    if(id==='hideStaleNav'){setHideStaleNav(false);return;}
    if(id.startsWith('metric:')){removeFilter(id.slice('metric:'.length));return;}
    if(arrayFacets.includes(id as ArrayFacet)){const facet=id as ArrayFacet;setArrayFacet(facet,defaultScreenerFilters[facet]);}
  };
  const clearAllWithUndo=()=>{
    undoFiltersRef.current={...screenerFilters,metrics:screenerFilters.metrics.map(filter=>({...filter}))};
    dispatchFilters({type:'reset'});setUndoToast(true);
    if(undoFiltersTimer.current!==undefined)window.clearTimeout(undoFiltersTimer.current);
    undoFiltersTimer.current=window.setTimeout(()=>{undoFiltersRef.current=null;setUndoToast(false);},5000);
  };
  const undoClearAll=()=>{if(!undoFiltersRef.current)return;dispatchFilters({type:'patch',patch:undoFiltersRef.current});undoFiltersRef.current=null;setUndoToast(false);if(undoFiltersTimer.current!==undefined)window.clearTimeout(undoFiltersTimer.current);};
  const updateFilter=(id:string,side:'min'|'max',value:string)=>{const trimmed=value.trim();const parsed=trimmed===''?null:Number(trimmed);if(parsed!==null&&!Number.isFinite(parsed))return;setAddedFilters(old=>old.map(f=>f.id===id?{...f,[side]:parsed}:f));};
  const setFilterPresetRange=(id:string,min:number|null,max:number|null)=>{setAddedFilters(old=>old.map(f=>f.id===id?{...f,min,max,excludeMissing:min!==null||max!==null?true:f.excludeMissing}:f));};
  const sortBy=(id:string)=>setSort(old=>({id,desc:old.id===id?!old.desc:(id==='name'||id==='category'?false:metricRegistry.find(m=>m.id===id)?.direction==='lower'?false:true)}));
  const toggleSelected=(code:number)=>setSelected(old=>old.includes(code)?old.filter(c=>c!==code):old.length>=6?old:[...old,code]);
  const saveScreen=()=>{const name=window.prompt('Name this screen','New screen');if(!name)return;const entry=JSON.stringify({version:5,name,filters:screenerFilters,sort,density,riskWindow,scatter:scatterPreferences});const next=[entry,...savedScreens];setSavedScreens(next);localStorage.setItem('fundscope-screens',JSON.stringify(next));};
  const persistAndSyncModel=async(targetName:string,targetFactors:ScoreFactor[],targetPeerGroup:PeerGroupMode,opTitle:string,opSubtitle:string)=>{
    const cleanName=targetName.trim()||'Untitled model';
    const cleanFactors=targetFactors.map(factor=>({...factor}));
    const now=Date.now();
    setBackendOp({title:opTitle,subtitle:opSubtitle,badge:'SCORE ENGINE'});
    await yieldToPaint();
    try{
      const {scores,modelHash}=computeScoreArray(fundsRef.current,cleanFactors,targetPeerGroup);
      await engineClient.updateScores(scores,modelHash).catch(()=>undefined);
      const scored=applyPersistentScores(fundsRef.current,cleanFactors,targetPeerGroup,{scores,modelHash});
      applyRefreshedFunds(scored,{silent:true});
      writePersistedScoreCache(modelHash,scores,fundsRef.current,now);
      const savedEntry:ScoreModelPreset={
        id:slugModelId(cleanName),
        name:cleanName,
        description:`${cleanFactors.length} factors · ${targetPeerGroup==='subcategory'?'AMFI Sub-category peers':targetPeerGroup==='category_plan'?'Sub-category + Plan':'Whole universe'}`,
        peerGroup:targetPeerGroup,
        factors:cleanFactors,
        builtIn:false,
        savedAt:now,
        dataAsOf:status.dataAsOf,
      };
      setSavedModels(current=>{
        const filtered=current.filter(m=>m.id!==savedEntry.id&&normalizeFilterText(m.name)!==normalizeFilterText(savedEntry.name));
        const next=[savedEntry,...filtered];
        persistCustomScoreModels(next);
        return next;
      });
      const savedState:SavedScoreModel={id:savedEntry.id,name:cleanName,factors:cleanFactors,peerGroup:targetPeerGroup,savedAt:now,dataAsOf:status.dataAsOf};
      void setLocalState('score-model',savedState).catch(()=>undefined);
      void saveFundMetrics(scored).catch(()=>undefined);
      setModelName(cleanName);
      setFactors(cleanFactors);
      setPeerGroup(targetPeerGroup);
      setScoreSavedAt(now);
      setScoreSyncVersion(v=>v+1);
      setModelSaved(true);
      if(modelSavedTimer.current!==undefined)window.clearTimeout(modelSavedTimer.current);
      modelSavedTimer.current=window.setTimeout(()=>setModelSaved(false),2400);
      return true;
    }catch(error){
      setRefreshError(`Could not save score model: ${errorText(error)}`);
      return false;
    }finally{
      setBackendOp(null);
    }
  };
  const saveModel=async(customName?:string)=>{
    const nameToSave=customName??modelName;
    await persistAndSyncModel(
      nameToSave,
      factors,
      peerGroup,
      `Saving "${nameToSave.trim()||'Untitled model'}" & persisting scores…`,
      `Computing peer-normalized percentile + robust z-scores across ${fundsRef.current.length.toLocaleString('en-IN')} schemes and locking model to local storage.`
    );
  };
  const saveAsNewModel=async()=>{
    const suggested=`${modelName.trim()||'Custom model'} (Copy)`;
    const prompted=window.prompt('Name for the new score model:',suggested);
    if(!prompted||!prompted.trim())return;
    await saveModel(prompted.trim());
  };
  const loadModelPreset=(preset:ScoreModelPreset)=>{
    setModelName(preset.name);
    setFactors(preset.factors.map(f=>({...f})));
    setPeerGroup(preset.peerGroup);
    if(preset.savedAt)setScoreSavedAt(preset.savedAt);
  };
  const deleteSavedModel=(id:string)=>{
    setSavedModels(current=>{
      const next=current.filter(m=>m.id!==id||m.builtIn);
      persistCustomScoreModels(next);
      return next;
    });
  };
  const applyModelToScreener=async(preset?:ScoreModelPreset)=>{
    const targetName=preset?preset.name:modelName;
    const targetFactors=preset?preset.factors.map(f=>({...f})):factors;
    const targetPeerGroup=preset?preset.peerGroup:peerGroup;
    if(preset){
      setModelName(targetName);
      setFactors(targetFactors);
      setPeerGroup(targetPeerGroup);
    }
    const alreadySavedAndCurrent=hasCurrentPersistentScores(fundsRef.current,targetFactors,targetPeerGroup)&&savedModels.some(m=>normalizeFilterText(m.name)===normalizeFilterText(targetName)&&scoreFactorsSignature(m.factors,m.peerGroup)===scoreFactorsSignature(targetFactors,targetPeerGroup));
    if(!alreadySavedAndCurrent){
      await persistAndSyncModel(
        targetName,
        targetFactors,
        targetPeerGroup,
        `Computing & saving "${targetName.trim()||'Untitled model'}" for Screener…`,
        `Scores were not saved for this model configuration — computing and persisting across ${fundsRef.current.length.toLocaleString('en-IN')} schemes now.`
      );
    }else{
      const targetHash=scoreFactorsSignature(targetFactors,targetPeerGroup);
      const scores=new Float32Array(fundsRef.current.length).fill(Number.NaN);
      for(let i=0;i<fundsRef.current.length;i++){
        const v=fundsRef.current[i]?.metrics?.[SCORE_METRIC_ID];
        if(typeof v==='number'&&Number.isFinite(v))scores[i]=v;
      }
      await engineClient.updateScores(scores,targetHash).catch(()=>undefined);
      setScoreSyncVersion(v=>v+1);
    }
    flushSync(()=>{
      setActiveModel(true);
      setSort({id:'score',desc:true});
    });
    nav('screener');
  };
  const exportCsv=()=>exportRows(Array.from(matchIndices,index=>funds[index]).filter((fund):fund is Fund=>Boolean(fund)),status);
  const requestBackfill=async(batchSize=100)=>{const todo:number[]=[];for(const index of matchIndices){const fund=funds[index];if(fund&&historyNeeds(fund))todo.push(fund.code);if(todo.length>=batchSize)break;}await loadHistory(todo,funds);};
  const retryHistory=(codes:number[])=>{const retry=[...new Set(codes)];if(!retry.length||historyRunning)return;for(const code of retry)autoAttemptedHistory.current.delete(code);setUnavailableCodes(current=>{const next=new Set(current);for(const code of retry)next.delete(code);return next;});setHistoryError('');void loadHistory(retry,funds);};
  /** Smart On-Demand History Loading (Zerodha Coin / Groww pattern):
   *  Full NAV history is fetched automatically ONLY when the user opens a Fund Drawer
   *  or compares selected schemes on the Compare chart. Table scrolling never triggers
   *  background network floods or metric recalculation churn.
   */
  useEffect(()=>{
    if(isLoading||!engineReady||historyLock.current||!funds.length)return;
    let candidates:Fund[]=[];
    if(detail)candidates=[funds.find(fund=>fund.code===detail.code)??detail];
    else if(route==='compare')candidates=funds.filter(fund=>selected.includes(fund.code));
    const todo=candidates.filter(fund=>(needsHistory(fund)||!hasAuthoritativeMetrics(fund,fund.history.at(-1)?.date))&&!unavailableCodes.has(fund.code)&&!autoAttemptedHistory.current.has(fund.code)).map(fund=>fund.code);
    if(!todo.length)return;
    const delayMs=0;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      todo.forEach(code=>autoAttemptedHistory.current.add(code));
      void loadHistory(todo,fundsRef.current,controller.signal);
    },delayMs);
    return()=>{window.clearTimeout(timer);controller.abort();todo.forEach(code=>autoAttemptedHistory.current.delete(code));};
  },[isLoading,engineReady,historyRunning,route,selected,detail?.code,detail?.history.length,unavailableCodes,historyPrefetchVersion]);
  useEffect(()=>{if(!detail)return;if(hostedWeb){if(loadedSnapshotDetails.current.has(detail.code))return;loadedSnapshotDetails.current.add(detail.code);const controller=new AbortController();void loadSnapshotDetails([detail.code],controller.signal).then(details=>{if(controller.signal.aborted)return;const extra=details.get(detail!.code);if(!extra)return;setFunds(current=>current.map(fund=>fund.code===detail!.code?ensureFundMetricsComputed({...fund,...extra},riskWindow,riskFree):fund));setDetail(current=>current?.code===detail!.code?ensureFundMetricsComputed({...current,...extra},riskWindow,riskFree):current);}).catch(error=>{if(!controller.signal.aborted)setRefreshError(errorText(error));});return()=>{controller.abort();loadedSnapshotDetails.current.delete(detail.code);};}let alive=true;void loadFundDetails(detail.code).then(extra=>{if(!alive)return;setFunds(current=>current.map(fund=>fund.code===detail!.code?ensureFundMetricsComputed({...fund,...extra},riskWindow,riskFree):fund));setDetail(current=>current?.code===detail!.code?ensureFundMetricsComputed({...current,...extra},riskWindow,riskFree):current);}).catch(error=>setRefreshError(errorText(error)));return()=>{alive=false;};},[detail?.code,hostedWeb]);
  const toggleHistoryPause=()=>{if(!historyRunning)return;const next=!historyPaused;pauseHistoryRef.current=next;setHistoryPaused(next);};
  const searchShortcut=typeof navigator!=='undefined'&&/Mac|iPhone|iPad|iPod/i.test(navigator.platform)?'⌘ K':'Ctrl K';
  const nav=(r:Route)=>{const applyRoute=()=>{setRoute(r);setDetail(null);setMobileNavOpen(false);mainContentRef.current?.scrollTo({top:0,behavior:'instant' as ScrollBehavior});};if(r===route){setDetail(null);setMobileNavOpen(false);return;}const transitionDocument=document as Document & {startViewTransition?: (callback:()=>void)=>unknown};if(!transitionDocument.startViewTransition||window.matchMedia('(prefers-reduced-motion: reduce)').matches){applyRoute();return;}try{transitionDocument.startViewTransition(()=>{flushSync(applyRoute);});}catch{applyRoute();}};
  useEffect(()=>{if(!mobileNavOpen)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileNavOpen(false);};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown);},[mobileNavOpen]);
  useEffect(()=>{if(!panelOpen||!window.matchMedia('(max-width: 767px)').matches)return;const panel=filterPanelRef.current;if(!panel)return;const focusable=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(element=>element.offsetParent!==null);focusable()[0]?.focus();const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setPanelOpen(false);filterToggleRef.current?.focus();return;}if(event.key!=='Tab')return;const items=focusable();if(!items.length)return;const first=items[0]!,last=items[items.length-1]!;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown);},[panelOpen]);
  const activeBlockingOp:BackendOpState=backendOp
    ||(refreshing?{title:'Refreshing AMFI mutual fund catalog…',subtitle:refreshStage||'Downloading latest NAVs, computing risk metrics, and updating persistent model scores.',badge:'AMFI CATALOG'}:null)
    ||(isLoading&&!funds.length?{title:'Initializing FundScope repository…',subtitle:'Hydrating scheme catalog, benchmark mappings, and saved score models.',badge:'LOCAL ENGINE'}:null);
  const activeBackgroundText=historyRunning
    ?`Loading NAV histories (${fetchedPct.done}/${fetchedPct.total||'…'})`
    :/^Fetching/i.test(aumStatus)?aumStatus
    :/^Fetching/i.test(terStatus)?terStatus
    :null;
  return <div className="app-shell">
    {isPerfEnabled()&&<aside className="fundscope-perf-hud"><b>Startup and data path · ?perf=1</b>{perfMeasurements.length?perfMeasurements.map(item=><span key={item.name}>{item.name}: {item.milliseconds.toFixed(1)} ms{item.detail?` · ${item.detail}`:''}</span>):<span>Waiting for measured operations…</span>}</aside>}
    <header className="topbar">
      <button type="button" className="icon-button mobile-menu-trigger" aria-label={mobileNavOpen?'Close navigation':'Open navigation'} aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={()=>setMobileNavOpen(value=>!value)}>{mobileNavOpen?<X size={19}/>:<Menu size={19}/>}</button>
      <button className="brand" onClick={()=>nav('screener')} aria-label="FundScope home"><span className="brand-icon"><Activity size={17}/></span><span>Fund<span className="brand-light">Scope</span></span><span className="local-tag">{hostedWeb?'WEB':'LOCAL'}</span></button>
      <div className="top-search"><Search size={15}/><input ref={searchInput} value={search} onChange={e=>{setSearch(e.target.value);nav('screener');}} placeholder="Search funds, AMCs, categories…"/><kbd>{searchShortcut}</kbd></div>
            <div className="top-actions"><button className={`freshness ${status.status==='ok'?'fresh':refreshing?'updating':status.status==='error'?'error':'muted'}`} onClick={()=>nav('health')}><span className="status-dot"/>{refreshing?'Updating…':status.dataAsOf?`Data as of ${formatEpochMs(status.dataAsOf)}`:'No local data'}<span className="fresh-divider"/>{status.fetchedAt?`Fetched ${timestampText(status.fetchedAt)}`:'Never refreshed'}</button>{!hostedWeb&&<button className="icon-button refresh-button" onClick={()=>void refresh()} disabled={refreshing} title="Refresh catalog"><RefreshCw size={16} className={refreshing?'spin':''}/></button>}<button className="icon-button" onClick={()=>setTheme(theme==='light'?'dark':'light')} title="Toggle theme">{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button></div>
    </header>
    {mobileNavOpen&&<button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={()=>setMobileNavOpen(false)}/>}
    <div className="workspace">
      <aside id="main-navigation" className={`nav-rail${mobileNavOpen?' mobile-open':''}`} aria-label="Main navigation">
        <NavButton icon={<SlidersHorizontal size={18}/>} label="Screener" active={route==='screener'} onClick={()=>nav('screener')}/><NavButton icon={<GitCompareArrows size={18}/>} label="Compare" badge={selected.length||undefined} active={route==='compare'} onClick={()=>nav('compare')}/><NavButton icon={<Gauge size={18}/>} label="Score Lab" active={route==='score'} onClick={()=>nav('score')}/><div className="rail-spacer"/><NavButton icon={<Database size={18}/>} label="Data health" active={route==='health'} onClick={()=>nav('health')}/><NavButton icon={<ShieldCheck size={18}/>} label="Classification" active={route==='governance'} onClick={()=>nav('governance')}/><NavButton icon={<Settings2 size={18}/>} label="Settings" active={route==='settings'} onClick={()=>nav('settings')}/><div className="rail-help">?<span>Keyboard shortcuts</span></div>
      </aside>
      <nav className="mobile-tabbar" aria-label="Mobile navigation"><NavButton icon={<SlidersHorizontal size={18}/>} label="Screener" active={route==='screener'} onClick={()=>nav('screener')}/><NavButton icon={<GitCompareArrows size={18}/>} label="Compare" badge={selected.length||undefined} active={route==='compare'} onClick={()=>nav('compare')}/><NavButton icon={<Gauge size={18}/>} label="Score" active={route==='score'} onClick={()=>nav('score')}/><NavButton icon={<Database size={18}/>} label="Health" active={route==='health'} onClick={()=>nav('health')}/><button className="nav-item" onClick={()=>setMobileNavOpen(true)} aria-label="More navigation"><span className="nav-icon"><Menu size={18}/></span><span className="nav-label">More</span></button></nav>
      <main ref={mainContentRef} className="main-content">
        {route==='screener'&&<div className="screener-layout">
          {panelOpen&&<button type="button" className="mobile-filter-backdrop" aria-label="Close filters" onClick={()=>setPanelOpen(false)}/>}
          <aside ref={filterPanelRef} className={`filter-panel${panelOpen?'':' collapsed'}`}>
            <div className="filter-head"><div><div className="eyebrow">WORKSPACE</div><button className="saved-select" onClick={()=>document.getElementById('saved-screens')?.classList.toggle('show')}>My screens <ChevronDown size={14}/></button><div id="saved-screens" className="saved-dropdown"><button onClick={()=>{resetFilters();}}>Direct growth · Starter</button><button onClick={()=>{setArrayFacet('categories',['Flexi Cap']);setAddedFilters([{id:'cagr_5y',min:15,max:null,excludeMissing:true}]);}}>Flexi cap focus · Example</button>{savedScreens.map((item,i)=>{const s=parseSavedScreen(item);return s?<button key={`${s.name}-${i}`} onClick={()=>{dispatchFilters({type:'patch',patch:s.filters});setSort(s.sort);setDensity(s.density);setRiskWindow(s.riskWindow);if(s.scatter)setScatterPreferences(s.scatter);}}>{s.name}</button>:null;})}</div></div><button className="icon-button small" title="Save screen" aria-label="Save screen" onClick={saveScreen}><Bookmark size={16}/></button><button type="button" className="icon-button mobile-filter-close" aria-label="Close filters" onClick={()=>setPanelOpen(false)}><X size={17}/></button></div>
            <AppliedFilters filters={appliedFilters} onRemoveValue={removeAppliedValue} onClearFilter={clearAppliedFilter} onClearAll={clearAllWithUndo} placement="sheet" resultCount={matchedCount} resultUpdating={filterUpdating}/>
            <section className="filter-section"><div className="section-label"><span>UNIVERSE</span><span title="Choose which scheme plans and options to screen."><CircleHelp size={13}/></span></div><div className="universe-row"><span>Plan</span><div className="segmented"><button className={plan==='Direct'?'selected':''} onClick={()=>setPlan('Direct')}>Direct</button><button className={plan==='Regular'?'selected':''} onClick={()=>setPlan('Regular')}>Regular</button><button className={plan==='Both'?'selected':''} onClick={()=>setPlan('Both')}>Both</button></div></div><div className="universe-row"><span>Option</span><select value={option} onChange={e=>setOption(e.target.value)}><option>Growth</option><option>IDCW</option><option>All</option></select></div><div className="universe-row"><span>Risk window <CircleHelp size={12}/></span><div className="segmented risk-segment">{[1,3,5].map(n=><button className={riskWindow===n?'selected':''} key={n} onClick={()=>setRiskWindow(n)}>{n}Y</button>)}</div></div><div className="universe-row"><span>Score model</span><select aria-label="Active score model" value={activeModel?slugModelId(modelName):'__off'} onChange={e=>{const val=e.target.value;if(val==='__off'){setActiveModel(false);if(sort.id==='score')setSort({id:'cagr_3y',desc:true});return;}const chosen=savedModels.find(m=>m.id===val||slugModelId(m.name)===val);if(chosen)void applyModelToScreener(chosen);else void applyModelToScreener();}}><option value="__off">Off (hide column)</option>{savedModels.map(m=><option key={m.id} value={m.id}>{m.name}{m.builtIn?' · Preset':' · Saved'}</option>)}</select></div><label className="check-row"><input type="checkbox" checked={hideStaleNav} onChange={e=>setHideStaleNav(e.target.checked)}/> Hide stale NAV data (&gt;10 days)</label></section>
            <section className="filter-section"><div className="section-label"><span>CORE FILTERS</span><button className="link-button" onClick={resetFilters}>Reset all</button></div>
              <MultiChecklist label="Asset class" searchPlaceholder="Search asset classes…" groups={[{label:'Assets',items:['equity','debt','hybrid','solution','commodity','liquid','other']}]} counts={countsForFacet('assetClasses')} selected={screenerFilters.assetClasses} onChange={items=>setArrayFacet('assetClasses',items)}/>
              <CategoryTreeFilter assets={categoryTree} counts={categoryCounts} selected={screenerFilters.categories} onChange={items=>setArrayFacet('categories',items)}/>
              <MultiChecklist label="Fund houses" searchPlaceholder="Search fund houses (e.g. HDFC, Parag Parikh)…" groups={[{label:'Fund houses',items:amcs}]} counts={amcCounts} selected={screenerFilters.amcs} onChange={items=>setArrayFacet('amcs',items)}/>
              <MultiChecklist label="Management" searchPlaceholder="Search management…" groups={[{label:'Management',items:valuesForFacet('management')}]} counts={countsForFacet('management')} selected={screenerFilters.management} onChange={items=>setArrayFacet('management',items)}/>
              <div title="Category-implied, not the scheme's official riskometer."><MultiChecklist label="Risk · category-implied" searchPlaceholder="Search risk bands…" groups={[{label:'Risk band',items:valuesForFacet('riskBands')}]} counts={countsForFacet('riskBands')} selected={screenerFilters.riskBands} onChange={items=>setArrayFacet('riskBands',items)}/></div>
            </section>
            <section className="filter-section"><div className="section-label"><span>PERFORMANCE & METRICS</span>{addedFilters.length>0&&<button className="link-button" onClick={()=>setAddedFilters([])}>Clear</button>}</div>
              {addedFilters.map(filter=>{const def=metricRegistry.find(m=>m.id===filter.id)!;return <NumericFilter key={filter.id} def={def} filter={filter} onChange={(side,value)=>updateFilter(filter.id,side,value)} onPreset={(min,max)=>setFilterPresetRange(filter.id,min,max)} onMissingChange={value=>setAddedFilters(old=>old.map(f=>f.id===filter.id?{...f,excludeMissing:value}:f))} onRemove={()=>removeFilter(filter.id)}/>})}
              <div ref={sidebarPickerRef} className="add-filter-wrap">
                <button type="button" className="add-filter" aria-expanded={sidebarPicker} onClick={()=>setSidebarPicker(value=>!value)}><Plus size={14}/> Add metric filter</button>
                <ScreenOptionsPicker open={sidebarPicker} query={pickerQuery} setQuery={setPickerQuery} addedFilters={addedFilters} visibleMetricIds={visibleMetricIds} onAdd={addFilter} onToggleColumn={toggleVisibleMetric} mode="filter"/>
              </div>
            </section>
            <section className="filter-section">
              <details className="advanced-filters-details" open={hasAdvancedFilters||undefined}>
                <summary className="section-label advanced-filters-summary"><span>STRATEGY & GOVERNANCE</span><ChevronDown size={13}/></summary>
                <div className="advanced-filters-body">
                  <MultiChecklist label="Investment philosophy" searchPlaceholder="Search philosophy…" groups={[{label:'Philosophy',items:valuesForFacet('philosophies')}]} counts={countsForFacet('philosophies')} selected={screenerFilters.philosophies} onChange={items=>setArrayFacet('philosophies',items)}/>
                  <MultiChecklist label="Investment speciality" searchPlaceholder="Search specialities…" groups={[{label:'Speciality',items:valuesForFacet('specialities')}]} counts={countsForFacet('specialities')} selected={screenerFilters.specialities} onChange={items=>setArrayFacet('specialities',items)}/>
                  <MultiChecklist label="Structure" searchPlaceholder="Search structure…" groups={[{label:'Structure',items:valuesForFacet('structure')}]} counts={countsForFacet('structure')} selected={screenerFilters.structure} onChange={items=>setArrayFacet('structure',items)}/>
                  <MultiChecklist label="Classification status" searchPlaceholder="Search status…" groups={[{label:'Status',items:['CONFIRMED','UNCONFIRMED','CONFLICT_STALE','CONFLICT']}]} counts={classificationStatusCounts} selected={screenerFilters.statuses} onChange={items=>setArrayFacet('statuses',items)}/>
                  <MultiChecklist label="Lifecycle" searchPlaceholder="Search lifecycle…" groups={[{label:'Lifecycle',items:['active','dormant']}]} counts={countsForFacet('lifecycle')} selected={screenerFilters.lifecycle} onChange={items=>setArrayFacet('lifecycle',items)}/>
                </div>
              </details>
            </section>
            <div className="panel-footer"><button type="button" className="link-button" onClick={resetFilters}>Reset</button><button type="button" className="button primary" onClick={()=>setPanelOpen(false)}>Show {matchedCount.toLocaleString('en-IN')} funds</button></div>
          </aside>
          <section className="results-area">
            <div className="page-heading screener-heading"><div><h1>Mutual Fund Screener</h1><p className="subtitle">On-demand institutional screening for Indian mutual fund schemes.</p></div><div className="heading-actions">{!hostedWeb&&<button className="button secondary" onClick={()=>void refresh()} disabled={refreshing} title={refreshStage||'Refresh catalog'}><RefreshCw size={15} className={refreshing?'spin':''}/>{refreshing?'Refreshing':'Refresh'}</button>}<button className="button secondary" onClick={saveScreen}><Bookmark size={15}/> Save screen</button></div></div>
            <div className="quick-presets-bar" role="region" aria-label="Quick fund screens">
              <button type="button" className={`quick-preset-pill${!hasActiveFilters?' active':''}`} onClick={()=>applyQuickPreset('all')}>All Direct Growth</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.categories.some(c=>/large cap/i.test(c))?' active':''}`} onClick={()=>applyQuickPreset('large')}>Large Cap</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.categories.some(c=>/flexi|multi cap/i.test(c))?' active':''}`} onClick={()=>applyQuickPreset('flexi')}>Flexi &amp; Multi Cap</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.categories.some(c=>/mid cap|small cap/i.test(c))?' active':''}`} onClick={()=>applyQuickPreset('mid_small')}>Mid &amp; Small Cap</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.management.includes('Passive')?' active':''}`} onClick={()=>applyQuickPreset('passive')}>Index &amp; Passive</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.categories.some(c=>/elss|tax/i.test(c))?' active':''}`} onClick={()=>applyQuickPreset('elss')}>ELSS Tax Saver</button>
              <button type="button" className={`quick-preset-pill${screenerFilters.assetClasses.includes('debt')?' active':''}`} onClick={()=>applyQuickPreset('debt')}>Debt &amp; Liquid</button>
              <button type="button" className={`quick-preset-pill${addedFilters.some(f=>f.id==='cagr_3y'&&f.min===15)?' active':''}`} onClick={()=>applyQuickPreset('high_cagr')}>3Y CAGR &ge; 15%</button>
              <button type="button" className={`quick-preset-pill${addedFilters.some(f=>f.id==='sharpe'&&f.min===1)?' active':''}`} onClick={()=>applyQuickPreset('high_sharpe')}>Sharpe &ge; 1.0</button>
            </div>
            <div className={`summary-strip${filterUpdating?' is-updating':''}`}><div className="summary-left"><button ref={filterToggleRef} className="icon-button filter-toggle" title="Toggle filters" aria-label={`Filters, ${activeFilterCount} active`} aria-expanded={panelOpen} onClick={()=>setPanelOpen(v=>!v)}><Filter size={17}/><span>Filters ({activeFilterCount})</span></button><div className="result-count" aria-live="polite" aria-atomic="true"><strong>{matchedCount.toLocaleString('en-IN')}</strong><span>of {funds.length.toLocaleString('en-IN')} schemes</span></div><span className="summary-divider"/><span className="summary-context">{plan} · {option} · {structure==='All'?'All structures':structure}</span><span className="filter-pending" role="status">{filterUpdating?'Updating results…':''}</span></div><div className="table-actions"><div ref={screenOptionsRef} className="screen-options-wrap"><button type="button" className="toolbar-button" aria-expanded={picker} onClick={event=>{event.preventDefault();event.stopPropagation();setPicker(value=>!value);}}><TableProperties size={15}/> Screen options <ChevronDown size={13}/></button><ScreenOptionsPicker open={picker} query={pickerQuery} setQuery={setPickerQuery} addedFilters={addedFilters} visibleMetricIds={visibleMetricIds} onAdd={addFilter} onToggleColumn={toggleVisibleMetric}/></div><button type="button" className="toolbar-button" onClick={()=>setDensity(density==='compact'?'comfortable':'compact')}><TableProperties size={15}/>{density==='compact'?'Compact':'Comfortable'}</button><button type="button" className="toolbar-button" onClick={exportCsv} disabled={!matchedCount}><Download size={15}/> Export</button></div></div>
            <AppliedFilters filters={appliedFilters} onRemoveValue={removeAppliedValue} onClearFilter={clearAppliedFilter} onClearAll={clearAllWithUndo} placement="summary" resultCount={matchedCount} resultUpdating={filterUpdating}/>
            {refreshing&&<div className="inline-alert refresh-progress"><RefreshCw size={14} className="spin"/><span>{refreshStage||'Refreshing data…'}</span></div>}
            {catalogStale&&<div className="inline-alert stale-banner" role="status" aria-live="polite"><AlertTriangle size={14}/><span>Latest NAV data is from {formatEpochMs(status.dataAsOf)}. Older data remains visible because a stale NAV does not mean a scheme is inactive.</span>{!hostedWeb&&<button className="link-button" onClick={()=>void refresh()} disabled={refreshing}>Refresh catalog</button>}</div>}
            {(dbError||engineError)&&<div className="inline-alert db-error"><span className="alert-dot"/><span><strong>{dbError?'Database Error:':'Filter engine error:'}</strong> {dbError||engineError}</span><button className="icon-button tiny" onClick={()=>{setDbError(null);setEngineError('');}}><X size={14}/></button></div>}
            {refreshError&&<div className="inline-alert"><span className="alert-dot"/><span>Couldn't refresh ({refreshError}). {funds.length?'Showing data saved on this device.':'Try again when a connection is available.'}</span><button className="link-button" onClick={()=>nav('health')}>Details</button><button className="icon-button tiny" onClick={()=>setRefreshError('')}><X size={14}/></button></div>}
            {route==='screener'&&historyError&&<div className="inline-alert"><span className="alert-dot"/><span>NAV history: {historyError}</span>{rowItems.some(item=>unavailableCodes.has(item.fund.code))&&<button className="link-button" onClick={()=>retryHistory(rowItems.filter(item=>unavailableCodes.has(item.fund.code)).map(item=>item.fund.code))} disabled={historyRunning}>Retry visible funds</button>}<button className="icon-button tiny" onClick={()=>setHistoryError('')} aria-label="Dismiss history message"><X size={14}/></button></div>}
            {matchedCount===0&&addedFilters.some(filter=>filter.excludeMissing||filter.min!==null||filter.max!==null)&&<div className="inline-alert"><CircleHelp size={14}/><span>Metric filters can hide every fund when the required NAV history or benchmark metric is missing. Jensen alpha stays unavailable until a benchmark proxy is approved.</span><button className="link-button" onClick={()=>setAddedFilters([])}>Clear metric filters</button></div>}
            <div className="mobile-result-cards">{isLoading&&Array.from({length:5},(_,index)=><article className="mobile-fund-card skeleton-mobile-card" key={`mobile-loading-${index}`} aria-hidden="true"><span className="skeleton skeleton-check"/><span className="skeleton skeleton-mobile-name"/><span className="skeleton skeleton-mobile-meta"/><span className="skeleton skeleton-mobile-value"/></article>)}{rowItems.map(({fund,score})=><article className="mobile-fund-card" key={fund.code} onPointerEnter={()=>scheduleRowPrefetch(fund.code)} onPointerLeave={cancelRowPrefetch} onClick={()=>setDetail(fund)}><label className="mobile-card-check" onClick={event=>event.stopPropagation()}><input type="checkbox" checked={selected.includes(fund.code)} onChange={()=>toggleSelected(fund.code)} aria-label={`Select ${fund.name}`}/></label><div className="mobile-card-main"><b>{fund.name||'Unnamed scheme'}</b><small>{fund.amc||'Unknown fund house'} · {fund.subCategory||'Uncategorized'}</small><span><i>{fund.plan||'Plan unknown'}</i><i>{fund.option||'Option unknown'}</i><i>₹{Number.isFinite(fund.nav)?fund.nav.toFixed(2):'—'}</i></span></div><div className="mobile-card-metrics">{tableMetrics.slice(0,3).map(metric=><span key={metric.id}><small>{metric.label}</small><b className={metricValueClass(fund.code,metric.id,fund.metrics?.[metric.id])}>{fmt(fund.metrics?.[metric.id]??null,metric.unit)}</b></span>)}{activeModel&&<span><small>Score</small><b>{score?.toFixed(1)??'—'}</b></span>}</div></article>)}</div><div className="table-scroll-container"><div className="table-shell"><div className="table-scroll" ref={tableScrollRef} onScroll={onTableScroll} aria-busy={isLoading||filterUpdating}><table className={density==='compact'?'fund-table compact':'fund-table'} aria-label="Mutual fund screening results"><thead><tr><th className="select-col"><input type="checkbox" aria-label="Select first six matching funds" checked={matchedCount>0&&Array.from(matchIndices.slice(0,Math.min(6,matchedCount)),index=>funds[index]?.code).every((code):code is number=>code!==undefined&&selected.includes(code))} onChange={()=>{const codes=Array.from(matchIndices.slice(0,Math.min(6,matchedCount)),index=>funds[index]?.code).filter((code):code is number=>code!==undefined);setSelected(old=>codes.every(code=>old.includes(code))?[]:codes);}}/></th><SortHeader label="Fund name" id="name" sort={sort} onClick={()=>sortBy('name')}/><SortHeader label="Category" id="category" sort={sort} onClick={()=>sortBy('category')}/><SortHeader label="NAV (₹)" id="nav" sort={sort} onClick={()=>sortBy('nav')}/>{tableMetrics.map(metric=><SortHeader key={metric.id} label={metric.label} id={metric.id} sort={sort} onClick={()=>sortBy(metric.id)}/>)}{activeModel&&<SortHeader label="Score" id="score" sort={sort} onClick={()=>sortBy('score')}/>}</tr></thead><tbody>
              {virtualStart>0&&<tr className="virtual-spacer" aria-hidden="true"><td colSpan={tableColumnCount} style={{height:virtualStart*rowHeight}}/></tr>}{rowItems.map(({fund,score})=><tr key={fund.code} tabIndex={0} aria-label={`Open details for ${fund.name}`} onPointerEnter={()=>scheduleRowPrefetch(fund.code)} onPointerLeave={cancelRowPrefetch} onFocus={()=>scheduleRowPrefetch(fund.code)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setDetail(fund);}}} onClick={()=>setDetail(fund)} className={selected.includes(fund.code)?'row-selected':''}><td className="select-col" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(fund.code)} onChange={()=>toggleSelected(fund.code)} aria-label={`Select ${fund.name}`} title={selected.length>=6&&!selected.includes(fund.code)?'Compare supports up to six funds':''}/></td><td className="fund-name-cell"><div title={fund.name}>{fund.name||'Unnamed scheme'}</div><small>{fund.amc||'Unknown fund house'} <span className="plan-chip">{fund.plan||'Plan unknown'}</span><span className="growth-chip">{fund.option||'Option unknown'}</span></small></td><td><span className="category-name" title={fund.subCategory}>{fund.subCategory||'Uncategorized'}</span></td><td className="numeric nav-cell" title={fund.navDate?`As of ${dateText(fund.navDate)}`:'Latest NAV'}>{Number.isFinite(fund.nav)?`₹${fund.nav.toFixed(2)}`:'—'}</td>{tableMetrics.map(metric=><td className={`numeric ${metricValueClass(fund.code,metric.id,fund.metrics?.[metric.id])??''}`} key={metric.id} title={fund.metrics?.[metric.id]==null?metricReasonText(fund,metric.id,metric.label):metricContextText(fund,metric.id)}>{fmt(fund.metrics?.[metric.id]??null,metric.unit)}</td>)}{activeModel&&<td className="numeric score-value">{score?.toFixed(1)??'—'}</td>}</tr>)}
              {isLoading&&Array.from({length:density==='compact'?10:8},(_,rowIndex)=><tr className="skeleton-data-row" key={`loading-${rowIndex}`} aria-hidden="true"><td className="select-col"><span className="skeleton skeleton-check"/></td><td className="fund-name-cell"><span className="skeleton skeleton-name"/><span className="skeleton skeleton-subtitle"/></td><td><span className="skeleton skeleton-value"/></td><td className="numeric"><span className="skeleton skeleton-value"/></td>{tableMetrics.map(metric=><td className="numeric" key={metric.id}><span className="skeleton skeleton-value"/></td>)}{activeModel&&<td className="numeric"><span className="skeleton skeleton-value"/></td>}</tr>)}
              {!isLoading&&matchedCount===0&&<tr><td colSpan={tableColumnCount}><EmptyState onRefresh={()=>void refresh()} onSettings={()=>nav('settings')} onReset={resetFilters} onRemoveFilter={removeZeroStep} zeroStep={zeroFunnelStep} refreshing={refreshing} hasData={funds.length>0} hasActiveFilters={hasActiveFilters} pendingHistory={false} hosted={hostedWeb}/></td></tr>}{virtualEnd<matchedCount&&<tr className="virtual-spacer" aria-hidden="true"><td colSpan={tableColumnCount} style={{height:(matchedCount-virtualEnd)*rowHeight}}/></tr>}
            </tbody></table></div><div className="table-bottom"><span>Showing {matchedCount.toLocaleString('en-IN')} schemes · {tableMetrics.length} performance &amp; risk columns</span><span className="mobile-swipe-hint">Swipe the table to see more columns</span><div><span>NAV charts &amp; scheme histories load on demand when you inspect or compare funds</span>{!hostedWeb&&matchedCount>0&&<button className="link-button" onClick={()=>void requestBackfill(100)} disabled={historyRunning||fetchedPct.done<fetchedPct.total&&fetchedPct.total>0}>Backfill 100 histories</button>}</div></div></div></div>
            {selected.length>0&&<div className="compare-tray"><div className="tray-left"><div className="tray-icon"><GitCompareArrows size={16}/></div><div><strong>{selected.length} funds selected</strong><span>Choose up to 6 to compare</span></div><div className="tray-pills">{selected.map((code,i)=>{const f=funds.find(x=>x.code===code);return f?<span key={code} className="tray-pill"><i style={{background:colorPalette[i]}}/>{shortName(f.name)}<button onClick={()=>toggleSelected(code)}><X size={12}/></button></span>:null})}</div></div><div className="tray-actions"><button className="link-button" onClick={()=>setSelected([])}>Clear</button><button className="button primary" disabled={selected.length<2} onClick={()=>nav('compare')}>Compare {selected.length}<ArrowDown size={14}/></button></div></div>}
          </section>
        </div>}
        {route==='compare'&&<CompareView funds={funds.filter(f=>selected.includes(f.code))} allFunds={funds} screenerCount={matchedCount} engine={engineClient} scatterPreferences={scatterPreferences} onScatterPreferencesChange={setScatterPreferences} onOpenFund={code=>{const fund=funds.find(item=>item.code===code);if(fund)setDetail(fund);}} onAddCompare={toggleSelected} riskWindow={riskWindow} riskFree={riskFree} dataAsOf={status.dataAsOf} remove={toggleSelected} onBack={()=>nav('screener')} loading={historyRunning} progress={fetchedPct} error={historyError} failedCodes={selected.filter(code=>unavailableCodes.has(code))} onRetry={()=>retryHistory(selected.filter(code=>unavailableCodes.has(code)))}/>}
        {route==='score'&&<ScoreLab allFunds={funds} rows={filtered} factors={factors} setFactors={setFactors} peerGroup={peerGroup} setPeerGroup={setPeerGroup} modelName={modelName} setModelName={setModelName} savedModels={savedModels} activeModel={activeModel} onSave={()=>void saveModel()} onSaveAsNew={()=>void saveAsNewModel()} onLoadModel={loadModelPreset} onDeleteModel={deleteSavedModel} modelSaved={modelSaved} scoreSavedAt={scoreSavedAt} dataAsOf={status.dataAsOf} onOpenFund={fund=>setDetail(fund)} apply={(preset)=>void applyModelToScreener(preset)}/>}
        {route==='health'&&<HealthView status={status} aumStatus={aumStatus} terStatus={terStatus} refreshing={refreshing} refresh={()=>void refresh()} error={refreshError} historyError={historyError} failedCodes={scopedFunds.filter(fund=>unavailableCodes.has(fund.code)).map(fund=>fund.code)} retryHistory={retryHistory} stage={refreshStage} funds={funds} historyScope={scopedFunds} coverage={snapshotCoverage} backfill={requestBackfill} progress={fetchedPct} historyRunning={historyRunning} historyPaused={historyPaused} toggleHistoryPause={toggleHistoryPause}/>}
        {route==='governance'&&<ClassificationGovernance funds={funds} onReview={async(code,action)=>{setBackendOp({title:'Recording classification decision…',subtitle:`Updating scheme #${code} and refreshing taxonomy bindings.`,badge:'TAXONOMY ENGINE'});await yieldToPaint();try{await recordClassificationDecision(code,action);setFunds(await getFunds());}finally{setBackendOp(null);}}} onRerun={async()=>{setBackendOp({title:'Re-running classification rules…',subtitle:'Evaluating S0–S4 source observations across all mutual fund schemes.',badge:'TAXONOMY ENGINE'});await yieldToPaint();try{setFunds(await rerunClassification());}finally{setBackendOp(null);}}}/>}
        {route==='settings'&&<SettingsView theme={theme} setTheme={setTheme} riskFree={riskFree} density={density} setDensity={setDensity} hosted={hostedWeb} status={status} snapshotUpdate={snapshotUpdate} onApplySnapshotUpdate={onApplySnapshotUpdate} onLock={onLock} sessionDays={sessionDays} onSessionDaysChange={onSessionDaysChange}/>}
      </main>
      {undoToast&&<div className="filter-undo-toast" role="status" aria-live="polite"><span>Filters cleared.</span><button type="button" onClick={undoClearAll}>Undo</button><button type="button" className="filter-chip-remove" aria-label="Dismiss undo message" onClick={()=>{setUndoToast(false);undoFiltersRef.current=null;}}><X size={14}/></button></div>}
      {activeBackgroundText&&!activeBlockingOp&&<div className="backend-activity-pill" role="status" aria-live="polite"><RefreshCw size={13} className="spin"/><span>{activeBackgroundText}</span></div>}
    </div>
    {activeBlockingOp&&<div className="backend-loading-backdrop" role="status" aria-live="assertive" aria-busy="true"><div className="backend-loading-modal"><div className="backend-loading-spinner"><RefreshCw size={22} className="spin"/></div><div className="backend-loading-body">{activeBlockingOp.badge&&<span className="eyebrow">{activeBlockingOp.badge}</span>}<h3>{activeBlockingOp.title}</h3><p>{activeBlockingOp.subtitle}</p><div className="backend-loading-bar"><i/></div></div></div></div>}
    {detail&&<FundDrawer fund={funds.find(fund=>fund.code===detail.code)??detail} unavailable={unavailableCodes.has(detail.code)} loading={historyRunning} onRetryHistory={()=>retryHistory([detail.code])} onClose={()=>setDetail(null)} inCompare={selected.includes(detail.code)} onCompare={()=>{toggleSelected(detail.code);}} riskWindow={riskWindow} riskFree={riskFree}/>}
    <footer className="safety-footer">For personal research. Not investment advice. Verify source data before acting.</footer>
  </div>;
}

function errorText(e:unknown){
  if(e instanceof Error)return e.message;
  if(typeof e==='string')return e;
  try{return JSON.stringify(e);}catch{return 'Unexpected refresh error';}
}
function metricReasonText(fund:Fund,id:string,label:string){return reasonMessage(fund.metricReasonDetails?.[id],label);}
function metricProvenanceText(source:string|undefined){return source==='LOCAL_NAV'?'Computed from local NAV':source==='PEER_MEDIAN'?'Compared with sub-category median':source==='BENCHMARK_PROXY'?'Computed against configured proxy':source==='AMFI_DISCLOSURE'?'AMFI disclosure':source==='LOCAL_OVERRIDE'?'Local CSV override':source==='SEBI_HEURISTIC'?'SEBI category mandate floor · heuristic':'Source not recorded';}
function metricContextText(fund:Fund,id:string):string{const source=metricProvenanceText(fund.metricProvenance?.[id]);const asOf=fund.metricAsOf?.[id];return asOf===undefined?source:`${source} · as of ${dateText(asOf)}`;}
function relativeTime(at:number){const mins=Math.max(0,Math.round((Date.now()-at)/60000));return mins<1?'just now':mins<60?`${mins}m ago`:`${Math.floor(mins/60)}h ago`;}
function timestampText(at:number){return new Date(at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
function shortName(name:string){return name.replace(/ fund$/i,'').replace(/ mutual fund$/i,'');}
function NavButton({icon,label,active,badge,onClick}:{icon:React.ReactNode,label:string,active:boolean,badge?:number,onClick:()=>void}){return <button className={`nav-item${active?' active':''}`} onClick={onClick} title={label}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>{badge!==undefined&&<span className="nav-badge">{badge}</span>}</button>}
function SortHeader({label,id,sort,onClick}:{label:string,id:string,sort:{id:string;desc:boolean},onClick:()=>void}){const metric=metricRegistry.find(item=>item.id===id);return <th><button className={`sort-header${sort.id===id?' sorted':''}`} onClick={onClick} title={metric?.description??label}>{label}{sort.id===id?(sort.desc?<ArrowDown size={12}/>:<ArrowUp size={12}/>):<ArrowDownUp size={11} className="sort-muted"/>}</button></th>}
function ScreenOptionsPicker({open,query,setQuery,addedFilters,visibleMetricIds=[],onAdd,onToggleColumn,mode='columns'}:{open:boolean,query:string,setQuery:(value:string)=>void,addedFilters:MetricFilter[],visibleMetricIds?:string[],onAdd:(id:string)=>void,onToggleColumn?:(id:string)=>void,mode?:'columns'|'filter'}){
  if(!open)return null;
  const normalizedQuery=normalizeFilterText(query);
  const options=metricRegistry.filter(metric=>metric.availability!=='unavailable'&&!['plan_type'].includes(metric.id)&&normalizeFilterText(`${metric.label} ${metric.group} ${metric.description}`).includes(normalizedQuery));
  return <div className="metric-picker screen-options-popover" role="dialog" aria-label="Screen options" onClick={event=>event.stopPropagation()}>
    <div className="picker-search"><Search size={13}/><input placeholder="Find a metric (e.g. Sharpe, CAGR, TER)…" value={query} onChange={event=>setQuery(event.target.value)} autoFocus aria-label="Find a metric"/></div>
    {options.length?options.map(metric=>{
      const hasFilter=addedFilters.some(filter=>filter.id===metric.id);
      const isVisible=visibleMetricIds.includes(metric.id)||hasFilter;
      if(mode==='filter'){
        return <button type="button" key={metric.id} disabled={hasFilter} onClick={event=>{event.preventDefault();event.stopPropagation();onAdd(metric.id);}}><span><b>{metric.label}</b><small>{metric.group} · {metric.description}</small></span>{hasFilter?<Check size={14}/>:<Plus size={14}/>}</button>;
      }
      return <div className="picker-option-row" key={metric.id}>
        <button type="button" className="picker-col-toggle" onClick={event=>{event.preventDefault();event.stopPropagation();onToggleColumn?.(metric.id);}} title={isVisible?'Shown in table':'Show column in table'}>
          <span className={`custom-check${isVisible?' is-checked':''}`}/>
          <span><b>{metric.label}</b><small>{metric.group} · {metric.description}</small></span>
        </button>
        <button type="button" className={`picker-filter-btn${hasFilter?' is-active':''}`} disabled={hasFilter} onClick={event=>{event.preventDefault();event.stopPropagation();onAdd(metric.id);}} title={hasFilter?'Filter added':'Add range filter'}>
          {hasFilter?<><Check size={12}/> Filtered</>:<><Plus size={12}/> Filter</>}
        </button>
      </div>;
    }):<p className="picker-empty" role="status">No matching metrics.</p>}
  </div>;
}
function checklistLabel(label:string,item:string){if(label==='Asset class')return ({equity:'Equity',debt:'Debt',hybrid:'Hybrid',solution:'Solution-oriented',commodity:'Gold / Silver',liquid:'Liquid',other:'Unclassified'} as Record<string,string>)[item]??item;if(label==='Classification status')return item==='CONFLICT'?'Under review':item==='CONFLICT_STALE'?'Stale source conflict':item==='UNCONFIRMED'?'Unconfirmed':'Confirmed';return item;}
function moveChipFocus(event:ReactKeyboardEvent<HTMLDivElement>){if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;const target=event.target;if(!(target instanceof HTMLElement)||!target.matches('[data-filter-chip]'))return;const chips=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-filter-chip]')];const index=chips.indexOf(target as HTMLButtonElement);const next=chips[index+(event.key==='ArrowRight'?1:-1)];if(next){event.preventDefault();next.focus();}}
function MultiChecklist({label,searchPlaceholder,groups,counts,selected,onChange}:{label:string,searchPlaceholder:string,groups:{label:string,items:string[]}[],counts:Record<string,number>,selected:string[],onChange:(items:string[])=>void}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>(()=>Object.fromEntries(groups.map(group=>[group.label,false])));
  const groupSignature=groups.map(group=>group.label).join('|');
  useEffect(()=>setCollapsed(current=>{const next=Object.fromEntries(groups.map(group=>[group.label,current[group.label]??false]));return groups.every(group=>current[group.label]!==undefined)?current:next;}),[groupSignature]);
  useEffect(()=>{if(!open)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown);},[open]);
  const normalizedQuery=normalizeFilterText(query);
  const normalizedCounts=useMemo(()=>new Map(Object.entries(counts).map(([key,count])=>[normalizeFilterText(key),count])),[counts]);
  const isSelected=(item:string)=>isFacetOptionSelected(selected,item);
  const countFor=(item:string)=>normalizedCounts.get(normalizeFilterText(item))??0;
  const totalOptionCount=groups.reduce((sum,group)=>sum+group.items.length,0);
  const visibleGroups=groups.map(group=>{
    const filteredItems=group.items.filter(item=>normalizeFilterText(checklistLabel(label,item)+' '+item).includes(normalizedQuery));
    const sortedItems=[...filteredItems].sort((a,b)=>{
      const aSel=isSelected(a)?1:0,bSel=isSelected(b)?1:0;
      if(aSel!==bSel)return bSel-aSel;
      const aHas=countFor(a)>0?1:0,bHas=countFor(b)>0?1:0;
      if(aHas!==bHas)return bHas-aHas;
      return totalOptionCount>8?countFor(b)-countFor(a)||a.localeCompare(b):0;
    });
    return {...group,items:sortedItems};
  }).filter(group=>group.items.length);
  const visibleItems=visibleGroups.flatMap(group=>group.items);
  const toggle=(item:string)=>{if(!isSelected(item)&&countFor(item)===0)return;onChange(isSelected(item)?selected.filter(value=>normalizeFilterText(value)!==normalizeFilterText(item)):[...selected,item]);};
  const toggleGroup=(items:string[])=>{const available=items.filter(item=>countFor(item)>0||isSelected(item));const allSelected=available.length>0&&available.every(isSelected);onChange(allSelected?selected.filter(value=>!available.some(item=>normalizeFilterText(value)===normalizeFilterText(item))):[...selected,...available.filter(item=>!isSelected(item))]);};
  const selectAll=()=>onChange([...selected,...visibleItems.filter(item=>countFor(item)>0&&!isSelected(item))]);
  const hasUnselectedVisible=visibleItems.some(item=>countFor(item)>0&&!isSelected(item));
  const singleGroup=groups.length===1;
  return <div className={`filter-card checklist-filter${open?' is-open':''}`}>
    <div className="checklist-heading"><label>{label}{selected.length>0&&<span className="count-pill">{selected.length}</span>}</label><button type="button" className="checklist-trigger" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label={`${label}, ${selected.length?`${selected.length} selected`:'no restriction'}`}>{selected.length?`${selected.length} selected`:'All options'}<ChevronDown size={13} className={open?'open-chevron':''}/></button></div>
    {selected.length>0&&<div className="checklist-chips-wrapper" onKeyDown={moveChipFocus}>{selected.map((item,index)=><FilterChip key={item} label={checklistLabel(label,item)} fullLabel={`${label}: ${checklistLabel(label,item)}`} chipIndex={index} onRemove={()=>toggle(item)}/>)}</div>}
    {open&&<div className="checklist-popover checklist-popover-inline" role="region" aria-label={`${label} filters`}>
      {(totalOptionCount>5||query.length>0)&&<div className="picker-search"><Search size={13}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus aria-label={searchPlaceholder}/></div>}
      <div className="checklist-actions"><button type="button" disabled={!hasUnselectedVisible} onClick={selectAll}>Select all</button><button type="button" disabled={!selected.length} onClick={()=>onChange([])}>Clear</button></div>
      <div className="checklist-items">{visibleGroups.length?visibleGroups.map(group=>{
        const available=group.items.filter(item=>countFor(item)>0);
        const groupSelected=available.length>0&&available.every(isSelected);
        const isGroupCollapsed=!singleGroup&&!normalizedQuery&&(collapsed[group.label]??false);
        return <div className="checklist-group" key={group.label}>
          {!singleGroup&&<div className="checklist-group-heading"><label className="group-checkbox-wrap"><input type="checkbox" aria-label={`Select all ${group.label}`} checked={groupSelected} disabled={!available.length} onChange={()=>toggleGroup(group.items)}/><span className="custom-check"/><span>{group.label} <small>({group.items.length})</small></span></label><button type="button" className="checklist-group-toggle" aria-label={`${isGroupCollapsed?'Expand':'Collapse'} ${group.label}`} onClick={()=>setCollapsed(current=>({...current,[group.label]:!isGroupCollapsed}))}><ChevronDown size={13} className={isGroupCollapsed?'collapsed':''}/></button></div>}
          {!isGroupCollapsed&&group.items.map(item=><label className={`checklist-item${countFor(item)===0&&!isSelected(item)?' disabled':''}`} key={item} title={`${checklistLabel(label,item)}: ${countFor(item)} matching schemes`}><input type="checkbox" checked={isSelected(item)} disabled={countFor(item)===0&&!isSelected(item)} onChange={()=>toggle(item)}/><span className="custom-check"/><span>{checklistLabel(label,item)}</span><small>{countFor(item).toLocaleString('en-IN')}</small></label>)}
        </div>;
      }):<p className="picker-empty" role="status">No matching options.</p>}</div>
    </div>}
  </div>;
}
type CategoryTreeAsset={assetClass:string;groups:{label:string;items:string[]}[]};
function CategoryTreeFilter({assets,counts,selected,onChange}:{assets:CategoryTreeAsset[];counts:Record<string,number>;selected:string[];onChange:(items:string[])=>void}){
  const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const [expanded,setExpanded]=useState<Record<string,boolean>>({equity:true,hybrid:true,debt:true});
  useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  const normalizedQuery=normalizeFilterText(query);const countMap=useMemo(()=>new Map(Object.entries(counts).map(([key,count])=>[normalizeFilterText(key),count])),[counts]);const countFor=(item:string)=>countMap.get(normalizeFilterText(item))??0;const isSelected=(item:string)=>isFacetOptionSelected(selected,item);
  const visible=assets.map(asset=>({...asset,groups:asset.groups.map(group=>({...group,items:group.items.filter(item=>normalizeFilterText(`${asset.assetClass} ${group.label} ${item}`).includes(normalizedQuery))})).filter(group=>group.items.length)})).filter(asset=>asset.groups.length);const visibleItems=[...new Map(visible.flatMap(asset=>asset.groups.flatMap(group=>group.items)).map(item=>[normalizeFilterText(item),item])).values()];
  const toggleItems=(items:string[])=>{const eligible=[...new Map(items.filter(item=>countFor(item)>0||isSelected(item)).map(item=>[normalizeFilterText(item),item])).values()];const allSelected=eligible.length>0&&eligible.every(isSelected);const next=allSelected?selected.filter(value=>!eligible.some(item=>normalizeFilterText(item)===normalizeFilterText(value))):[...selected,...eligible.filter(item=>!isSelected(item))];onChange([...new Map(next.map(item=>[normalizeFilterText(item),item])).values()]);};
  const states=(items:string[])=>{const eligible=items.filter(item=>countFor(item)>0||isSelected(item));const selectedCount=eligible.filter(isSelected).length;return {checked:eligible.length>0&&selectedCount===eligible.length,mixed:selectedCount>0&&selectedCount<eligible.length,count:eligible.length};};
  const clear=()=>onChange([]);const selectAll=()=>toggleItems(visibleItems.filter(item=>countFor(item)>0&&!isSelected(item)));
  return <div className={`filter-card checklist-filter${open?' is-open':''}`}>
    <div className="checklist-heading"><label>Categories{selected.length>0&&<span className="count-pill">{selected.length}</span>}</label><button type="button" className="checklist-trigger" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label={`Categories, ${selected.length?`${selected.length} selected`:'no restriction'}`}>{selected.length?`${selected.length} selected`:'All categories'}<ChevronDown size={13} className={open?'open-chevron':''}/></button></div>
    {selected.length>0&&<div className="checklist-chips-wrapper" onKeyDown={moveChipFocus}>{selected.map((item,index)=><FilterChip key={item} label={item} fullLabel={`Categories: ${item}`} chipIndex={index} onRemove={()=>toggleItems([item])}/>)}</div>}
    {open&&<div className="checklist-popover checklist-popover-inline category-tree-popover" role="region" aria-label="Category filters">
      <div className="picker-search"><Search size={13}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search categories (e.g. Flexi Cap, Small Cap)…" autoFocus aria-label="Search categories"/></div><div className="checklist-actions"><button type="button" disabled={!visibleItems.some(item=>countFor(item)>0&&!isSelected(item))} onClick={selectAll}>Select all</button><button type="button" disabled={!selected.length} onClick={clear}>Clear</button></div>
      <div className="checklist-items category-tree-items">{visible.length?visible.map(asset=>{const assetItems=asset.groups.flatMap(group=>group.items);const assetState=states(assetItems);const expandedAsset=Boolean(normalizedQuery)||(expanded[asset.assetClass]??false);return <section className="category-tree-asset" key={asset.assetClass}>
        <div className="checklist-group-heading category-tree-asset-heading"><label className="group-checkbox-wrap"><input type="checkbox" aria-label={`Select all ${asset.assetClass} categories`} aria-checked={assetState.mixed?'mixed':assetState.checked} checked={assetState.checked} disabled={!assetState.count} ref={element=>{if(element)element.indeterminate=assetState.mixed;}} onChange={()=>toggleItems(assetItems)}/><span className="custom-check"/><b>{checklistLabel('Asset class',asset.assetClass)}</b><small>({assetState.count})</small></label><button type="button" className="checklist-group-toggle" aria-label={`${expandedAsset?'Collapse':'Expand'} ${asset.assetClass}`} onClick={()=>setExpanded(current=>({...current,[asset.assetClass]:!expandedAsset}))}><ChevronDown size={13} className={expandedAsset?'':'collapsed'}/></button></div>
        {expandedAsset&&asset.groups.map(group=>{const groupKey=`${asset.assetClass}/${group.label}`;const groupState=states(group.items);const expandedGroup=Boolean(normalizedQuery)||(expanded[groupKey]??true);return <div className="category-tree-group" key={groupKey}><div className="checklist-group-heading category-tree-group-heading"><label className="group-checkbox-wrap"><input type="checkbox" aria-label={`Select all ${group.label} categories`} aria-checked={groupState.mixed?'mixed':groupState.checked} checked={groupState.checked} disabled={!groupState.count} ref={element=>{if(element)element.indeterminate=groupState.mixed;}} onChange={()=>toggleItems(group.items)}/><span className="custom-check"/><span>{group.label}</span><small>({groupState.count})</small></label><button type="button" className="checklist-group-toggle" aria-label={`${expandedGroup?'Collapse':'Expand'} ${group.label}`} onClick={()=>setExpanded(current=>({...current,[groupKey]:!expandedGroup}))}><ChevronDown size={13} className={expandedGroup?'':'collapsed'}/></button></div>{expandedGroup&&group.items.map(item=><label className={`checklist-item${countFor(item)===0&&!isSelected(item)?' disabled':''}`} key={item} title={`${item}: ${countFor(item)} matching schemes`}><input type="checkbox" checked={isSelected(item)} disabled={countFor(item)===0&&!isSelected(item)} onChange={()=>toggleItems([item])}/><span className="custom-check"/><span>{item}</span><small>{countFor(item).toLocaleString('en-IN')}</small></label>)}</div>;})}
      </section>;}):<p className="picker-empty" role="status">No matching categories.</p>}</div>
    </div>}
  </div>;
}
function metricQuickPresets(def:MetricDefinition):Array<{label:string;min:number|null;max:number|null}>{
  if(def.id==='max_drawdown')return [{label:'≥ -10%',min:-10,max:null},{label:'≥ -15%',min:-15,max:null},{label:'≥ -25%',min:-25,max:null}];
  if(def.id==='std_dev'||def.id==='category_std_dev'||def.id==='downside_deviation')return [{label:'≤ 10%',min:null,max:10},{label:'≤ 15%',min:null,max:15},{label:'≤ 20%',min:null,max:20}];
  if(def.id==='ter_pct')return [{label:'≤ 0.5%',min:null,max:0.5},{label:'≤ 1.0%',min:null,max:1.0},{label:'≤ 1.5%',min:null,max:1.5}];
  if(def.unit==='ratio')return [{label:'≥ 0.5',min:0.5,max:null},{label:'≥ 1.0',min:1.0,max:null},{label:'≥ 1.5',min:1.5,max:null}];
  if(def.unit==='%')return [{label:'≥ 10%',min:10,max:null},{label:'≥ 15%',min:15,max:null},{label:'≥ 20%',min:20,max:null}];
  return [];
}
function NumericFilter({def,filter,onChange,onPreset,onMissingChange,onRemove}:{def:MetricDefinition,filter:MetricFilter,onChange:(side:'min'|'max',value:string)=>void,onPreset?:(min:number|null,max:number|null)=>void,onMissingChange:(value:boolean)=>void,onRemove:()=>void}){
  const labelUnit=def.unit==='%'?'%':def.unit==='ratio'?'x':def.unit==='years'?'yr':'';
  const presets=metricQuickPresets(def);
  return <div className="filter-card numeric-filter">
    <div className="numeric-filter-heading"><label>{def.label}<span title={def.description}><CircleHelp size={12}/></span></label><button className="remove-filter" onClick={onRemove} title="Remove filter"><X size={13}/></button></div>
    {presets.length>0&&onPreset&&<div className="numeric-presets">
      {presets.map(preset=>{
        const active=filter.min===preset.min&&filter.max===preset.max;
        return <button type="button" key={preset.label} className={`numeric-preset-chip${active?' active':''}`} onClick={()=>onPreset(active?null:preset.min,active?null:preset.max)}>{preset.label}</button>;
      })}
      {(filter.min!==null||filter.max!==null)&&<button type="button" className="numeric-preset-chip reset" onClick={()=>onPreset(null,null)}>Any</button>}
    </div>}
    <div className="range-inputs"><label><span>Min</span><input type="number" value={filter.min??''} placeholder="Any" onChange={e=>onChange('min',e.target.value)}/><small>{labelUnit}</small></label><span className="range-dash">–</span><label><span>Max</span><input type="number" value={filter.max??''} placeholder="Any" onChange={e=>onChange('max',e.target.value)}/><small>{labelUnit}</small></label></div>
    <div className="null-toggle"><span title="Missing values cannot satisfy a numeric range.">Exclude funds with no value</span><input type="checkbox" checked={filter.excludeMissing} onChange={e=>onMissingChange(e.target.checked)} title="Missing values cannot satisfy a numeric range."/></div>
  </div>;
}
function EmptyState({onRefresh,onSettings,onReset,onRemoveFilter,zeroStep,refreshing,hasData,hasActiveFilters,pendingHistory,hosted}:{onRefresh:()=>void,onSettings:()=>void,onReset:()=>void,onRemoveFilter:()=>void,zeroStep?:string,refreshing:boolean,hasData:boolean,hasActiveFilters:boolean,pendingHistory:boolean,hosted:boolean}){
  const noResults=hasData&&!pendingHistory;
  return <div className="empty-state" role="status">
    <div className="empty-icon">{pendingHistory?<RefreshCw size={20} className="spin"/>:hasData?<Filter size={20}/>:<Database size={21}/>}</div>
    <h3>{pendingHistory?'Loading NAV history for this filter set.':noResults?zeroStep?`No funds remain after ${zeroStep}.`:'No results found':'Start with verified source data.'}</h3>
    <p>{pendingHistory?'Matching funds were found, and their NAV history is still loading.':noResults?`No funds match the current criteria${hasActiveFilters?' yet':''}. Search checks names, fund houses, categories, plans and options. Clear criteria or ranges to broaden the results.`:hosted?'No hosted catalog data is available in this browser. Check Settings for snapshot status and update options.':'Refresh pulls the current AMFI catalog. Missing NAV histories then load for the selected screener universe.'}</p>
    <div className="empty-actions">
      {noResults&&hasActiveFilters&&<button className="button primary" onClick={onReset}><X size={15}/> Reset filters</button>}
      {noResults&&hasActiveFilters&&zeroStep&&<button className="button secondary" onClick={onRemoveFilter}><X size={15}/> Remove {zeroStep}</button>}
      {pendingHistory&&<span className="loading-status"><RefreshCw size={14} className="spin"/> Loading matching history…</span>}
      {hosted&&!hasData&&<button className="button secondary" onClick={onSettings}><Settings2 size={15}/> Data settings</button>}
      {(!hasData||(!hasActiveFilters&&!pendingHistory))&&!hosted&&<button className="button primary" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/>{refreshing?'Refreshing':'Refresh catalog'}</button>}
    </div>
    {!hasData&&<small>No sample fund values are included in production.</small>}
  </div>;
}
function exportRows(funds:Fund[],status:SourceState){const headers=['Fund name','AMFI scheme code','AMC','Category','Plan','Option','NAV','NAV date','1Y CAGR %','3Y CAGR %','5Y CAGR %','Std deviation %','Sharpe','Max drawdown %'];const escape=(s:string|number)=>`"${String(s).replaceAll('"','""')}"`;const rows=funds.map(f=>[f.name,f.code,f.amc,f.subCategory,f.plan,f.option,f.nav,dateText(f.navDate),f.metrics.cagr_1y??'',f.metrics.cagr_3y??'',f.metrics.cagr_5y??'',f.metrics.std_dev??'',f.metrics.sharpe??'',f.metrics.max_drawdown??'']);const content=`For personal research. Not investment advice. Source data from AMFI / public feeds. Data as of ${status.dataAsOf?formatEpochMs(status.dataAsOf):'unavailable'}\n${headers.map(escape).join(',')}\n${rows.map(row=>row.map(escape).join(',')).join('\n')}`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'}));a.download='fundscope-screen.csv';a.click();URL.revokeObjectURL(a.href);}

function CompareView({funds,allFunds,screenerCount,engine,scatterPreferences,onScatterPreferencesChange,onOpenFund,onAddCompare,riskWindow,riskFree=DEFAULT_RISK_FREE_RATE_PERCENT,dataAsOf,remove,onBack,loading,progress,error,failedCodes,onRetry}:{
  funds:Fund[];allFunds:Fund[];screenerCount:number;engine:ScreenerEngineClient;scatterPreferences:ScatterPreferences;onScatterPreferencesChange:(preferences:ScatterPreferences)=>void;
  onOpenFund:(code:number)=>void;onAddCompare:(code:number)=>void;riskWindow:1|3|5;riskFree?:number;dataAsOf:number|null;
  remove:(code:number)=>void;onBack:()=>void;loading:boolean;progress:{done:number;total:number};error:string;failedCodes:number[];onRetry:()=>void;
}){
  const enrichedFunds=useMemo(()=>funds.map(fund=>ensureFundMetricsComputed(fund,riskWindow,riskFree)),[funds,riskWindow,riskFree]);
  const missing=enrichedFunds.filter(fund=>fund.history.length===0).length;const [tab,setTab]=useState<'growth'|'scatter'>('growth');
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow">SIDE-BY-SIDE ANALYSIS</div><h1>Compare <span>with context.</span></h1><p>Fund histories load automatically when you open a comparison.</p></div><button className="button secondary" onClick={onBack}>Back to screener</button></div>
    <>
      {enrichedFunds.length>0&&<>
      {missing>0&&<div className="inline-alert" role="status" aria-live="polite"><RefreshCw size={14} className={loading?'spin':''}/><span>{loading?`Loading NAV history for selected funds${progress.total?` · ${Math.min(progress.done,progress.total)} / ${progress.total}`:''}…`:failedCodes.length?error||`${failedCodes.length} NAV histories could not be loaded.`:`Preparing NAV history for ${missing} selected ${missing===1?'fund':'funds'}…`}</span>{failedCodes.length>0&&<button className="link-button" onClick={onRetry} disabled={loading}>Retry {failedCodes.length}</button>}</div>}
      <div className="compare-fund-cards">{enrichedFunds.map((f,i)=><div className="compare-fund-card" key={f.code}><span className="compare-swatch" style={{background:colorPalette[i]}}/><div onClick={()=>onOpenFund(f.code)} style={{cursor:'pointer'}}><b>{f.name}</b><small>{f.amc} · {f.subCategory}{f.metrics.cagr_3y!=null?` · 3Y ${pct(f.metrics.cagr_3y)}`:''}</small></div><button className="icon-button small" aria-label={`Remove ${f.name} from comparison`} onClick={()=>remove(f.code)}><X size={15}/></button></div>)}</div>
      </>}
      <div className="compare-tabs" role="tablist" aria-label="Comparison views"><button type="button" role="tab" aria-selected={tab==='growth'} onClick={()=>setTab('growth')}>Growth & metrics</button><button type="button" role="tab" aria-selected={tab==='scatter'} onClick={()=>setTab('scatter')}>Scatter</button></div>
      {tab==='scatter'?<Suspense fallback={<div className="scatter-chart-empty" role="status">Loading comparison tools…</div>}><ScatterTab engine={engine} comparedFunds={enrichedFunds} universeRevision={allFunds} preferences={scatterPreferences} onPreferencesChange={onScatterPreferencesChange} onOpenFund={onOpenFund} onAddCompare={onAddCompare} onBack={onBack} dataAsOf={dataAsOf} riskWindow={riskWindow}/></Suspense>:enrichedFunds.length<2?<div className="empty-panel"><div className="empty-icon"><GitCompareArrows size={20}/></div><h3>Select 2–6 funds</h3><p>Choose funds in the screener, or open Scatter to see the remaining selected fund.</p><button className="button primary" onClick={onBack}>Choose funds</button></div>:<>
        <div className="compare-grid"><div className="chart-card growth-card"><div className="card-title"><div><span className="eyebrow">GROWTH OF ₹10,000</span><h2>Value over time</h2></div><span className="approx-badge">NAV · no benchmark</span></div><GrowthChart funds={enrichedFunds} loading={loading}/><div className="chart-legend">{enrichedFunds.map((f,i)=><span key={f.code}><i style={{background:colorPalette[i]}}/>{shortName(f.name)}</span>)}</div></div></div>
        <div className="table-shell compare-table-shell"><div className="compare-table-title"><div><span className="eyebrow">METRIC REVIEW</span><h2>Metric comparison</h2></div><span>{enrichedFunds.length} selected · {screenerCount.toLocaleString('en-IN')} match current filters · {allFunds.length.toLocaleString('en-IN')} total</span></div><div className="compare-table-scroll"><table className="metric-table"><thead><tr><th>Metric</th>{enrichedFunds.map((f,i)=><th key={f.code}><i className="mini-swatch" style={{background:colorPalette[i]}}/>{shortName(f.name)}</th>)}</tr></thead><tbody>{metricRegistry.filter(m=>m.id!=='plan_type').map(m=>{
          const finiteValues=enrichedFunds.map(f=>f.metrics[m.id]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
          const bestValue=finiteValues.length>=2&&m.direction!=='neutral'?(m.direction==='lower'?Math.min(...finiteValues):Math.max(...finiteValues)):null;
          return <tr key={m.id}><td><span>{m.label}</span><small>{m.group}</small></td>{enrichedFunds.map(f=>{const val=f.metrics[m.id];const isBest=bestValue!==null&&val===bestValue;const tone=RETURN_COLOR_METRIC_IDS.has(m.id)&&val!=null&&Number.isFinite(val)&&val!==0?(val>0?'val-pos':'val-neg'):'';return <td className={`numeric${tone?` ${tone}`:''}${isBest?' best-metric-cell':''}`} key={f.code}>{val!=null?fmt(val,m.unit):f.history.length===0&&loading?'Loading…':'—'}</td>;})}</tr>;
        })}</tbody></table></div></div>
      </>}
    </></div>
}
function GrowthChart({funds,loading=false,showRangeSelector=true}:{funds:Fund[],loading?:boolean,showRangeSelector?:boolean}){
  const [selectedDay,setSelectedDay]=useState<number|null>(null);
  const [rangeYears,setRangeYears]=useState<1|3|5|25>(5);
  const [model,setModel]=useState<GrowthChartModel|null>(null);
  const [chartError,setChartError]=useState('');
  const chartRef=useRef<SVGSVGElement>(null);
  const dragging=useRef(false);
  const inputKey=funds.map(fund=>{const first=fund.history[0];const last=fund.history.at(-1);return `${fund.code}:${historyArrayId(fund.history)}:${fund.history.length}:${first?.date??0}:${first?.nav??0}:${last?.date??0}:${last?.nav??0}`;}).join('|');
  const chartFunds=useMemo(()=>funds.map(fund=>({code:fund.code,history:fund.history})),[inputKey]);
  useEffect(()=>{
    const controller=new AbortController();
    setChartError('');
    void computeGrowthChartInWorker(chartFunds,365*rangeYears,controller.signal).then(setModel).catch(error=>{
      if(!controller.signal.aborted)setChartError(error instanceof Error?error.message:'Chart calculation failed.');
    });
    return()=>controller.abort();
  },[chartFunds,rangeYears]);
  useEffect(()=>{setSelectedDay(null);},[inputKey,rangeYears]);
  if(!model)return <div className="chart-empty" role="status"><Activity size={22}/><span>{chartError?`Chart unavailable: ${chartError}`:loading?'Loading NAV history for this chart…':'Preparing chart in the background…'}</span></div>;
  if(!model.chartDays.length)return <div className="chart-empty"><Activity size={22}/><span>{loading?'Loading NAV history for this chart…':'NAV history is not available yet. Retry the history load to draw this chart.'}</span></div>;

  const {series,chartDays,startDay,endDay,min,max}=model;
  const xForDay=(day:number)=>36+(day-startDay)/Math.max(endDay-startDay,1)*528;
  const yForNav=(nav:number)=>166-(nav-min)/Math.max(max-min,1)*138;
  const nearestIndex=(day:number)=>{
    let low=0,high=chartDays.length;
    while(low<high){const middle=(low+high)>>1;if(chartDays[middle]!<day)low=middle+1;else high=middle;}
    if(low===0)return 0;
    if(low>=chartDays.length)return chartDays.length-1;
    return day-chartDays[low-1]!<=chartDays[low]!-day?low-1:low;
  };
  const updateFromPointer=(clientX:number)=>{
    const bounds=chartRef.current?.getBoundingClientRect();
    if(!bounds||bounds.width<=0)return;
    const svgX=(clientX-bounds.left)/bounds.width*600;
    const fraction=Math.max(0,Math.min(1,(svgX-36)/528));
    const day=startDay+fraction*(endDay-startDay);
    setSelectedDay(chartDays[nearestIndex(day)]!);
  };
  const selectFromKeyboard=(event:ReactKeyboardEvent<SVGSVGElement>)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=selectedDay===null?chartDays.length-1:nearestIndex(selectedDay);
    const next=event.key==='Home'?0:event.key==='End'?chartDays.length-1:Math.max(0,Math.min(chartDays.length-1,current+(event.key==='ArrowLeft'?-1:1)));
    setSelectedDay(chartDays[next]!);
  };
  const firstYear=new Date(startDay*86_400_000).getUTCFullYear();
  const lastYear=new Date(endDay*86_400_000).getUTCFullYear();
  const yearMarkers=Array.from({length:lastYear-firstYear+1},(_,index)=>{
    const year=firstYear+index;
    const januaryFirst=Math.floor(Date.UTC(year,0,1)/86_400_000);
    return {year,day:Math.max(startDay,januaryFirst)};
  }).filter(marker=>marker.day<=endDay);
  const activeDay=selectedDay===null?null:chartDays[nearestIndex(selectedDay)]!;
  const activePoints=activeDay===null?[]:series.map((points,index)=>({fund:funds[index]!,point:nearestGrowthPoint(points,activeDay),color:colorPalette[index%colorPalette.length]})).filter((item):item is {fund:Fund;point:NavPoint;color:string}=>item.point!==null);
  const activeX=activeDay===null?null:xForDay(activeDay);
  const primaryLatest=series[0]?.values.at(-1)??null;
  const primaryGainPct=primaryLatest!==null?(primaryLatest-10000)/100:null;

  return <div className="growth-chart-wrap">
    {showRangeSelector&&<div className="growth-toolbar">
      {funds.length===1&&primaryLatest!==null?<div className="growth-summary-pill">
        <span>₹10,000 → <strong>₹{primaryLatest.toLocaleString('en-IN',{maximumFractionDigits:0})}</strong></span>
        {primaryGainPct!==null&&<b className={primaryGainPct>=0?'val-pos':'val-neg'}>{pct(primaryGainPct)}</b>}
      </div>:<span className="growth-range-caption">{dateText(startDay)} – {dateText(endDay)}</span>}
      <div className="segmented growth-range-segment" role="group" aria-label="Chart timeframe">
        {([1,3,5,25] as const).map(yr=><button type="button" key={yr} className={rangeYears===yr?'selected':''} onClick={()=>setRangeYears(yr)}>{yr===25?'Max':`${yr}Y`}</button>)}
      </div>
    </div>}
    <svg ref={chartRef} className="line-chart interactive-line-chart" viewBox="0 0 600 210" role="slider" tabIndex={0} aria-label="Growth of ten thousand over time. Tap or drag to inspect values by date." aria-valuemin={startDay} aria-valuemax={endDay} aria-valuenow={activeDay??endDay} aria-valuetext={activeDay===null?'No date selected':dateText(activeDay)} onKeyDown={selectFromKeyboard} onPointerDown={event=>{dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);updateFromPointer(event.clientX);}} onPointerMove={event=>{if(dragging.current)updateFromPointer(event.clientX);}} onPointerUp={event=>{dragging.current=false;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{dragging.current=false;}}>
      <path d="M36 28H564M36 97H564M36 166H564" className="chart-grid"/>
      {yearMarkers.map(marker=>{const x=xForDay(marker.day);return <g key={marker.year}><line x1={x} x2={x} y1="28" y2="166" className="chart-year-marker"/><text x={x} y="194" textAnchor={marker.day===startDay?'start':marker.day===endDay?'end':'middle'} className="chart-year-label">{marker.year}</text></g>;})}
      {series.map((data,index)=>data.path?<path key={funds[index]?.code??index} d={data.path} fill="none" stroke={colorPalette[index%colorPalette.length]} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>:null)}
      {activeX!==null&&<><line x1={activeX} x2={activeX} y1="24" y2="168" className="chart-active-marker"/>{activePoints.map(item=><circle key={item.fund.code} cx={xForDay(item.point.date)} cy={yForNav(item.point.nav)} r="4" fill="var(--surface)" stroke={item.color} strokeWidth="2.5" className="chart-active-point"/>)}</>}
    </svg>
    <div className="chart-date-readout" aria-live="polite">
      {activeDay===null?<span>Tap or drag the graph to inspect values by date.</span>:<><strong>{dateText(activeDay)}</strong>{activePoints.map(item=><span key={item.fund.code}><i style={{background:item.color}}/>{shortName(item.fund.name)} <b>₹{item.point.nav.toLocaleString('en-IN',{maximumFractionDigits:0})}</b></span>)}</>}
    </div>
  </div>;
}
function ScatterPlot({funds}:{funds:Fund[]}){const eligible=funds.filter(f=>f.metrics.std_dev!=null&&f.metrics.cagr_3y!=null);if(!eligible.length)return <div className="chart-empty"><Activity size={22}/><span>Risk-return view appears after history is available.</span></div>;const xs=eligible.map(f=>f.metrics.std_dev!),ys=eligible.map(f=>f.metrics.cagr_3y!);const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);return <svg className="scatter-chart" viewBox="0 0 420 220" role="img" aria-label="Risk versus return scatter plot"><path d="M48 20V180H400" className="chart-axis"/>{eligible.map((f,i)=><g key={f.code}><circle cx={55+(f.metrics.std_dev!-xmin)/(xmax-xmin||1)*330} cy={170-(f.metrics.cagr_3y!-ymin)/(ymax-ymin||1)*140} r="6" fill={colorPalette[i]} opacity=".84"/><title>{f.name} · {f.metrics.std_dev?.toFixed(2)}% risk · {f.metrics.cagr_3y?.toFixed(2)}% return</title></g>)}<text x="160" y="210" className="axis-label">3Y volatility →</text><text transform="translate(15 135) rotate(-90)" className="axis-label">3Y CAGR →</text></svg>}
function ScoreLab({allFunds,rows,factors,setFactors,peerGroup,setPeerGroup,modelName,setModelName,savedModels,activeModel,onSave,onSaveAsNew,onLoadModel,onDeleteModel,modelSaved,scoreSavedAt,dataAsOf,onOpenFund,apply}:{allFunds:Fund[],rows:Fund[],factors:ScoreFactor[],setFactors:(v:ScoreFactor[])=>void,peerGroup:PeerGroupMode,setPeerGroup:(v:PeerGroupMode)=>void,modelName:string,setModelName:(v:string)=>void,savedModels:ScoreModelPreset[],activeModel:boolean,onSave:()=>void,onSaveAsNew:()=>void,onLoadModel:(preset:ScoreModelPreset)=>void,onDeleteModel:(id:string)=>void,modelSaved:boolean,scoreSavedAt:number|null,dataAsOf:number|null,onOpenFund:(fund:Fund)=>void,apply:(preset?:ScoreModelPreset)=>void}){
  const deferredFactors=useDeferredValue(factors);
  const deferredPeerGroup=useDeferredValue(peerGroup);
  const currentSig=useMemo(()=>scoreFactorsSignature(factors,peerGroup),[factors,peerGroup]);
  const isSavedCurrent=useMemo(()=>hasCurrentPersistentScores(allFunds,deferredFactors,deferredPeerGroup),[allFunds,deferredFactors,deferredPeerGroup]);
  const scoreByCode=useMemo(()=>{
    const map=new Map<number,number>();
    if(isSavedCurrent){
      for(const fund of allFunds){
        const val=fund.metrics?.[SCORE_METRIC_ID];
        if(typeof val==='number'&&Number.isFinite(val))map.set(fund.code,val);
      }
      return map;
    }
    const {scores}=computeScoreArray(allFunds,deferredFactors,deferredPeerGroup);
    for(let i=0;i<allFunds.length;i++){
      const val=scores[i]!;
      if(Number.isFinite(val))map.set(allFunds[i]!.code,val);
    }
    return map;
  },[allFunds,deferredFactors,deferredPeerGroup,isSavedCurrent]);
  const ranked=useMemo(()=>rows.map(fund=>({fund,score:scoreByCode.get(fund.code)??null})).filter(item=>item.score!==null&&Number.isFinite(item.score)).sort((a,b)=>(b.score??-1)-(a.score??-1)).slice(0,25),[rows,scoreByCode]);
  const scoredCount=useMemo(()=>rows.filter(fund=>scoreByCode.has(fund.code)).length,[rows,scoreByCode]);
  const total=factors.reduce((a,b)=>a+b.weight,0);
  const add=(id:string)=>setFactors([...factors,{id,weight:20,direction:metricRegistry.find(m=>m.id===id)?.direction==='lower'?'lower':'higher'}]);
  const peerGroupLabel=(mode:PeerGroupMode)=>mode==='subcategory'?'Sub-category peers':mode==='category_plan'?'Sub-category + Plan':'Whole universe';
  const statusLabel=isSavedCurrent
    ?`Scores saved · computed with daily refresh${dataAsOf?` (as of ${formatEpochMs(dataAsOf)})`:scoreSavedAt?` (${timestampText(scoreSavedAt)})`:''}`
    :'Unsaved weight changes · click Save or Apply to persist scores';
  return <div className="subpage score-layout">
    <div className="subpage-heading">
      <div>
        <div className="eyebrow">PERSISTENT MULTI-FACTOR RANKING</div>
        <h1>Build your <span>score model.</span></h1>
        <p>Scores are precomputed in the backend and locked on daily refresh so they never shift when viewing NAV charts or changing filters.</p>
      </div>
      <div className="heading-actions">
        <button type="button" className="button secondary" onClick={onSaveAsNew} title="Save current weights as a new named model"><Plus size={15}/> Save as new</button>
        <button type="button" className="button secondary" onClick={onSave}><Bookmark size={15}/> {modelSaved?'Saved locally':'Save scores'}</button>
        <button type="button" className="button primary" onClick={()=>apply()}><Sparkles size={15}/> Apply to screener</button>
      </div>
    </div>
    <section className="saved-models-section" aria-label="Saved score models">
      <div className="builder-title">
        <div>
          <span className="eyebrow">MODEL LIBRARY · {savedModels.filter(m=>!m.builtIn).length} CUSTOM SAVED · {savedModels.filter(m=>m.builtIn).length} INSTITUTIONAL PRESETS</span>
          <h2>Saved models &amp; presets</h2>
        </div>
        <span className="preview-count">{activeModel?`Active in Screener: ${modelName}`:'Select a model to edit or apply directly to Screener'}</span>
      </div>
      <div className="saved-models-grid">
        {savedModels.map(preset=>{
          const presetSig=scoreFactorsSignature(preset.factors,preset.peerGroup);
          const isEditing=presetSig===currentSig&&normalizeFilterText(preset.name)===normalizeFilterText(modelName);
          const isScreenerActive=activeModel&&isEditing;
          const presetTotal=preset.factors.reduce((sum,f)=>sum+Math.max(0,f.weight),0);
          return <article key={preset.id} className={`saved-model-card${isEditing?' is-editing':''}${isScreenerActive?' is-active-screener':''}`}>
            <div className="saved-model-head">
              <div>
                <div className="saved-model-badges">
                  <span className={`saved-model-badge ${preset.builtIn?'preset':'custom'}`}>{preset.builtIn?'Preset':'Saved'}</span>
                  <span className="saved-model-badge peer">{peerGroupLabel(preset.peerGroup)}</span>
                  {isScreenerActive&&<span className="saved-model-badge active"><Check size={11}/> Active in Screener</span>}
                  {!isScreenerActive&&isEditing&&<span className="saved-model-badge editing">Loaded in Builder</span>}
                </div>
                <h3>{preset.name}</h3>
                <p>{preset.description}</p>
              </div>
              {!preset.builtIn&&<button type="button" className="icon-button tiny" title={`Delete ${preset.name}`} aria-label={`Delete ${preset.name}`} onClick={()=>onDeleteModel(preset.id)}><Trash2 size={14}/></button>}
            </div>
            <div className="saved-model-factors">
              {preset.factors.map((f,idx)=>{
                const m=metricRegistry.find(item=>item.id===f.id);
                const pctShare=presetTotal?Math.round(f.weight/presetTotal*100):0;
                return <span key={f.id} className="saved-factor-pill"><i style={{background:colorPalette[idx%colorPalette.length]}}/>{m?.label??f.id} <b>{pctShare}%</b></span>;
              })}
            </div>
            <div className="saved-model-foot">
              <small>{preset.savedAt?`Saved ${timestampText(preset.savedAt)}`:'Institutional default weights'}</small>
              <div className="saved-model-actions">
                <button type="button" className="button small secondary" onClick={()=>onLoadModel(preset)}>{isEditing?'Loaded':'Load weights'}</button>
                <button type="button" className="button small primary" onClick={()=>apply(preset)}><Sparkles size={13}/> Apply to screener</button>
              </div>
            </div>
          </article>;
        })}
      </div>
    </section>
    <div className="score-workspace"><section className="model-builder"><div className="builder-title"><div><span className="eyebrow">MODEL BUILDER · {statusLabel}</span><h2>Factors and weights</h2></div><button type="button" className="icon-button small" title={modelSaved?"Saved locally":"Save model"} aria-label={modelSaved?"Model saved locally":"Save model"} onClick={event=>{event.preventDefault();event.stopPropagation();onSave();}}>{modelSaved?<Check size={15}/>:<Bookmark size={15}/>}</button></div><label className="form-label">Model name<input value={modelName} onChange={e=>setModelName(e.target.value)}/></label><div className="share-bar">{factors.map((f,i)=><span key={f.id} style={{width:`${total?f.weight/total*100:0}%`,background:colorPalette[i]}} title={metricRegistry.find(m=>m.id===f.id)?.label}/>)}</div>{factors.map((factor,i)=>{const metric=metricRegistry.find(m=>m.id===factor.id)!;return <div className="factor-row" key={factor.id}><div className="factor-name"><i style={{background:colorPalette[i]}}/><span><b>{metric.label}</b><small>{metric.group} · {metric.description}</small></span><button className="remove-filter" onClick={()=>setFactors(factors.filter(f=>f.id!==factor.id))}><X size={13}/></button></div><div className="factor-controls"><select value={factor.direction} onChange={e=>setFactors(factors.map(f=>f.id===factor.id?{...f,direction:e.target.value as 'higher'|'lower'}:f))}><option value="higher">↑ Higher is better</option><option value="lower">↓ Lower is better</option></select><input type="range" min="0" max="100" value={factor.weight} onChange={e=>setFactors(factors.map(f=>f.id===factor.id?{...f,weight:Number(e.target.value)}:f))}/><input className="weight-input" type="number" min="0" max="100" value={factor.weight} onChange={e=>setFactors(factors.map(f=>f.id===factor.id?{...f,weight:Number(e.target.value)}:f))}/><span className="factor-share">{total?Math.round(factor.weight/total*100):0}%</span></div></div>})}<select className="add-factor-select" value="" onChange={e=>e.target.value&&add(e.target.value)}><option value="">+ Add a score factor</option>{metricRegistry.filter(m=>m.availability!=='unavailable'&&!factors.some(f=>f.id===m.id)).map(m=><option key={m.id} value={m.id}>{m.label} · {m.group}</option>)}</select><div className="peer-group"><div><b>Peer group normalization</b><small>Tie-aware percentile + winsorized z-score across canonical peers.</small></div><select value={peerGroup} onChange={e=>setPeerGroup(e.target.value as PeerGroupMode)}><option value="subcategory">AMFI Sub-category peers (recommended)</option><option value="category_plan">Sub-category + Plan</option><option value="universe">Whole universe</option></select></div><div className="policy-note"><CircleHelp size={15}/><span>Missing metric values score 0, and factor weights are never redistributed. Scores are computed once per daily refresh and cached locally.</span></div><p className="safety-note">Scores rank funds relative to peers using your weights. They are not a prediction or advice.</p></section><section className="preview-panel"><div className="builder-title"><div><span className="eyebrow">PERSISTENT SCORE LEADERBOARD</span><h2>Ranked funds</h2></div><span className="preview-count">{scoredCount.toLocaleString('en-IN')} scored of {rows.length.toLocaleString('en-IN')} in view</span></div><div className="preview-head"><span>RANK</span><span>FUND</span><span className="numeric">SCORE</span></div>{ranked.map(({fund,score},i)=><div className="preview-row" key={fund.code} onClick={()=>onOpenFund(fund)} style={{cursor:'pointer'}} title="Open scheme details"><span className="rank-number">{String(i+1).padStart(2,'0')}</span><div className="preview-fund"><b>{fund.name}</b><small>{fund.subCategory} · {fund.plan}</small></div><div className="preview-score"><b>{score?.toFixed(1)??'—'}</b><div className="mini-score-track"><i style={{width:`${score??0}%`}}/></div></div></div>)}{!ranked.length&&<div className="chart-empty">No scored schemes match the active screener filters.</div>}</section></div></div>;
}
function HealthView({status,aumStatus,terStatus,refreshing,refresh,error,historyError,failedCodes,retryHistory,stage,funds,historyScope,coverage,backfill,progress,historyRunning,historyPaused,toggleHistoryPause}:{status:SourceState,aumStatus:string,terStatus:string,refreshing:boolean,refresh:()=>void,error:string,historyError:string,failedCodes:number[],retryHistory:(codes:number[])=>void,stage:string,funds:Fund[],historyScope:Fund[],coverage:{open_direct_growth?:{total:number;with_history:number};all?:{total:number;with_history:number};failed?:number;pending?:number;last_run?:string}|null,backfill:(batchSize?:number)=>void,progress:{done:number,total:number},historyRunning:boolean,historyPaused:boolean,toggleHistoryPause:()=>void}){
  const unresolvedBenchmarks=benchmarkConfig?.benchmarks.filter(item=>item.status==='unresolved').length??0;
  const quarantinedFunds=funds.filter(fund=>fund.assetClass==='other').length;
  const fundCount=funds.length;
  const coverageLabel=(count:number)=>{const percentage=fundCount?count/fundCount*100:0;return percentage>0&&percentage<0.1?'<0.1%':`${percentage.toFixed(1)}%`;};
  return <div className="subpage">
    <div className="subpage-heading"><div><div className="eyebrow">TRANSPARENCY & COVERAGE</div><h1>Data you can <span>trust and trace.</span></h1><p>Source status, timestamps and limits. Category mandate floors are marked as heuristics.</p></div>{!hostedWeb&&<button className="button secondary" onClick={refresh} disabled={refreshing} title="Refresh sources"><RefreshCw size={15} className={refreshing?'spin':''}/>Refresh sources</button>}</div>
    <section className="health-cards">
            <div className="health-card"><span className="health-status ok"/><div><small>AMFI · Daily NAV catalog</small><b>{status.status==='ok'?'Connected':status.status==='error'?'Refresh failed':'Not refreshed'}</b><span>As of {formatEpochMs(status.dataAsOf)} · fetched {status.fetchedAt?new Date(status.fetchedAt).toLocaleString('en-IN'):'never'}</span></div><span className="health-protocol">PUBLIC</span></div>
      <div className="health-card"><span className={`health-status${historyRunning?' ok':historyPaused?' error-dot':' neutral-dot'}`}/><div><small>MFapi · Historical NAV</small><b>{historyRunning?historyPaused?'History queue paused':'Loading selected schemes':`${historyScope.filter(needsHistory).length.toLocaleString('en-IN')} schemes in this filter set need history`}</b><span>{coverage?.open_direct_growth?`Snapshot coverage: ${coverage.open_direct_growth.with_history.toLocaleString('en-IN')} of ${coverage.open_direct_growth.total.toLocaleString('en-IN')} Direct-Growth schemes · ${coverage.failed??0} failed · ${coverage.pending??0} pending.`:'Only schemes matching the current screener filters are fetched. Their full NAV histories are stored locally.'}</span></div><div className="history-actions"><button className="button small secondary" onClick={()=>backfill(100)} disabled={historyRunning}>Load next 100</button>{failedCodes.length>0&&<button className="button small secondary" onClick={()=>retryHistory(failedCodes)} disabled={historyRunning}>Retry failed ({failedCodes.length})</button>}{historyRunning&&<button className="button small primary" onClick={toggleHistoryPause}>{historyPaused?'Resume':'Pause'}</button>}</div></div>
      <div className="health-card"><span className={`health-status${/needs attention/i.test(aumStatus)||/needs attention/i.test(terStatus)?' error-dot':' neutral-dot'}`}/><div><small>AMFI · Scheme disclosures</small><b>{/needs attention/i.test(aumStatus)||/needs attention/i.test(terStatus)?'Needs attention':/fetching/i.test(aumStatus)||/fetching/i.test(terStatus)?'Importing disclosures':'Disclosure status'}</b><span>Latest published AAUM · {aumStatus}</span><span>Current-month TER · {terStatus}</span></div><span className="health-protocol">PUBLIC</span></div>
    </section>
    <div className="health-grid"><section className="coverage-card"><div className="card-title"><div><span className="eyebrow">FIELD COVERAGE</span><h2>Availability by metric</h2></div><span className="preview-count">{fundCount.toLocaleString('en-IN')} schemes</span></div><div className="coverage-list">{metricRegistry.map(m=>{const unavailable=m.availability==='unavailable';const count=m.id==='plan_type'?funds.filter(f=>f.plan!=='Unknown').length:funds.filter(f=>f.metrics[m.id]!=null).length;const percent=fundCount?count/fundCount*100:0;return <div className="coverage-row" key={m.id}><div><b>{m.label}</b><span>{unavailable?'Unavailable · source not verified':count?`${count.toLocaleString('en-IN')} values`:'Requires NAV history'}</span></div><div className="coverage-track"><i className={unavailable?'coverage-none':''} style={{width:`${unavailable?0:percent}%`}}/></div><strong>{unavailable?'—':coverageLabel(count)}</strong></div>})}</div></section><section className="health-detail"><span className="eyebrow">LAST REFRESH</span><h2>{status.status==='error'?'Refresh needs attention':status.fetchedAt?'Catalog refreshed':'No refresh yet'}</h2><p>{error||(refreshing?stage:'')||status.detail||'The app will refresh when it opens and show your saved data while the request runs.'}</p>{historyError&&<div className="inline-alert" role="status"><span className="alert-dot"/><span>{historyError}</span></div>}<div className="detail-line"><span>Data as of</span><b>{formatEpochMs(status.dataAsOf)}</b></div><div className="detail-line"><span>Last fetched</span><b>{status.fetchedAt?new Date(status.fetchedAt).toLocaleString('en-IN'):'—'}</b></div>{progress.total>0&&<div className="backfill-progress"><span>History queue {progress.done} / {progress.total}</span><div><i style={{width:`${progress.done/progress.total*100}%`}}/></div></div>}<div className="info-callout"><CircleHelp size={15}/><span>AMFI quarterly scheme AAUM and current-month TER load in the background. Taxonomy v{TAXONOMY_VERSION} · benchmark mappings: {unresolvedBenchmarks} proxy candidates remain unverified and are never used for regression. {quarantinedFunds} schemes remain unclassified pending AMFI evidence. {benchmarkConfigValidation.ok ? 'Mapping registry schema is valid.' : 'Mapping registry validation failed.'}</span></div></section></div>
  </div>}
function ClassificationGovernance({funds,onReview,onRerun}:{funds:Fund[],onReview:(code:number,action:'accept_s1'|'rebind_other')=>Promise<void>,onRerun:()=>Promise<void>}){
  const summary=useMemo(()=>summarizeClassification(funds),[funds]);const [diagnostics,setDiagnostics]=useState<Awaited<ReturnType<typeof getClassificationDiagnostics>>|null>(null);const [working,setWorking]=useState(false);const [message,setMessage]=useState('');const fileInput=useRef<HTMLInputElement>(null);
  const loadDiagnostics=()=>void getClassificationDiagnostics().then(setDiagnostics).catch(error=>setMessage(errorText(error)));useEffect(()=>{loadDiagnostics();},[funds.length,summary.conflicts.length,summary.unmapped.length]);
  const decision=async(code:number,action:'accept_s1'|'rebind_other')=>{const fund=funds.find(item=>item.code===code);const question=action==='accept_s1'?`Accept AMFI as the reviewed category for ${fund?.name??code}? This decision will be recorded locally.`:`Rebind ${fund?.name??code} to Other? This manual class change will be recorded locally.`;if(!window.confirm(question))return;setWorking(true);try{await onReview(code,action);setMessage(action==='accept_s1'?'AMFI classification accepted and recorded.':'Manual Other classification recorded.');loadDiagnostics();}catch(error){setMessage(errorText(error));}finally{setWorking(false);}};
  const downloadSample=()=>{const chosen=new Map<number,Fund>();for(const fund of [...summary.unmapped,...summary.conflicts,...summary.plausibilityFlags,...funds.filter(item=>item.assetClass==='other')])chosen.set(fund.code,fund);const buckets=new Map<string,Fund[]>();for(const fund of funds){const key=`${fund.assetClass}\u0000${fund.subCategory}`;buckets.set(key,[...(buckets.get(key)??[]),fund]);}for(const assetClass of ['equity','debt','hybrid','liquid','other']){const groups=[...buckets.entries()].filter(([key])=>key.startsWith(`${assetClass}\u0000`));let index=0;while(chosen.size<30&&groups.length){let added=false;for(const [,items] of groups){const candidate=items[index];if(candidate&&!chosen.has(candidate.code)){chosen.set(candidate.code,candidate);added=true;}}if(!added)break;index++;}}const csv=renderClassificationAuditSample([...chosen.values()]);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='fundscope-classification-audit-sample.csv';link.click();URL.revokeObjectURL(url);};
  const importAudit=async(file?:File)=>{if(!file)return;setWorking(true);try{const records=parseClassificationAuditCsv(await file.text(),funds);if(!records.length)throw new Error('No completed SID audit rows were found.');const result=await importClassificationAudit(records);setMessage(`Imported ${result.imported} audit rows; ${result.disagreements} disagreement${result.disagreements===1?'':'s'} recorded.`);loadDiagnostics();}catch(error){setMessage(errorText(error));}finally{setWorking(false);if(fileInput.current)fileInput.current.value='';}};
  const run=async()=>{setWorking(true);try{await onRerun();setMessage('Classification rules reran against stored source observations.');loadDiagnostics();}catch(error){setMessage(errorText(error));}finally{setWorking(false);}};
  const reasonGroups=useMemo(()=>groupUnclassifiedByReason(funds),[funds]);const unclassifiedCount=reasonGroups.reduce((total,group)=>total+group.funds.length,0);
  const downloadUnclassified=()=>{const quote=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;const unclassified=reasonGroups.flatMap(group=>group.funds);const header=['scheme_code','scheme_name','amc','raw_amfi_scheme_master_category','raw_amfi_navall_category','asset_class','group','sub_category','reason_code','rule_id','lifecycle','lifecycle_reason','nav_date'];const lines=unclassified.map(fund=>[fund.code,fund.name,fund.amc,fund.schemeMaster?.categoryRaw,fund.classDetail?.s1.categoryRaw??fund.category,fund.assetClass,fund.group,fund.subCategory,fund.classificationReason,fund.classRuleId,fund.lifecycle,fund.lifecycleReason,fund.navDate].map(quote).join(','));const url=URL.createObjectURL(new Blob([[header.map(quote).join(','),...lines].join('\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='fundscope-unclassified-review.csv';link.click();URL.revokeObjectURL(url);};
  const copySuggestedRule=async(reason:string,items:Fund[])=>{const first=items[0]!;const raw=first.schemeMaster?.categoryRaw||first.classDetail?.s1.categoryRaw||first.category;const suggestion={status:'REVIEW_REQUIRED',reasonCode:reason,exactAmfiCategory:raw,source:first.schemeMaster?.categoryRaw?'AMFI_SCHEME_MASTER':'AMFI_NAVALL',ruleId:`REVIEW_${reason.replace(/[^A-Z0-9]+/gi,'_').toUpperCase()}`,instruction:'Inspect the AMFI category/header and representative scheme names. Add an explicit taxonomy-tree rule only when AMFI evidence determines the leaf; otherwise retain this reason code.'};const text=JSON.stringify(suggestion,null,2);try{await navigator.clipboard.writeText(text);setMessage(`Copied a review-ready rule stub for ${reason}; it does not assign a category.`);}catch{window.prompt('Copy this review-ready rule stub; it does not assign a category:',text);setMessage(`Opened the rule stub for ${reason}; review AMFI evidence before mapping.`);}};
  const classes=['equity','debt','hybrid','solution','commodity','liquid','other'] as const;const statuses=['CONFIRMED','UNCONFIRMED','CONFLICT_STALE','CONFLICT'] as const;const disputes=summary.conflicts;
  return <div className="subpage classification-page"><div className="subpage-heading"><div><div className="eyebrow">TAXONOMY V{TAXONOMY_VERSION} · REVIEW & PROVENANCE</div><h1>Classification <span>governance.</span></h1><p>AMFI Scheme Master (S0) is primary; the AMFI NAV catalog (S1) is fallback. TER and AAUM corroborate. MFapi is informational only.</p></div><button className="button secondary" onClick={()=>void run()} disabled={working}><RefreshCw size={15} className={working?'spin':''}/> Re-run classification</button></div>
    {message&&<div className="inline-alert"><span className="alert-dot"/><span>{message}</span><button className="icon-button tiny" onClick={()=>setMessage('')}><X size={14}/></button></div>}
    <section className="classification-card"><div className="card-title"><div><span className="eyebrow">CLASS × STATUS</span><h2>{funds.length.toLocaleString('en-IN')} schemes</h2></div><span className="preview-count">S0 AMFI Scheme Master → S1 AMFI NAVAll fallback</span></div><div className="classification-matrix"><div className="matrix-row matrix-header"><span>Asset class</span>{statuses.map(status=><span key={status}>{classificationMessages.status[status]}</span>)}<span>Total</span></div>{classes.map(assetClass=><div className="matrix-row" key={assetClass}><b>{assetClass==='other'?'Unclassified':assetClass==='commodity'?'Gold / Silver':assetClass==='solution'?'Solution-oriented':assetClass[0]!.toUpperCase()+assetClass.slice(1)}</b>{statuses.map(status=><span key={status}>{funds.filter(fund=>fund.assetClass===assetClass&&(fund.classStatus??'UNCONFIRMED')===status).length.toLocaleString('en-IN')}</span>)}<strong>{summary.byClass[assetClass].toLocaleString('en-IN')}</strong></div>)}</div></section>
    <section className="classification-card"><div className="card-title"><div><span className="eyebrow">UNCLASSIFIED REVIEW QUEUE</span><h2>{unclassifiedCount.toLocaleString('en-IN')} schemes · reasons, not guesses</h2><p>Lifecycle counts are based on closure date or the configured 90-day NAV-staleness rule.</p></div><div className="audit-actions"><button className="button secondary" onClick={downloadUnclassified} disabled={!unclassifiedCount}><Download size={14}/> Export all unclassified</button>{unclassifiedCount>0&&<span className="review-badge"><AlertTriangle size={13}/> Review needed</span>}</div></div>{reasonGroups.length?reasonGroups.map(group=>{const {reasonCode:reason,funds:items,activeCount:active,dormantCount:dormant,unknownLifecycleCount,sourceLabels:rawCategories}=group;return <details className="unclassified-reason" key={reason}><summary><span><b>{reason}</b><small>{rawCategories.slice(0,2).join(' · ')||'AMFI category not recorded'}</small></span><span className="reason-counts"><b>{items.length.toLocaleString('en-IN')}</b><small>{active.toLocaleString('en-IN')} active · {dormant.toLocaleString('en-IN')} dormant{unknownLifecycleCount?` · ${unknownLifecycleCount} lifecycle unknown`:''}</small></span></summary><div className="reason-detail"><div className="reason-toolbar"><span>{rawCategories.length.toLocaleString('en-IN')} distinct source label{rawCategories.length===1?'':'s'}</span><button className="button small secondary" onClick={event=>{event.preventDefault();void copySuggestedRule(reason,items);}}>Copy suggested rule stub</button></div><div className="classification-table-wrap"><table className="classification-table"><thead><tr><th>Scheme</th><th>AMFI Scheme Master (S0)</th><th>AMFI NAVAll (S1)</th><th>Lifecycle</th></tr></thead><tbody>{items.slice(0,100).map(fund=><tr key={fund.code}><td><b>{fund.name}</b><small>{fund.code} · {fund.amc}</small></td><td>{fund.schemeMaster?.categoryRaw??classificationMessages.unknown}</td><td>{fund.classDetail?.s1.categoryRaw??fund.category??classificationMessages.unknown}</td><td>{fund.lifecycle==='dormant'?`Dormant · ${fund.lifecycleReason==='CLOSED'?'closed':'no recent NAV'}`:fund.lifecycle==='active'?'Active':'Not recorded'}</td></tr>)}</tbody></table>{items.length>100&&<p className="classification-note">Showing first 100 schemes. Export all unclassified for the complete list.</p>}</div></div></details>;}):<p className="classification-empty"><BadgeCheck size={15}/> No schemes are currently unclassified.</p>}{diagnostics?.unmapped.length? <details className="raw-unmapped"><summary>Unrecognized source-label observations ({diagnostics.unmapped.length})</summary><div className="classification-table-wrap"><table className="classification-table"><thead><tr><th>Raw source value</th><th>Source</th><th>Schemes</th><th>Last seen</th></tr></thead><tbody>{diagnostics.unmapped.map(item=><tr key={`${item.categoryKey}-${item.sourceId}`}><td><b>{item.sampleRaw||item.categoryKey}</b></td><td>{item.sourceId}</td><td>{item.schemeCount.toLocaleString('en-IN')}</td><td>{timestampText(item.lastSeen)}</td></tr>)}</tbody></table></div></details>:null}</section>
    <section className="classification-card"><div className="card-title"><div><span className="eyebrow">CONFLICTS & CATEGORY DRIFT</span><h2>{disputes.length.toLocaleString('en-IN')} schemes need review</h2><p>MFapi metadata is shown as context and never enters the AMFI classification vote.</p></div></div>{disputes.length?<div className="classification-table-wrap"><table className="classification-table"><thead><tr><th>Scheme</th><th>S0 · AMFI Master</th><th>S1 · AMFI NAVAll</th><th>S2 · MFapi · info</th><th>S3 · AMFI TER</th><th>S4 · AMFI AAUM</th><th>Flags</th><th>Actions</th></tr></thead><tbody>{disputes.map(fund=><tr key={fund.code}><td><b>{fund.name}</b><small>{fund.code} · bound {fund.assetClass} · {fund.classRuleId}</small></td><td>{fund.classDetail?.s0?.categoryRaw??classificationMessages.unknown}</td><td>{fund.classDetail?.s1.categoryRaw??fund.category}</td><td>{fund.classDetail?.s2?.categoryRaw??classificationMessages.unknown}</td><td>{fund.classDetail?.s3?.categoryRaw??classificationMessages.unknown}</td><td>{fund.classDetail?.s4?.categoryRaw??classificationMessages.unknown}</td><td>{fund.classDetail?.flags.join(', ')||classificationMessages.review}</td><td><div className="governance-actions"><button className="button small secondary" disabled={working} onClick={()=>void decision(fund.code,'accept_s1')}>Accept S1</button><button className="button small secondary" disabled={working} onClick={()=>void decision(fund.code,'rebind_other')}>Rebind Other</button></div></td></tr>)}</tbody></table></div>:<p className="classification-empty"><BadgeCheck size={15}/> {classificationMessages.confirmed}</p>}</section>
    <section className="classification-card"><div className="card-title"><div><span className="eyebrow">LOCAL-HISTORY PLAUSIBILITY CHECKS</span><h2>{summary.plausibilityFlags.length.toLocaleString('en-IN')} candidates</h2></div></div>{summary.plausibilityFlags.length?<div className="classification-table-wrap"><table className="classification-table"><thead><tr><th>Scheme</th><th>Class</th><th>Category</th><th>Flags</th></tr></thead><tbody>{summary.plausibilityFlags.map(fund=><tr key={fund.code}><td>{fund.name}</td><td>{fund.assetClass}</td><td>{fund.subCategory}</td><td>{fund.classDetail?.flags.filter(flag=>flag.startsWith('PLAUS_')).join(', ')}</td></tr>)}</tbody></table></div>:<p className="classification-empty">Plausibility checks appear after sufficient local NAV and peer history is available. They never change the AMFI classification.</p>}</section>
    <section className="classification-card audit-card"><div className="card-title"><div><span className="eyebrow">S5 HUMAN AUDIT</span><h2>{diagnostics?.auditCount??0} recorded audit rows</h2><p>{diagnostics?.auditCount?`${(diagnostics.agreements/diagnostics.auditCount*100).toFixed(1)}% agreement · `:''}{diagnostics?.lastAuditAt?`Last audit ${timestampText(diagnostics.lastAuditAt)}`:'No audit imported yet.'}</p></div><div className="audit-actions"><button className="button secondary" onClick={downloadSample}><Download size={14}/> Download SID sample</button><button className="button secondary" disabled={working} onClick={()=>fileInput.current?.click()}><Upload size={14}/> Import results</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={event=>void importAudit(event.currentTarget.files?.[0])}/></div></div><p className="classification-note">Fill SID category, SID URL and expected class from the Scheme Information Document. The import records disagreements against the current binding.</p></section>
  </div>;
}
function SettingsView({theme,setTheme,riskFree,density,setDensity,hosted,status,snapshotUpdate,onApplySnapshotUpdate,onLock,sessionDays,onSessionDaysChange}:{theme:'light'|'dark',setTheme:(v:'light'|'dark')=>void,riskFree:number,density:string,setDensity:(v:'comfortable'|'compact')=>void,hosted:boolean,status:SourceState,snapshotUpdate?:{keyChanged:boolean;applying?:boolean;error?:string}|null,onApplySnapshotUpdate?:()=>void,onLock?:()=>void,sessionDays:string,onSessionDaysChange?:(value:string)=>void}){
  const dataAsOf=status.dataAsOf===null?'Unavailable':formatEpochMs(status.dataAsOf);
  const fetchedAt=status.fetchedAt===null?'Unavailable':timestampText(status.fetchedAt);
  return <div className="subpage settings-page">
    <div className="subpage-heading"><div><div className="eyebrow">PERSONAL PREFERENCES</div><h1>Your desk, <span>your defaults.</span></h1><p>Preferences are stored locally on this device.</p></div></div>
    <div className="settings-card">
      <div className="setting-row"><div><b>Appearance</b><small>Choose a light or dark workspace.</small></div><div className="segmented"><button className={theme==='light'?'selected':''} onClick={()=>setTheme('light')}><Sun size={14}/> Light</button><button className={theme==='dark'?'selected':''} onClick={()=>setTheme('dark')}><Moon size={14}/> Dark</button></div></div>
      <div className="setting-row"><div><b>Table density</b><small>Set the default row height.</small></div><select value={density} onChange={e=>setDensity(e.target.value as 'comfortable'|'compact')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
      <div className="setting-row"><div><b>Risk-free benchmark</b><small>Industry-standard rate ({INDUSTRY_RISK_FREE_BENCHMARK}) used across Sharpe, Sortino, Omega, Treynor, and Jensen&apos;s alpha.</small></div><span className="local-badge"><ShieldCheck size={13}/> {riskFree.toFixed(2)}% p.a. · {INDUSTRY_RISK_FREE_BENCHMARK}</span></div>
      <div className="setting-row"><div><b>Storage</b><small>{hosted?'Encrypted snapshot and device unlock are stored locally.':'Database runs locally on this device.'}</small></div><span className="local-badge"><Database size={13}/> On this device</span></div>
      {hosted&&<div className="setting-row"><div><b>Data snapshot</b><small>Catalog updates are published automatically each night. Data as of {dataAsOf} · last fetched {fetchedAt}.</small><small>{snapshotUpdate?(snapshotUpdate.keyChanged?'The snapshot key changed. Reload and unlock with the updated passphrase.':snapshotUpdate.applying?'Applying the encrypted update…':'A newer snapshot is ready to load.'):'No newer snapshot is currently available.'}</small>{snapshotUpdate?.error&&<small role="alert" className="text-danger">{snapshotUpdate.error}</small>}</div><div className="snapshot-setting-actions"><span className={'local-badge' + (snapshotUpdate?' snapshot-update-ready':'')}><RefreshCw size={13}/> {snapshotUpdate?(snapshotUpdate.keyChanged?'Unlock required':snapshotUpdate.applying?'Updating…':'Update ready'):'Nightly'}</span>{snapshotUpdate&&<button className="button secondary" disabled={snapshotUpdate.applying} onClick={onApplySnapshotUpdate}>{snapshotUpdate.keyChanged?'Reload & unlock':snapshotUpdate.applying?'Updating…':'Update now'}</button>}</div></div>}
      {hosted&&<><div className="setting-row"><div><b>Ask again after</b><small>Controls how long this browser profile can unlock without the shared passphrase.</small></div><select value={sessionDays} onChange={event=>onSessionDaysChange?.(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="never">Never</option></select></div><div className="setting-row"><div><b>Lock & clear</b><small>Remove the saved device key and return to the passphrase screen.</small></div><button className="button secondary" onClick={onLock}><LockKeyhole size={15}/> Lock & clear</button></div></>}
    </div>
  </div>;
}
function ClassificationPanel({fund}:{fund:Fund}){const detail=fund.classDetail;const status=fund.classStatus??'UNCONFIRMED';const message=status==='CONFLICT'?classificationMessages.review:status==='CONFIRMED'?classificationMessages.confirmed:classificationMessages.unconfirmed;const sourceName:Record<string,string>={AMFI_SCHEME_MASTER:'AMFI Scheme Master (S0)',AMFI_NAVALL:'AMFI NAV catalog (S1)',AMFI_TER:'AMFI TER (S3)',AMFI_AAUM:'AMFI AAUM (S4)',AMFI_RULE:'AMFI rule'};const fields=[['assetClass','Asset class'],['group','Group'],['subCategory','Category'],['management','Management'],['riskBand','Category-implied risk band'],['philosophy','Investment philosophy'],['speciality','Speciality'],['lifecycle','Lifecycle']] as const;const genericS0=['income','growth','other scheme','not specified'].includes(normalizeFilterText(detail?.s0?.categoryRaw??''));const appliedSource=detail?.s0&&!genericS0?classificationMessages.source.s0_amfi_master:classificationMessages.source.s1_navall;const appliedCategory=detail?.s0&&!genericS0?detail.s0.categoryRaw:detail?.s1.categoryRaw??fund.category;return <section className="drawer-section classification-drawer"><div className="section-label"><span>CLASSIFICATION</span><span className={`status-chip status-${status.toLowerCase()}`}>{status==='CONFLICT'?<AlertTriangle size={12}/>:status==='CONFIRMED'?<BadgeCheck size={12}/>:<CircleHelp size={12}/>} {classificationMessages.status[status]}</span></div><div className="classification-badges"><span className="asset-class-badge">{fund.assetClass==='other'?'Unclassified':fund.assetClass==='commodity'?'Gold / Silver':fund.assetClass}</span><span>{fund.classRuleId}</span><span>Taxonomy v{fund.taxonomyVersion}</span></div><p><b>Applied AMFI category · {appliedSource}</b><span>{appliedCategory}</span></p><p><b>Group / category</b><span>{fund.group??'Not specified'} / {fund.subCategory}</span></p><small>{message}</small>{detail?.flags.length? <div className="classification-flag-list">{detail.flags.map(flag=><span key={flag}>{flag}</span>)}</div>:null}<details className="classification-why"><summary>Why this classification?</summary><div className="classification-provenance"><b>{classificationMessages.source.s0_amfi_master}</b><span>{detail?.s0?`${detail.s0.categoryRaw} · ${timestampText(detail.s0.observedAt)}`:'Not available; S1 fallback applies'}</span><b>{classificationMessages.source.s1_navall}</b><span>{detail?.s1.categoryRaw??classificationMessages.unknown} · {detail?.s1.observedAt?timestampText(detail.s1.observedAt):classificationMessages.unknown}</span><b>{classificationMessages.source.s2_mfapi}</b><span>{detail?.s2?`${detail.s2.categoryRaw} · ${timestampText(detail.s2.observedAt)} · informational only, not a vote`: 'Not available; NAV history source only'}</span><b>{classificationMessages.source.s3_amfi_ter}</b><span>{detail?.s3?`${detail.s3.categoryRaw} · ${timestampText(detail.s3.observedAt)}`:classificationMessages.unknown}</span><b>{classificationMessages.source.s4_amfi_aum}</b><span>{detail?.s4?`${detail.s4.categoryRaw} · ${timestampText(detail.s4.observedAt)}`:classificationMessages.unknown}</span><b>Field-level provenance</b>{fields.map(([key,label])=>{const provenance=fund.classificationProvenance?.[key];const value=key==='speciality'?fund.speciality?.join(', ')||'None':String((fund as unknown as Record<string,unknown>)[key]??'Not specified');return <span key={key}>{label}: {value} · {provenance?`${provenance.ruleId} · ${sourceName[provenance.source]??provenance.source}`:'source not recorded'}</span>})}<b>Risk label</b><span>Category-implied, not the scheme&apos;s official riskometer. NAVAll does not provide the official riskometer.</span></div></details></section>}
function FundDrawer({fund,unavailable,loading,onRetryHistory,onClose,inCompare=false,onCompare,riskWindow,riskFree=DEFAULT_RISK_FREE_RATE_PERCENT}:{fund:Fund,unavailable:boolean,loading:boolean,onRetryHistory:()=>void,onClose:()=>void,inCompare?:boolean,onCompare:()=>void,riskWindow:number,riskFree?:number}){
  const drawerRef=useRef<HTMLElement>(null);const closeTimer=useRef<number|undefined>(undefined);const closingRef=useRef(false);const [isClosing,setIsClosing]=useState(false);const onCloseRef=useRef(onClose);onCloseRef.current=onClose;
  const enrichedFund=useMemo(()=>ensureFundMetricsComputed(fund,riskWindow,riskFree),[fund,riskWindow,riskFree]);
  const metricGroups=useMemo(()=>{
    const groups=new Map<string,MetricDefinition[]>();
    for(const m of metricRegistry){
      const list=groups.get(m.group)??[];
      list.push(m);
      groups.set(m.group,list);
    }
    return [...groups.entries()];
  },[]);
  const closeSmooth=()=>{if(closingRef.current)return;closingRef.current=true;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){onCloseRef.current();return;}setIsClosing(true);closeTimer.current=window.setTimeout(()=>onCloseRef.current(),320);};
  useEffect(()=>{const onPointerDown=(event:PointerEvent)=>{if(window.matchMedia('(max-width: 767px)').matches)return;if(event.target instanceof Node&&!drawerRef.current?.contains(event.target))closeSmooth();};const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();closingRef.current=true;if(closeTimer.current!==undefined)window.clearTimeout(closeTimer.current);onCloseRef.current();}};document.addEventListener("pointerdown",onPointerDown);window.addEventListener("keydown",onKeyDown);return()=>{document.removeEventListener("pointerdown",onPointerDown);window.removeEventListener("keydown",onKeyDown);if(closeTimer.current!==undefined)window.clearTimeout(closeTimer.current);};},[]);
  const headlineReturnId=enrichedFund.metrics.cagr_3y!=null?'cagr_3y':enrichedFund.metrics.cagr_1y!=null?'cagr_1y':'absolute_return_6m';
  const headlineReturnLabel=headlineReturnId==='cagr_3y'?'3Y CAGR':headlineReturnId==='cagr_1y'?'1Y CAGR':'6M RETURN';
  const headlineReturnVal=enrichedFund.metrics[headlineReturnId];
  return <><button type="button" className={`drawer-scrim${isClosing?" closing":""}`} onClick={closeSmooth} aria-label="Close fund details"/><aside ref={drawerRef} className={`fund-drawer${isClosing?" closing":""}`}>
    <div className="drawer-header"><div><span className="eyebrow">FUND DETAIL · #{enrichedFund.code}</span><button type="button" className="drawer-close" onClick={closeSmooth} aria-label="Close fund details"><X size={18}/></button><h2>{enrichedFund.name}</h2><p>{enrichedFund.amc}</p><div className="drawer-chips"><span title={`Asset class ${enrichedFund.assetClass}; rule ${enrichedFund.classRuleId}; taxonomy v${enrichedFund.taxonomyVersion}`}>{enrichedFund.subCategory}</span><span>{enrichedFund.plan}</span><span>{enrichedFund.option}</span>{enrichedFund.riskBand&&enrichedFund.riskBand!=='Not specified'&&<span>{enrichedFund.riskBand} risk</span>}</div></div></div>
    <div className="drawer-hero-strip">
      <div className="drawer-hero-metric"><small>LATEST NAV</small><b>₹{Number.isFinite(enrichedFund.nav)?enrichedFund.nav.toFixed(4):'—'}</b><span>As of {dateText(enrichedFund.navDate)}</span></div>
      <div className="drawer-hero-metric"><small>{headlineReturnLabel}</small><b className={headlineReturnVal!=null&&headlineReturnVal!==0?(headlineReturnVal>0?'val-pos':'val-neg'):''}>{pct(headlineReturnVal)}</b><span>Vintage: {fmt(enrichedFund.metrics.scheme_vintage_years,'years')}</span></div>
      <div className="drawer-hero-metric"><small>EXPENSE &amp; SIZE</small><b>TER {fmt(enrichedFund.metrics.ter_pct,'%')}</b><span>AUM: {fmt(enrichedFund.metrics.aum_cr,'₹ Cr')}</span></div>
    </div>
    <div className="drawer-actions"><button type="button" className="button primary" onClick={onCompare}><GitCompareArrows size={15}/> {inCompare?'Remove from compare':'Add to compare'}</button><button type="button" className="button secondary" onClick={closeSmooth}>Close</button></div>
    <section className="drawer-section"><div className="card-title"><div><span className="eyebrow">GROWTH OF ₹10,000</span><h2>Historical value</h2></div><span className="approx-badge">NAV</span></div>{enrichedFund.history.length>0?<GrowthChart funds={[enrichedFund]} loading={loading}/>:<div className="chart-empty"><Activity size={22}/><span>{loading?"Loading this scheme's NAV history…":unavailable?"NAV history could not be loaded.":"Loading this scheme's NAV history…"}</span>{!loading&&<button className="link-button" onClick={onRetryHistory}>Retry NAV history</button>}</div>}</section>
    <section className="drawer-section"><div className="section-label"><span>KEY STATS · {riskWindow}Y RISK WINDOW</span><span>{enrichedFund.history.length?`${enrichedFund.history.length.toLocaleString('en-IN')} pts`:'On-demand'}</span></div><div className="stat-grid">{['absolute_return_3m','absolute_return_6m','cagr_1y','cagr_3y','cagr_5y','std_dev','sharpe','sortino','max_drawdown'].map(id=>{const metric=metricRegistry.find(m=>m.id===id)!;const val=enrichedFund.metrics[id];const insight=explainMetricForFund(enrichedFund,metric,riskWindow);const tone=RETURN_COLOR_METRIC_IDS.has(id)&&val!=null&&Number.isFinite(val)&&val!==0?(val>0?'val-pos':'val-neg'):'';return <div className="stat-tile" key={id} title={`${insight.whatItTellsYou} ${insight.inContext}`}><span>{metric.label}</span><b className={tone}>{fmt(val,metric.unit)}</b><small className={val==null?'is-missing':'is-ready'}>{metric.availability==='unavailable'?'Unavailable: source not verified':val==null?metricReasonText(enrichedFund,id,metric.label):metricContextText(enrichedFund,id)}</small></div>})}</div></section>
    <section className="drawer-section metric-accordion"><div className="section-label"><span>METRICS &amp; DEFINITIONS</span><span>{metricRegistry.filter(m=>enrichedFund.metrics[m.id]!=null).length} computed</span></div>{metricGroups.map(([groupName,metrics])=><div className="metric-group-block" key={groupName}><div className="metric-group-label">{groupName}</div>{metrics.map(m=>{const val=enrichedFund.metrics[m.id];const insight=explainMetricForFund(enrichedFund,m,riskWindow);const tone=RETURN_COLOR_METRIC_IDS.has(m.id)&&val!=null&&Number.isFinite(val)&&val!==0?(val>0?'val-pos':'val-neg'):'';return <details key={m.id}><summary title={val==null?metricReasonText(enrichedFund,m.id,m.label):metricContextText(enrichedFund,m.id)}><span>{m.label}</span><b className={tone}>{m.id==='plan_type'?enrichedFund.plan:fmt(val,m.unit)}</b></summary><div className="metric-insight-body"><p className="metric-insight-what"><b>What this tells you:</b> {insight.whatItTellsYou}</p><p className="metric-insight-context"><b>In context for this fund:</b> {insight.inContext}</p></div></details>;})}</div>)}</section>
    <div className="drawer-nav"><FundBenchmarkSection fund={enrichedFund}/></div>
    <ClassificationPanel fund={enrichedFund}/>
    <div className="drawer-quality"><CircleHelp size={14}/><span>{enrichedFund.history.length?`${enrichedFund.history.length.toLocaleString('en-IN')} NAV observations loaded (${dateText(enrichedFund.history[0]?.date??null)} – ${dateText(enrichedFund.history.at(-1)?.date??null)}).`:unavailable?"History load failed; retry to fetch this scheme again.":'NAV history is loading automatically for this scheme.'}</span></div>
  </aside></>;
}

export default App;
