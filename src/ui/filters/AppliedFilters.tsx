import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fitWrappedChipCount, formatFacetChip } from '../../domain/screener/appliedFilters';

export type AppliedFilterValue = { key: string; label: string };
export type AppliedFilter = { id: string; label: string; values: AppliedFilterValue[]; rangeText?: string };

export function FilterChip({ label, fullLabel, onOpen, onRemove, chipIndex }: { label: string; fullLabel?: string; onOpen?: () => void; onRemove: () => void; chipIndex?: number }) {
  const text = fullLabel ?? label;
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onRemove(); }
  };
  return <span className="filter-chip" title={text}>
    <button type="button" className="filter-chip-main" aria-label={text} aria-disabled={!onOpen || undefined} title={text} onClick={onOpen} onKeyDown={handleKeyDown} data-filter-chip={chipIndex}>
      <span>{label}</span>
    </button>
    <button type="button" className="filter-chip-remove" aria-label={`Remove ${text}`} title={`Remove ${text}`} onClick={onRemove}><X size={12}/></button>
  </span>;
}

export function AppliedFilters({ filters, onRemoveValue, onClearFilter, onClearAll, placement = 'summary', resultCount = 0, resultUpdating = false }: {
  filters: AppliedFilter[];
  onRemoveValue: (filterId: string, valueKey: string) => void;
  onClearFilter: (filterId: string) => void;
  onClearAll: () => void;
  placement?: 'summary' | 'sheet';
  resultCount?: number;
  resultUpdating?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(filters.length);
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [announcement, setAnnouncement] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const signature = useMemo(() => filters.map(filter => `${filter.id}:${filter.label}:${filter.rangeText ?? ''}:${filter.values.map(value => `${value.key}=${value.label}`).join(',')}`).join('|'), [filters]);
  const maxRows = mobile ? 2 : 3;
  const previousFilters = useRef(filters.map(filter => ({ id: filter.id, label: filter.label, rangeText: filter.rangeText, values: filter.values.map(value => ({ ...value })) })));
  const suppressDiffAnnouncement = useRef(false);
  const pendingAnnouncement = useRef<string | null>(null);const sawUpdate = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const previous = new Map(previousFilters.current.map(filter => [filter.id, filter]));
    const current = new Map(filters.map(filter => [filter.id, filter]));
    let change = '';
    for (const filter of filters) {
      const old = previous.get(filter.id);
      if (!old) { change = `Added ${filter.label}`; break; }
      const oldValues = new Set(old.values.map(value => value.key));
      const addedValue = filter.values.find(value => !oldValues.has(value.key));
      if (addedValue) { change = `Added ${filter.label}: ${addedValue.label}`; break; }
      const removedValue = old.values.find(value => !filter.values.some(next => next.key === value.key));
      if (removedValue) { change = `Removed ${filter.label}: ${removedValue.label}`; break; }
      if (old.rangeText !== filter.rangeText) { change = `Updated ${filter.label}`; break; }
    }
    if (!change) { const removed = previousFilters.current.find(filter => !current.has(filter.id)); if (removed) change = `Removed ${removed.label}`; }
    if (change && !suppressDiffAnnouncement.current) { pendingAnnouncement.current=change;sawUpdate.current=resultUpdating; }
    suppressDiffAnnouncement.current = false;
    previousFilters.current = filters.map(filter => ({ id: filter.id, label: filter.label, rangeText: filter.rangeText, values: filter.values.map(value => ({ ...value })) }));
  }, [signature]);

  useEffect(()=>{
    if(!pendingAnnouncement.current)return;
    if(resultUpdating){sawUpdate.current=true;return;}
    if(sawUpdate.current){setAnnouncement(`${pendingAnnouncement.current}. ${resultCount.toLocaleString('en-IN')} funds currently shown.`);pendingAnnouncement.current=null;sawUpdate.current=false;}
  },[resultUpdating,resultCount]);

  useLayoutEffect(() => {
    const container = rootRef.current?.querySelector<HTMLElement>('.applied-filter-chips');
    if (!container) return;
    const measure = () => {
      if (expanded) { setVisibleCount(filters.length); return; }
      const width = container.clientWidth;
      const measureHost = measureRef.current;
      const widths = Array.from(measureHost?.querySelectorAll<HTMLElement>('[data-measure-chip]') ?? []).map(item => item.getBoundingClientRect().width);
      const moreWidth = moreRef.current?.getBoundingClientRect().width ?? 78;
      const trailingWidth = container.querySelector<HTMLElement>('.applied-filter-clear-all')?.getBoundingClientRect().width ?? 0;
      setVisibleCount(fitWrappedChipCount(width, widths, maxRows, moreWidth, 8, trailingWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [signature, expanded, maxRows, filters.length]);

  useEffect(() => {
    if (!openId) return;
    const focusables = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusables()[0]?.focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpenId(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setOpenId(null); triggerRef.current?.focus(); }
      if (event.key === 'Tab' && mobile) {
        const items = focusables();
        if (!items.length) return;
        const first = items[0]!; const last = items.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', escape); };
  }, [openId, mobile]);

  const openFilter = filters.find(filter => filter.id === openId) ?? null;
  const countLabel = (filter: AppliedFilter) => filter.rangeText ?? formatFacetChip(filter.label, filter.values.map(value => value.label));
  const removeValue = (filter: AppliedFilter, value: AppliedFilterValue) => { onRemoveValue(filter.id, value.key); };
  const removeChip = (filter: AppliedFilter) => {
    onClearFilter(filter.id);
    setOpenId(null);
  };
  const visibleFilters = expanded ? filters : filters.slice(0, visibleCount);
  const hiddenCount = Math.max(0, filters.length - visibleFilters.length);
  const chipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('[data-filter-chip]')) return;
    const chips = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-filter-chip]') ?? [])];
    const index = chips.indexOf(target as HTMLButtonElement);
    const next = chips[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); }
  };
  const moreLabel = `+${hiddenCount || filters.length} more`;
  const menu = openFilter ? <div className={`applied-filter-menu${mobile ? ' mobile' : ''}`} role="dialog" aria-modal={mobile || undefined} aria-label={`${openFilter.label} filter values`} ref={menuRef}>
    <div className="applied-filter-menu-head"><b>{openFilter.label}</b><button type="button" className="filter-chip-remove" aria-label="Close filter details" onClick={() => setOpenId(null)}><X size={15}/></button></div>
    {openFilter.rangeText ? <div className="applied-filter-value"><span>{openFilter.rangeText.replace(`${openFilter.label}: `, '')}</span></div> : <div className="applied-filter-value-list">{openFilter.values.map(value => <div className="applied-filter-value" key={value.key}><span title={value.label}>{value.label}</span><button type="button" className="filter-chip-remove" aria-label={`Remove ${openFilter.label}: ${value.label}`} onClick={() => removeValue(openFilter, value)}><X size={13}/></button></div>)}</div>}
    <button type="button" className="applied-filter-clear-one" onClick={() => removeChip(openFilter)}>Clear this filter</button>
  </div> : null;

  return <div className={`applied-filters applied-filters-${placement}${filters.length ? '' : ' applied-filters-empty'}`} ref={rootRef} onKeyDown={chipKeyDown}>
    <div className="applied-filter-chips" aria-label="Applied filters">
      {visibleFilters.map((filter, index) => <span className="applied-filter-wrap" key={filter.id}>
        <FilterChip label={countLabel(filter)} fullLabel={countLabel(filter)} chipIndex={index} onOpen={() => { setOpenId(current => current === filter.id ? null : filter.id); triggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null; }} onRemove={() => removeChip(filter)}/>
      </span>)}
      {hiddenCount > 0 && !expanded && <button type="button" className="applied-filter-more" onClick={() => setExpanded(true)} aria-label={`Show ${hiddenCount} more applied filters`}>{moreLabel}</button>}
      {expanded && filters.length > (mobile ? 2 : 3) && <button type="button" className="applied-filter-more" onClick={() => setExpanded(false)}>Show less</button>}
      {filters.length >= 2 && placement === 'summary' && <div className="applied-filter-actions"><button type="button" className="applied-filter-clear-all" onClick={() => { suppressDiffAnnouncement.current = true; onClearAll(); setOpenId(null); setAnnouncement(`All filters cleared. Undo is available for five seconds.`); }}>Clear all</button></div>}
      {!expanded && <div className="applied-filter-measure" ref={measureRef} aria-hidden="true">{filters.map(filter => <span className="filter-chip" data-measure-chip key={filter.id}><span>{countLabel(filter)}</span><span><X size={12}/></span></span>)}</div>}
      {!expanded && <span className="applied-filter-more-measure" ref={moreRef} aria-hidden="true">+{filters.length} more</span>}
    </div>
    {hiddenCount > 0 && expanded && <div className="applied-filter-expanded-note">All {filters.length} applied filters are shown. Remove any chip or use “Show less”.</div>}
    <div className="sr-only" aria-live={placement==='summary'?'polite':'off'} aria-atomic="true">{announcement}</div>
    {openFilter && mobile && createPortal(<><button type="button" className="applied-filter-scrim" aria-label="Close filter details" onClick={() => setOpenId(null)}/>{menu}</>, document.body)}
    {openFilter && !mobile && menu}
  </div>;
}
