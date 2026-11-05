import { metricRegistry } from '../../domain/metrics/registry';
import type { MetricDirection, SplitRule } from '../../domain/scatter/quadrants';
import type { ScatterPreferences } from './types';

export const defaultScatterPreferences: ScatterPreferences = {
  x: 'std_dev', y: 'cagr_3y', splitRule: 'peer-median', customX: null, customY: null,
  bestAtTopRight: false, showTable: false, directionOverrides: {},
};

/** Reads old preference records while deliberately dropping removed scope/outlier fields. */
export function parseScatterPreferences(raw: unknown): ScatterPreferences | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<ScatterPreferences> & { splitRule?: unknown };
  const splits: SplitRule[] = ['median', 'mean', 'peer-median', 'custom'];
  const knownMetrics = new Set(metricRegistry.filter(metric => metric.unit !== 'enum').map(metric => metric.id));
  const directionOverrides: Record<string, MetricDirection> = {};
  if (value.directionOverrides && typeof value.directionOverrides === 'object') for (const [id, direction] of Object.entries(value.directionOverrides)) {
    if (knownMetrics.has(id) && (direction === 'higher' || direction === 'lower' || direction === 'none')) directionOverrides[id] = direction;
  }
  return {
    ...defaultScatterPreferences,
    x: typeof value.x === 'string' && knownMetrics.has(value.x) ? value.x : defaultScatterPreferences.x,
    y: typeof value.y === 'string' && knownMetrics.has(value.y) ? value.y : defaultScatterPreferences.y,
    splitRule: splits.includes(value.splitRule as SplitRule) ? value.splitRule as SplitRule : defaultScatterPreferences.splitRule,
    customX: typeof value.customX === 'number' && Number.isFinite(value.customX) ? value.customX : null,
    customY: typeof value.customY === 'number' && Number.isFinite(value.customY) ? value.customY : null,
    bestAtTopRight: value.bestAtTopRight === true, showTable: value.showTable === true, directionOverrides,
  };
}
