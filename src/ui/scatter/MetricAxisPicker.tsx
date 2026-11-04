import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { MetricDefinition } from '../../domain/types';
import { normalizeFilterText } from '../../domain/search/normalize';
import type { MetricDirection } from '../../domain/scatter/quadrants';

export function MetricAxisPicker({ axis, metricId, metrics, coverage, direction, onMetricChange, onDirectionChange }: {
  axis: 'X' | 'Y'; metricId: string; metrics: MetricDefinition[]; coverage: Record<string, number>; direction: MetricDirection;
  onMetricChange: (id: string) => void; onDirectionChange: (direction: MetricDirection) => void;
}) {
  const [open, setOpen] = useState(false); const [search, setSearch] = useState('');
  const triggerRef=useRef<HTMLButtonElement>(null);const [menuPosition,setMenuPosition]=useState({left:16,top:80});
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const media=window.matchMedia('(max-width: 767px)');const update=()=>setMobile(media.matches);media.addEventListener?.('change',update);return()=>media.removeEventListener?.('change',update); }, []);
  useEffect(() => { if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key); }, [open]);
  useEffect(()=>{if(!open||mobile)return;const rect=triggerRef.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(480,window.innerWidth-32);const height=Math.min(window.innerHeight*.62,560);setMenuPosition({left:Math.max(16,Math.min(rect.left,window.innerWidth-width-16)),top:Math.max(12,Math.min(rect.bottom+5,window.innerHeight-height-12))});},[open,mobile,metricId]);
  const chosen=metrics.find(metric=>metric.id===metricId);
  const groups=useMemo(()=>{const q=normalizeFilterText(search);const rows=metrics.filter(metric=>normalizeFilterText(`${metric.label} ${metric.group}`).includes(q));return [...new Set(rows.map(metric=>metric.group))].sort().map(group=>({group,items:rows.filter(metric=>metric.group===group)}));},[metrics,search]);
  return <div className="axis-picker">
    <span className="axis-picker-label">{axis} axis</span>
    <button ref={triggerRef} type="button" className="axis-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span>{chosen?.label??'Choose metric'} <small>{chosen?`(${chosen.unit})`:''}</small></span><ChevronDown size={15}/>
    </button>
    <label className="axis-direction"><span>Direction</span><select aria-label={`${axis} axis direction`} value={direction} onChange={event=>onDirectionChange(event.target.value as MetricDirection)}><option value="higher">↑ Higher is better</option><option value="lower">↓ Lower is better</option><option value="none">No preference</option></select></label>
    {open&&<><button type="button" className={`axis-picker-backdrop${mobile?' mobile':''}`} aria-label="Close metric list" onClick={()=>setOpen(false)}/><div style={mobile?undefined:{left:menuPosition.left,top:menuPosition.top,position:'fixed'}} className={`axis-picker-menu${mobile?' mobile':''}`} role="listbox" aria-label={`Choose ${axis} axis metric`}><div className="axis-picker-search"><Search size={15}/><input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search metrics…" aria-label="Search metrics"/><button type="button" aria-label="Close metric list" onClick={()=>setOpen(false)}><X size={15}/></button></div>{groups.length?groups.map(({group,items})=><section key={group}><h4>{group}</h4>{items.map(metric=>{const count=coverage[metric.id]??0;const disabled=count<5&&metric.id!==metricId;const directionGlyph=metric.direction==='higher'?'↑':metric.direction==='lower'?'↓':'↔';return <button type="button" role="option" aria-selected={metric.id===metricId} disabled={disabled} key={metric.id} onClick={()=>{onMetricChange(metric.id);setOpen(false);setSearch('');}}><span><b>{metric.label}</b><small>{metric.unit} · {directionGlyph} {metric.direction==='neutral'?'No default direction':`${metric.direction} is better`}</small></span><span className="axis-coverage">{count.toLocaleString('en-IN')} funds{disabled?' · need 5':''}</span></button>;})}</section>):<p className="picker-empty">No matching metrics.</p>}</div></>}
  </div>;
}
