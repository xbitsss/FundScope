import type { SplitRule, MetricDirection } from '../../domain/scatter/quadrants';

export type ScatterPreferences = {
  x: string; y: string; splitRule: SplitRule; customX: number | null; customY: number | null;
  logScale: boolean; showLabels: boolean; showTable: boolean; directionOverrides: Record<string, MetricDirection>;
};
export type ScatterSort = { by: 'name' | 'x' | 'y' | 'quadrant' | 'rankX' | 'rankY'; desc: boolean };
