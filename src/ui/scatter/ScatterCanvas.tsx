import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { MetricDefinition } from '../../domain/types';
import type { MetricDirection, QuadrantId } from '../../domain/scatter/quadrants';
import { quadrantName } from '../../domain/scatter/quadrants';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';

type View = { x0: number; x1: number; y0: number; y1: number };
type Point = { index: number; x: number; y: number };
const INITIAL_VIEW: View = { x0: 0, x1: 1, y0: 0, y1: 1 };
const PLOT = { left: 56, right: 18, top: 25, bottom: 48 };
const QUADRANT_COLORS = ['#d99000', '#15966c', '#bf5968', '#0b83a5'];

function valueLabel(value: number, unit: MetricDefinition['unit']) {
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
  return unit === '%' ? `${text}%` : unit === '₹ Cr' ? `₹${text} Cr` : unit === 'years' ? `${text} yr` : unit === 'ratio' ? `${text}x` : text;
}

function bounds(data: ScatterQueryResult, includeOutliers: boolean, logX: boolean, logY: boolean) {
  const source = includeOutliers ? data.dataBounds : data.outlierBounds;
  let { xMin, xMax, yMin, yMax } = source;
  if (xMin === null || xMax === null || yMin === null || yMax === null) return null;
  if (logX || logY) {
    let xLow = Infinity; let xHigh = -Infinity; let yLow = Infinity; let yHigh = -Infinity;
    for (let i = 0; i < data.x.length; i++) {
      const xv = data.x[i]!; const yv = data.y[i]!;
      if ((!logX || xv > 0) && xv >= xMin && xv <= xMax) { xLow = Math.min(xLow, xv); xHigh = Math.max(xHigh, xv); }
      if ((!logY || yv > 0) && yv >= yMin && yv <= yMax) { yLow = Math.min(yLow, yv); yHigh = Math.max(yHigh, yv); }
    }
    if (![xLow, xHigh, yLow, yHigh].every(Number.isFinite)) return null;
    xMin = xLow; xMax = xHigh; yMin = yLow; yMax = yHigh;
  }
  return { xMin, xMax, yMin, yMax };
}

export function ScatterCanvas({ result, xMetric, yMetric, dirX, dirY, bestAtTopRight, includeOutliers, logScale, highlightedQuadrant, selectedColors, inspectCode, onInspect, onThresholdChange }: {
  result: ScatterQueryResult | null; xMetric: MetricDefinition; yMetric: MetricDefinition; dirX: MetricDirection; dirY: MetricDirection;
  bestAtTopRight: boolean; includeOutliers: boolean; logScale: boolean; highlightedQuadrant: QuadrantId | null;
  selectedColors: Record<number, string>; inspectCode: number | null; onInspect: (code: number) => void; onThresholdChange: (axis: 'x' | 'y', value: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 720, height: 360 }); const [view, setView] = useState<View>(INITIAL_VIEW);
  const [draggedThreshold, setDraggedThreshold] = useState<{ axis: 'x' | 'y'; value: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null); const [keyboardIndex, setKeyboardIndex] = useState(0);
  const pointGrid = useRef<Map<string, Point[]>>(new Map()); const pointSize = useRef(28);
  const pointer = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean; dragAxis: 'x' | 'y' | null } | null>(null);
  const activePointers=useRef<Map<number,{x:number;y:number}>>(new Map());const pinchStart=useRef<{distance:number;view:View;centerX:number;centerY:number}|null>(null);
  const lastTap = useRef(0);
  const logX = logScale && xMetric.unit === '₹ Cr'; const logY = logScale && yMetric.unit === '₹ Cr';
  const domain = useMemo(() => result ? bounds(result, includeOutliers, logX, logY) : null, [result, includeOutliers, logX, logY]);
  const safeDomain = useMemo(() => {
    if (!domain) return null;
    const transformX = (value: number) => logX ? Math.log10(value) : value; const transformY = (value: number) => logY ? Math.log10(value) : value;
    const x0 = transformX(domain.xMin); const x1 = transformX(domain.xMax); const y0 = transformY(domain.yMin); const y1 = transformY(domain.yMax);
    const pad = (low: number, high: number) => high > low ? [low, high] as const : [low - Math.max(Math.abs(low) * .02, .5), high + Math.max(Math.abs(high) * .02, .5)] as const;
    const [xMin, xMax] = pad(x0, x1); const [yMin, yMax] = pad(y0, y1);
    return { xMin, xMax, yMin, yMax, transformX, transformY };
  }, [domain, logX, logY]);
  const project = (index: number, width = size.width, height = size.height, activeView = view): Point | null => {
    if (!result || !safeDomain) return null;
    const xv = result.x[index]!; const yv = result.y[index]!;
    if ((logX && xv <= 0) || (logY && yv <= 0)) return null;
    const tx = safeDomain.transformX(xv); const ty = safeDomain.transformY(yv);
    let nx = (tx - safeDomain.xMin) / (safeDomain.xMax - safeDomain.xMin);
    let ny = (ty - safeDomain.yMin) / (safeDomain.yMax - safeDomain.yMin);
    if (bestAtTopRight && dirX === 'lower') nx = 1 - nx;
    if (bestAtTopRight && dirY === 'lower') ny = 1 - ny;
    const shownX = (nx - activeView.x0) / (activeView.x1 - activeView.x0);
    const shownY = (ny - activeView.y0) / (activeView.y1 - activeView.y0);
    return { index, x: PLOT.left + shownX * (width - PLOT.left - PLOT.right), y: height - PLOT.bottom - shownY * (height - PLOT.top - PLOT.bottom) };
  };

  useEffect(() => {
    const node = hostRef.current; if (!node) return;
    const update = () => { const rect = node.getBoundingClientRect(); if (rect.width) { const maxHeight=window.innerHeight*.7;setSize({ width: rect.width, height: Math.min(maxHeight,Math.max(Math.min(280,maxHeight),rect.width*.72)) }); } };
    update(); const observer = new ResizeObserver(update); observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => setView(INITIAL_VIEW), [result, includeOutliers, logScale, bestAtTopRight]);

  useEffect(() => {
    const canvas = canvasRef.current; const context = canvas?.getContext('2d');
    if (!canvas || !context || !result) return;
    let frame = 0;
    const draw = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio);
      canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      const styles = getComputedStyle(document.documentElement);
      context.fillStyle = styles.getPropertyValue('--surface').trim() || '#131a22'; context.fillRect(0, 0, size.width, size.height);
      const left = PLOT.left; const top = PLOT.top; const width = size.width - PLOT.left - PLOT.right; const height = size.height - PLOT.top - PLOT.bottom;
      const grid = new Map<string, Point[]>(); const groups: Point[][] = [[], [], [], []]; const selectedPoints: Point[] = []; const cell = pointSize.current;
      for (let i = 0; i < result.codes.length; i++) {
        const point = project(i); if (!point) continue;
        const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`; const items = grid.get(key) ?? []; items.push(point); grid.set(key, items);
        if (result.selected[i]) selectedPoints.push(point); else (groups[result.quadrants[i]!] ?? groups[0]!).push(point);
      }
      context.save(); context.beginPath(); context.rect(left, top, width, height); context.clip();
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        context.beginPath(); context.fillStyle = QUADRANT_COLORS[quadrant]!; context.globalAlpha = highlightedQuadrant === null || highlightedQuadrant === quadrant ? .46 : .12;
        for (const point of groups[quadrant]!) {
          context.moveTo(point.x + 3.2, point.y); context.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
        }
        context.fill();
      }
      context.globalAlpha = 1;
      for (const point of selectedPoints) {
        context.beginPath(); context.fillStyle = selectedColors[result.codes[point.index]!] ?? '#6654ee'; context.strokeStyle = styles.getPropertyValue('--surface').trim() || '#131a22'; context.lineWidth = 2;
        context.arc(point.x, point.y, 7, 0, Math.PI * 2); context.fill(); context.stroke();
      }
      context.restore();
      pointGrid.current = grid;
    };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [result, size, view, safeDomain, dirX, dirY, bestAtTopRight, includeOutliers, logScale, highlightedQuadrant, selectedColors]);

  const selectedIndexByCode = useMemo(() => {
    const map = new Map<number, number>(); if (result) for (let i = 0; i < result.codes.length; i++) map.set(result.codes[i]!, i); return map;
  }, [result]);
  const selectedPoints = useMemo(() => Object.keys(selectedColors).flatMap(code => { const index = selectedIndexByCode.get(Number(code)); const point = index === undefined ? null : project(index); return point ? [{ ...point, code: Number(code) }] : []; }), [selectedColors, selectedIndexByCode, size, view, safeDomain, result, dirX, dirY, bestAtTopRight]);

  const eventPoint = (event: ReactPointerEvent<HTMLDivElement>) => { const rect = hostRef.current?.getBoundingClientRect(); return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null; };
  const nearest = (x: number, y: number) => {
    const cell = pointSize.current; const col = Math.floor(x / cell); const row = Math.floor(y / cell); let nearestPoint: Point | null = null; let distance = Infinity;
    const radius = window.matchMedia('(pointer: coarse)').matches ? 22 : 14;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const point of pointGrid.current.get(`${col + dx},${row + dy}`) ?? []) {
      const next = Math.hypot(point.x - x, point.y - y); if (next < distance && next <= radius) { distance = next; nearestPoint = point; }
    }
    return nearestPoint;
  };
  const dataFromPosition = (axis: 'x' | 'y', x: number, y: number) => {
    if (!safeDomain) return null;
    const range = axis === 'x' ? size.width - PLOT.left - PLOT.right : size.height - PLOT.top - PLOT.bottom;
    let normValue = axis === 'x' ? (x - PLOT.left) / range : (size.height - PLOT.bottom - y) / range;
    normValue = Math.max(0, Math.min(1, axis === 'x' ? view.x0 + normValue * (view.x1 - view.x0) : view.y0 + normValue * (view.y1 - view.y0)));
    const reversed = bestAtTopRight && (axis === 'x' ? dirX : dirY) === 'lower'; if (reversed) normValue = 1 - normValue;
    const min = axis === 'x' ? safeDomain.xMin : safeDomain.yMin; const max = axis === 'x' ? safeDomain.xMax : safeDomain.yMax;
    const transformed = min + normValue * (max - min); return (axis === 'x' ? logX : logY) ? 10 ** transformed : transformed;
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pos = eventPoint(event); if (!pos) return; const target = event.target as HTMLElement; if (target.closest('button')) return; const dragAxis = target.dataset.splitAxis === 'x' || target.dataset.splitAxis === 'y' ? target.dataset.splitAxis : null;
    activePointers.current.set(event.pointerId,pos);event.currentTarget.setPointerCapture(event.pointerId);
    if(activePointers.current.size>=2){const points=[...activePointers.current.values()].slice(0,2);const centerX=(points[0]!.x+points[1]!.x)/2;const centerY=(points[0]!.y+points[1]!.y)/2;const distance=Math.max(1,Math.hypot(points[0]!.x-points[1]!.x,points[0]!.y-points[1]!.y));const fractionX=Math.max(0,Math.min(1,(centerX-PLOT.left)/(size.width-PLOT.left-PLOT.right)));const fractionY=Math.max(0,Math.min(1,(size.height-PLOT.bottom-centerY)/(size.height-PLOT.top-PLOT.bottom)));pinchStart.current={distance,view:{...view},centerX:view.x0+fractionX*(view.x1-view.x0),centerY:view.y0+fractionY*(view.y1-view.y0)};pointer.current=null;return;}
    pointer.current = { id: event.pointerId, x: pos.x, y: pos.y, startX: pos.x, startY: pos.y, moved: false, dragAxis };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pos = eventPoint(event); if (!pos) return; if ((event.target as HTMLElement).closest('button')) return;
    if(activePointers.current.has(event.pointerId))activePointers.current.set(event.pointerId,pos);
    if(activePointers.current.size>=2&&pinchStart.current){const points=[...activePointers.current.values()].slice(0,2);const distance=Math.max(1,Math.hypot(points[0]!.x-points[1]!.x,points[0]!.y-points[1]!.y));const base=pinchStart.current;const factor=base.distance/distance;const xSpan=Math.max(.08,Math.min(1,(base.view.x1-base.view.x0)*factor));const ySpan=Math.max(.08,Math.min(1,(base.view.y1-base.view.y0)*factor));const x0=Math.max(0,Math.min(1-xSpan,base.centerX-(base.centerX-base.view.x0)*factor));const y0=Math.max(0,Math.min(1-ySpan,base.centerY-(base.centerY-base.view.y0)*factor));setView({x0,x1:x0+xSpan,y0,y1:y0+ySpan});return;}
    const active = pointer.current;
    if (active?.id === event.pointerId) {
      if (active.dragAxis) { const value = dataFromPosition(active.dragAxis, pos.x, pos.y); if (value !== null) setDraggedThreshold({ axis: active.dragAxis, value }); active.moved = true; return; }
      const dx = pos.x - active.x; const dy = pos.y - active.y;
      if (Math.abs(pos.x - active.startX) + Math.abs(pos.y - active.startY) > 4) active.moved = true;
      if (active.moved) setView(old => {
        const xSpan = old.x1 - old.x0; const ySpan = old.y1 - old.y0;
        const x0 = Math.max(0, Math.min(1 - xSpan, old.x0 - dx / (size.width - PLOT.left - PLOT.right) * xSpan));
        const y0 = Math.max(0, Math.min(1 - ySpan, old.y0 + dy / (size.height - PLOT.top - PLOT.bottom) * ySpan));
        return { x0, x1: x0 + xSpan, y0, y1: y0 + ySpan };
      });
      active.x = pos.x; active.y = pos.y; return;
    }
    const found = nearest(pos.x, pos.y); setHoverIndex(found?.index ?? null);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pointer.current; const pos = eventPoint(event); pointer.current = null;
    activePointers.current.delete(event.pointerId);
    if(pinchStart.current){pinchStart.current=null;const remaining=activePointers.current.entries().next().value as [number,{x:number;y:number}]|undefined;if(remaining)pointer.current={id:remaining[0],x:remaining[1].x,y:remaining[1].y,startX:remaining[1].x,startY:remaining[1].y,moved:true,dragAxis:null};return;}
    if (active?.id !== event.pointerId) return;
    if (active.dragAxis) { if (draggedThreshold?.axis === active.dragAxis) onThresholdChange(active.dragAxis, draggedThreshold.value); setDraggedThreshold(null); return; }
    if (!active.moved && !active.dragAxis && pos) {
      const point = nearest(pos.x, pos.y); if (point && result) {
        const now = performance.now(); if (now - lastTap.current < 320) setView(old => ({ x0: Math.max(0, Math.min(.8, old.x0 + .1)), x1: Math.min(1, old.x1 - .1), y0: Math.max(0, Math.min(.8, old.y0 + .1)), y1: Math.min(1, old.y1 - .1) })); else onInspect(result.codes[point.index]!); lastTap.current = now;
      }
    }
  };
  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault(); const pos = eventPoint(event as unknown as ReactPointerEvent<HTMLDivElement>); if (!pos) return;
    const factor = event.deltaY < 0 ? .82 : 1.22; const xf = Math.max(0, Math.min(1, (pos.x - PLOT.left) / (size.width - PLOT.left - PLOT.right))); const yf = Math.max(0, Math.min(1, (size.height - PLOT.bottom - pos.y) / (size.height - PLOT.top - PLOT.bottom)));
    setView(old => { const xSpan = Math.max(.08, Math.min(1, (old.x1 - old.x0) * factor)); const ySpan = Math.max(.08, Math.min(1, (old.y1 - old.y0) * factor)); const x0 = Math.max(0, Math.min(1 - xSpan, old.x0 + xf * (old.x1 - old.x0 - xSpan))); const y0 = Math.max(0, Math.min(1 - ySpan, old.y0 + yf * (old.y1 - old.y0 - ySpan))); return { x0, x1: x0 + xSpan, y0, y1: y0 + ySpan }; });
  };
  const thresholdPoint = (axis: 'x' | 'y', threshold: number | null) => {
    if (threshold === null || !safeDomain) return null;
    const shownThreshold = draggedThreshold?.axis === axis ? draggedThreshold.value : threshold;
    if((axis==='x'?logX:logY)&&shownThreshold<=0)return null;
    let t = axis === 'x' ? safeDomain.transformX(shownThreshold) : safeDomain.transformY(shownThreshold); const min = axis === 'x' ? safeDomain.xMin : safeDomain.yMin; const max = axis === 'x' ? safeDomain.xMax : safeDomain.yMax;
    t = Math.max(min, Math.min(max, t)); let n = (t - min) / (max - min); if (bestAtTopRight && (axis === 'x' ? dirX : dirY) === 'lower') n = 1 - n;
    const range = axis === 'x' ? view.x1 - view.x0 : view.y1 - view.y0; const offset = axis === 'x' ? view.x0 : view.y0; const visible = (n - offset) / range;
    return axis === 'x' ? PLOT.left + visible * (size.width - PLOT.left - PLOT.right) : size.height - PLOT.bottom - visible * (size.height - PLOT.top - PLOT.bottom);
  };
  const tickValue = (axis: 'x' | 'y', fraction: number) => {
    if (!safeDomain) return '';
    const activeView = axis === 'x' ? view.x0 + fraction * (view.x1 - view.x0) : view.y0 + fraction * (view.y1 - view.y0);
    const reversed = bestAtTopRight && (axis === 'x' ? dirX : dirY) === 'lower'; const valueFraction = reversed ? 1 - activeView : activeView;
    const min = axis === 'x' ? safeDomain.xMin : safeDomain.yMin; const max = axis === 'x' ? safeDomain.xMax : safeDomain.yMax;
    const transformed = min + valueFraction * (max - min); return valueLabel((axis === 'x' ? logX : logY) ? 10 ** transformed : transformed, axis === 'x' ? xMetric.unit : yMetric.unit);
  };
  const inspectIndex = inspectCode === null ? null : selectedIndexByCode.get(inspectCode) ?? null;
  const activeIndex = hoverIndex ?? inspectIndex;
  const activePoint = activeIndex === null || !result ? null : project(activeIndex);
  const tooltipLeft = activePoint && activePoint.x < size.width / 2 ? 'calc(100% - min(320px, 72%) - 4px)' : '4px';
  const tooltipTop = activePoint && activePoint.y < size.height / 2 ? '52%' : '8px';
  const xThreshold = thresholdPoint('x', result?.thresholds.x ?? null); const yThreshold = thresholdPoint('y', result?.thresholds.y ?? null);
  const selectedLabel = quadrantName(0, xMetric.label, yMetric.label, dirX, dirY);
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!result?.codes.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1; const next = Math.max(0, Math.min(result.codes.length - 1, keyboardIndex + step)); setKeyboardIndex(next); setHoverIndex(next); }
    if (event.key === 'Enter') { event.preventDefault(); onInspect(result.codes[keyboardIndex]!); }
  };

  if (!result?.codes.length || !safeDomain) return <div className="scatter-canvas-empty" role="status">{!result ? 'Preparing scatter data…' : 'No funds have both selected metrics in this scope.'}</div>;
  return <div ref={hostRef} className="scatter-canvas-wrap" style={{ height: size.height }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { pointer.current = null; activePointers.current.clear(); pinchStart.current=null; setDraggedThreshold(null); }} onWheel={wheel}>
    <canvas ref={canvasRef} className="scatter-canvas-points" aria-hidden="true"/>
    <svg className="scatter-canvas-overlay" viewBox={`0 0 ${size.width} ${size.height}`} role="application" tabIndex={0} aria-label={`Scatter plot of ${xMetric.label} and ${yMetric.label}. Use arrow keys to focus plotted funds and Enter to inspect.`} onKeyDown={onKeyDown}>
      <path d={`M${PLOT.left} ${PLOT.top}V${size.height - PLOT.bottom}H${size.width - PLOT.right}`} className="chart-axis"/>
      {[0, .5, 1].map(t => { const y = PLOT.top + t * (size.height - PLOT.top - PLOT.bottom); return <g key={`h${t}`}><line x1={PLOT.left} x2={size.width - PLOT.right} y1={y} y2={y} className="chart-grid"/><text className="scatter-axis-tick" x={PLOT.left-7} y={y+3} textAnchor="end">{tickValue('y',1-t)}</text></g>; })}
      {[0, .5, 1].map(t => { const x = PLOT.left + t * (size.width - PLOT.left - PLOT.right); return <g key={`v${t}`}><line x1={x} x2={x} y1={PLOT.top} y2={size.height - PLOT.bottom} className="chart-grid"/><text className="scatter-axis-tick" x={x} y={size.height-PLOT.bottom+14} textAnchor="middle">{tickValue('x',t)}</text></g>; })}
      {xThreshold !== null && <g className="scatter-split-line"><line x1={xThreshold} x2={xThreshold} y1={PLOT.top} y2={size.height - PLOT.bottom} data-split-axis="x"/><text x={xThreshold + 5} y={PLOT.top + 14}>{result.thresholds.rule === 'median' ? 'Median' : result.thresholds.rule === 'mean' ? 'Mean' : result.thresholds.rule === 'peer-median' ? 'Peer median' : 'Custom'} {valueLabel(draggedThreshold?.axis==='x'?draggedThreshold.value:result.thresholds.x!, xMetric.unit)}</text><line className="scatter-split-hit" x1={xThreshold} x2={xThreshold} y1={PLOT.top} y2={size.height - PLOT.bottom} data-split-axis="x"/></g>}
      {yThreshold !== null && <g className="scatter-split-line"><line x1={PLOT.left} x2={size.width - PLOT.right} y1={yThreshold} y2={yThreshold} data-split-axis="y"/><text x={PLOT.left + 5} y={yThreshold - 6}>{result.thresholds.rule === 'median' ? 'Median' : result.thresholds.rule === 'mean' ? 'Mean' : result.thresholds.rule === 'peer-median' ? 'Peer median' : 'Custom'} {valueLabel(draggedThreshold?.axis==='y'?draggedThreshold.value:result.thresholds.y!, yMetric.unit)}</text><line className="scatter-split-hit" x1={PLOT.left} x2={size.width - PLOT.right} y1={yThreshold} y2={yThreshold} data-split-axis="y"/></g>}
      {result.thresholds.x !== null && result.thresholds.y !== null && [0, 1, 2, 3].map(id => { const name = quadrantName(id as QuadrantId, xMetric.label, yMetric.label, dirX, dirY); const reverseX=bestAtTopRight&&dirX==='lower';const reverseY=bestAtTopRight&&dirY==='lower';const right=((id&1)!==0)!==reverseX;const top=((id&2)!==0)!==reverseY;const x = right ? size.width - PLOT.right - 8 : PLOT.left + 8; const y = top ? PLOT.top + 22 : size.height - PLOT.bottom - 9; return <g key={id} className={`scatter-quadrant-label ${name.kind}`}><rect x={right ? x - 180 : x - 5} y={y - 17} width="182" height="23" rx="5"/><text x={x} y={y} textAnchor={right ? 'end' : 'start'}>{name.label}</text></g>; })}
      {selectedPoints.map(point => <g className="scatter-selected-point" key={point.code}><circle cx={point.x} cy={point.y} r="8" fill={selectedColors[point.code]}/><circle cx={point.x} cy={point.y} r="10" fill="none" stroke="var(--surface)" strokeWidth="2"/><text x={point.x + 11} y={point.y - 10}>{(result.names[selectedIndexByCode.get(point.code)!] ?? '').slice(0, 24)}</text></g>)}
      {activePoint && <circle className="scatter-focus-ring" cx={activePoint.x} cy={activePoint.y} r="13"/>}
      <text x={(PLOT.left + size.width - PLOT.right) / 2} y={size.height - 8} textAnchor="middle" className="axis-label">{xMetric.label}{bestAtTopRight && dirX === 'lower' ? ' · ↺ reversed' : ''} ({xMetric.unit})</text>
      <text transform={`translate(14 ${(PLOT.top + size.height - PLOT.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{yMetric.label}{bestAtTopRight && dirY === 'lower' ? ' · ↺ reversed' : ''} ({yMetric.unit})</text>
    </svg>
    {activeIndex !== null && result && activePoint && <div className="scatter-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}><b>{result.names[activeIndex]}</b><span>{result.amcs[activeIndex]}</span><span>{xMetric.label}: {valueLabel(result.x[activeIndex]!, xMetric.unit)} · {dirX==='none'?`${result.rankX[activeIndex]!.toFixed(0)}th percentile`:`top ${result.rankX[activeIndex]!.toFixed(1)}%`}</span><span>{yMetric.label}: {valueLabel(result.y[activeIndex]!, yMetric.unit)} · {dirY==='none'?`${result.rankY[activeIndex]!.toFixed(0)}th percentile`:`top ${result.rankY[activeIndex]!.toFixed(1)}%`}</span><span>{result.thresholds.x !== null && result.thresholds.y !== null ? quadrantName(result.quadrants[activeIndex]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'Enter split values to assign a quadrant.'}</span></div>}
    <div className="scatter-axis-help">Drag to pan · scroll to zoom · drag a split line to set a custom threshold · ties fall on the better side{dirX === 'none' || dirY === 'none' ? ' (or the higher side when there is no preference)' : ''}.</div>
    <button className="scatter-reset-view" type="button" onPointerDown={event=>event.stopPropagation()} onClick={() => setView(INITIAL_VIEW)}>Reset view</button>
    <span className="sr-only" aria-live="polite">{hoverIndex !== null && result ? `${result.names[hoverIndex]}: ${valueLabel(result.x[hoverIndex]!, xMetric.unit)} on ${xMetric.label}, ${valueLabel(result.y[hoverIndex]!, yMetric.unit)} on ${yMetric.label}` : selectedLabel.label}</span>
  </div>;
}
