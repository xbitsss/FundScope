import type { Fund, NavPoint } from '../../domain/types';
import type { SnapshotFileRef, SnapshotManifest } from './types';
import {
  constantTimeEqual, decodeUtf8, decryptSnapshotFile, decryptSnapshotFileV2, deriveSnapshotKey, encodeUtf8, fromBase64, gunzipBytes, sha256Hex, unwrapSnapshotDek,
} from '../crypto/snapshotCrypto';
import { decodeFundColumns } from './columnar';
import { getDeviceSession, saveDeviceSession } from './deviceSession';

const CANARY_TEXT = 'FundScope snapshot canary:v1';
interface UnlockedSnapshot { manifest: SnapshotManifest; key: CryptoKey; baseUrl: string }
let unlocked: UnlockedSnapshot | null = null;
let manifestPromise: Promise<{ manifest: SnapshotManifest; baseUrl: string }> | null = null;
let warmUnlockWorker: Worker | null = null;
const prefetchedFiles = new Map<string, Promise<Uint8Array>>();
const historyCache = new Map<string, Map<number, NavPoint[]>>();
const detailCache = new Map<string, Map<number, Partial<Fund>>>();
let failedUnlocks = 0;
let blockedUntil = 0;
let latestUnlockTimings: Record<string, number> = {};
export interface HistoryLoadResult { loaded: Map<number, NavPoint[]>; unavailable: number[]; failed: Array<{ code: number; reason: string }> }

function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(base, globalThis.location.origin).href;
}

function validateManifest(value: unknown): SnapshotManifest {
  if (value === null || typeof value !== 'object') throw new Error('The snapshot manifest is invalid.');
  const manifest = value as Partial<SnapshotManifest>;
  const version = manifest.schema_version;
  if ((version !== 1 && version !== 2) || !manifest.encryption || !manifest.index || !manifest.histories || typeof manifest.histories !== 'object') {
    throw new Error('This FundScope snapshot version is not supported.');
  }
  const safeRef = (ref: unknown): ref is SnapshotFileRef => {
    if (!ref || typeof ref !== 'object') return false;
    const file = ref as SnapshotFileRef;
    return typeof file.path === 'string' && file.path.startsWith('data/') && /^data\/[A-Za-z0-9_./-]+\.enc$/.test(file.path) &&
      !file.path.split('/').some((part) => part === '.' || part === '..') && /^[0-9a-f]{64}$/.test(file.sha256) &&
      Number.isSafeInteger(file.encryptedBytes) && file.encryptedBytes > 0;
  };
  if (!safeRef(manifest.index)) throw new Error('Snapshot index reference is malformed.');
  if (version === 1 && (!manifest.encryption.canary || !safeRef(manifest.encryption.canary))) throw new Error('Snapshot canary reference is malformed.');
  if (version === 2 && (typeof manifest.snapshot_id !== 'string' || !manifest.snapshot_id || typeof manifest.encryption.keyId !== 'string' || !manifest.encryption.wrappedDek)) {
    throw new Error('Snapshot key settings are malformed.');
  }
  for (const [code, ref] of Object.entries(manifest.histories)) {
    if (!/^\d+$/.test(code) || !safeRef(ref)) throw new Error('Snapshot history references are malformed.');
  }
  for (const [code, ref] of Object.entries(manifest.details ?? {})) {
    if (!/^\d+$/.test(code) || !safeRef(ref)) throw new Error('Snapshot detail references are malformed.');
  }
  if (manifest.encryption.algorithm !== 'AES-256-GCM' || manifest.encryption.kdf !== 'PBKDF2-SHA256' || typeof manifest.encryption.salt !== 'string' || !Number.isInteger(manifest.encryption.iterations)) {
    throw new Error('Snapshot encryption settings are not supported.');
  }
  return manifest as SnapshotManifest;
}

async function fetchManifest(baseUrl: string): Promise<{ manifest: SnapshotManifest; baseUrl: string }> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(new URL('data/manifest.json', base), { cache: 'no-store' });
  if (!response.ok) throw new Error(`FundScope data snapshot is unavailable (HTTP ${response.status}).`);
  const manifest = validateManifest(await response.json());
  if (manifest.schema_version === 1) console.info('This FundScope snapshot uses legacy schema v1; update the nightly ETL to publish schema v2.');
  return { manifest, baseUrl: base };
}

async function fetchFile(baseUrl: string, ref: SnapshotFileRef): Promise<Uint8Array> {
  const url = new URL(ref.path, baseUrl).href;
  let pending = prefetchedFiles.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Snapshot file could not be loaded (HTTP ${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    prefetchedFiles.set(url, pending);
  }
  try {
    const bytes = await pending;
    if (bytes.byteLength !== ref.encryptedBytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('Snapshot file integrity check failed.');
    return bytes;
  } catch (error) {
    prefetchedFiles.delete(url);
    throw error;
  }
}

/** Starts before the user submits the passphrase; cached bytes are reused by unlockSnapshot. */
export function prefetchSnapshot(baseUrl = import.meta.env.BASE_URL): void {
  if (!manifestPromise) manifestPromise = fetchManifest(baseUrl).catch((error) => { manifestPromise = null; throw error; });
  if (!warmUnlockWorker && typeof Worker !== 'undefined') {
    try { warmUnlockWorker = new Worker(new URL('./unlock.worker.ts', import.meta.url), { type: 'module', name: 'fundscope-snapshot-unlock' }); }
    catch { warmUnlockWorker = null; }
  }
  void manifestPromise.then(async ({ manifest, baseUrl: base }) => {
    const refs = [manifest.index, ...(manifest.schema_version === 1 && manifest.encryption.canary ? [manifest.encryption.canary] : [])];
    await Promise.all(refs.map((ref) => fetchFile(base, ref).catch(() => undefined)));
  }).catch(() => undefined);
}

export async function checkForSnapshotUpdate(baseUrl = import.meta.env.BASE_URL): Promise<SnapshotManifest> {
  const base = normalizeBaseUrl(baseUrl);
  const url = new URL('data/manifest.json', base);
  url.searchParams.set('fresh', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Snapshot update check failed (HTTP ${response.status}).`);
  return validateManifest(await response.json());
}

function decryptFile(manifest: SnapshotManifest, key: CryptoKey, path: string, bytes: Uint8Array): Promise<Uint8Array> {
  return manifest.schema_version === 2
    ? decryptSnapshotFileV2(key, path, manifest.snapshot_id ?? '', bytes)
    : decryptSnapshotFile(key, path, bytes);
}

export async function unlockSnapshot(passphrase: string, baseUrl = import.meta.env.BASE_URL, options: { remember?: boolean; rememberDays?: number | null; onProgress?: (phase: string) => void } = {}): Promise<{ manifest: SnapshotManifest; funds: Fund[]; timings: Record<string, number> }> {
  if (Date.now() < blockedUntil) throw new Error(`Please wait ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds before trying again.`);
  const base = normalizeBaseUrl(baseUrl);
  performance.mark?.('unlock.submit');
  const prepared = manifestPromise ?? fetchManifest(base);
  let key: CryptoKey | undefined;
  try {
    const fetched = await prepared;
    const { manifest } = fetched;
    performance.mark?.('unlock.manifest');
    const [encrypted, canary] = await Promise.all([
      fetchFile(base, manifest.index),
      manifest.schema_version === 1 && manifest.encryption.canary ? fetchFile(base, manifest.encryption.canary) : Promise.resolve(undefined),
    ]);
    performance.mark?.('unlock.files');
    let worker: Worker | null = warmUnlockWorker;
    warmUnlockWorker = null;
    let result: { funds: Fund[]; key: CryptoKey; timings?: Record<string, number> };
    if (!worker) try { worker = new Worker(new URL('./unlock.worker.ts', import.meta.url), { type: 'module', name: 'fundscope-snapshot-unlock' }); } catch { worker = null; }
    if (worker) {
      const response = await new Promise<{ funds: Fund[]; key: CryptoKey; timings: Record<string, number> }>((resolve, reject) => {
        worker!.onmessage = (event: MessageEvent<{ type: string; funds?: Fund[]; key?: CryptoKey; message?: string; phase?: string; timings?: Record<string, number> }>) => {
          if (event.data.type === 'progress') { if (event.data.phase) options.onProgress?.(event.data.phase); return; }
          if (event.data.type === 'success' && event.data.funds && event.data.key) resolve({ funds: event.data.funds, key: event.data.key, timings: event.data.timings ?? {} });
          else reject(new Error(event.data.message ?? 'Snapshot data could not be unlocked.'));
        };
        worker!.onerror = () => reject(new Error('Snapshot unlock worker failed.'));
        const indexBuffer = encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength);
        const canaryBuffer = canary?.buffer.slice(canary.byteOffset, canary.byteOffset + canary.byteLength);
        worker!.postMessage({ type: 'unlock', passphrase, manifest, index: indexBuffer, remember: options.remember ?? true, rememberDays: options.rememberDays ?? 30, ...(canaryBuffer ? { canary: canaryBuffer } : {}) }, canaryBuffer ? [indexBuffer, canaryBuffer] : [indexBuffer]);
      }).finally(() => worker?.terminate());
      result = response;
    } else {
      // Older embedded WebViews without module-worker support retain a compatible fallback.
      const kek = await deriveSnapshotKey(passphrase, fromBase64(manifest.encryption.salt), manifest.encryption.iterations);
      let fallbackKey = kek;
      let rawDek: Uint8Array | undefined;
      if (manifest.schema_version === 2) {
        try { const opened = await unwrapSnapshotDek(kek, manifest.encryption.keyId!, manifest.encryption.wrappedDek!); fallbackKey = opened.key; rawDek = opened.raw; }
        catch { throw new Error('Incorrect passphrase.'); }
      }
      else if (canary && !constantTimeEqual(encodeUtf8(decodeUtf8(await decryptSnapshotFile(kek, manifest.encryption.canary!.path, canary))), encodeUtf8(CANARY_TEXT))) throw new Error('Incorrect passphrase or damaged snapshot.');
      const compressed = manifest.schema_version === 2
        ? await decryptSnapshotFileV2(fallbackKey, manifest.index.path, manifest.snapshot_id ?? '', encrypted)
        : await decryptSnapshotFile(fallbackKey, manifest.index.path, encrypted);
      const plain = await gunzipBytes(compressed);
      const funds = manifest.schema_version === 2
        ? decodeFundColumns(plain)
        : JSON.parse(decodeUtf8(plain)) as Fund[];
      if (options.remember && rawDek && manifest.encryption.keyId) await saveDeviceSession(manifest.encryption.keyId, rawDek, options.rememberDays ?? 30);
      rawDek?.fill(0);
      result = { funds: funds.map(fund => ({ ...fund, history: Array.isArray(fund.history) ? fund.history : [] })), key: fallbackKey, timings: {} };
    }
    key = result.key;
    performance.mark?.('unlock.decoded');
    if (result.funds.length !== manifest.fund_count) throw new Error('Snapshot fund count does not match its manifest.');
    failedUnlocks = 0; blockedUntil = 0;
    latestUnlockTimings = result.timings ?? {};
    unlocked = { manifest, key, baseUrl: base };
    return { manifest, funds: result.funds, timings: latestUnlockTimings };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Incorrect passphrase')) {
      failedUnlocks++;
      if (failedUnlocks >= 5) { blockedUntil = Date.now() + Math.min(30_000, 1000 * (2 ** (failedUnlocks - 5))); failedUnlocks = 0; }
      throw new Error('Incorrect passphrase.');
    }
    if (error instanceof Error && (error.message === 'Incorrect passphrase.' || error.message.includes('passphrase') || error.message.includes('snapshot'))) throw error;
    throw new Error('Snapshot data could not be decoded. It may be incomplete or damaged.');
  }
}

export async function restoreSnapshotOnDevice(baseUrl = import.meta.env.BASE_URL): Promise<{ manifest: SnapshotManifest; funds: Fund[] } | null> {
  const base = normalizeBaseUrl(baseUrl);
  const fetched = await (manifestPromise ?? fetchManifest(base));
  const { manifest } = fetched;
  if (manifest.schema_version !== 2 || !manifest.encryption.keyId) return null;
  const session = await getDeviceSession(manifest.encryption.keyId);
  if (!session) return null;
  const encrypted = await fetchFile(base, manifest.index);
  let worker: Worker | null = warmUnlockWorker;
  warmUnlockWorker = null;
  if (!worker) try { worker = new Worker(new URL('./unlock.worker.ts', import.meta.url), { type: 'module', name: 'fundscope-device-restore' }); } catch { worker = null; }
  let result: { funds: Fund[]; key: CryptoKey };
  if (worker) {
    const indexBuffer = encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength);
    result = await new Promise<{ funds: Fund[]; key: CryptoKey }>((resolve, reject) => {
      worker!.onmessage = (event: MessageEvent<{ type: string; funds?: Fund[]; key?: CryptoKey; message?: string }>) => {
        if (event.data.type === 'success' && event.data.funds && event.data.key) resolve({ funds: event.data.funds, key: event.data.key });
        else reject(new Error(event.data.message ?? 'Saved device unlock failed.'));
      };
      worker!.onerror = () => reject(new Error('Saved device unlock worker failed.'));
      worker!.postMessage({ type: 'restore', manifest, index: indexBuffer, session }, [indexBuffer]);
    }).finally(() => worker?.terminate());
  } else {
    const { key } = await unwrapSnapshotDek(session.key, session.keyId, session.wrappedDek);
    const compressed = await decryptSnapshotFileV2(key, manifest.index.path, manifest.snapshot_id ?? '', encrypted);
    const funds = decodeFundColumns(await gunzipBytes(compressed));
    result = { funds, key };
  }
  if (result.funds.length !== manifest.fund_count) throw new Error('Saved snapshot fund count does not match its manifest.');
  unlocked = { manifest, key: result.key, baseUrl: base };
  return { manifest, funds: result.funds };
}

export async function loadSnapshotDetails(codes: number[]): Promise<Map<number, Partial<Fund>>> {
  if (!unlocked) throw new Error('Unlock the FundScope snapshot before loading fund details.');
  const { manifest, key, baseUrl } = unlocked;
  const snapshotId = manifest.snapshot_id ?? manifest.generated_at;
  const cache = detailCache.get(snapshotId) ?? new Map<number, Partial<Fund>>(); detailCache.set(snapshotId, cache);
  const loaded = new Map<number, Partial<Fund>>();
  await Promise.all(codes.map(async (code) => {
    if (cache.has(code)) { loaded.set(code, cache.get(code)!); return; }
    const ref = manifest.details?.[String(code)]; if (!ref) return;
    const bytes = await fetchFile(baseUrl, ref);
    const compressed = await decryptFile(manifest, key, ref.path, bytes);
    const value = JSON.parse(decodeUtf8(await gunzipBytes(compressed))) as Partial<Fund>;
    cache.set(code, value); loaded.set(code, value);
  }));
  return loaded;
}

export async function loadSnapshotHistories(codes: number[], onProgress?: (done: number, total: number) => void): Promise<HistoryLoadResult> {
  if (!unlocked) throw new Error('Unlock the FundScope snapshot before loading fund history.');
  const result = new Map<number, NavPoint[]>();
  const unavailable: number[] = []; const failed: Array<{ code: number; reason: string }> = [];
  const { manifest, key, baseUrl } = unlocked;
  const snapshotId = manifest.snapshot_id ?? manifest.generated_at;
  const cached = historyCache.get(snapshotId) ?? new Map<number, NavPoint[]>(); historyCache.set(snapshotId, cached);
  let next = 0; let done = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= codes.length) return;
      const code = codes[index]!;
      const ref = manifest.histories[String(code)];
      if (!ref) unavailable.push(code);
      else if (cached.has(code)) result.set(code, cached.get(code)!);
      else {
        try {
          let error: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const encrypted = await fetchFile(baseUrl, ref);
              const compressed = await decryptFile(manifest, key, ref.path, encrypted);
              const history = JSON.parse(decodeUtf8(await gunzipBytes(compressed))) as unknown;
              if (!Array.isArray(history) || history.length === 0 || history.some((point) => !point || !Number.isInteger(point.date) || !Number.isFinite(point.nav) || point.nav <= 0)) throw new Error(`Snapshot history for scheme ${code} is malformed or empty.`);
              cached.set(code, history as NavPoint[]); result.set(code, history as NavPoint[]); error = undefined; break;
            } catch (cause) { error = cause; if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100)); }
          }
          if (error) failed.push({ code, reason: error instanceof Error ? error.message : 'History could not be loaded.' });
        } catch (cause) { failed.push({ code, reason: cause instanceof Error ? cause.message : 'History could not be loaded.' }); }
      }
      done++; onProgress?.(done, codes.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, codes.length) }, worker));
  Object.defineProperties(result, { loaded: { value: result, enumerable: false }, unavailable: { value: unavailable, enumerable: false }, failed: { value: failed, enumerable: false } });
  return result as unknown as HistoryLoadResult;
}

export function getUnlockedSnapshotManifest(): SnapshotManifest | null { return unlocked?.manifest ?? null; }
export function getLastUnlockTimings(): Record<string, number> { return { ...latestUnlockTimings }; }
export function lockSnapshot(): void { unlocked = null; warmUnlockWorker?.terminate(); warmUnlockWorker = null; }
