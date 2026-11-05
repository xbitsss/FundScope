import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, GitCompareArrows, RefreshCw, TableProperties, X } from 'lucide-react';
import type { Fund, MetricDefinition } from '../../domain/types';
import { metricRegistry } from '../../domain/metrics/registry';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';
import type { MetricDirection, QuadrantId } from '../../domain/scatter/quadrants';
import { bestQuadrant, quadrantName } from '../../domain/scatter/quadrants';
import { formatEpochMs, formatAxisTitle } from '../../domain/scatter/presentation';
import { reasonMessage } from '../../domain/governance/reasonMessages';
import type { ReasonDetail } from '../../domain/governance/reasons';
import type { ScreenerEngineClient } from '../../engine/engineClient';
import type { ScatterPreferences, ScatterSort } from './types';
import { MetricAxisPicker } from './MetricAxisPicker';
import { ScatterChart } from './ScatterChart';
import { ScatterTable } from './ScatterTable';
import { colorPalette } from '../colorPalette';
import presets from '../../../config/scatter-presets.json';

const numericMetrics = metricRegistry.filter(metric => metric.unit !== 'enum');
const metricById = new Map(numericMetrics.map(metric => [metric.id, metric]));
const rawPresets = presets as Array<{ id: string; label: string; x: string; y: string }>;
const validPresets = rawPresets.filter(preset => metricById.has(preset.x) && metricById.has(preset.y));
function defaultDirection(metric: MetricDefinition): MetricDirection { return metric.direction === 'higher' || metric.direction === 'lower' ? metric.direction : 'none'; }
function displayValue(value: number, metric: MetricDefinition) {
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
  return metric.unit === '%' ? `${text}%` : metric.unit === '₹ Cr' ? `₹${text} Cr` : metric.unit === 'years' ? `${text} yr` : metric.unit === 'ratio' ? `${text}x` : text;
}
function splitLabel(rule: string) { return rule === 'peer-median' ? 'Peer median' : rule === 'median' ? 'Median of selected' : rule === 'mean' ? 'Mean of selected' : 'Custom'; }
function reasonText(metricId: string, code: string, detail?: ReasonDetail) {
  const label = metricById.get(metricId)?.label ?? metricId;
  if (detail) return reasonMessage(detail, label);
  if (code === 'INSUFFICIENT_HISTORY') return `${label} is unavailable because the fund history is too short.`;
  if (code === 'DATA_GAPS') return `${label} is unavailable because its history has gaps.`;
  if (code === 'NA_CATEGORY') return `${label} does not apply to this category.`;
  if (code === 'NO_BENCHMARK') return `${label} needs an approved benchmark series.`;
  return `${label} has no verified value in local data.`;
}

export function ScatterTab({ engine, comparedFunds, universeRevision, preferences, onPreferencesChange, onOpenFund, onAddCompare, onBack, dataAsOf, riskWindow }: {
  engine: ScreenerEngineClient; comparedFunds: Fund[]; universeRevision: Fund[]; preferences: ScatterPreferences;
  onPreferencesChange: (preferences: ScatterPreferences) => void; onOpenFund: (code: number) => void; onAddCompare: (code: number) => void;
  onBack: () => void; dataAsOf: number | null; riskWindow: 1 | 3 | 5;
}) {
  const [result, setResult] = useState<ScatterQueryResult | null>(null); const [resultKey, setResultKey] = useState(''); const [resultSelectionKey, setResultSelectionKey] = useState(''); const [resultUniverse, setResultUniverse] = useState<Fund[] | null>(null); const [querying, setQuerying] = useState(true); const [queryError, setQueryError] = useState('');
  const [sort, setSort] = useState<ScatterSort>({ by: 'name', desc: false }); const [highlighted, setHighlighted] = useState<QuadrantId | null>(null);
  const [mobileOptions, setMobileOptions] = useState(false); const requestSequence = useRef(0); const svgHost = useRef<HTMLDivElement>(null);
  const selectedCodes = useMemo(() => comparedFunds.map(fund => fund.code), [comparedFunds]);
  const xMetric = metricById.get(preferences.x) ?? metricById.get('std_dev')!; const yMetric = metricById.get(preferences.y) ?? metricById.get('cagr_3y')!;
  const selectedPreset = validPresets.find(preset => preset.x === preferences.x && preset.y === preferences.y)?.id ?? 'custom';
  const dirX = preferences.directionOverrides[xMetric.id] ?? defaultDirection(xMetric); const dirY = preferences.directionOverrides[yMetric.id] ?? defaultDirection(yMetric);
  const queryKey = [xMetric.id, yMetric.id, dirX, dirY, preferences.splitRule, preferences.customX ?? '', preferences.customY ?? ''].join('|');
  const selectionKey = selectedCodes.join(',');
  const selectedColors = useMemo(() => Object.fromEntries(comparedFunds.map((fund, index) => [fund.code, colorPalette[index % colorPalette.length]!])), [comparedFunds]);

  useEffect(() => {
    const request = ++requestSequence.current; setQuerying(true); setQueryError('');
    void engine.scatter({ xMetric: xMetric.id, yMetric: yMetric.id, dirX, dirY, selectedCodes, splitRule: preferences.splitRule, customX: preferences.customX, customY: preferences.customY })
      .then(({ result: next }) => { if (request !== requestSequence.current) return; setResult(next); setResultKey(queryKey); setResultSelectionKey(selectionKey); setResultUniverse(universeRevision); setQuerying(false); })
      .catch(error => { if (request !== requestSequence.current) return; setQueryError(error instanceof Error ? error.message : String(error)); setQuerying(false); });
    return () => { requestSequence.current++; };
  }, [engine, queryKey, selectionKey, universeRevision]);

  const setPreference = <K extends keyof ScatterPreferences>(key: K, value: ScatterPreferences[K]) => onPreferencesChange({ ...preferences, [key]: value });
  const setDirection = (metric: MetricDefinition, direction: MetricDirection) => onPreferencesChange({ ...preferences, directionOverrides: { ...preferences.directionOverrides, [metric.id]: direction } });
  const swapAxes = () => onPreferencesChange({ ...preferences, x: preferences.y, y: preferences.x });
  const applyPreset = (id: string) => { const preset = validPresets.find(item => item.id === id); if (preset) onPreferencesChange({ ...preferences, x: preset.x, y: preset.y }); };
  const sortTable = (next: ScatterSort) => setSort(current => ({ ...next, desc: current.by === next.by ? !current.desc : next.desc }));
  const visibleResult = useMemo(() => {
    if (!result || resultKey !== queryKey || resultUniverse !== universeRevision) return null;
    const allowed = new Set(selectedCodes); const indices = Array.from(result.codes, (_, index) => index).filter(index => allowed.has(result.codes[index]!));
    const subset = <T extends Uint8Array | Uint32Array | Float32Array>(values: T): T => new (values.constructor as { new (data: number[]): T })(indices.map(index => values[index]!));
    const selectionChanged = resultSelectionKey !== selectionKey;
    return { ...result, codes: subset(result.codes), x: subset(result.x), y: subset(result.y), quadrants: selectionChanged ? new Uint8Array(indices.length) : subset(result.quadrants), selected: new Uint8Array(indices.length).fill(1), percentileX: subset(result.percentileX), percentileY: subset(result.percentileY), rankX: subset(result.rankX), rankY: subset(result.rankY), names: indices.map(index => result.names[index]!), amcs: indices.map(index => result.amcs[index]!), categories: indices.map(index => result.categories[index]!), assetClasses: indices.map(index => result.assetClasses[index]!), notPlotted: result.notPlotted.filter(item => allowed.has(item.code)), selectedCount: selectedCodes.length, thresholds: selectionChanged ? { ...result.thresholds, x: null, y: null, notice: 'Updating the split reference for the current selection…' } : result.thresholds };
  }, [result, resultKey, queryKey, resultSelectionKey, resultUniverse, universeRevision, selectionKey]);
  const selectionCoverage = useMemo(() => {
    const coverage: Record<string, number> = {}; const reasons: Record<string, string> = {};
    for (const fund of comparedFunds) for (const [id, value] of Object.entries(fund.metrics)) {
      if (typeof value === 'number' && Number.isFinite(value)) coverage[id] = (coverage[id] ?? 0) + 1;
      else if (!reasons[id] && fund.metricReasons?.[id]) reasons[id] = fund.metricReasons[id]!;
    }
    return { coverage, reasons };
  }, [comparedFunds]);
  const plottedIndices = useMemo(() => new Map<number, number>(visibleResult ? Array.from(visibleResult.codes, (code, index) => [code, index]) : []), [visibleResult]);
  const missingFunds = useMemo(() => {
    const missing = new Map<number, { name: string; reasons: string[] }>();
    for (const item of visibleResult?.notPlotted ?? []) { const current = missing.get(item.code) ?? { name: item.name, reasons: [] }; current.reasons.push(reasonText(item.metricId, item.reason, item.detail)); missing.set(item.code, current); }
    return missing;
  }, [visibleResult]);
  const plottedCount = visibleResult?.codes.length ?? 0; const selectedCount = comparedFunds.length;
  const thresholdReady = plottedCount >= 2 && visibleResult?.thresholds.x !== null && visibleResult?.thresholds.x !== undefined && visibleResult?.thresholds.y !== null && visibleResult?.thresholds.y !== undefined;
  const thresholdLabel = visibleResult ? splitLabel(visibleResult.thresholds.rule) : splitLabel(preferences.splitRule);
  const activeSplitValue = visibleResult?.thresholds.rule ?? preferences.splitRule;
  const dateLabel = formatEpochMs(dataAsOf);

  const exportPng = () => {
    const source = svgHost.current?.querySelector('svg'); if (!source) return;
    const svgText = new XMLSerializer().serializeToString(source);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => {
      if (typeof OffscreenCanvas === 'undefined') { URL.revokeObjectURL(url); return; }
      const surface = new OffscreenCanvas(Math.max(800, source.clientWidth * 2), Math.max(450, source.clientHeight * 2));
      const context = surface.getContext('2d'); if (context) { context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff'; context.fillRect(0, 0, surface.width, surface.height); context.drawImage(image, 0, 0, surface.width, surface.height); void surface.convertToBlob({ type: 'image/png' }).then(output => { const link = document.createElement('a'); const pngUrl = URL.createObjectURL(output); link.href = pngUrl; link.download = 'fundscope-scatter.png'; link.click(); URL.revokeObjectURL(pngUrl); }).catch(() => undefined); }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url); image.src = url;
  };
  const pointQuadrantCounts = [0, 0, 0, 0];
  if (visibleResult && thresholdReady) for (const quadrant of visibleResult.quadrants) pointQuadrantCounts[quadrant] = (pointQuadrantCounts[quadrant] ?? 0) + 1;

  const controls = <>
    <div className="scatter-axis-row">
      <MetricAxisPicker axis="X" metricId={xMetric.id} metrics={numericMetrics} coverage={selectionCoverage.coverage} coverageReasons={selectionCoverage.reasons} selectedCount={selectedCount} direction={dirX} onMetricChange={id => setPreference('x', id)} onDirectionChange={direction => setDirection(xMetric, direction)}/>
      <button type="button" className="scatter-swap" onClick={swapAxes} aria-label="Swap X and Y axes">⇄ <span>Swap</span></button>
      <MetricAxisPicker axis="Y" metricId={yMetric.id} metrics={numericMetrics} coverage={selectionCoverage.coverage} coverageReasons={selectionCoverage.reasons} selectedCount={selectedCount} direction={dirY} onMetricChange={id => setPreference('y', id)} onDirectionChange={direction => setDirection(yMetric, direction)}/>
    </div>
    <div className="scatter-options-row">
      <label><span>Preset</span><select value={selectedPreset} onChange={event => applyPreset(event.target.value)}><option value="custom">Custom axes</option>{validPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label><span>Split at</span><select value={activeSplitValue} onChange={event => setPreference('splitRule', event.target.value as ScatterPreferences['splitRule'])}>
        <option value="peer-median" disabled={(visibleResult?.thresholds.peerCount ?? 0) < 10}>Peer median{(visibleResult?.thresholds.peerCount ?? 0) < 10 ? ' · needs 10 peers' : ` · ${visibleResult?.thresholds.peerCount} peers`}</option><option value="median" disabled={plottedCount < 3}>Median of selected · needs 3 funds</option><option value="mean" disabled={plottedCount < 2}>Mean of selected · needs 2 funds</option><option value="custom">Custom</option>
      </select></label>
      {preferences.splitRule === 'custom' && <div className="scatter-custom-splits"><label><span>X split · {xMetric.unit}</span><input aria-label={`X split in ${xMetric.unit}`} type="number" value={preferences.customX ?? ''} onChange={event => { const raw = event.target.value; setPreference('customX', raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : null); }}/></label><label><span>Y split · {yMetric.unit}</span><input aria-label={`Y split in ${yMetric.unit}`} type="number" value={preferences.customY ?? ''} onChange={event => { const raw = event.target.value; setPreference('customY', raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : null); }}/></label></div>}
      <label className="scatter-toggle"><input type="checkbox" checked={preferences.bestAtTopRight} onChange={event => setPreference('bestAtTopRight', event.target.checked)}/>Best at top-right</label>
    </div>
  </>;

  return <section className="scatter-tab" aria-labelledby="scatter-heading">
    <header className="scatter-tab-head"><div><span className="eyebrow">COMPARE · LOCAL METRICS</span><h2 id="scatter-heading">How your selected funds compare</h2><p>Missing values are excluded and counted; nothing is estimated.</p></div><div className="scatter-head-actions"><span className="scatter-data-asof">Data as of {dateLabel}</span><button type="button" className="button secondary scatter-table-toggle" onClick={() => setPreference('showTable', !preferences.showTable)}><TableProperties size={16}/>{preferences.showTable ? 'Chart' : 'Table'}</button></div></header>
    <div className="scatter-controls-desktop">{controls}</div>
    <button type="button" className="scatter-mobile-summary" onClick={() => setMobileOptions(true)}>{xMetric.label} × {yMetric.label} · {thresholdLabel} <span>Options ▾</span></button>
    {mobileOptions && <div className="scatter-bottom-sheet-backdrop" role="presentation" onClick={() => setMobileOptions(false)}><section className="scatter-bottom-sheet" role="dialog" aria-modal="true" aria-label="Scatter chart options" onClick={event => event.stopPropagation()}><div className="scatter-sheet-heading"><h3>Chart options</h3><button type="button" className="icon-button" aria-label="Close options" onClick={() => setMobileOptions(false)}><X size={18}/></button></div>{controls}<button className="button primary scatter-sheet-done" type="button" onClick={() => setMobileOptions(false)}>Done</button></section></div>}
    <div className="scatter-context"><GitCompareArrows size={15}/><span>{formatAxisTitle(xMetric, dirX, riskWindow)} × {formatAxisTitle(yMetric, dirY, riskWindow)}</span><span>Split: {thresholdLabel}</span></div>
    <div className="scatter-count" aria-live="polite"><b>{plottedCount} of {selectedCount} selected funds plotted</b>{missingFunds.size > 0 && <details><summary>{missingFunds.size} not plotted</summary><ul>{[...missingFunds].map(([code, item]) => <li key={code}><b>{item.name}</b> — {item.reasons.join('; ')}</li>)}</ul></details>}</div>
    {visibleResult?.thresholds.notice && <p className="scatter-fallback-notice" role="status">{visibleResult.thresholds.notice}</p>}
    {queryError && <div className="scatter-error" role="alert">Comparison could not be calculated: {queryError} <button type="button" onClick={() => setSort(current => ({ ...current }))}>Retry</button></div>}
    {selectedCount === 0 ? <div className="scatter-empty"><GitCompareArrows size={24}/><h3>Select 2–6 funds in the screener to compare</h3><p>Only funds in your compare tray appear in this chart.</p><button className="button primary" type="button" onClick={onBack}><ArrowLeft size={16}/>Back to screener</button></div> : <>
      {selectedCount === 1 && <p className="scatter-single-hint">Add another fund or choose a custom split. Quadrants appear when at least two funds are selected.</p>}
      <section className="scatter-plot-card" aria-label="Selected funds scatter chart"><div className="scatter-plot-toolbar"><div><b>{xMetric.label} × {yMetric.label}</b><small>{plottedCount} plotted · split: {thresholdLabel}</small></div><div><button className="button secondary" type="button" onClick={() => void exportPng()} disabled={!plottedCount}><Download size={15}/>PNG</button></div></div>
        <div ref={svgHost} className={preferences.showTable ? 'scatter-export-source' : undefined} aria-hidden={preferences.showTable}><ScatterChart result={visibleResult ?? emptyResult()} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} selectedColors={selectedColors} bestAtTopRight={preferences.bestAtTopRight} highlighted={highlighted} dataAsOfLabel={dateLabel} onThresholdChange={(axis, value) => onPreferencesChange({ ...preferences, splitRule: 'custom', customX: axis === 'x' ? value : visibleResult?.thresholds.x ?? preferences.customX, customY: axis === 'y' ? value : visibleResult?.thresholds.y ?? preferences.customY })} onInspect={onOpenFund}/></div>
        {preferences.showTable && visibleResult && <ScatterTable result={visibleResult} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} sort={sort} onSort={sortTable} onInspect={onOpenFund}/>}
        {querying && <div className="scatter-updating" aria-live="polite"><RefreshCw size={14} className="spin"/> Updating selected funds…</div>}
      </section>
      <section className="scatter-selected-list" aria-label="Selected comparison funds"><div className="scatter-list-heading"><h3>Selected funds</h3><button type="button" className="link-button" onClick={onBack}>+ Add funds</button></div>{comparedFunds.map((fund, index) => {
        const pointIndex = plottedIndices.get(fund.code); const missing = missingFunds.get(fund.code); const plotted = pointIndex !== undefined;
        const x = plotted ? visibleResult!.x[pointIndex]! : null; const y = plotted ? visibleResult!.y[pointIndex]! : null; const quadrant = plotted ? visibleResult!.quadrants[pointIndex]! as QuadrantId : null;
        const qName = quadrant === null ? null : quadrantName(quadrant, xMetric.label, yMetric.label, dirX, dirY);
        return <article className={`scatter-selected-row${plotted ? '' : ' missing'}`} key={fund.code}><span className="scatter-marker" style={{ background: selectedColors[fund.code] }} aria-hidden="true">{index + 1}</span><button type="button" className="scatter-fund-name" onClick={() => plotted && onOpenFund(fund.code)}><b>{fund.name}</b><small>{fund.amc} · {fund.subCategory}</small></button>{plotted ? <><span className="scatter-value"><small>X</small>{displayValue(x!, xMetric)}</span><span className="scatter-value"><small>Y</small>{displayValue(y!, yMetric)}</span><span className={`scatter-quadrant-badge ${qName?.kind ?? ''}`}>{thresholdReady ? qName?.label : 'No quadrant'}</span><span className="scatter-ranks">X {visibleResult!.rankX[pointIndex]!.toFixed(0)}% · Y {visibleResult!.rankY[pointIndex]!.toFixed(0)}%</span></> : <span className="scatter-missing-reason">Not plotted · {missing?.reasons.join('; ') ?? (querying ? 'Metrics updating for this selection.' : 'Fund record unavailable.')}</span>}<button type="button" className="scatter-remove" aria-label={`Remove ${fund.name} from compare`} onClick={() => onAddCompare(fund.code)}><X size={17}/></button></article>;
      })}</section>
      {thresholdReady && <section className="scatter-quadrant-cards" aria-label="Quadrants">{([0,1,2,3] as QuadrantId[]).map(id => { const info=quadrantName(id,xMetric.label,yMetric.label,dirX,dirY);const names=Array.from(visibleResult!.codes,(_,i)=>visibleResult!.quadrants[i]===id?visibleResult!.names[i]:null).filter((name):name is string=>!!name);return <button key={id} type="button" className={`scatter-quadrant-card ${info.kind}${highlighted===id?' active':''}`} aria-pressed={highlighted===id} onClick={()=>setHighlighted(highlighted===id?null:id)}><b>{info.kind==='best'?'★ ':info.kind==='avoid'?'⚠ ':''}{info.label}</b><span>{names.length ? names.join(', ') : 'No selected funds'}</span><small>{pointQuadrantCounts[id]} funds</small></button>;})}</section>}
      {(dirX === 'none' || dirY === 'none') && thresholdReady && <p className="quadrant-direction-note">No preference is set for {dirX === 'none' ? xMetric.label : yMetric.label}; quadrant labels stay neutral for that axis.</p>}
      {bestQuadrant(dirX,dirY) === null && selectedCount >= 2 && <p className="scatter-safety-note">Choose a direction for both axes to identify Best and Avoid. No-preference ties go to the higher side.</p>}
    </>}
  </section>;
}

function emptyResult(): ScatterQueryResult { return { codes:new Uint32Array(),x:new Float32Array(),y:new Float32Array(),quadrants:new Uint8Array(),selected:new Uint8Array(),percentileX:new Float32Array(),percentileY:new Float32Array(),rankX:new Float32Array(),rankY:new Float32Array(),names:[],amcs:[],categories:[],assetClasses:[],thresholds:{x:null,y:null,rule:'custom',peerCount:0,notice:null},coverage:{},coverageReasons:{},axisCoverage:{x:{},y:{}},selectedCount:0,notPlotted:[],dataBounds:{xMin:null,xMax:null,yMin:null,yMax:null} }; }
