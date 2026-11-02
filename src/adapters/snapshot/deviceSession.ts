import type { WrappedSnapshotDek } from '../crypto/snapshotCrypto';
import { wrapSnapshotDek } from '../crypto/snapshotCrypto';

const DB_NAME = 'fundscope-device-unlock';
const STORE_NAME = 'sessions';
const RECORD_ID = 'active';
export interface DeviceSession { keyId: string; key: CryptoKey; wrappedDek: WrappedSnapshotDek; expiresAt: number | null }
interface StoredDeviceSession extends DeviceSession { id: string; savedAt: number }

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Device session storage could not be opened.'));
    request.onblocked = () => reject(new Error('Device session storage is blocked.'));
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export async function saveDeviceSession(keyId: string, rawDek: Uint8Array, days: number | null): Promise<boolean> {
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const wrappedDek = await wrapSnapshotDek(key, keyId, rawDek);
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ id: RECORD_ID, keyId, key, wrappedDek, expiresAt: days === null ? null : Date.now() + days * 86_400_000, savedAt: Date.now() } satisfies StoredDeviceSession);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function getDeviceSession(keyId: string): Promise<DeviceSession | null> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const record = await requestValue(transaction.objectStore(STORE_NAME).get(RECORD_ID)) as StoredDeviceSession | undefined;
    db.close();
    if (!record || record.keyId !== keyId || (record.expiresAt !== null && record.expiresAt <= Date.now())) return null;
    return { keyId: record.keyId, key: record.key, wrappedDek: record.wrappedDek, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

export async function clearDeviceSession(): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
  } catch { /* Private browsing and unavailable storage fall back to passphrase unlock. */ }
}

export async function updateDeviceSessionDuration(days: number | null): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestValue(store.get(RECORD_ID)) as StoredDeviceSession | undefined;
    if (record) store.put({ ...record, expiresAt: days === null ? null : Date.now() + days * 86_400_000 });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
  } catch { /* Keep the current session when storage is unavailable. */ }
}
