import type { Fund } from '../domain/types';
import type { ScreenerFilters } from '../domain/screener/filters';
import type { ScoreFactor } from '../domain/scoring/engine';
import type { ScatterQueryOptions, ScatterQueryResult } from '../domain/scatter/scatterQuery';
import { ScreenerEngine, type EngineCategoryTree, type EngineQueryResult, type EngineSort } from './core';
import { recordPerfMeasurement } from '../app/perf';

type WorkerReply =
  | { kind: 'ready'; id: number; size: number; categoryTree: EngineCategoryTree[]; buildMs?: number; phaseTimings?: Record<string, number> }
  | { kind: 'scores-updated'; id: number }
  | { kind: 'result'; id: number; result: EngineQueryResult }
  | { kind: 'scatter-result'; id: number; result: ScatterQueryResult }
  | { kind: 'error'; id: number; message: string };
type Pending = { resolve: (value: WorkerReply) => void; reject: (reason: Error) => void };

function sameStringArray(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameMetricValues(a: Fund['metrics'] | undefined, b: Fund['metrics'] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ignoreScoreKey = (k: string) => k === 'composite_score' || k === 'composite_score_model_hash';
  const aKeys = Object.keys(a).filter(k => !ignoreScoreKey(k));
  const bKeys = Object.keys(b).filter(k => !ignoreScoreKey(k));
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]!;
    if (!(key in b)) return false;
    const va = a[key];
    const vb = b[key];
    if (va === vb) continue;
    if (typeof va === 'number' && typeof vb === 'number' && Number.isNaN(va) && Number.isNaN(vb)) continue;
    return false;
  }
  return true;
}

/** Ignores detail/history-only replacements so opening a drawer cannot rebuild the full screener index. */
export function sameScreenerIndexData(previous: Fund[], next: Fund[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) {
    const a = previous[index]!; const b = next[index]!;
    if (a === b) continue;
    if (a.code !== b.code || a.name !== b.name || a.amc !== b.amc || a.category !== b.category || a.assetClass !== b.assetClass ||
      a.classRuleId !== b.classRuleId || a.subCategory !== b.subCategory || a.structure !== b.structure || a.plan !== b.plan || a.option !== b.option ||
      a.management !== b.management || a.group !== b.group || a.riskBand !== b.riskBand || a.philosophy !== b.philosophy || a.lifecycle !== b.lifecycle ||
      a.classStatus !== b.classStatus || a.nav !== b.nav || a.navDate !== b.navDate || !sameStringArray(a.speciality, b.speciality) || !sameMetricValues(a.metrics, b.metrics)) return false;
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

  load(funds: Fund[], indexBuffer?: ArrayBuffer): Promise<{ size: number; categoryTree: EngineCategoryTree[] }> {
    if (funds === this.fundsRef) return this.loadPromise;
    if (this.fundsRef && sameScreenerIndexData(this.fundsRef, funds)) { this.fundsRef = funds; return this.loadPromise; }
    this.fundsRef = funds;
    const id = ++this.nextId;
    if (!this.worker) {
      const started = performance.now();
      this.local = new ScreenerEngine(funds);
      recordPerfMeasurement('screener index build (main thread)', performance.now() - started, `${funds.length.toLocaleString('en-IN')} funds`);
      this.loadPromise = Promise.resolve({ size: this.local.size, categoryTree: this.local.categoryTree });
      return this.loadPromise;
    }
    this.loadPromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: reply => {
        if (reply.kind !== 'ready') { reject(new Error('Unexpected screener worker response.')); return; }
        if (reply.buildMs !== undefined) recordPerfMeasurement('screener index build (worker)', reply.buildMs, `${reply.size.toLocaleString('en-IN')} funds`);
        for (const [phase, milliseconds] of Object.entries(reply.phaseTimings ?? {})) recordPerfMeasurement(`screener index · ${phase}`, milliseconds);
        resolve({ size: reply.size, categoryTree: reply.categoryTree });
      }, reject });
      const started = performance.now();
      const validBuffer = indexBuffer && indexBuffer.byteLength > 0 ? indexBuffer : undefined;
      if(validBuffer)this.worker!.postMessage({ kind: 'load', id, indexBuffer: validBuffer }, [validBuffer]);
      else this.worker!.postMessage({ kind: 'load', id, funds });
      recordPerfMeasurement('fund transfer to screener worker', performance.now() - started, `${funds.length.toLocaleString('en-IN')} funds · ${validBuffer?'transferred columnar buffer':'structured-clone postMessage'} time`);
    });
    return this.loadPromise;
  }

  async updateScores(scores: Float32Array, modelHash: number): Promise<void> {
    await this.loadPromise;
    const id = ++this.nextId;
    if (!this.worker) {
      this.local?.updateScores(scores, modelHash);
      return;
    }
    const copy = scores.slice();
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: reply => reply.kind === 'scores-updated' ? resolve() : reject(new Error('Unexpected score update worker response.')),
        reject,
      });
      this.worker!.postMessage({ kind: 'update-scores', id, scores: copy, modelHash }, [copy.buffer]);
    });
  }

  async query(filters: ScreenerFilters, sort: EngineSort, now = Date.now(), factors: ScoreFactor[] = []): Promise<{ id: number; result: EngineQueryResult }> {
    await this.loadPromise;
    const id = ++this.nextId;
    const started = performance.now();
    if (!this.worker) {
      if (!this.local) throw new Error('The local screener index is not ready.');
      const result = this.local.query(filters, sort, now, factors);
      recordPerfMeasurement('screener query round trip', performance.now() - started, `${result.indices.length.toLocaleString('en-IN')} matched funds`);
      return { id, result };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: reply => {
        if (reply.kind !== 'result') { reject(new Error('Unexpected screener worker response.')); return; }
        recordPerfMeasurement('screener query round trip', performance.now() - started, `${reply.result.indices.length.toLocaleString('en-IN')} matched funds · worker round trip`);
        resolve({ id, result: reply.result });
      }, reject });
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
