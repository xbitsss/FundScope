import type { NavPoint } from '../domain/types';
export { AbortableRequestPool } from '../domain/async/abortableRequestPool';

export interface HistoryCacheEntry {
  history: NavPoint[];
  loadedAt: number;
  snapshotId: string;
  schemeCategory?: string | null;
  schemeName?: string;
}

/** Small per-device LRU for histories already opened in the current app session. */
export class HistoryLruCache {
  private readonly entries = new Map<number, HistoryCacheEntry>();

  constructor(readonly maxEntries = 64, readonly maxAgeMs = 7 * 86_400_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('History LRU capacity must be positive.');
  }

  get(code: number, options: { now?: number; snapshotId?: string } = {}): HistoryCacheEntry | null {
    const entry = this.entries.get(code);
    if (!entry) return null;
    const now = options.now ?? Date.now();
    if (!Number.isFinite(entry.loadedAt) || entry.loadedAt > now + 300_000 || now - entry.loadedAt > this.maxAgeMs ||
      (options.snapshotId !== undefined && entry.snapshotId !== '' && entry.snapshotId !== options.snapshotId)) {
      this.entries.delete(code);
      return null;
    }
    this.entries.delete(code);
    this.entries.set(code, entry);
    return { ...entry, history: [...entry.history] };
  }

  set(code: number, entry: HistoryCacheEntry): void {
    if (!Number.isSafeInteger(code) || code <= 0 || !entry.history.length) return;
    this.entries.delete(code);
    this.entries.set(code, { ...entry, history: [...entry.history] });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  delete(code: number): void { this.entries.delete(code); }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}

export const historyLruCache = new HistoryLruCache();
