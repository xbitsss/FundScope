import type { Fund } from '../domain/types';
import { arrayFacets, fixedValues, ordered, type ArrayFacet, type FacetOption, type ScreenerFilters, type ScreenerFacet } from '../domain/screener/filters';
import { normalizeFilterText } from '../domain/search/normalize';
import { rankFunds, SCORE_METRIC_ID, SCORE_MODEL_HASH_METRIC_ID, scoreFactorsSignature, type ScoreFactor } from '../domain/scoring/engine';
import { computeScatterQuery, type ScatterQueryOptions, type ScatterQueryResult } from '../domain/scatter/scatterQuery';

export interface EngineSort { id: string; desc: boolean }
export interface EngineFacetCounts { values: string[]; counts: Uint32Array }
export interface EngineCategoryTree { assetClass: string; groups: { label: string; items: string[] }[] }
export interface EngineQueryResult {
  total: number;
  indices: Uint32Array;
  facets: Record<ArrayFacet, EngineFacetCounts>;
  funnel: { step: string; remaining: number }[];
  scores?: Float32Array;
}

type MetricColumn = { values: Float64Array; reasons: Uint8Array };
type FacetColumn = { values: string[]; ids: Uint16Array; masks: Map<string, Uint32Array> };
const norm = normalizeFilterText;
function rawFacetValues(fund: Fund, facet: ArrayFacet): string | readonly string[] {
  switch (facet) {
    case 'management': return fund.management || 'Not specified';
    case 'structure': return ['open', 'close', 'interval', 'unknown'].includes(fund.structure) ? fund.structure : 'Unknown';
    case 'plan': return fund.plan === 'Direct' || fund.plan === 'Regular' ? fund.plan : 'Unknown';
    case 'option': return /growth/i.test(fund.option ?? '') && !/bonus/i.test(fund.option ?? '') ? 'Growth' : /idcw|dividend|payout|reinvest/i.test(fund.option ?? '') ? 'IDCW' : 'Unknown';
    case 'categories': return fund.subCategory || 'Not specified';
    case 'amcs': return fund.amc || 'Unknown';
    case 'assetClasses': return fund.assetClass || 'other';
    case 'statuses': return fund.classStatus || 'Unknown';
    case 'riskBands': return fund.riskBand || 'Not specified';
    case 'philosophies': return fund.philosophy || 'Blend/Unspecified';
    case 'specialities': return fund.speciality?.length ? fund.speciality : ['None'];
    case 'groups': return fund.group || 'Unclassified';
    case 'lifecycle': return fund.lifecycle || 'active';
  }
}
const missingReasonCode: Record<string, number> = { INSUFFICIENT_HISTORY: 1, DATA_GAPS: 2, SOURCE_MISSING: 3, NO_BENCHMARK: 4, NOT_APPLICABLE: 5 };
const wordsFor = (length: number) => Math.ceil(length / 32);
const popcount32 = (input: number) => {
  let value = input >>> 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
function countBits(mask: Uint32Array): number { let count = 0; for (const word of mask) count += popcount32(word); return count; }
function cloneMask(mask: Uint32Array): Uint32Array { return mask.slice(); }
function intersectInto(target: Uint32Array, other: Uint32Array): void { for (let i = 0; i < target.length; i++) target[i] = target[i]! & other[i]!; }
function setBit(mask: Uint32Array, index: number): void { mask[index >>> 5] = mask[index >>> 5]! | (1 << (index & 31)); }
function readBit(mask: Uint32Array, index: number): boolean { return (mask[index >>> 5]! & (1 << (index & 31))) !== 0; }

/** Columnar, bitset-backed screener. The reference implementation remains in domain/screener/filters.ts. */
export class ScreenerEngine {
  readonly size: number;
  readonly categoryTree: EngineCategoryTree[];
  private readonly funds: Fund[];
  private readonly universe: Uint32Array;
  private readonly columns = new Map<ArrayFacet, FacetColumn>();
  private readonly metricColumns = new Map<string, MetricColumn>();
  private readonly searchText: string[];
  private readonly names: string[];
  private readonly subCategories: string[];
  private readonly navs: Float64Array;
  private readonly navDates: Float64Array;
  private readonly sortCache = new Map<string, Uint32Array>();
  private readonly scoreCache = new Map<number, Float32Array>();

  constructor(funds: Fund[], onProfile?: (phase: string, milliseconds: number) => void) {
    this.funds = funds;
    const clock = () => globalThis.performance?.now() ?? 0;
    let phaseStart = clock();
    const recordPhase = (name: string) => { if (onProfile) { const now = clock(); onProfile(name, now - phaseStart); phaseStart = now; } };
    this.size = funds.length;
    const words = wordsFor(this.size);
    this.universe = new Uint32Array(words).fill(0xffffffff);
    if (words && this.size % 32) this.universe[words - 1] = (2 ** (this.size % 32) - 1) >>> 0;
    this.searchText = new Array(this.size);
    this.names = new Array(this.size);
    this.subCategories = new Array(this.size);
    this.navs = new Float64Array(this.size);
    this.navDates = new Float64Array(this.size);
    const categoryTree = new Map<string, Map<string, Set<string>>>();
    const metricIds = new Set<string>();
    for (const fund of funds) for (const id of Object.keys(fund.metrics ?? {})) metricIds.add(id);
    for (const id of metricIds) this.metricColumns.set(id, { values: new Float64Array(this.size).fill(Number.NaN), reasons: new Uint8Array(this.size) });
    const facetDictionaries = new Map<ArrayFacet, Map<string, { label: string; mask: Uint32Array; id: number }>>(arrayFacets.map(facet => [facet, new Map()]));
    const facetIds = new Map<ArrayFacet, Uint16Array>(arrayFacets.map(facet => [facet, new Uint16Array(this.size)]));
    recordPhase('allocation');

    for (let index = 0; index < this.size; index++) {
      const fund = funds[index]!;
      this.names[index] = norm(fund.name);
      this.subCategories[index] = norm(fund.subCategory);
      this.navs[index] = Number.isFinite(fund.nav) ? fund.nav : Number.NaN;
      this.navDates[index] = Number.isFinite(fund.navDate) ? fund.navDate : Number.NaN;
      const searchFields = [fund.name, fund.amc, fund.subCategory, fund.group, fund.category, fund.option, fund.plan, fund.assetClass, fund.management, ...(fund.speciality ?? [])].filter(Boolean);
      this.searchText[index] = norm(searchFields.join('\u0000'));
      // The reference getter returns one value per scalar facet. Avoid allocating
      // a temporary Set for every fund × facet; specialities are de-duplicated
      // while assigning their typed ids below.
      for (const facet of arrayFacets) {
        const raw = rawFacetValues(fund, facet);
        const labels = typeof raw === 'string' ? [raw] : raw;
        const dictionary = facetDictionaries.get(facet)!;
        let first = true;
        for (const item of labels) {
          const label = String(item || 'Unknown').trim() || 'Unknown';
          const key = norm(label); if (!key) continue;
          let entry = dictionary.get(key);
          if (!entry) { entry = { label, mask: new Uint32Array(words), id: dictionary.size }; dictionary.set(key, entry); }
          if (first) { facetIds.get(facet)![index] = entry.id; first = false; }
          setBit(entry.mask, index);
        }
      }
      const category = String(fund.subCategory || 'Not specified').trim() || 'Not specified';
      const asset = String(fund.assetClass || 'other').trim() || 'other';
      const group = String(fund.group || 'Unclassified').trim() || 'Unclassified';
      const groups = categoryTree.get(asset) ?? new Map<string, Set<string>>();
      const items = groups.get(group) ?? new Set<string>(); items.add(category); groups.set(group, items); categoryTree.set(asset, groups);
      for (const [id, column] of this.metricColumns) {
        const raw = fund.metrics?.[id];
        if (typeof raw === 'number' && Number.isFinite(raw)) column.values[index] = raw;
        const reason = fund.metricReasons?.[id];
        if (reason) column.reasons[index] = missingReasonCode[reason] ?? 255;
      }
    }
    recordPhase('row-columns');

    for (const facet of arrayFacets) {
      const dictionary = facetDictionaries.get(facet)!;
      for (const label of fixedValues[facet] ?? []) {
        const key = norm(label);
        if (key && !dictionary.has(key)) dictionary.set(key, { label, mask: new Uint32Array(words), id: dictionary.size });
      }
      const entries = [...dictionary.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
      const values = entries.map(([, entry]) => entry.label);
      if (values.length > 65_535) throw new Error(`Too many distinct values in facet ${facet}.`);
      const oldToNew = new Uint16Array(entries.length);
      entries.forEach(([, entry], id) => { oldToNew[entry.id] = id; });
      const ids = facetIds.get(facet)!;
      for (let index = 0; index < ids.length; index++) ids[index] = oldToNew[ids[index]!] ?? 0;
      const masks = new Map(entries.map(([key, entry]) => [key, entry.mask]));
      this.columns.set(facet, { values, ids, masks });
    }
    recordPhase('facets');
    this.categoryTree = [...categoryTree.entries()].map(([assetClass, groups]) => ({ assetClass, groups: [...groups.entries()].map(([label, items]) => ({ label, items: [...items].sort((a, b) => a.localeCompare(b)) })).sort((a, b) => a.label.localeCompare(b.label)) })).sort((a, b) => a.assetClass.localeCompare(b.assetClass));
    recordPhase('category-tree');
  }

  query(filters: ScreenerFilters, sort: EngineSort, now = Date.now(), scoreFactors: ScoreFactor[] = []): EngineQueryResult {
    const selectionMasks = new Map<ArrayFacet, Uint32Array | null>();
    for (const facet of arrayFacets) {
      const selection = filters[facet] as readonly string[];
      if (!selection.length) { selectionMasks.set(facet, null); continue; }
      const column = this.columns.get(facet)!; const mask = new Uint32Array(this.universe.length);
      for (const value of selection) { const part = column.masks.get(norm(value)); if (part) for (let i = 0; i < mask.length; i++) mask[i] = mask[i]! | part[i]!; }
      selectionMasks.set(facet, mask);
    }
    const searchMask = this.searchMask(filters.search);
    const staleMask = filters.hideStaleNav ? this.staleMask(now) : null;
    const metricMask = this.metricMask(filters.metrics);
    const maskForFacet = (facet: ScreenerFacet | null): Uint32Array => {
      const result = cloneMask(this.universe);
      for (const candidate of arrayFacets) if (candidate !== facet) { const mask = selectionMasks.get(candidate); if (mask) intersectInto(result, mask); }
      if (staleMask) intersectInto(result, staleMask);
      if (metricMask) intersectInto(result, metricMask);
      if (searchMask) intersectInto(result, searchMask);
      return result;
    };
    const resultMask = maskForFacet(null);
    const total = countBits(resultMask);
    const funnelMask = cloneMask(this.universe);
    const funnel = ordered.map(([step, facet]) => {
      if (arrayFacets.includes(facet as ArrayFacet)) { const part = selectionMasks.get(facet as ArrayFacet); if (part) intersectInto(funnelMask, part); }
      else if (facet === 'hideStaleNav' && staleMask) intersectInto(funnelMask, staleMask);
      else if (facet === 'metrics' && metricMask) intersectInto(funnelMask, metricMask);
      else if (facet === 'search' && searchMask) intersectInto(funnelMask, searchMask);
      return { step, remaining: countBits(funnelMask) };
    });
    const facets = {} as Record<ArrayFacet, EngineFacetCounts>;
    for (const facet of arrayFacets) {
      const base = maskForFacet(facet); const column = this.columns.get(facet)!;
      const counts = new Uint32Array(column.values.length);
      for (let valueId = 0; valueId < column.values.length; valueId++) {
        const optionMask = column.masks.get(norm(column.values[valueId]!))!;
        let count = 0; for (let word = 0; word < base.length; word++) count += popcount32(base[word]! & optionMask[word]!);
        counts[valueId] = count;
      }
      facets[facet] = { values: column.values, counts };
    }
    const scoreSig = scoreFactors.length ? scoreFactorsSignature(scoreFactors, 'subcategory') : 0;
    const scores = scoreFactors.length ? this.computeScores(scoreFactors, scoreSig) : undefined;
    const order = this.getSortOrder(sort, scores, scoreSig);
    const indices = new Uint32Array(total);
    let cursor = 0; for (const index of order) if (readBit(resultMask, index)) indices[cursor++] = index;
    return { total, indices, facets, funnel, ...(scores ? { scores } : {}) };
  }

  scatterQuery(options: ScatterQueryOptions): ScatterQueryResult {
    return computeScatterQuery(this.funds, options);
  }

  private searchMask(query: string): Uint32Array | null {
    const needle = norm(query); if (!needle) return null;
    const mask = new Uint32Array(this.universe.length);
    for (let index = 0; index < this.size; index++) if (this.searchText[index]!.includes(needle)) setBit(mask, index);
    return mask;
  }
  private staleMask(now: number): Uint32Array {
    const mask = new Uint32Array(this.universe.length); const today = now / 86_400_000;
    for (let index = 0; index < this.size; index++) if (Number.isFinite(this.navDates[index]) && today - this.navDates[index]! <= 10) setBit(mask, index);
    return mask;
  }
  private metricMask(filters: ScreenerFilters['metrics']): Uint32Array | null {
    if (!filters.length) return null;
    const mask = cloneMask(this.universe);
    for (const filter of filters) {
      const values = this.metricColumns.get(filter.id)?.values;
      for (let index = 0; index < this.size; index++) {
        const value = values?.[index];
        const allowed = typeof value !== 'number' || !Number.isFinite(value)
          ? !(filter.excludeMissing || filter.min !== null || filter.max !== null)
          : (filter.min === null || value >= filter.min) && (filter.max === null || value <= filter.max);
        if (!allowed) mask[index >>> 5] = mask[index >>> 5]! & ~(1 << (index & 31));
      }
    }
    return mask;
  }
  private getSortOrder(sort: EngineSort, scores?: Float32Array, scoreSig = 0): Uint32Array {
    const cacheKey = `${sort.id}:${sort.desc ? 'desc' : 'asc'}:${sort.id === 'score' ? scoreSig : ''}`;
    const cached = this.sortCache.get(cacheKey); if (cached) return cached;
    const order = Array.from({ length: this.size }, (_, index) => index);
    const savedScores = this.metricColumns.get(SCORE_METRIC_ID)?.values;
    const metric = sort.id === 'nav' ? this.navs : sort.id === 'navDate' ? this.navDates : sort.id === 'score' ? savedScores : this.metricColumns.get(sort.id)?.values;
    order.sort((left, right) => {
      if (sort.id === 'name' || sort.id === 'category') {
        const a = sort.id === 'name' ? this.names[left]! : this.subCategories[left]!;
        const b = sort.id === 'name' ? this.names[right]! : this.subCategories[right]!;
        const compare = a.localeCompare(b); return (sort.desc ? -compare : compare) || left - right;
      }
      const a = sort.id === 'score' && scores ? scores[left] : metric?.[left];
      const b = sort.id === 'score' && scores ? scores[right] : metric?.[right];
      const aMissing = a === undefined || !Number.isFinite(a); const bMissing = b === undefined || !Number.isFinite(b);
      if (aMissing || bMissing) return aMissing === bMissing ? left - right : aMissing ? 1 : -1;
      return (a! - b!) * (sort.desc ? -1 : 1) || left - right;
    });
    const result = Uint32Array.from(order); this.sortCache.set(cacheKey, result); return result;
  }
  private computeScores(factors: ScoreFactor[], sig: number): Float32Array {
    const cached = this.scoreCache.get(sig);
    if (cached) return cached;
    const scores = new Float32Array(this.size).fill(Number.NaN);
    const used = factors.reduce((total, factor) => total + Math.max(0, factor.weight), 0);
    if (!used) return scores;

    const savedScoreCol = this.metricColumns.get(SCORE_METRIC_ID)?.values;
    const savedHashCol = this.metricColumns.get(SCORE_MODEL_HASH_METRIC_ID)?.values;
    if (savedScoreCol) {
      let hasMatchingSaved = false;
      for (let i = 0; i < this.size; i++) {
        if (Number.isFinite(savedScoreCol[i])) {
          const hashVal = savedHashCol?.[i];
          if (hashVal === undefined || !Number.isFinite(hashVal) || Math.round(hashVal) === sig) {
            hasMatchingSaved = true;
          }
          break;
        }
      }
      if (hasMatchingSaved) {
        for (let i = 0; i < this.size; i++) {
          const val = savedScoreCol[i]!;
          if (Number.isFinite(val)) scores[i] = val;
        }
        this.scoreCache.set(sig, scores);
        return scores;
      }
    }

    const ranked = rankFunds(this.funds, factors, { peerGroup: 'subcategory', robustMagnitude: true });
    for (let i = 0; i < this.size; i++) {
      const s = ranked[i]?.score;
      if (s !== null && s !== undefined && Number.isFinite(s)) {
        scores[i] = s;
      }
    }
    this.scoreCache.set(sig, scores);
    return scores;
  }
}

export function facetOptionsFromCounts(facets: Record<ArrayFacet, EngineFacetCounts>): Record<ArrayFacet, FacetOption[]> {
  return Object.fromEntries(arrayFacets.map(facet => {
    const { values, counts } = facets[facet];
    return [facet, values.map((value, index) => ({ value, count: counts[index] ?? 0, disabled: counts[index] === 0 }))];
  })) as Record<ArrayFacet, FacetOption[]>;
}
