import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, GitCompareArrows, RefreshCw, TableProperties, X } from 'lucide-react';
import type { Fund, MetricDefinition } from '../../domain/types';
import { metricRegistry } from '../../domain/metrics/registry';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';
import type { MetricDirection, QuadrantId } from '../../domain/scatter/quadrants';
import { quadrantName } from '../../domain/scatter/quadrants';
import { formatEpochMs, formatAxisTitle, formatMetricName, formatSplitValue, parseSplitValue } from '../../domain/scatter/presentation';
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
  const [mobileOptions, setMobileOptions] = useState(false); const [optionsOpen, setOptionsOpen] = useState(false); const [retryKey, setRetryKey] = useState(0); const [customDraftX, setCustomDraftX] = useState(() => formatSplitValue(preferences.customX)); const [customDraftY, setCustomDraftY] = useState(() => formatSplitValue(preferences.customY)); const [customErrorX, setCustomErrorX] = useState(''); const [customErrorY, setCustomErrorY] = useState(''); const requestSequence = useRef(0); const svgHost = useRef<HTMLDivElement>(null);
  const [phoneLayout, setPhoneLayout] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 639px)'); const update = () => setPhoneLayout(media.matches); media.addEventListener?.('change', update); return () => media.removeEventListener?.('change', update); }, []);
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
  }, [engine, queryKey, selectionKey, universeRevision, retryKey]);

  const setPreference = <K extends keyof ScatterPreferences>(key: K, value: ScatterPreferences[K]) => onPreferencesChange({ ...preferences, [key]: value });
  const setDirection = (metric: MetricDefinition, direction: MetricDirection) => onPreferencesChange({ ...preferences, directionOverrides: { ...preferences.directionOverrides, [metric.id]: direction } });
  const swapAxes = () => onPreferencesChange({ ...preferences, x: preferences.y, y: preferences.x });
  const applyPreset = (id: string) => { const preset = validPresets.find(item => item.id === id); if (preset) onPreferencesChange({ ...preferences, x: preset.x, y: preset.y }); };
  const sortTable = (next: ScatterSort) => setSort(current => ({ ...next, desc: current.by === next.by ? !current.desc : next.desc }));
  const chooseSplitRule = (rule: ScatterPreferences['splitRule']) => {
    if (rule === 'custom') {
      const x = visibleResult?.thresholds.x ?? visibleResult?.x[0] ?? preferences.customX;
      const y = visibleResult?.thresholds.y ?? visibleResult?.y[0] ?? preferences.customY;
      setCustomDraftX(formatSplitValue(x ?? null)); setCustomDraftY(formatSplitValue(y ?? null));
      setCustomErrorX(''); setCustomErrorY(''); onPreferencesChange({ ...preferences, splitRule: rule, customX: x ?? null, customY: y ?? null });
    } else onPreferencesChange({ ...preferences, splitRule: rule });
  };
  const setCustomSplit = (axis: 'x' | 'y', raw: string) => {
    const lastValid = axis === 'x' ? preferences.customX : preferences.customY; const parsed = parseSplitValue(raw, lastValid); const current = { ...preferences };
    if (axis === 'x') { setCustomDraftX(raw); setCustomErrorX(parsed.valid ? '' : 'Enter a finite value. The last valid split is kept.'); if (parsed.valid) current.customX = parsed.value; }
    else { setCustomDraftY(raw); setCustomErrorY(parsed.valid ? '' : 'Enter a finite value. The last valid split is kept.'); if (parsed.valid) current.customY = parsed.value; }
    if (parsed.valid) onPreferencesChange(current);
  };
  const onChartSplitChange = (axis: 'x' | 'y', value: number) => {
    const customX = axis === 'x' ? value : visibleResult?.thresholds.x ?? preferences.customX;
    const customY = axis === 'y' ? value : visibleResult?.thresholds.y ?? preferences.customY;
    onPreferencesChange({ ...preferences, splitRule: 'custom', customX, customY }); setCustomDraftX(formatSplitValue(customX)); setCustomDraftY(formatSplitValue(customY));
  };
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
  const thresholdReady = visibleResult?.thresholds.x !== null && visibleResult?.thresholds.x !== undefined && visibleResult?.thresholds.y !== null && visibleResult?.thresholds.y !== undefined;
  const thresholdLabel = visibleResult ? splitLabel(visibleResult.thresholds.rule) : splitLabel(preferences.splitRule);
  const dateLabel = formatEpochMs(dataAsOf);
  const logScaleEligible = plottedCount > 0 && [...Array.from(visibleResult?.x ?? []), ...Array.from(visibleResult?.y ?? []), ...(visibleResult?.thresholds.x == null ? [] : [visibleResult.thresholds.x]), ...(visibleResult?.thresholds.y == null ? [] : [visibleResult.thresholds.y])].every(value => value > 0);

  useEffect(() => {
    if (document.activeElement !== document.querySelector('[data-split-axis="x"]')) setCustomDraftX(formatSplitValue(preferences.customX));
    if (document.activeElement !== document.querySelector('[data-split-axis="y"]')) setCustomDraftY(formatSplitValue(preferences.customY));
  }, [preferences.customX, preferences.customY, preferences.x, preferences.y]);
  useEffect(() => { if (preferences.logScale && plottedCount > 0 && !logScaleEligible) onPreferencesChange({ ...preferences, logScale: false }); }, [preferences.logScale, logScaleEligible, plottedCount]);

  const exportPng = () => {
    const source = svgHost.current?.querySelector('svg'); if (!source) return;
    const viewBox = (source.getAttribute('viewBox') ?? `0 0 ${source.clientWidth} ${source.clientHeight}`).split(/\s+/).map(Number);
    const viewWidth = viewBox[2] || source.clientWidth; const viewHeight = viewBox[3] || source.clientHeight;
    const legendHeight = 44 + plottedCount * 18; const exportViewHeight = viewHeight + legendHeight;
    const width = Math.max(800, source.clientWidth * 2); const height = Math.max(450, Math.round(width * exportViewHeight / viewWidth));
    const clone = source.cloneNode(true) as SVGSVGElement; const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))]; const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
    const styleProperties = ['fill','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','opacity','color','pointer-events','vector-effect'];
    sourceNodes.forEach((node,index)=>{const style=getComputedStyle(node);const target=cloneNodes[index] as SVGElement|undefined;if(!target)return;for(const property of styleProperties){const value=style.getPropertyValue(property);if(value)target.style.setProperty(property,value);}});
    clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height)); clone.setAttribute('viewBox', `0 0 ${viewWidth} ${exportViewHeight}`);
    const svgNs = 'http://www.w3.org/2000/svg';
    const legendTitle = document.createElementNS(svgNs, 'text'); legendTitle.setAttribute('x', '14'); legendTitle.setAttribute('y', String(viewHeight + 17)); legendTitle.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#263445'); legendTitle.setAttribute('font-size', '11'); legendTitle.setAttribute('font-weight', '700'); legendTitle.textContent = `Selected funds · Data as of ${dateLabel}`; clone.append(legendTitle);
    visibleResult?.codes.forEach((code, index) => {
      const y = viewHeight + 35 + index * 18; const color = selectedColors[code] ?? '#6654ee';
      const marker = document.createElementNS(svgNs, 'circle'); marker.setAttribute('cx', '18'); marker.setAttribute('cy', String(y - 3)); marker.setAttribute('r', '4'); marker.setAttribute('fill', color); clone.append(marker);
      const quadrant = thresholdReady ? quadrantName(visibleResult.quadrants[index]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'No quadrant split';
      const label = `${index + 1}. ${visibleResult.names[index]} · X: ${displayValue(visibleResult.x[index]!, xMetric)} · Y: ${displayValue(visibleResult.y[index]!, yMetric)} · ${quadrant}`;
      const line = document.createElementNS(svgNs, 'text'); line.setAttribute('x', '29'); line.setAttribute('y', String(y)); line.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#263445'); line.setAttribute('font-size', '9');
      if (label.length > Math.floor((viewWidth - 42) / 5.5)) { line.setAttribute('textLength', String(viewWidth - 42)); line.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      line.textContent = label; clone.append(line);
    });
    const svgText = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => {
      const surface = document.createElement('canvas'); surface.width = width; surface.height = height;
      const context = surface.getContext('2d'); if (context) { context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff'; context.fillRect(0, 0, surface.width, surface.height); context.drawImage(image, 0, 0, surface.width, surface.height); surface.toBlob(output => { if (!output) return; const link = document.createElement('a'); const pngUrl = URL.createObjectURL(output); link.href = pngUrl; link.download = 'fundscope-scatter.png'; link.click(); window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000); }, 'image/png'); }
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
    <div className={`scatter-options-row${preferences.splitRule === 'custom' ? ' custom-active' : ''}`}>
      <label><span>Preset</span><select value={selectedPreset} onChange={event => applyPreset(event.target.value)}><option value="custom">Custom axes</option>{validPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label><span>Split at</span><select value={preferences.splitRule} onChange={event => chooseSplitRule(event.target.value as ScatterPreferences['splitRule'])}>
        <option value="peer-median" disabled={(visibleResult?.thresholds.peerCount ?? 0) < 10 && preferences.splitRule !== 'peer-median'}>Peer median{(visibleResult?.thresholds.peerCount ?? 0) < 10 ? ' · needs 10 peers' : ` · ${visibleResult?.thresholds.peerCount} peers`}</option><option value="median" disabled={plottedCount < 3 && preferences.splitRule !== 'median'}>Median of selected{plottedCount < 3 ? ' · needs 3 funds' : ''}</option><option value="mean" disabled={plottedCount < 2 && preferences.splitRule !== 'mean'}>Mean of selected{plottedCount < 2 ? ' · needs 2 funds' : ''}</option><option value="custom">Custom</option>
      </select></label>
      {preferences.splitRule === 'custom' && <div className="scatter-custom-splits"><label><span>X split · {xMetric.unit}</span><input data-split-axis="x" aria-label={`X split in ${xMetric.unit}`} aria-invalid={!!customErrorX} aria-describedby={customErrorX ? 'scatter-custom-x-error' : undefined} type="text" inputMode="decimal" value={customDraftX} onChange={event => setCustomSplit('x', event.target.value)} onBlur={() => setCustomDraftX(formatSplitValue(preferences.customX))}/>{customErrorX && <small id="scatter-custom-x-error" className="scatter-field-error">{customErrorX}</small>}</label><label><span>Y split · {yMetric.unit}</span><input data-split-axis="y" aria-label={`Y split in ${yMetric.unit}`} aria-invalid={!!customErrorY} aria-describedby={customErrorY ? 'scatter-custom-y-error' : undefined} type="text" inputMode="decimal" value={customDraftY} onChange={event => setCustomSplit('y', event.target.value)} onBlur={() => setCustomDraftY(formatSplitValue(preferences.customY))}/>{customErrorY && <small id="scatter-custom-y-error" className="scatter-field-error">{customErrorY}</small>}</label></div>}
      <div className="scatter-options-control"><button type="button" className="scatter-options-trigger" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options ▾</button>{optionsOpen && <div className="scatter-options-popover"><label title={!logScaleEligible ? 'Log scale requires positive plotted values and split points on both axes.' : undefined}><input type="checkbox" checked={preferences.logScale} disabled={!logScaleEligible} onChange={event => setPreference('logScale', event.target.checked)}/>Log scale{!logScaleEligible && <small> · positive values only</small>}</label><label><input type="checkbox" checked={preferences.showLabels} onChange={event => setPreference('showLabels', event.target.checked)}/>Show labels</label><p>Ties on a split belong to the better side; no-preference ties count as high.</p></div>}</div>
      {(preferences.logScale || !preferences.showLabels) && <div className="scatter-option-chips">{preferences.logScale && <span>Log scale</span>}{!preferences.showLabels && <span>Labels hidden</span>}</div>}
    </div>
  </>;

  return <section className="scatter-tab" aria-labelledby="scatter-heading">
    <header className="scatter-tab-head"><div><span className="eyebrow">COMPARE · LOCAL METRICS</span><h2 id="scatter-heading">How your selected funds compare</h2><p>Missing values are excluded and counted; nothing is estimated.</p></div><div className="scatter-head-actions"><span className="scatter-data-asof">Data as of {dateLabel}</span><button type="button" className="button secondary scatter-table-toggle" aria-pressed={preferences.showTable} onClick={() => setPreference('showTable', !preferences.showTable)}><TableProperties size={16}/>{preferences.showTable ? 'Chart view' : 'Table view'}</button></div></header>
    {!phoneLayout && <div className="scatter-controls-desktop">{controls}</div>}
    {phoneLayout && <button type="button" className="scatter-mobile-summary" onClick={() => setMobileOptions(true)}>{formatMetricName(xMetric)} × {formatMetricName(yMetric)} <span>Options ▾</span></button>}
    {phoneLayout && mobileOptions && <div className="scatter-bottom-sheet-backdrop" role="presentation" onClick={() => setMobileOptions(false)}><section className="scatter-bottom-sheet" role="dialog" aria-modal="true" aria-label="Scatter chart options" onClick={event => event.stopPropagation()}><div className="scatter-sheet-heading"><h3>Chart options</h3><button type="button" className="icon-button" aria-label="Close options" onClick={() => setMobileOptions(false)}><X size={18}/></button></div>{controls}<button className="button primary scatter-sheet-done" type="button" onClick={() => setMobileOptions(false)}>Done</button></section></div>}
    <div className="scatter-context"><GitCompareArrows size={15}/><span>{formatAxisTitle(xMetric, dirX, riskWindow)} × {formatAxisTitle(yMetric, dirY, riskWindow)}</span><span>Split: {thresholdLabel}</span></div>
    <div className="scatter-count" aria-live="polite"><b>{plottedCount} of {selectedCount} selected funds plotted</b>{missingFunds.size > 0 && <details><summary>{missingFunds.size} not plotted</summary><ul>{[...missingFunds].map(([code, item]) => <li key={code}><b>{item.name}</b> — {item.reasons.join('; ')}</li>)}</ul></details>}</div>
    {visibleResult?.thresholds.notice && <p className="scatter-fallback-notice" role="status">{visibleResult.thresholds.notice}</p>}
    {visibleResult?.thresholds.rule === 'peer-median' && visibleResult.thresholds.peerScope === 'asset class' && <p className="scatter-fallback-notice" role="status">Only {visibleResult.thresholds.subCategoryPeerCount} matching sub-category peers were available; the peer median uses the selected asset class.</p>}
    {queryError && <div className="scatter-error" role="alert">Comparison could not be calculated: {queryError} <button type="button" onClick={() => setRetryKey(key => key + 1)}>Retry</button></div>}
    {selectedCount === 0 ? <div className="scatter-empty"><GitCompareArrows size={24}/><h3>Select 2–6 funds in the screener to compare</h3><p>Only funds in your compare tray appear in this chart.</p><button className="button primary" type="button" onClick={onBack}><ArrowLeft size={16}/>Back to screener</button></div> : <>
      {selectedCount === 1 && <p className="scatter-single-hint">Add another fund or choose a custom split. A computed peer split can show quadrants for one fund.</p>}
      <section className="scatter-plot-card" aria-label="Selected funds scatter chart"><div className="scatter-plot-toolbar"><div><b>{formatMetricName(xMetric)} × {formatMetricName(yMetric)}</b><small>{plottedCount} plotted · split: {thresholdLabel}</small></div><div><button className="button secondary" type="button" onClick={() => void exportPng()} disabled={!plottedCount}><Download size={15}/>PNG</button></div></div>
        <div ref={svgHost} className={preferences.showTable ? 'scatter-export-source' : undefined} aria-hidden={preferences.showTable}><ScatterChart result={visibleResult ?? emptyResult()} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} selectedColors={selectedColors} logScale={preferences.logScale && logScaleEligible} showLabels={preferences.showLabels} highlighted={highlighted} dataAsOfLabel={dateLabel} riskWindow={riskWindow} onDirectionChange={(axis,direction)=>setDirection(axis==='x'?xMetric:yMetric,direction)} onThresholdChange={onChartSplitChange} onInspect={onOpenFund}/></div>
        {preferences.showTable && visibleResult && <ScatterTable result={visibleResult} xMetric={xMetric} yMetric={yMetric} dirX={dirX} dirY={dirY} sort={sort} onSort={sortTable} onInspect={onOpenFund}/>}
        {querying && <div className="scatter-updating" aria-live="polite"><RefreshCw size={14} className="spin"/> Updating selected funds…</div>}
      </section>
      <section className="scatter-selected-list" aria-label="Selected comparison funds"><div className="scatter-list-heading"><h3>Selected funds</h3><button type="button" className="link-button" onClick={onBack}>+ Add funds</button></div>{comparedFunds.map((fund, index) => {
        const pointIndex = plottedIndices.get(fund.code); const missing = missingFunds.get(fund.code); const plotted = pointIndex !== undefined;
        const x = plotted ? visibleResult!.x[pointIndex]! : null; const y = plotted ? visibleResult!.y[pointIndex]! : null; const quadrant = plotted ? visibleResult!.quadrants[pointIndex]! as QuadrantId : null;
        const qName = quadrant === null ? null : quadrantName(quadrant, xMetric.label, yMetric.label, dirX, dirY);
        return <article className={`scatter-selected-row${plotted ? '' : ' missing'}`} key={fund.code}><span className="scatter-marker" style={{ background: selectedColors[fund.code] }} aria-hidden="true">{index + 1}</span><button type="button" className="scatter-fund-name" onClick={() => plotted && onOpenFund(fund.code)}><b>{fund.name}</b><small>{fund.amc} · {fund.subCategory}</small></button>{plotted ? <><span className="scatter-value"><small>X</small>{displayValue(x!, xMetric)}</span><span className="scatter-value"><small>Y</small>{displayValue(y!, yMetric)}</span><span className={`scatter-quadrant-badge ${qName?.kind ?? ''}`}>{thresholdReady ? qName?.label : 'No quadrant'}</span><span className="scatter-ranks">X #{visibleResult!.rankX[pointIndex]} · Y #{visibleResult!.rankY[pointIndex]}</span></> : <span className="scatter-missing-reason">Not plotted · {missing?.reasons.join('; ') ?? (querying ? 'Metrics updating for this selection.' : 'Fund record unavailable.')}</span>}<button type="button" className="scatter-remove" aria-label={`Remove ${fund.name} from compare`} onClick={() => onAddCompare(fund.code)}><X size={17}/></button></article>;
      })}</section>
      {thresholdReady && <section className="scatter-quadrant-cards" aria-label="Quadrants">{([0,1,2,3] as QuadrantId[]).map(id => { const info=quadrantName(id,xMetric.label,yMetric.label,dirX,dirY);const names=Array.from(visibleResult!.codes,(_,i)=>visibleResult!.quadrants[i]===id?visibleResult!.names[i]:null).filter((name):name is string=>!!name);return <button key={id} type="button" className={`scatter-quadrant-card ${info.kind}${highlighted===id?' active':''}`} aria-pressed={highlighted===id} onClick={()=>setHighlighted(highlighted===id?null:id)}><b>{info.label}</b><span>{names.length ? names.join(', ') : 'No selected funds'}</span><small>{pointQuadrantCounts[id]} funds</small></button>;})}</section>}
    </>}
  </section>;
}

function emptyResult(): ScatterQueryResult { return { codes:new Uint32Array(),x:new Float32Array(),y:new Float32Array(),quadrants:new Uint8Array(),selected:new Uint8Array(),percentileX:new Float32Array(),percentileY:new Float32Array(),rankX:new Float32Array(),rankY:new Float32Array(),names:[],amcs:[],categories:[],assetClasses:[],thresholds:{x:null,y:null,rule:'custom',peerCount:0,peerScope:null,subCategoryPeerCount:0,notice:null},coverage:{},coverageReasons:{},axisCoverage:{x:{},y:{}},selectedCount:0,notPlotted:[],dataBounds:{xMin:null,xMax:null,yMin:null,yMax:null} }; }
