import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { MetricDefinition } from '../../domain/types';
import type { QuadrantId } from '../../domain/scatter/quadrants';
import { quadrantName } from '../../domain/scatter/quadrants';
import type { ScatterQueryResult } from '../../domain/scatter/scatterQuery';
import type { ScatterSort } from './types';

type SortBy = 'name' | 'x' | 'y' | 'quadrant' | 'rankX' | 'rankY';
function formatted(value: number, unit: MetricDefinition['unit']) {
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
  return unit === '%' ? `${text}%` : unit === 'years' ? `${text} yr` : unit === '₹ Cr' ? `₹${text} Cr` : unit === 'ratio' ? `${text}x` : text;
}

export function ScatterTable({ result, xMetric, yMetric, dirX, dirY, sort, onSort, onInspect }: {
  result: ScatterQueryResult; xMetric: MetricDefinition; yMetric: MetricDefinition; dirX: 'higher'|'lower'|'none'; dirY: 'higher'|'lower'|'none';
  sort: ScatterSort; onSort: (sort: { by: SortBy; desc: boolean }) => void; onInspect: (code: number) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0); const rowHeight = 46; const height = 360;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4); const end = Math.min(result.codes.length, start + Math.ceil(height / rowHeight) + 8);
  const sortedIndices = useMemo(() => Array.from({ length: result.codes.length }, (_, index) => index).sort((left, right) => {
    const compare = sort.by === 'name' ? result.names[left]!.localeCompare(result.names[right]!)
      : sort.by === 'x' ? result.x[left]! - result.x[right]!
        : sort.by === 'y' ? result.y[left]! - result.y[right]!
          : sort.by === 'rankX' ? result.rankX[left]! - result.rankX[right]!
            : sort.by === 'rankY' ? result.rankY[left]! - result.rankY[right]!
              : result.quadrants[left]! - result.quadrants[right]!;
    return (sort.desc ? -compare : compare) || result.names[left]!.localeCompare(result.names[right]!);
  }), [result, sort.by, sort.desc]);
  const rows = useMemo(() => sortedIndices.slice(start, end), [sortedIndices, start, end]);
  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const heading = ['Fund', 'AMC', xMetric.label, yMetric.label, 'Quadrant', `Rank ${xMetric.label}`, `Rank ${yMetric.label}`, 'Sub-category'];
    const contents = [heading, ...Array.from({ length: result.codes.length }, (_, index) => [result.names[index] ?? '', result.amcs[index] ?? '', result.x[index]!, result.y[index]!, result.thresholds.x !== null && result.thresholds.y !== null ? quadrantName(result.quadrants[index]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'Not split', `#${result.rankX[index]} of ${result.codes.length}`, `#${result.rankY[index]} of ${result.codes.length}`, result.categories[index] ?? ''])]
      .map(row => row.map(escape).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`For personal research. Not investment advice.\n${contents}`], { type: 'text/csv;charset=utf-8' })); link.download = 'fundscope-scatter.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  const header = (label: string, by: SortBy) => <th aria-sort={sort.by===by?(sort.desc?'descending':'ascending'):'none'}><button type="button" onClick={() => onSort({ by, desc: false })}>{label}{sort.by===by?(sort.desc?' ↓':' ↑'):''}</button></th>;
  return <section className="scatter-table-section" aria-label="Scatter plot data table">
    <div className="scatter-table-toolbar"><span>{result.codes.length.toLocaleString('en-IN')} plotted funds · compared funds first</span><button type="button" className="button secondary" onClick={exportCsv}><Download size={15}/> Export CSV</button></div>
    <div className="scatter-table-scroll" style={{ height }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <table className="scatter-data-table"><thead><tr>{header('Fund', 'name')}{header('X value', 'x')}{header('Y value', 'y')}{header('Quadrant', 'quadrant')}{header(`Rank · ${xMetric.label}`, 'rankX')}{header(`Rank · ${yMetric.label}`, 'rankY')}</tr></thead>
      <tbody><tr className="scatter-table-spacer"><td colSpan={6} style={{ height: start * rowHeight }}/></tr>
        {rows.map(index => <tr key={result.codes[index]} className={result.selected[index] ? 'selected' : ''}>
          <td><button type="button" className="scatter-table-fund" onClick={() => onInspect(result.codes[index]!)}><b>{result.names[index]}</b><small>{result.amcs[index]} · {result.categories[index]}</small></button></td>
          <td>{formatted(result.x[index]!, xMetric.unit)}</td><td>{formatted(result.y[index]!, yMetric.unit)}</td>
          <td>{result.thresholds.x !== null && result.thresholds.y !== null ? quadrantName(result.quadrants[index]! as QuadrantId, xMetric.label, yMetric.label, dirX, dirY).label : 'Not split'}</td>
          <td>#{result.rankX[index]} of {result.codes.length}{dirX === 'none' ? ' · natural order' : ` · top ${result.percentileX[index]!.toFixed(1)}%`}</td>
          <td>#{result.rankY[index]} of {result.codes.length}{dirY === 'none' ? ' · natural order' : ` · top ${result.percentileY[index]!.toFixed(1)}%`}</td>
        </tr>)}
        <tr className="scatter-table-spacer"><td colSpan={6} style={{ height: Math.max(0, result.codes.length - end) * rowHeight }}/></tr>
      </tbody></table>
    </div>
  </section>;
}
