import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MetricDefinition } from '../../domain/types';
import { formatMetricAxisLabel, labelPlacement, niceTicks } from '../../domain/scatter/presentation';
import { quadrantName, quadrantTone, type MetricDirection, type QuadrantId } from '../../domain/scatter/quadrants';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';

function numberLabel(value: number, unit: MetricDefinition['unit']): string {
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
  return unit === '%' ? `${text}%` : unit === '₹ Cr' ? `₹${text} Cr` : unit === 'years' ? `${text} yr` : unit === 'ratio' ? `${text}x` : text;
}
function shortFundName(name: string): string { return name.replace(/\s+(?:direct|regular|growth|idcw|dividend|reinvestment).*$/i, '').trim().slice(0, 24); }
function symbolPath(shape: number, x: number, y: number, radius = 8): string {
  if (shape === 1) return `M${x-radius} ${y-radius}h${radius*2}v${radius*2}h-${radius*2}z`;
  if (shape === 2) return `M${x} ${y-radius-1}L${x+radius+1} ${y}L${x} ${y+radius+1}L${x-radius-1} ${y}z`;
  if (shape === 3) return `M${x} ${y-radius-1}L${x+radius} ${y+radius}H${x-radius}z`;
  if (shape === 4) return `M${x-radius} ${y-radius}l${radius*2} ${radius*2}m0 -${radius*2}l-${radius*2} ${radius*2}`;
  if (shape === 5) return `M${x} ${y-radius-1}l${radius*.28} ${radius*.65}l${radius*.72} ${radius*.1}l-${radius*.52} ${radius*.5}l${radius*.15} ${radius*.76}l-${radius*.63} -${radius*.38}l-${radius*.63} ${radius*.38}l${radius*.15} -${radius*.76}l-${radius*.52} -${radius*.5}l${radius*.72} -${radius*.1}z`;
  return `M${x-radius} ${y}a${radius} ${radius} 0 1 0 ${radius*2} 0a${radius} ${radius} 0 1 0 -${radius*2} 0`;
}

type Tone = ReturnType<typeof quadrantTone>;
type Chip = { x: number; y: number; width: number; height: number; text: string };
function quadrantChip(id: QuadrantId, tone: Tone, rect: { x: number; y: number; width: number; height: number }, label: string, points: Array<{ x: number; y: number }>, compact: boolean): Chip | null {
  if (rect.width < 52 || rect.height < 38) return null;
  const short = tone === 'best' ? '★ Best' : tone === 'worst' ? '⚠ Worst' : tone === 'mixed' ? 'Trade-off' : label;
  const text = compact ? short : label;
  const maxWidth = Math.max(48, Math.min(205, rect.width - 12)); const width = Math.min(maxWidth, Math.max(58, text.length * (compact ? 5.8 : 5.4) + 16)); const height = compact ? 22 : 24;
  const pad = 6;
  const corners = id === 2 ? ['tl','tr','bl','br'] : id === 3 ? ['tr','tl','br','bl'] : id === 0 ? ['bl','br','tl','tr'] : ['br','bl','tr','tl'];
  for (const corner of corners) {
    const x = corner.endsWith('l') ? rect.x + pad : rect.x + rect.width - width - pad;
    const y = corner.startsWith('t') ? rect.y + pad : rect.y + rect.height - height - pad;
    const collides = points.some(point => point.x >= x - 8 && point.x <= x + width + 8 && point.y >= y - 8 && point.y <= y + height + 8);
    if (!collides) return { x, y, width, height, text: text.length * 5.4 + 16 > width ? `${text.slice(0, Math.max(3, Math.floor((width - 22) / 5.4)))}…` : text };
  }
  // Six selected markers can occupy all four corners. Search the remaining
  // free space in a small grid before suppressing the label.
  const stepX = Math.max(8, Math.min(18, Math.floor((rect.width - width - pad * 2) / 8)));
  const stepY = Math.max(8, Math.min(18, Math.floor((rect.height - height - pad * 2) / 6)));
  for (let y = rect.y + pad; y <= rect.y + rect.height - height - pad; y += stepY) {
    for (let x = rect.x + pad; x <= rect.x + rect.width - width - pad; x += stepX) {
      const collides = points.some(point => point.x >= x - 8 && point.x <= x + width + 8 && point.y >= y - 8 && point.y <= y + height + 8);
      if (!collides) return { x, y, width, height, text: text.length * 5.4 + 16 > width ? `${text.slice(0, Math.max(3, Math.floor((width - 22) / 5.4)))}…` : text };
    }
  }
  return null;
}

export function ScatterChart({ result, xMetric, yMetric, dirX, dirY, selectedColors, logScale, showLabels, highlighted, dataAsOfLabel, riskWindow, onThresholdChange, onDirectionChange, onInspect }: {
  result: ScatterQueryResult; xMetric: MetricDefinition; yMetric: MetricDefinition; dirX: MetricDirection; dirY: MetricDirection;
  selectedColors: Record<number, string>; logScale: boolean; showLabels: boolean; highlighted: QuadrantId | null;
  onInspect: (code: number) => void; onThresholdChange: (axis: 'x' | 'y', value: number) => void; onDirectionChange: (axis: 'x' | 'y', direction: MetricDirection) => void;
  dataAsOfLabel: string; riskWindow: 1 | 3 | 5;
}) {
  const host = useRef<HTMLDivElement>(null); const svgRef = useRef<SVGSVGElement>(null); const dragAxis = useRef<'x' | 'y' | null>(null); const dragValue = useRef<number | null>(null); const uid = useId().replace(/:/g, '');
  const [width, setWidth] = useState(720); const [height, setHeight] = useState(405); const [compactLabels, setCompactLabels] = useState(false); const [tooltipCode, setTooltipCode] = useState<number | null>(null); const [dragged, setDragged] = useState<{ axis: 'x' | 'y'; value: number } | null>(null);
  useEffect(() => {
    const node = host.current; if (!node) return;
    const observer = new ResizeObserver(entries => { const next = entries[0]?.contentRect; if (!next) return; const narrow = next.width < 640; setWidth(Math.max(280, Math.round(next.width))); setHeight(Math.max(300, Math.round(next.width * (narrow ? .75 : .5625)))); setCompactLabels(next.width < 360); });
    observer.observe(node); return () => observer.disconnect();
  }, []);

  const thresholdsVisible = result.codes.length > 0 && Number.isFinite(result.thresholds.x) && Number.isFinite(result.thresholds.y);
  const canLog = logScale && [...Array.from(result.x), ...Array.from(result.y), ...(result.thresholds.x === null ? [] : [result.thresholds.x]), ...(result.thresholds.y === null ? [] : [result.thresholds.y])].every(value => value > 0);
  const project = (value: number) => canLog ? Math.log10(value) : value;
  const unproject = (value: number) => canLog ? 10 ** value : value;
  const plot = useMemo(() => {
    const bounds = { left: width < 360 ? 82 : 74, top: 36, right: width - 20, bottom: height - 66 };
    const xValues = Array.from(result.x, value => canLog ? Math.log10(value) : value); const yValues = Array.from(result.y, value => canLog ? Math.log10(value) : value);
    if (result.thresholds.x !== null && (!canLog || result.thresholds.x > 0)) xValues.push(canLog ? Math.log10(result.thresholds.x) : result.thresholds.x);
    if (result.thresholds.y !== null && (!canLog || result.thresholds.y > 0)) yValues.push(canLog ? Math.log10(result.thresholds.y) : result.thresholds.y);
    const range = (values: number[]) => {
      if (!values.length) return [0, 1] as const;
      let min = Math.min(...values); let max = Math.max(...values);
      if (min === max) { const pad = Math.max(Math.abs(min) * .08, .01); min -= pad; max += pad; }
      const pad = (max - min) * .08; return [min - pad, max + pad] as const;
    };
    const [xmin, xmax] = range(xValues); const [ymin, ymax] = range(yValues);
    const px = (value: number) => bounds.left + ((project(value) - xmin) / (xmax - xmin)) * (bounds.right - bounds.left);
    const py = (value: number) => bounds.bottom - ((project(value) - ymin) / (ymax - ymin)) * (bounds.bottom - bounds.top);
    const positions = Array.from(result.codes, (_, index) => ({ x: px(result.x[index]!), y: py(result.y[index]!), label: shortFundName(result.names[index]!) }));
    const xTickValues = canLog ? niceTicks(xmin, xmax).map(unproject) : niceTicks(xmin, xmax);
    const yTickValues = canLog ? niceTicks(ymin, ymax).map(unproject) : niceTicks(ymin, ymax);
    return { bounds, xmin, xmax, ymin, ymax, px, py, positions, xTicks: xTickValues, yTicks: yTickValues, labels: labelPlacement(positions, bounds) };
  }, [result, width, height, canLog]);

  const dark = document.documentElement.dataset.theme === 'dark';
  const ink = dark ? '#e4eaf2' : '#263445'; const muted = dark ? '#a5b2c2' : '#617187'; const grid = dark ? '#354354' : '#d7dfe8';
  const splitXValue = dragged?.axis === 'x' ? dragged.value : result.thresholds.x; const splitYValue = dragged?.axis === 'y' ? dragged.value : result.thresholds.y;
  const xSplit = thresholdsVisible && splitXValue !== null ? plot.px(splitXValue) : null; const ySplit = thresholdsVisible && splitYValue !== null ? plot.py(splitYValue) : null;
  const splitRule = dragged ? 'custom' : result.thresholds.rule;
  const splitName = splitRule === 'peer-median' ? 'Peer median' : splitRule === 'median' ? 'Median of selected' : splitRule === 'mean' ? 'Mean of selected' : 'Custom';
  const dragValueAt = (axis: 'x' | 'y', event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = svgRef.current?.getBoundingClientRect(); if (!rect || !rect.width || !rect.height) return null;
    const px = (event.clientX - rect.left) * width / rect.width; const py = (event.clientY - rect.top) * height / rect.height;
    if (axis === 'x') { const fraction = Math.max(0, Math.min(1, (px - plot.bounds.left) / (plot.bounds.right - plot.bounds.left))); return unproject(plot.xmin + fraction * (plot.xmax - plot.xmin)); }
    const fraction = Math.max(0, Math.min(1, (plot.bounds.bottom - py) / (plot.bounds.bottom - plot.bounds.top))); return unproject(plot.ymin + fraction * (plot.ymax - plot.ymin));
  };
  const beginDrag = (axis: 'x' | 'y', event: ReactPointerEvent<SVGLineElement>) => { const value = dragValueAt(axis, event); if (value === null) return; dragAxis.current = axis; dragValue.current = value; event.currentTarget.setPointerCapture(event.pointerId); setDragged({ axis, value }); };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => { const axis = dragAxis.current; if (!axis) return; const value = dragValueAt(axis, event); if (value !== null) { dragValue.current = value; setDragged({ axis, value }); } };
  const endDrag = () => { if (dragAxis.current && dragValue.current !== null) onThresholdChange(dragAxis.current, dragValue.current); dragAxis.current = null; dragValue.current = null; setDragged(null); };

  const quadrants = thresholdsVisible ? ([0, 1, 2, 3] as QuadrantId[]).map(id => {
    const highX = (id & 1) !== 0; const highY = (id & 2) !== 0;
    const x1 = highX ? xSplit! : plot.bounds.left; const x2 = highX ? plot.bounds.right : xSplit!;
    const y1 = highY ? plot.bounds.top : ySplit!; const y2 = highY ? ySplit! : plot.bounds.bottom;
    const label = quadrantName(id, xMetric.label, yMetric.label, dirX, dirY); const tone: Tone = quadrantTone(dirX === 'higher' ? true : dirX === 'lower' ? false : null, dirY === 'higher' ? true : dirY === 'lower' ? false : null, id);
    const rect = { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
    const chip = quadrantChip(id, tone, rect, label.label, plot.positions, compactLabels);
    return { id, ...rect, label: label.label, kind: label.kind, tone, chip };
  }) : [];
  const pointQuadrants = Array.from(result.codes, (_, index) => result.quadrants[index]! as QuadrantId);
  const activeTooltip = tooltipCode === null ? -1 : result.codes.indexOf(tooltipCode);
  const customPatternId = `scatter-worst-hatch-${uid}`; const clipId = `scatter-plot-clip-${uid}`;
  const callout = dirX === 'none' || dirY === 'none';

  return <div ref={host} className="scatter-chart-host">
    {result.codes.length === 0 ? <div className="scatter-chart-empty" role="status">No selected funds have both values for these metrics.</div> : <>
      <svg ref={svgRef} className="scatter-chart-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Selected-fund scatter chart: ${xMetric.label} versus ${yMetric.label}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <title>How your selected funds compare · {formatMetricAxisLabel(xMetric, riskWindow)} × {formatMetricAxisLabel(yMetric, riskWindow)} · Split: {splitName} · Data as of {dataAsOfLabel}</title>
        <desc>Only compared funds with both values appear. Axes are natural: larger values increase to the right and top. {dirX === 'none' || dirY === 'none' ? 'Quadrants are neutral until you choose a direction.' : 'Quadrant colors move with the selected metric directions.'}</desc>
        <text x={plot.bounds.left} y="15" fill={muted} fontSize="11" fontWeight="650">How your selected funds compare</text>
        <text x={width - 20} y="15" textAnchor="end" fill={muted} fontSize="10">Data as of {dataAsOfLabel}</text>
        <defs><clipPath id={clipId}><rect x={plot.bounds.left} y={plot.bounds.top} width={plot.bounds.right - plot.bounds.left} height={plot.bounds.bottom - plot.bounds.top}/></clipPath><pattern id={customPatternId} width="8" height="8" patternTransform="rotate(35)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="8" className="scatter-worst-hatch-line"/></pattern></defs>
        <g clipPath={`url(#${clipId})`} aria-label="Quadrants">
          {quadrants.map(item => <g key={`q${item.id}`} className={`scatter-quadrant-group ${item.tone}`} data-quadrant={item.id} data-tone={item.tone}><rect className={`scatter-quadrant ${item.tone}`} x={item.x} y={item.y} width={item.width} height={item.height}/>{item.tone === 'worst' && <rect className="scatter-quadrant-hatch" x={item.x} y={item.y} width={item.width} height={item.height} fill={`url(#${customPatternId})`}/>}</g>)}
          <g className="scatter-grid" aria-hidden="true">{plot.yTicks.map(value => <g key={`y${value}`}><line x1={plot.bounds.left} x2={plot.bounds.right} y1={plot.py(value)} y2={plot.py(value)}/><text x={plot.bounds.left - 8} y={plot.py(value) + 4} textAnchor="end">{numberLabel(value, yMetric.unit)}</text></g>)}{plot.xTicks.map(value => <g key={`x${value}`}><line x1={plot.px(value)} x2={plot.px(value)} y1={plot.bounds.top} y2={plot.bounds.bottom}/><text x={plot.px(value)} y={plot.bounds.bottom + 18} textAnchor="middle">{numberLabel(value, xMetric.unit)}</text></g>)}</g>
          {thresholdsVisible && <g className="scatter-split-lines"><line x1={xSplit!} x2={xSplit!} y1={plot.bounds.top} y2={plot.bounds.bottom}/><line x1={plot.bounds.left} x2={plot.bounds.right} y1={ySplit!} y2={ySplit!}/><line className="scatter-split-hit" x1={xSplit!} x2={xSplit!} y1={plot.bounds.top} y2={plot.bounds.bottom} onPointerDown={event => beginDrag('x', event)}/><line className="scatter-split-hit" x1={plot.bounds.left} x2={plot.bounds.right} y1={ySplit!} y2={ySplit!} onPointerDown={event => beginDrag('y', event)}/></g>}
          {Array.from(result.codes, (_, index) => { const point = plot.positions[index]!; const code = result.codes[index]!; const color = selectedColors[code] ?? '#6654ee'; const faded = highlighted !== null && highlighted !== pointQuadrants[index]; const active = tooltipCode === code; const path = symbolPath(index % 6, point.x, point.y); return <g key={code} className={`scatter-svg-point${active ? ' active' : ''}`} tabIndex={0} role="button" aria-label={`${result.names[index]}, ${numberLabel(result.x[index]!, xMetric.unit)} ${xMetric.label}, ${numberLabel(result.y[index]!, yMetric.unit)} ${yMetric.label}`} onPointerEnter={() => setTooltipCode(code)} onPointerLeave={() => setTooltipCode(null)} onFocus={() => setTooltipCode(code)} onBlur={() => setTooltipCode(null)} onClick={() => onInspect(code)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(code); } }} opacity={faded ? .35 : 1}><path className="scatter-point-halo" d={path}/><path className="scatter-point-symbol" d={path} fill={index % 6 === 4 ? 'none' : color} stroke={color}/><circle cx={point.x} cy={point.y} r="13" fill="transparent"/><title>{result.names[index]} · {numberLabel(result.x[index]!, xMetric.unit)} × {numberLabel(result.y[index]!, yMetric.unit)}</title></g>;})}
          {showLabels && !compactLabels && Array.from(result.codes, (_, index) => { const pos = plot.labels[index]!; const point = plot.positions[index]!; return <g key={`label${result.codes[index]}`} className="scatter-point-label" pointerEvents="none">{pos.moved && <line x1={point.x} y1={point.y} x2={pos.x} y2={pos.y - 3}/>}<text x={pos.x} y={pos.y} textAnchor={pos.anchor}>{point.label}</text></g>;})}
          {showLabels && compactLabels && Array.from(result.codes, (_, index) => { const point = plot.positions[index]!; const code = result.codes[index]!; return <g key={`number${code}`} className="scatter-point-number" pointerEvents="none"><circle cx={point.x + 12} cy={point.y - 12} r="9" fill={selectedColors[code] ?? '#6654ee'}/><text x={point.x + 12} y={point.y - 9} textAnchor="middle">{index + 1}</text></g>;})}
          {quadrants.map(item => item.chip && <g key={`chip${item.id}`} className={`scatter-quadrant-chip ${item.tone}`}><rect x={item.chip.x} y={item.chip.y} width={item.chip.width} height={item.chip.height} rx="5"/><text x={item.chip.x + 8} y={item.chip.y + 15}>{item.chip.text}</text></g>)}
        </g>
        {thresholdsVisible && <g className="scatter-split-labels"><rect x={Math.max(plot.bounds.left + 2, Math.min(plot.bounds.right - 148, xSplit! + 5))} y={plot.bounds.top + 2} width="144" height="20" rx="4"/><text x={Math.max(plot.bounds.left + 7, Math.min(plot.bounds.right - 143, xSplit! + 10))} y={plot.bounds.top + 16}>{splitName} {numberLabel(splitXValue!, xMetric.unit)}</text><rect x={plot.bounds.left + 3} y={Math.max(plot.bounds.top + 3, Math.min(plot.bounds.bottom - 22, ySplit! - 23))} width="144" height="20" rx="4"/><text x={plot.bounds.left + 8} y={Math.max(plot.bounds.top + 17, Math.min(plot.bounds.bottom - 7, ySplit! - 9))}>{splitName} {numberLabel(splitYValue!, yMetric.unit)}</text></g>}
        <path className="scatter-axis-path" d={`M${plot.bounds.left} ${plot.bounds.top}V${plot.bounds.bottom}H${plot.bounds.right}`}/>
        <text className="scatter-axis-title" x={(plot.bounds.left + plot.bounds.right) / 2} y={height - 9} textAnchor="middle" textLength={Math.max(80, width - plot.bounds.left - 28)} lengthAdjust="spacingAndGlyphs">{formatMetricAxisLabel(xMetric, riskWindow)}</text>
        <text className="scatter-axis-title" transform={`translate(15 ${(plot.bounds.top + plot.bounds.bottom) / 2}) rotate(-90)`} textAnchor="middle" textLength={Math.max(100, plot.bounds.bottom - plot.bounds.top - 8)} lengthAdjust="spacingAndGlyphs">{formatMetricAxisLabel(yMetric, riskWindow)}</text>
      </svg>
      {callout && <div className="scatter-direction-callout" role="group" aria-label="Choose a preferred direction to color the quadrants"><b>Choose which direction is better for {dirX === 'none' ? xMetric.label : yMetric.label}.</b><span>Until then the quadrants are neutral.</span>{dirX === 'none' && <DirectionButtons axis="x" onChange={onDirectionChange} />}{dirY === 'none' && <DirectionButtons axis="y" onChange={onDirectionChange} />}</div>}
      {activeTooltip >= 0 && <div className="scatter-chart-tooltip" role="tooltip"><b>{result.names[activeTooltip]}</b><span>{result.amcs[activeTooltip]}</span><span>{xMetric.label}: {numberLabel(result.x[activeTooltip]!, xMetric.unit)} · rank #{result.rankX[activeTooltip]} of {result.codes.length}{dirX === 'none' ? ' · no preference' : ` · top ${result.percentileX[activeTooltip]!.toFixed(1)}%`}</span><span>{yMetric.label}: {numberLabel(result.y[activeTooltip]!, yMetric.unit)} · rank #{result.rankY[activeTooltip]} of {result.codes.length}{dirY === 'none' ? ' · no preference' : ` · top ${result.percentileY[activeTooltip]!.toFixed(1)}%`}</span><span>{thresholdsVisible ? quadrantName(result.quadrants[activeTooltip]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'No quadrant split is available yet'}</span></div>}
    </>}
  </div>;
}

function DirectionButtons({ axis, onChange }: { axis: 'x' | 'y'; onChange: (axis: 'x' | 'y', direction: MetricDirection) => void }) {
  return <div className="scatter-inline-directions" aria-label={`Direction for ${axis.toUpperCase()} axis`}><button type="button" onClick={() => onChange(axis, 'higher')}>↑ Higher</button><button type="button" onClick={() => onChange(axis, 'lower')}>↓ Lower</button></div>;
}
