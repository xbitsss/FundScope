import type { ScatterScope } from '../../domain/scatter/scatterQuery';
import type { SplitRule, MetricDirection } from '../../domain/scatter/quadrants';

export type ScatterPreferences = {
  x: string; y: string; scope: ScatterScope; splitRule: SplitRule; customX: number | null; customY: number | null;
  bestAtTopRight: boolean; logScale: boolean; includeOutliers: boolean; showTable: boolean; directionOverrides: Record<string, MetricDirection>;
};
export type ScatterSort = { by: 'name' | 'x' | 'y' | 'quadrant' | 'rankX' | 'rankY'; desc: boolean };
