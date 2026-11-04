import type { Fund } from '../domain/types';
import type { ScreenerFilters } from '../domain/screener/filters';
import type { ScoreFactor } from '../domain/scoring/engine';
import type { ScatterQueryOptions, ScatterQueryResult } from '../domain/scatter/scatterQuery';
import { ScreenerEngine, type EngineCategoryTree, type EngineQueryResult, type EngineSort } from './core';

type WorkerReply =
  | { kind: 'ready'; id: number; size: number; categoryTree: EngineCategoryTree[] }
  | { kind: 'result'; id: number; result: EngineQueryResult }
  | { kind: 'scatter-result'; id: number; result: ScatterQueryResult }
  | { kind: 'error'; id: number; message: string };
type Pending = { resolve: (value: WorkerReply) => void; reject: (reason: Error) => void };

/** Ignores detail/history-only replacements so opening a drawer cannot rebuild the full screener index. */
export function sameScreenerIndexData(previous: Fund[], next: Fund[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) {
    const a = previous[index]!; const b = next[index]!;
    if (a === b) continue;
    if (a.code !== b.code || a.name !== b.name || a.amc !== b.amc || a.category !== b.category || a.assetClass !== b.assetClass ||
      a.classRuleId !== b.classRuleId || a.subCategory !== b.subCategory || a.structure !== b.structure || a.plan !== b.plan || a.option !== b.option ||
      a.management !== b.management || a.group !== b.group || a.riskBand !== b.riskBand || a.philosophy !== b.philosophy || a.lifecycle !== b.lifecycle ||
      a.classStatus !== b.classStatus || a.navDate !== b.navDate || a.speciality !== b.speciality || a.metrics !== b.metrics) return false;
  }
  return true;
}

/** A small request/reply client. Worker results carry indices and typed facet counts, never Fund payloads. */
export class ScreenerEngineClient {
  private worker: Worker | null = null;
  private local: ScreenerEngine | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private loadPromise: Promise<{ size: number; categoryTree: EngineCategoryTree[] }> = Promise.resolve({ size: 0, categoryTree: [] });
  private fundsRef: Fund[] | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'fundscope-screener' });
      this.worker.onmessage = event => this.receive(event.data as WorkerReply);
      this.worker.onerror = event => {
        const error = new Error(event.message || 'Screener worker failed.');
        for (const item of this.pending.values()) item.reject(error);
        this.pending.clear();
      };
    } catch {
      // Older webviews still get the same indexed engine on the main thread.
    }
  }

  load(funds: Fund[]): Promise<{ size: number; categoryTree: EngineCategoryTree[] }> {
    if (funds === this.fundsRef) return this.loadPromise;
    if (this.fundsRef && sameScreenerIndexData(this.fundsRef, funds)) { this.fundsRef = funds; return this.loadPromise; }
    this.fundsRef = funds;
    const id = ++this.nextId;
    if (!this.worker) {
      this.local = new ScreenerEngine(funds);
      this.loadPromise = Promise.resolve({ size: this.local.size, categoryTree: this.local.categoryTree });
      return this.loadPromise;
    }
    this.loadPromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: reply => reply.kind === 'ready' ? resolve({ size: reply.size, categoryTree: reply.categoryTree }) : reject(new Error('Unexpected screener worker response.')), reject });
      this.worker!.postMessage({ kind: 'load', id, funds });
    });
    return this.loadPromise;
  }

  async query(filters: ScreenerFilters, sort: EngineSort, now = Date.now(), factors: ScoreFactor[] = []): Promise<{ id: number; result: EngineQueryResult }> {
    await this.loadPromise;
    const id = ++this.nextId;
    if (!this.worker) {
      if (!this.local) throw new Error('The local screener index is not ready.');
      return { id, result: this.local.query(filters, sort, now, factors) };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: reply => reply.kind === 'result' ? resolve({ id, result: reply.result }) : reject(new Error('Unexpected screener worker response.')), reject });
      this.worker!.postMessage({ kind: 'query', id, filters, sort, now, factors });
    });
  }

  async scatter(options: ScatterQueryOptions): Promise<{ id: number; result: ScatterQueryResult }> {
    await this.loadPromise;
    const id = ++this.nextId;
    if (!this.worker) {
      if (!this.local) throw new Error('The local screener index is not ready.');
      return { id, result: this.local.scatterQuery(options) };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: reply => reply.kind === 'scatter-result' ? resolve({ id, result: reply.result }) : reject(new Error('Unexpected scatter worker response.')), reject });
      this.worker!.postMessage({ kind: 'scatter', id, options });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private receive(reply: WorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.kind === 'error') pending.reject(new Error(reply.message));
    else pending.resolve(reply);
  }
}
