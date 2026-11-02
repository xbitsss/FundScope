const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FORMAT_VERSION = 1;
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer as ArrayBuffer;
export const MIN_PBKDF2_ITERATIONS = 100_000;
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

function subtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is required to unlock FundScope snapshots.');
  return globalThis.crypto.subtle;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Constant-time comparison used only for the legacy snapshot canary. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index++) mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function deriveSnapshotKey(passphrase: string, salt: Uint8Array, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<CryptoKey> {
  if (!passphrase || passphrase.length < 16) throw new Error('The passphrase must be at least 16 characters.');
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS) throw new Error('Snapshot KDF settings are below the accepted security minimum.');
  const subtle = subtleCrypto();
  const material = await subtle.importKey('raw', asArrayBuffer(encoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asArrayBuffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface WrappedSnapshotDek { iv: string; ciphertext: string }
export function generateSnapshotDek(): Uint8Array { return randomBytes(32); }
export async function importSnapshotDek(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error('Snapshot data key must be 256 bits.');
  return subtleCrypto().importKey('raw', asArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function wrapSnapshotDek(kek: CryptoKey, keyId: string, rawDek: Uint8Array): Promise<WrappedSnapshotDek> {
  if (rawDek.byteLength !== 32) throw new Error('Snapshot data key must be 256 bits.');
  const iv = randomBytes(12);
  const ciphertext = await subtleCrypto().encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(encoder.encode(`fundscope-dek-wrap:v2:${keyId}`)), tagLength: 128 }, kek, asArrayBuffer(rawDek));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}
export async function unwrapSnapshotDek(kek: CryptoKey, keyId: string, wrapped: WrappedSnapshotDek): Promise<{ raw: Uint8Array; key: CryptoKey }> {
  const raw = new Uint8Array(await subtleCrypto().decrypt({ name: 'AES-GCM', iv: asArrayBuffer(fromBase64(wrapped.iv)), additionalData: asArrayBuffer(encoder.encode(`fundscope-dek-wrap:v2:${keyId}`)), tagLength: 128 }, kek, asArrayBuffer(fromBase64(wrapped.ciphertext))));
  if (raw.byteLength !== 32) throw new Error('Wrapped snapshot key has an invalid length.');
  return { raw, key: await importSnapshotDek(raw) };
}

function additionalData(path: string): ArrayBuffer {
  return asArrayBuffer(encoder.encode(`fundscope-snapshot:${FORMAT_VERSION}:${path}`));
}

export async function encryptSnapshotFile(key: CryptoKey, path: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ciphertext = await subtleCrypto().encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: additionalData(path), tagLength: 128 }, key, asArrayBuffer(plaintext));
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

export async function decryptSnapshotFile(key: CryptoKey, path: string, encrypted: Uint8Array): Promise<Uint8Array> {
  if (encrypted.length < 12 + 16) throw new Error('Encrypted snapshot file is truncated.');
  const iv = encrypted.subarray(0, 12);
  const ciphertext = encrypted.subarray(12);
  const plaintext = await subtleCrypto().decrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: additionalData(path), tagLength: 128 }, key, asArrayBuffer(ciphertext));
  return new Uint8Array(plaintext);
}

function additionalDataV2(path: string, snapshotId: string): ArrayBuffer {
  return asArrayBuffer(encoder.encode(`fundscope-snapshot:2:${snapshotId}:${path}`));
}
export async function encryptSnapshotFileV2(key: CryptoKey, path: string, snapshotId: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ciphertext = await subtleCrypto().encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: additionalDataV2(path, snapshotId), tagLength: 128 }, key, asArrayBuffer(plaintext));
  const result = new Uint8Array(iv.length + ciphertext.byteLength); result.set(iv, 0); result.set(new Uint8Array(ciphertext), iv.length); return result;
}
export async function decryptSnapshotFileV2(key: CryptoKey, path: string, snapshotId: string, encrypted: Uint8Array): Promise<Uint8Array> {
  if (encrypted.length < 12 + 16) throw new Error('Encrypted snapshot file is truncated.');
  const plaintext = await subtleCrypto().decrypt({ name: 'AES-GCM', iv: asArrayBuffer(encrypted.subarray(0, 12)), additionalData: additionalDataV2(path, snapshotId), tagLength: 128 }, key, asArrayBuffer(encrypted.subarray(12)));
  return new Uint8Array(plaintext);
}

export async function gzipBytes(plaintext: Uint8Array): Promise<Uint8Array> {
  if (!('CompressionStream' in globalThis)) throw new Error('Gzip compression is not available in this runtime.');
  const stream = new Blob([asArrayBuffer(plaintext)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (!('DecompressionStream' in globalThis)) throw new Error('Gzip decompression is not available in this runtime.');
  const stream = new Blob([asArrayBuffer(compressed)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await subtleCrypto().digest('SHA-256', asArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const encodeUtf8 = (value: string): Uint8Array => encoder.encode(value);
export const decodeUtf8 = (value: Uint8Array): string => decoder.decode(value);
