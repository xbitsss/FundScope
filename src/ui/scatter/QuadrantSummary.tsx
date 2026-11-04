import { AlertTriangle, ArrowDownRight, ArrowUpRight, Star } from 'lucide-react';
import { quadrantName, type MetricDirection, type QuadrantId } from '../../domain/scatter/quadrants';

export type InspectedRank = { code: number; name: string; quadrant: QuadrantId; rankX: number; rankY: number };

export function QuadrantSummary({ counts, plottedCount, xLabel, yLabel, dirX, dirY, selected, highlighted, onHighlight, onFilter, onOpen, onAddCompare }: {
  counts: number[]; plottedCount: number; xLabel: string; yLabel: string; dirX: MetricDirection; dirY: MetricDirection;
  selected: InspectedRank[]; highlighted: QuadrantId | null; onHighlight: (id: QuadrantId | null) => void; onFilter: (id: QuadrantId) => void;
  onOpen: (code: number) => void; onAddCompare: (code: number) => void;
}) {
  const ids: QuadrantId[]=[0,1,2,3];
  const selectedBest = selected.length ? selected.map(item=>({ ...item, title:quadrantName(item.quadrant,xLabel,yLabel,dirX,dirY) })) : [];
  return <section className="quadrant-summary" aria-label="Quadrant summary">
    <div className="quadrant-card-grid">{ids.map(id=>{const info=quadrantName(id,xLabel,yLabel,dirX,dirY);const Icon=info.kind==='best'?Star:info.kind==='avoid'?AlertTriangle:info.kind==='tradeoff'?ArrowUpRight:ArrowDownRight;const count=counts[id]??0;const share=plottedCount?count/plottedCount*100:0;return <article className={`quadrant-card ${info.kind}${highlighted===id?' highlighted':''}`} key={id}>
      <button type="button" className="quadrant-card-select" onClick={()=>onHighlight(highlighted===id?null:id)} aria-pressed={highlighted===id} aria-label={`${info.label}: ${count} funds, ${share.toFixed(1)} percent`}><span className="quadrant-card-title"><Icon size={15}/><b>{info.label}</b></span><span className="quadrant-card-count">{count.toLocaleString('en-IN')} · {share.toFixed(1)}%</span></button>
      {count>0&&<button type="button" className="quadrant-filter-action" onClick={()=>onFilter(id)}>Filter screener to this quadrant</button>}
    </article>;})}</div>
    {(dirX==='none'||dirY==='none')&&<p className="quadrant-direction-note">Choose a direction for {dirX==='none'?xLabel:yLabel} to mark Best and Avoid quadrants. Until then, all quadrants are neutral.</p>}
    {selectedBest.length>0&&<div className="selected-quadrant-list"><h3>Compared funds by quadrant</h3>{selectedBest.map(item=>{const rankX=dirX==='none'?`${item.rankX.toFixed(0)}th percentile`:`Top ${item.rankX.toFixed(1)}%`;const rankY=dirY==='none'?`${item.rankY.toFixed(0)}th percentile`:`Top ${item.rankY.toFixed(1)}%`;return <div className="selected-quadrant-row" key={item.code}><span>{item.name} — {item.title.label}</span><small>{rankX} on {xLabel} · {rankY} on {yLabel}</small><span className="selected-quadrant-actions"><button type="button" onClick={()=>onAddCompare(item.code)}>Remove from compare</button><button type="button" onClick={()=>onOpen(item.code)}>Open details</button></span></div>;})}</div>}
  </section>;
}
