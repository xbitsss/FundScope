import type { Fund, NavPoint } from '../../domain/types';
import type { SnapshotFileRef, SnapshotManifest } from './types';
import { decodeUtf8, decryptSnapshotFile, deriveSnapshotKey, fromBase64, gunzipBytes, sha256Hex } from '../crypto/snapshotCrypto';

const CANARY_TEXT = 'FundScope snapshot canary:v1';
interface UnlockedSnapshot { manifest: SnapshotManifest; key: CryptoKey; baseUrl: string }
let unlocked: UnlockedSnapshot | null = null;

function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(base, globalThis.location.origin).href;
}

function validateManifest(value: unknown): SnapshotManifest {
  if (value === null || typeof value !== 'object') throw new Error('The snapshot manifest is invalid.');
  const manifest = value as Partial<SnapshotManifest>;
  if (manifest.schema_version !== 1 || !manifest.encryption || !manifest.index || !manifest.encryption.canary || !manifest.histories || typeof manifest.histories !== 'object') {
    throw new Error('This FundScope snapshot version is not supported.');
  }
  const safeRef = (ref: SnapshotFileRef) => typeof ref.path === 'string' && /^data\/[A-Za-z0-9_./-]+\.enc$/.test(ref.path) && /^[0-9a-f]{64}$/.test(ref.sha256);
  if (!safeRef(manifest.index) || !safeRef(manifest.encryption.canary)) throw new Error('Snapshot file references are malformed.');
  for (const [code, ref] of Object.entries(manifest.histories)) {
    if (!/^\d+$/.test(code) || !safeRef(ref)) throw new Error('Snapshot history references are malformed.');
  }
  if (manifest.encryption.algorithm !== 'AES-256-GCM' || manifest.encryption.kdf !== 'PBKDF2-SHA256' || typeof manifest.encryption.salt !== 'string' || !Number.isInteger(manifest.encryption.iterations)) {
    throw new Error('Snapshot encryption settings are not supported.');
  }
  return manifest as SnapshotManifest;
}

async function fetchFile(baseUrl: string, ref: SnapshotFileRef): Promise<Uint8Array> {
  const response = await fetch(new URL(ref.path, baseUrl), { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Snapshot file could not be loaded (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== ref.encryptedBytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('Snapshot file integrity check failed.');
  return bytes;
}

export async function unlockSnapshot(passphrase: string, baseUrl = import.meta.env.BASE_URL): Promise<{ manifest: SnapshotManifest; funds: Fund[] }> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(new URL('data/manifest.json', base), { cache: 'no-store' });
  if (!response.ok) throw new Error(`FundScope data snapshot is unavailable (HTTP ${response.status}).`);
  const manifest = validateManifest(await response.json());
  const key = await deriveSnapshotKey(passphrase, fromBase64(manifest.encryption.salt), manifest.encryption.iterations);
  const canaryEncrypted = await fetchFile(base, manifest.encryption.canary);
  let canary: string;
  try {
    canary = decodeUtf8(await decryptSnapshotFile(key, manifest.encryption.canary.path, canaryEncrypted));
  } catch {
    throw new Error('Incorrect passphrase or damaged snapshot.');
  }
  if (canary !== CANARY_TEXT) throw new Error('Incorrect passphrase or damaged snapshot.');
  const indexEncrypted = await fetchFile(base, manifest.index);
  const indexCompressed = await decryptSnapshotFile(key, manifest.index.path, indexEncrypted);
  let funds: Fund[];
  try {
    const value: unknown = JSON.parse(decodeUtf8(await gunzipBytes(indexCompressed)));
    if (!Array.isArray(value)) throw new Error('Snapshot index is not an array.');
    funds = value.map((item) => {
      if (!item || typeof item !== 'object' || !Number.isInteger((item as Fund).code)) throw new Error('Snapshot contains an invalid fund record.');
      return { ...(item as Fund), history: Array.isArray((item as Fund).history) ? (item as Fund).history : [] };
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Snapshot')) throw error;
    throw new Error('Snapshot data could not be decoded. It may be incomplete or damaged.');
  }
  unlocked = { manifest, key, baseUrl: base };
  return { manifest, funds };
}

export async function loadSnapshotHistories(codes: number[], onProgress?: (done: number, total: number) => void): Promise<Map<number, NavPoint[]>> {
  if (!unlocked) throw new Error('Unlock the FundScope snapshot before loading fund history.');
  const result = new Map<number, NavPoint[]>();
  let next = 0; let done = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= codes.length) return;
      const code = codes[index]!;
      const ref = unlocked!.manifest.histories[String(code)];
      if (ref) {
        const encrypted = await fetchFile(unlocked!.baseUrl, ref);
        const compressed = await decryptSnapshotFile(unlocked!.key, ref.path, encrypted);
        const history = JSON.parse(decodeUtf8(await gunzipBytes(compressed))) as unknown;
        if (!Array.isArray(history) || history.some((point) => !point || !Number.isInteger(point.date) || !Number.isFinite(point.nav))) {
          throw new Error(`Snapshot history for scheme ${code} is malformed.`);
        }
        result.set(code, history as NavPoint[]);
      }
      done++;
      onProgress?.(done, codes.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, codes.length) }, worker));
  return result;
}

export function getUnlockedSnapshotManifest(): SnapshotManifest | null {
  return unlocked?.manifest ?? null;
}

export function lockSnapshot(): void {
  unlocked = null;
}
