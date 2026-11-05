import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MetricDefinition } from '../../domain/types';
import { labelPlacement, niceTicks } from '../../domain/scatter/presentation';
import { quadrantName, type MetricDirection, type QuadrantId } from '../../domain/scatter/quadrants';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';

function numberLabel(value: number, unit: MetricDefinition['unit']): string {
  const digits = Math.abs(value) < 1 ? 2 : 1;
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
  return unit === '%' ? `${text}%` : unit === '₹ Cr' ? `₹${text} Cr` : unit === 'years' ? `${text} yr` : unit === 'ratio' ? `${text}x` : text;
}
function shortAxisName(metric: MetricDefinition): string { return metric.label.replace(/\s*\([^)]*%[^)]*\)\s*$/g, '').replace(/\s*\([^)]*₹[^)]*\)\s*$/g, '').trim(); }
function symbolPath(shape: number, x: number, y: number, radius = 8): string {
  if (shape === 1) return `M${x-radius} ${y-radius}h${radius*2}v${radius*2}h-${radius*2}z`;
  if (shape === 2) return `M${x} ${y-radius-1}L${x+radius+1} ${y}L${x} ${y+radius+1}L${x-radius-1} ${y}z`;
  if (shape === 3) return `M${x} ${y-radius-1}L${x+radius} ${y+radius}H${x-radius}z`;
  if (shape === 4) return `M${x-radius} ${y-radius}l${radius*2} ${radius*2}m0 -${radius*2}l-${radius*2} ${radius*2}`;
  if (shape === 5) return `M${x} ${y-radius-1}l${radius*.28} ${radius*.65}l${radius*.72} ${radius*.1}l-${radius*.52} ${radius*.5}l${radius*.15} ${radius*.76}l-${radius*.63} -${radius*.38}l-${radius*.63} ${radius*.38}l${radius*.15} -${radius*.76}l-${radius*.52} -${radius*.5}l${radius*.72} -${radius*.1}z`;
  return `M${x-radius} ${y}a${radius} ${radius} 0 1 0 ${radius*2} 0a${radius} ${radius} 0 1 0 -${radius*2} 0`;
}

export function ScatterChart({ result, xMetric, yMetric, dirX, dirY, selectedColors, bestAtTopRight, highlighted, dataAsOfLabel, onThresholdChange, onInspect }: {
  result: ScatterQueryResult; xMetric: MetricDefinition; yMetric: MetricDefinition; dirX: MetricDirection; dirY: MetricDirection;
  selectedColors: Record<number, string>; bestAtTopRight: boolean; highlighted: QuadrantId | null;
  onInspect: (code: number) => void; onThresholdChange: (axis: 'x' | 'y', value: number) => void; dataAsOfLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null); const svgRef = useRef<SVGSVGElement>(null); const dragAxis = useRef<'x' | 'y' | null>(null);
  const [width, setWidth] = useState(800); const [height, setHeight] = useState(450); const [compactLabels, setCompactLabels] = useState(false); const [tooltipCode, setTooltipCode] = useState<number | null>(null); const [dragged, setDragged] = useState<{ axis: 'x' | 'y'; value: number } | null>(null);
  useEffect(() => {
    const node = host.current; if (!node) return;
    const observer = new ResizeObserver(entries => { const next = entries[0]?.contentRect; if (!next) return;
      const narrow = next.width < 640; setWidth(Math.max(280, Math.round(next.width))); setHeight(Math.max(300, Math.round(next.width * (narrow ? .75 : .5625)))); setCompactLabels(next.width < 360); });
    observer.observe(node); return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    const bounds = { left: 68, top: 24, right: width - 18, bottom: height - 72 };
    const xValues = Array.from(result.x); const yValues = Array.from(result.y);
    if (result.thresholds.x !== null) xValues.push(result.thresholds.x); if (result.thresholds.y !== null) yValues.push(result.thresholds.y);
    const range = (values: number[]) => {
      if (!values.length) return [0, 1] as const;
      let min = Math.min(...values); let max = Math.max(...values);
      if (min === max) { const pad = Math.max(Math.abs(min) * .08, .01); min -= pad; max += pad; }
      const pad = (max - min) * .08; return [min - pad, max + pad] as const;
    };
    const [xmin, xmax] = range(xValues); const [ymin, ymax] = range(yValues);
    const reverseX = bestAtTopRight && dirX === 'lower'; const reverseY = bestAtTopRight && dirY === 'lower';
    const px = (value: number) => bounds.left + ((reverseX ? xmax - value : value - xmin) / (xmax - xmin)) * (bounds.right - bounds.left);
    const py = (value: number) => bounds.bottom - ((reverseY ? ymax - value : value - ymin) / (ymax - ymin)) * (bounds.bottom - bounds.top);
    const positions = Array.from(result.codes, (_, index) => ({ x: px(result.x[index]!), y: py(result.y[index]!), label: result.names[index]!.replace(/\s+(direct|regular|growth|idcw|dividend).*$/i, '').slice(0, 22) }));
    return { bounds, xmin, xmax, ymin, ymax, px, py, positions, xTicks: niceTicks(xmin, xmax), yTicks: niceTicks(ymin, ymax), labels: labelPlacement(positions, bounds) };
  }, [result, width, height, bestAtTopRight, dirX, dirY]);
  const thresholdsVisible = result.codes.length >= 2 && result.thresholds.x !== null && result.thresholds.y !== null;
  const dark = document.documentElement.dataset.theme === 'dark';
  const ink = dark ? '#e4eaf2' : '#263445'; const muted = dark ? '#a5b2c2' : '#617187'; const grid = dark ? '#2a3645' : '#dfe5ec';
  const splitXValue = dragged?.axis === 'x' ? dragged.value : result.thresholds.x;
  const splitYValue = dragged?.axis === 'y' ? dragged.value : result.thresholds.y;
  const xSplit = thresholdsVisible && splitXValue !== null ? plot.px(splitXValue) : null; const ySplit = thresholdsVisible && splitYValue !== null ? plot.py(splitYValue) : null;
  const splitRule = dragged ? 'custom' : result.thresholds.rule;
  const splitName = splitRule === 'peer-median' ? 'Peer median' : splitRule === 'median' ? 'Median of selected' : splitRule === 'mean' ? 'Mean of selected' : 'Custom';
  const dragValueAt = (axis: 'x' | 'y', event: ReactPointerEvent<SVGLineElement>) => {
    const rect = svgRef.current?.getBoundingClientRect(); if (!rect || !rect.width || !rect.height) return null;
    const px = (event.clientX - rect.left) * width / rect.width; const py = (event.clientY - rect.top) * height / rect.height;
    if (axis === 'x') { let fraction = Math.max(0, Math.min(1, (px - plot.bounds.left) / (plot.bounds.right - plot.bounds.left))); if (bestAtTopRight && dirX === 'lower') fraction = 1 - fraction; return plot.xmin + fraction * (plot.xmax - plot.xmin); }
    let fraction = Math.max(0, Math.min(1, (plot.bounds.bottom - py) / (plot.bounds.bottom - plot.bounds.top))); if (bestAtTopRight && dirY === 'lower') fraction = 1 - fraction; return plot.ymin + fraction * (plot.ymax - plot.ymin);
  };
  const beginDrag = (axis: 'x' | 'y', event: ReactPointerEvent<SVGLineElement>) => { const value = dragValueAt(axis, event); if (value === null) return; dragAxis.current = axis; event.currentTarget.setPointerCapture(event.pointerId); setDragged({ axis, value }); };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => { const axis = dragAxis.current; if (!axis) return; const value = dragValueAt(axis, event as unknown as ReactPointerEvent<SVGLineElement>); if (value !== null) setDragged({ axis, value }); };
  const endDrag = () => { if (dragAxis.current && dragged) onThresholdChange(dragAxis.current, dragged.value); dragAxis.current = null; setDragged(null); };
  const quadrants = thresholdsVisible ? ([0, 1, 2, 3] as QuadrantId[]).map(id => {
    const highX = (id & 1) !== 0; const highY = (id & 2) !== 0;
    const leftSide = highX === (bestAtTopRight && dirX === 'lower'); const topSide = highY !== (bestAtTopRight && dirY === 'lower');
    const x1 = leftSide ? plot.bounds.left : xSplit!; const x2 = leftSide ? xSplit! : plot.bounds.right;
    const y1 = topSide ? plot.bounds.top : ySplit!; const y2 = topSide ? ySplit! : plot.bounds.bottom;
    const label = quadrantName(id, xMetric.label, yMetric.label, dirX, dirY);
    const text = label.kind === 'best' ? `★ Best · ${label.label}` : label.kind === 'avoid' ? `⚠ Avoid · ${label.label}` : label.kind === 'neutral' ? label.label : 'Trade-off';
    return { id, x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1), label: text, kind: label.kind };
  }) : [];
  const fillFor = (kind: string) => kind === 'best' ? (dark ? '#1e6048' : '#d8f3e7') : kind === 'avoid' ? (dark ? '#65313b' : '#fbe1e1') : dark ? '#273341' : '#eef2f6';

  return <div ref={host} className="scatter-chart-host">
    {result.codes.length === 0 ? <div className="scatter-chart-empty" role="status">No selected funds have both values for these metrics.</div> :
      <svg ref={svgRef} className="scatter-chart-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Selected-fund scatter chart: ${xMetric.label} versus ${yMetric.label}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <title>{xMetric.label} × {yMetric.label}</title>
        <desc>Only the selected funds with both metrics are plotted. Split rule: {splitName}.</desc>
        <text x={plot.bounds.left} y="15" fill={muted} fontSize="10">Data as of {dataAsOfLabel}</text>
        <defs><clipPath id="scatter-plot-clip"><rect x={plot.bounds.left} y={plot.bounds.top} width={plot.bounds.right - plot.bounds.left} height={plot.bounds.bottom - plot.bounds.top}/></clipPath></defs>
        <g aria-hidden="true">{plot.yTicks.map(value => <g key={`y${value}`}><line x1={plot.bounds.left} x2={plot.bounds.right} y1={plot.py(value)} y2={plot.py(value)} stroke={grid}/><text x={plot.bounds.left - 8} y={plot.py(value) + 4} textAnchor="end" fill={muted} fontSize="11">{numberLabel(value, yMetric.unit)}</text></g>)}{plot.xTicks.map(value => <g key={`x${value}`}><line x1={plot.px(value)} x2={plot.px(value)} y1={plot.bounds.top} y2={plot.bounds.bottom} stroke={grid}/><text x={plot.px(value)} y={plot.bounds.bottom + 18} textAnchor="middle" fill={muted} fontSize="11">{numberLabel(value, xMetric.unit)}</text></g>)}</g>
        <g clipPath="url(#scatter-plot-clip)">{quadrants.map(item => <rect key={`q${item.id}`} x={item.x} y={item.y} width={item.width} height={item.height} fill={fillFor(item.kind)} opacity={highlighted === null || highlighted === item.id ? .52 : .18}/>)}
          {thresholdsVisible && <><line x1={xSplit!} x2={xSplit!} y1={plot.bounds.top} y2={plot.bounds.bottom} stroke={muted} strokeDasharray="6 5" strokeWidth="1.5"/><line x1={plot.bounds.left} x2={plot.bounds.right} y1={ySplit!} y2={ySplit!} stroke={muted} strokeDasharray="6 5" strokeWidth="1.5"/><line x1={xSplit!} x2={xSplit!} y1={plot.bounds.top} y2={plot.bounds.bottom} stroke="transparent" strokeWidth="14" pointerEvents="stroke" onPointerDown={event => beginDrag('x', event)} style={{ cursor: 'ew-resize' }}/><line x1={plot.bounds.left} x2={plot.bounds.right} y1={ySplit!} y2={ySplit!} stroke="transparent" strokeWidth="14" pointerEvents="stroke" onPointerDown={event => beginDrag('y', event)} style={{ cursor: 'ns-resize' }}/></>}
          {Array.from(result.codes, (_, index) => { const point = plot.positions[index]!; const color = selectedColors[result.codes[index]!] ?? '#6654ee'; const focused = highlighted === null || highlighted === result.quadrants[index]; return <g key={result.codes[index]} className="scatter-svg-point" tabIndex={0} role="button" aria-label={`${result.names[index]}, ${numberLabel(result.x[index]!, xMetric.unit)} ${xMetric.label}, ${numberLabel(result.y[index]!, yMetric.unit)} ${yMetric.label}`} onPointerEnter={() => setTooltipCode(result.codes[index]!)} onPointerLeave={() => setTooltipCode(null)} onFocus={() => setTooltipCode(result.codes[index]!)} onBlur={() => setTooltipCode(null)} onClick={() => onInspect(result.codes[index]!)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(result.codes[index]!); } }} opacity={focused ? 1 : .35}><path d={symbolPath(index % 6, point.x, point.y)} fill={index % 6 === 4 ? 'none' : color} stroke={color} strokeWidth="2"/><circle cx={point.x} cy={point.y} r="13" fill="transparent"/><title>{result.names[index]} · {numberLabel(result.x[index]!, xMetric.unit)} × {numberLabel(result.y[index]!, yMetric.unit)}</title></g>; })}
        </g>
        {thresholdsVisible && <g className="scatter-split-labels" fill={ink} fontSize="10" fontWeight="650"><rect x={Math.max(plot.bounds.left + 2, Math.min(plot.bounds.right - 132, xSplit! + 5))} y={plot.bounds.top + 2} width="128" height="18" rx="4" fill={dark ? '#131a22' : '#ffffff'} opacity=".92"/><text x={Math.max(plot.bounds.left + 7, Math.min(plot.bounds.right - 127, xSplit! + 10))} y={plot.bounds.top + 15}>{splitName} {numberLabel(splitXValue!, xMetric.unit)}</text><rect x={plot.bounds.left + 3} y={Math.max(plot.bounds.top + 3, Math.min(plot.bounds.bottom - 20, ySplit! - 21))} width="128" height="18" rx="4" fill={dark ? '#131a22' : '#ffffff'} opacity=".92"/><text x={plot.bounds.left + 8} y={Math.max(plot.bounds.top + 16, Math.min(plot.bounds.bottom - 7, ySplit! - 8))}>{splitName} {numberLabel(splitYValue!, yMetric.unit)}</text></g>}
        {quadrants.map(item => <g key={`ql${item.id}`} className="scatter-quadrant-label" fill={ink} fontSize="10" pointerEvents="none"><text x={item.x + 7} y={item.y + 34}>{item.label.slice(0, Math.max(5, Math.floor((item.width - 12) / 5.8)))}</text></g>)}
        {!compactLabels && Array.from(result.codes, (_, index) => { const pos = plot.labels[index]!; const point = plot.positions[index]!; return <g key={`label${result.codes[index]}`} pointerEvents="none">{pos.moved && <line x1={point.x} y1={point.y} x2={pos.x} y2={pos.y - 3} stroke={muted} strokeWidth=".8"/>}<text x={pos.x} y={pos.y} textAnchor={pos.anchor} fill={ink} fontSize="10">{plot.positions[index]!.label}</text></g>; })}
        {compactLabels && Array.from(result.codes, (_, index) => { const point = plot.positions[index]!; return <g key={`number${result.codes[index]}`} pointerEvents="none"><circle cx={point.x + 12} cy={point.y - 12} r="9" fill={selectedColors[result.codes[index]!] ?? '#6654ee'}/><text x={point.x + 12} y={point.y - 9} textAnchor="middle" fill="#fff" fontSize="9">{index + 1}</text></g>; })}
        <path d={`M${plot.bounds.left} ${plot.bounds.top}V${plot.bounds.bottom}H${plot.bounds.right}`} fill="none" stroke={ink}/>
        <text x={(plot.bounds.left + plot.bounds.right) / 2} y={height - 8} textAnchor="middle" fill={ink} fontSize="11">{shortAxisName(xMetric)}{bestAtTopRight && dirX === 'lower' ? ' · ↺ reversed' : ''}</text>
        <text transform={`translate(15 ${(plot.bounds.top + plot.bounds.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill={ink} fontSize="11">{shortAxisName(yMetric)}{bestAtTopRight && dirY === 'lower' ? ' · ↺ reversed' : ''}</text>
      </svg>}
    {tooltipCode !== null && result.codes.includes(tooltipCode) && (() => { const index = result.codes.indexOf(tooltipCode); return <div className="scatter-chart-tooltip" role="tooltip"><b>{result.names[index]}</b><span>{result.amcs[index]}</span><span>{xMetric.label}: {numberLabel(result.x[index]!, xMetric.unit)} · {dirX === 'none' ? `${result.rankX[index]!.toFixed(0)}th percentile` : `top ${result.rankX[index]!.toFixed(1)}%`}</span><span>{yMetric.label}: {numberLabel(result.y[index]!, yMetric.unit)} · {dirY === 'none' ? `${result.rankY[index]!.toFixed(0)}th percentile` : `top ${result.rankY[index]!.toFixed(1)}%`}</span><span>{thresholdsVisible ? quadrantName(result.quadrants[index]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'No quadrant yet'}</span></div>; })()}
  </div>;
}
