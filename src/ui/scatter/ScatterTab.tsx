import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, GitCompareArrows, RefreshCw, Star, TableProperties } from 'lucide-react';
import type { Fund, MetricDefinition } from '../../domain/types';
import { metricRegistry } from '../../domain/metrics/registry';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';
import type { MetricDirection, QuadrantId } from '../../domain/scatter/quadrants';
import { bestQuadrant, quadrantName } from '../../domain/scatter/quadrants';
import { reasonMessage } from '../../domain/governance/reasonMessages';
import type { ReasonCode, ReasonDetail } from '../../domain/governance/reasons';
import type { ScreenerEngineClient } from '../../engine/engineClient';
import type { ScreenerFilters } from '../../domain/screener/filters';
import type { ScatterPreferences, ScatterSort } from './types';
import { MetricAxisPicker } from './MetricAxisPicker';
import { QuadrantSummary, type InspectedRank } from './QuadrantSummary';
import { ScatterCanvas } from './ScatterCanvas';
import { ScatterTable } from './ScatterTable';
import { colorPalette } from '../colorPalette';
import presets from '../../../config/scatter-presets.json';

const numericMetrics = metricRegistry.filter(metric => metric.unit !== 'enum');
const metricById = new Map(numericMetrics.map(metric => [metric.id, metric]));
const rawPresets = presets as Array<{ id: string; label: string; x: string; y: string }>;
const validPresets = rawPresets.filter(preset => {
  const valid = metricById.has(preset.x) && metricById.has(preset.y);
  if (!valid && import.meta.env.DEV) console.warn(`Skipping scatter preset '${preset.id}': unknown metric id.`);
  return valid;
});

function defaultDirection(metric: MetricDefinition): MetricDirection { return metric.direction === 'higher' || metric.direction === 'lower' ? metric.direction : 'none'; }
function reasonText(metricId: string, code: string, detail?: ReasonDetail) {
  const label = metricById.get(metricId)?.label ?? metricId;
  if (detail) return reasonMessage(detail, label);
  if (code === 'INSUFFICIENT_HISTORY') return `${label} needs a longer history window.`;
  if (code === 'DATA_GAPS') return `${label} history contains gaps or invalid dates.`;
  if (code === 'NA_CATEGORY') return `${label} is not applicable to this classification.`;
  if (code === 'NO_BENCHMARK') return `${label} needs a verified benchmark series.`;
  return `${label} has no verified value in the local data.`;
}
function valueText(value: number, metric: MetricDefinition) {
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
  return metric.unit === '%' ? `${text}%` : metric.unit === '₹ Cr' ? `₹${text} Cr` : metric.unit === 'years' ? `${text} yr` : metric.unit === 'ratio' ? `${text}x` : text;
}
function toRange(value: number, highSide: boolean, direction: MetricDirection) {
  const epsilon = Math.max(Number.EPSILON, Math.abs(value) * Number.EPSILON * 2);
  if (highSide) return direction === 'lower' ? { min: value + epsilon, max: null } : { min: value, max: null };
  return direction === 'lower' ? { min: null, max: value } : { min: null, max: value - epsilon };
}

export function ScatterTab({ engine, allFunds, comparedFunds, screenerIndices, preferences, onPreferencesChange, onFilterToQuadrant, onOpenFund, onAddCompare, dataAsOf, riskWindow }: {
  engine: ScreenerEngineClient; allFunds: Fund[]; comparedFunds: Fund[]; screenerIndices: Uint32Array; preferences: ScatterPreferences;
  onPreferencesChange: (preferences: ScatterPreferences) => void; onFilterToQuadrant: (filters: Array<{ id: string; min: number | null; max: number | null }>) => void;
  onOpenFund: (code: number) => void; onAddCompare: (code: number) => void; dataAsOf: number | null; riskWindow: 1 | 3 | 5;
}) {
  const [result, setResult] = useState<ScatterQueryResult | null>(null); const [querying, setQuerying] = useState(true); const [queryError, setQueryError] = useState('');
  const [sort, setSort] = useState<ScatterSort>({ by: 'name', desc: false }); const [highlighted, setHighlighted] = useState<QuadrantId | null>(null);
  const [inspectCode, setInspectCode] = useState<number | null>(null); const [showReasons, setShowReasons] = useState(false);
  const requestSequence = useRef(0);
  const selectedCodes = useMemo(() => comparedFunds.map(fund => fund.code), [comparedFunds]);
  const xMetric = metricById.get(preferences.x) ?? metricById.get('std_dev')!; const yMetric = metricById.get(preferences.y) ?? metricById.get('cagr_3y')!;
  const selectedPreset = validPresets.find(preset => preset.x === preferences.x && preset.y === preferences.y)?.id ?? 'custom';
  const dirX = preferences.directionOverrides[xMetric.id] ?? defaultDirection(xMetric); const dirY = preferences.directionOverrides[yMetric.id] ?? defaultDirection(yMetric);
  const selectedColors = useMemo(() => Object.fromEntries(comparedFunds.map((fund, index) => [fund.code, colorPalette[index % colorPalette.length]!])), [comparedFunds]);

  useEffect(() => {
    const request = ++requestSequence.current; setQuerying(true); setQueryError('');
    void engine.scatter({ xMetric: xMetric.id, yMetric: yMetric.id, dirX, dirY, scope: preferences.scope, selectedCodes, currentScreenerIndices: screenerIndices, splitRule: preferences.splitRule, customX: preferences.customX, customY: preferences.customY, sort })
      .then(({ result: next }) => { if (request !== requestSequence.current) return; setResult(next); setQuerying(false); })
      .catch(error => { if (request !== requestSequence.current) return; setQueryError(error instanceof Error ? error.message : String(error)); setQuerying(false); });
    return () => { requestSequence.current++; };
  }, [engine, xMetric.id, yMetric.id, dirX, dirY, preferences.scope, preferences.splitRule, preferences.customX, preferences.customY, selectedCodes, screenerIndices, sort]);

  const setPreference = <K extends keyof ScatterPreferences>(key: K, value: ScatterPreferences[K]) => onPreferencesChange({ ...preferences, [key]: value });
  const setDirection = (metric: MetricDefinition, direction: MetricDirection) => onPreferencesChange({ ...preferences, directionOverrides: { ...preferences.directionOverrides, [metric.id]: direction } });
  const swapAxes = () => onPreferencesChange({ ...preferences, x: preferences.y, y: preferences.x });
  const applyPreset = (id: string) => { const preset = validPresets.find(item => item.id === id); if (preset) onPreferencesChange({ ...preferences, x: preset.x, y: preset.y }); };
  const sortTable = (next: ScatterSort) => setSort(current => ({ ...next, desc: current.by === next.by ? !current.desc : next.desc }));

  const summaryRows = useMemo<InspectedRank[]>(() => {
    if (!result) return [];
    const comparedSet = new Set(selectedCodes); const rows: InspectedRank[] = [];
    for (let i = 0; i < result.codes.length; i++) if (comparedSet.has(result.codes[i]!)) rows.push({ code: result.codes[i]!, name: result.names[i]!, quadrant: result.quadrants[i]! as QuadrantId, rankX: result.rankX[i]!, rankY: result.rankY[i]! });
    return rows;
  }, [result, selectedCodes]);
  const counts = useMemo(() => { const values = [0, 0, 0, 0]; if (result) for (const id of result.quadrants) values[id] = (values[id] ?? 0) + 1; return values; }, [result]);
  const indexByCode = useMemo(() => { const map = new Map<number, number>(); if (result) for (let index = 0; index < result.codes.length; index++) map.set(result.codes[index]!, index); return map; }, [result]);
  const inspectedIndex = inspectCode === null ? -1 : indexByCode.get(inspectCode) ?? -1;
  const scopeLabel = preferences.scope === 'current' ? 'Current screener results' : preferences.scope === 'compared' ? 'Compared funds' : preferences.scope === 'same-subcategory' ? 'Selected sub-categories' : 'Selected asset class';
  const dateLabel = dataAsOf === null ? 'date unavailable' : new Date(dataAsOf * 86_400_000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const thresholdReady = result?.thresholds.x !== null && result?.thresholds.x !== undefined && result?.thresholds.y !== null && result?.thresholds.y !== undefined;
  const gated = result?.notPlottedReasons.some(item => item.reason === 'NA_CATEGORY' || item.reason === 'CLASSIFICATION_UNCERTAIN') ?? false;
  const mixed = result?.mixedAssetClasses ?? false;
  const showRestrict = mixed || gated;

  const filterQuadrant = (id: QuadrantId) => {
    if (!result || result.thresholds.x === null || result.thresholds.y === null) return;
    onFilterToQuadrant([
      { id: xMetric.id, ...toRange(result.thresholds.x, (id & 1) !== 0, dirX) },
      { id: yMetric.id, ...toRange(result.thresholds.y, (id & 2) !== 0, dirY) },
    ]);
  };
  const exportPng = () => {
    if (!result) return;
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 820;
    const context = canvas.getContext('2d'); if (!context) return;
    const dark = document.documentElement.dataset.theme === 'dark'; const background = dark ? '#131a22' : '#ffffff'; const ink = dark ? '#e5ebf3' : '#1b2633'; const muted = dark ? '#95a4b8' : '#64748b';
    context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = ink; context.font = '600 25px system-ui'; context.fillText(`${xMetric.label} × ${yMetric.label}`, 64, 48); context.fillStyle = muted; context.font = '15px system-ui'; context.fillText(`${riskWindow}Y risk window · ${scopeLabel} · ${preferences.splitRule.replace('-', ' ')} · Data as of ${dateLabel}`, 64, 75);context.fillText(`X split: ${result.thresholds.x===null?'—':valueText(result.thresholds.x,xMetric)} · Y split: ${result.thresholds.y===null?'—':valueText(result.thresholds.y,yMetric)}`,64,99);
    const left = 95; const top = 120; const width = 1040; const height = 620; const source = preferences.includeOutliers ? result.dataBounds : result.outlierBounds;
    let xMin = source.xMin ?? 0; let xMax = source.xMax ?? 1; let yMin = source.yMin ?? 0; let yMax = source.yMax ?? 1;
    const logX = preferences.logScale && xMetric.unit === '₹ Cr'; const logY = preferences.logScale && yMetric.unit === '₹ Cr';
    if (logX) { const positive = Array.from(result.x).filter(value => value > 0 && value >= xMin && value <= xMax); if (positive.length) { xMin = Math.min(...positive); xMax = Math.max(...positive); } }
    if (logY) { const positive = Array.from(result.y).filter(value => value > 0 && value >= yMin && value <= yMax); if (positive.length) { yMin = Math.min(...positive); yMax = Math.max(...positive); } }
    const tx = (value: number) => logX ? Math.log10(value) : value; const ty = (value: number) => logY ? Math.log10(value) : value;
    let xmin = tx(xMin); let xmax = tx(xMax); let ymin = ty(yMin); let ymax = ty(yMax); if (xmin === xmax) { xmin -= .5; xmax += .5; } if (ymin === ymax) { ymin -= .5; ymax += .5; }
    const px = (value: number) => { let n = (tx(value) - xmin) / (xmax - xmin); if (preferences.bestAtTopRight && dirX === 'lower') n = 1 - n; return left + Math.max(0, Math.min(1, n)) * width; };
    const py = (value: number) => { let n = (ty(value) - ymin) / (ymax - ymin); if (preferences.bestAtTopRight && dirY === 'lower') n = 1 - n; return top + height - Math.max(0, Math.min(1, n)) * height; };
    context.strokeStyle = dark ? '#2c3949' : '#e2e8f0'; context.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const x = left + width * i / 4; const y = top + height * i / 4; context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + height); context.moveTo(left, y); context.lineTo(left + width, y); context.stroke(); }
    context.strokeStyle = ink; context.beginPath(); context.moveTo(left, top + height); context.lineTo(left + width, top + height); context.moveTo(left, top); context.lineTo(left, top + height); context.stroke();
    if (result.thresholds.x !== null) { context.setLineDash([7, 6]); context.strokeStyle = '#748194'; context.beginPath(); context.moveTo(px(result.thresholds.x), top); context.lineTo(px(result.thresholds.x), top + height); context.stroke(); }
    if (result.thresholds.y !== null) { context.setLineDash([7, 6]); context.beginPath(); context.moveTo(left, py(result.thresholds.y)); context.lineTo(left + width, py(result.thresholds.y)); context.stroke(); } context.setLineDash([]);
    for (let i = 0; i < result.codes.length; i++) { if ((logX && result.x[i]! <= 0) || (logY && result.y[i]! <= 0)) continue; context.beginPath(); context.globalAlpha = result.selected[i] ? 1 : .5; context.fillStyle = selectedColors[result.codes[i]!] ?? ['#d99000', '#15966c', '#bf5968', '#0b83a5'][result.quadrants[i]!]!; context.arc(px(result.x[i]!), py(result.y[i]!), result.selected[i] ? 7 : 4, 0, Math.PI * 2); context.fill(); }
    context.globalAlpha = 1; context.fillStyle = ink; context.font = '16px system-ui'; context.textAlign = 'center'; context.fillText(`${xMetric.label} (${xMetric.unit})${preferences.bestAtTopRight && dirX === 'lower' ? ' · reversed' : ''}`, left + width / 2, 785); context.save(); context.translate(25, top + height / 2); context.rotate(-Math.PI / 2); context.fillText(`${yMetric.label} (${yMetric.unit})${preferences.bestAtTopRight && dirY === 'lower' ? ' · reversed' : ''}`, 0, 0); context.restore();
    canvas.toBlob(blob => { if (!blob) return; const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fundscope-scatter.png'; link.click(); URL.revokeObjectURL(link.href); }, 'image/png');
  };
  const inspected = inspectedIndex >= 0 && result ? {
    code: result.codes[inspectedIndex]!, name: result.names[inspectedIndex]!, amc: result.amcs[inspectedIndex]!, x: result.x[inspectedIndex]!, y: result.y[inspectedIndex]!,
    quadrant: result.quadrants[inspectedIndex]! as QuadrantId, rankX: result.rankX[inspectedIndex]!, rankY: result.rankY[inspectedIndex]!,
  } : null;

  return <section className="scatter-tab" aria-labelledby="scatter-heading">
    <div className="scatter-tab-head"><div><span className="eyebrow">COMPARE · LOCAL METRICS</span><h2 id="scatter-heading">Find funds by their risk and return profile.</h2><p>Points with either missing value are excluded and counted; no values are estimated.</p></div><span className="scatter-data-asof">Data as of {dateLabel}</span></div>
    <div className="scatter-controls">
      <label className="scatter-preset"><span>Preset</span><select value={selectedPreset} onChange={event => applyPreset(event.target.value)}><option value="custom">Choose a preset…</option>{validPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <MetricAxisPicker axis="X" metricId={xMetric.id} metrics={numericMetrics} coverage={result?.axisCoverage.x ?? {}} direction={dirX} onMetricChange={id => setPreference('x', id)} onDirectionChange={direction => setDirection(xMetric, direction)}/>
      <button type="button" className="scatter-swap" onClick={swapAxes} aria-label="Swap X and Y axes">⇄ <span>Swap axes</span></button>
      <MetricAxisPicker axis="Y" metricId={yMetric.id} metrics={numericMetrics} coverage={result?.axisCoverage.y ?? {}} direction={dirY} onMetricChange={id => setPreference('y', id)} onDirectionChange={direction => setDirection(yMetric, direction)}/>
      <label className="scatter-scope"><span>Compare against</span><select value={preferences.scope} onChange={event => setPreference('scope', event.target.value as ScatterPreferences['scope'])}><option value="current">Current screener results</option><option value="compared">Compared funds only</option><option value="same-subcategory">Same sub-category as compared funds</option><option value="same-asset-class">Same asset class as first compared fund</option></select></label>
      <label className="scatter-split"><span>Split at</span><select value={preferences.splitRule} onChange={event => setPreference('splitRule', event.target.value as ScatterPreferences['splitRule'])}><option value="median">Median of scope</option><option value="mean">Mean of scope</option><option value="peer-median">Peer median (sub-category medians)</option><option value="custom">Custom values</option></select></label>
      {preferences.splitRule === 'custom' && <div className="scatter-custom-splits"><label>X split <input type="number" min={preferences.logScale&&xMetric.unit==='₹ Cr'?'0.000001':undefined} value={preferences.customX ?? ''} placeholder={xMetric.unit} onChange={event => {const value=event.target.value;const parsed=value===''?null:Number(value);const valid=parsed!==null&&Number.isFinite(parsed)&&(!(preferences.logScale&&xMetric.unit==='₹ Cr')||parsed>0);setPreference('customX',valid?parsed:null);}}/><small>{xMetric.unit}</small></label><label>Y split <input type="number" min={preferences.logScale&&yMetric.unit==='₹ Cr'?'0.000001':undefined} value={preferences.customY ?? ''} placeholder={yMetric.unit} onChange={event => {const value=event.target.value;const parsed=value===''?null:Number(value);const valid=parsed!==null&&Number.isFinite(parsed)&&(!(preferences.logScale&&yMetric.unit==='₹ Cr')||parsed>0);setPreference('customY',valid?parsed:null);}}/><small>{yMetric.unit}</small></label></div>}
      <label className="scatter-check"><input type="checkbox" checked={preferences.bestAtTopRight} onChange={event => setPreference('bestAtTopRight', event.target.checked)}/>Best at top-right</label>
      {(xMetric.unit === '₹ Cr' || yMetric.unit === '₹ Cr') && <label className="scatter-check"><input type="checkbox" checked={preferences.logScale} onChange={event => setPreference('logScale', event.target.checked)}/>Log scale for size axis</label>}
      <label className="scatter-check"><input type="checkbox" checked={preferences.includeOutliers} onChange={event => setPreference('includeOutliers', event.target.checked)}/>Include outliers</label>
      <label className="scatter-check"><input type="checkbox" checked={preferences.showTable} onChange={event => setPreference('showTable', event.target.checked)}/>Table view</label>
    </div>
    <div className="scatter-context"><GitCompareArrows size={14}/><span>{xMetric.label} ({xMetric.unit}) × {yMetric.label} ({yMetric.unit}) · {riskWindow}Y risk window · {scopeLabel} · {preferences.splitRule.replace('-', ' ')}</span><span>{result?.scopeCount.toLocaleString('en-IN') ?? '—'} in scope · {result?.codes.length.toLocaleString('en-IN') ?? '—'} plotted · {allFunds.length.toLocaleString('en-IN')} total</span></div>
    {showRestrict && <div className="scatter-warning" role="status"><AlertTriangle size={16}/><span>{mixed ? 'This cloud contains multiple asset classes. ' : ''}{gated ? 'Classification-gated values are left missing. ' : ''}Restrict the cloud to the selected fund’s asset class for a closer comparison.</span><button type="button" onClick={() => setPreference('scope', 'same-asset-class')}>Restrict to same asset class</button></div>}
    {queryError && <div className="scatter-error" role="alert">Scatter calculation failed: {queryError} <button type="button" onClick={() => setSort(current => ({ ...current }))}>Retry</button></div>}
    <div className={`scatter-plot-card${querying ? ' is-updating' : ''}`}>
      <div className="scatter-plot-toolbar"><div><b>{xMetric.label} against {yMetric.label}</b><small>{result?.codes.length.toLocaleString('en-IN') ?? 0} funds with both values</small></div><div><button type="button" className="button secondary" onClick={() => setPreference('showTable', !preferences.showTable)}><TableProperties size={15}/>{preferences.showTable ? 'Show chart' : 'Table view'}</button><button className="button secondary" type="button" onClick={exportPng} disabled={!result}><Download size={15}/>PNG</button></div></div>
      {preferences.showTable && result ? <ScatterTable result={result} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} sort={sort} onSort={sortTable} onInspect={setInspectCode}/> : <ScatterCanvas result={result} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} bestAtTopRight={preferences.bestAtTopRight} includeOutliers={preferences.includeOutliers} logScale={preferences.logScale} highlightedQuadrant={highlighted} selectedColors={selectedColors} inspectCode={inspectCode} onInspect={setInspectCode} onThresholdChange={(axis, value) => onPreferencesChange({ ...preferences, splitRule: 'custom', ...(axis === 'x' ? { customX: value } : { customY: value }) })}/>}
      {querying && <div className="scatter-updating" aria-live="polite"><RefreshCw size={14} className="spin"/> Updating comparison…</div>}
    </div>
    {result && result.outlierCount > 0 && !preferences.includeOutliers && <p className="scatter-outlier-note">{result.outlierCount.toLocaleString('en-IN')} outlier {result.outlierCount === 1 ? 'point is' : 'points are'} clamped to the 1st–99th percentile view. They remain in the table and counts.</p>}
    {result?.notPlottedCount ? <details className="scatter-not-plotted" open={showReasons} onToggle={event => setShowReasons(event.currentTarget.open)}><summary>{result.notPlottedCount.toLocaleString('en-IN')} {result.notPlottedCount === 1 ? 'fund was' : 'funds were'} not plotted because one or both metrics are missing</summary><ul>{result.notPlottedReasons.map(item => <li key={`${item.metricId}:${item.reason}`}>{item.count.toLocaleString('en-IN')} · {reasonText(item.metricId, item.reason, item.detail)}</li>)}</ul></details> : null}
    {result && thresholdReady ? <QuadrantSummary counts={counts} plottedCount={result.codes.length} xLabel={xMetric.label} yLabel={yMetric.label} dirX={dirX} dirY={dirY} selected={summaryRows} highlighted={highlighted} onHighlight={id => setHighlighted(id)} onFilter={filterQuadrant} onOpen={onOpenFund} onAddCompare={onAddCompare}/> : preferences.splitRule === 'custom' && <p className="quadrant-direction-note">Enter both custom split values to assign funds to quadrants.</p>}
    {inspected && <aside className="scatter-inspected-card"><div><span className="eyebrow">INSPECTED FUND</span><h3>{inspected.name}</h3><small>{inspected.amc} · {result?.categories[inspectedIndex]}</small></div><div className="scatter-inspected-values"><span>{xMetric.label}<b>{valueText(inspected.x, xMetric)}</b></span><span>{yMetric.label}<b>{valueText(inspected.y, yMetric)}</b></span><span>Quadrant<b>{thresholdReady ? quadrantName(inspected.quadrant, xMetric.label, yMetric.label, dirX, dirY).label : 'Split values required'}</b></span></div><div className="scatter-inspected-actions">{!selectedCodes.includes(inspected.code) && <button type="button" className="button secondary" onClick={() => onAddCompare(inspected.code)}>Add to compare</button>}<button type="button" className="button primary" onClick={() => onOpenFund(inspected.code)}>Open details</button></div></aside>}
    {bestQuadrant(dirX, dirY) === null && <p className="quadrant-direction-note"><Star size={14}/> Pick a direction for both metrics to identify a Best and Avoid quadrant. No-preference axes do not rank funds as better or worse.</p>}
    <p className="scatter-safety-note">Quadrants describe the selected metrics and split rule only. They are not investment advice.</p>
  </section>;
}
