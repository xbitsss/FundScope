export interface PerfMeasurement {
  name: string;
  milliseconds: number;
  detail?: string;
}

const measurements: PerfMeasurement[] = [];
const listeners = new Set<(items: PerfMeasurement[]) => void>();
export const isPerfEnabled = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1';

export function startPerfMeasurement(): number | undefined {
  return isPerfEnabled() ? performance.now() : undefined;
}

export function recordPerfMeasurement(name: string, milliseconds: number, detail?: string): void {
  if (!isPerfEnabled() || !Number.isFinite(milliseconds)) return;
  const item: PerfMeasurement = { name, milliseconds: Math.max(0, milliseconds), ...(detail ? { detail } : {}) };
  const existing = measurements.findIndex(value => value.name === name);
  if (existing >= 0) measurements.splice(existing, 1);
  measurements.push(item);
  for (const listener of listeners) listener([...measurements]);
}

export function finishPerfMeasurement(name: string, startedAt: number | undefined, detail?: string): void {
  if (startedAt === undefined) return;
  recordPerfMeasurement(name, performance.now() - startedAt, detail);
}

export function getPerfMeasurements(): PerfMeasurement[] {
  return [...measurements];
}

export function subscribePerfMeasurements(listener: (items: PerfMeasurement[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
