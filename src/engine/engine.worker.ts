import type { Fund } from '../domain/types';
import type { ScreenerFilters } from '../domain/screener/filters';
import type { ScoreFactor } from '../domain/scoring/engine';
import { ScreenerEngine } from './core';
import type { EngineSort } from './core';
import type { ScatterQueryOptions, ScatterQueryResult } from '../domain/scatter/scatterQuery';

type Message =
  | { kind: 'load'; id: number; funds: Fund[] }
  | { kind: 'query'; id: number; filters: ScreenerFilters; sort: EngineSort; now: number; factors: ScoreFactor[] }
  | { kind: 'scatter'; id: number; options: ScatterQueryOptions };
type WorkerScope = { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
const scope = self as unknown as WorkerScope;
let engine: ScreenerEngine | null = null;

scope.onmessage = event => {
  const message = event.data;
  try {
    if (message.kind === 'load') {
      engine = new ScreenerEngine(message.funds);
      scope.postMessage({ kind: 'ready', id: message.id, size: engine.size, categoryTree: engine.categoryTree });
      return;
    }
    if (!engine) throw new Error('The local screener index is not ready.');
    if (message.kind === 'scatter') {
      const result: ScatterQueryResult = engine.scatterQuery(message.options);
      scope.postMessage({ kind: 'scatter-result', id: message.id, result }, [result.codes.buffer, result.x.buffer, result.y.buffer, result.quadrants.buffer, result.selected.buffer, result.percentileX.buffer, result.percentileY.buffer, result.rankX.buffer, result.rankY.buffer]);
      return;
    }
    const result = engine.query(message.filters, message.sort, message.now, message.factors);
    const transfer: Transferable[] = [result.indices.buffer];
    for (const facet of Object.values(result.facets)) transfer.push(facet.counts.buffer);
    if (result.scores) transfer.push(result.scores.buffer);
    scope.postMessage({ kind: 'result', id: message.id, result }, transfer);
  } catch (error) {
    scope.postMessage({ kind: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
