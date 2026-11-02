import { describe, expect, it } from 'vitest';
import { constantTimeEqual, decodeUtf8, decryptSnapshotFile, decryptSnapshotFileV2, deriveSnapshotKey, encodeUtf8, encryptSnapshotFile, encryptSnapshotFileV2, fromBase64, generateSnapshotDek, gzipBytes, gunzipBytes, importSnapshotDek, randomBytes, toBase64, unwrapSnapshotDek, wrapSnapshotDek } from '../../src/adapters/crypto/snapshotCrypto';

describe('encrypted static snapshot crypto', () => {
  it('compares legacy canary bytes with equal and unequal results', () => {
    expect(constantTimeEqual(encodeUtf8('snapshot-canary'), encodeUtf8('snapshot-canary'))).toBe(true);
    expect(constantTimeEqual(encodeUtf8('snapshot-canary'), encodeUtf8('snapshot-canary!'))).toBe(false);
  });
  it('round-trips gzip data with authenticated file paths', async () => {
    const salt = randomBytes(16);
    expect(fromBase64(toBase64(salt))).toEqual(salt);
    const key = await deriveSnapshotKey('fundscope-test-passphrase-2026', salt, 310_000);
    const compressed = await gzipBytes(encodeUtf8('{"scheme_count":3}'));
    const encrypted = await encryptSnapshotFile(key, 'data/index.enc', compressed);
    const decrypted = await decryptSnapshotFile(key, 'data/index.enc', encrypted);
    expect(decodeUtf8(await gunzipBytes(decrypted))).toBe('{"scheme_count":3}');
    await expect(decryptSnapshotFile(key, 'data/changed.enc', encrypted)).rejects.toThrow();
  });

  it('rejects weak passphrases and weak KDF settings', async () => {
    const salt = randomBytes(16);
    await expect(deriveSnapshotKey('short', salt)).rejects.toThrow(/at least 16 characters/);
    await expect(deriveSnapshotKey('fundscope-test-passphrase-2026', salt, 100)).rejects.toThrow(/security minimum/);
  });

  it('wraps a stable non-extractable DEK with a passphrase KEK and binds v2 files to the snapshot id', async () => {
    const salt=randomBytes(16);const kek=await deriveSnapshotKey('fundscope-test-passphrase-2026',salt,100_000);const raw=generateSnapshotDek();const wrapped=await wrapSnapshotDek(kek,'key-123',raw);const unwrapped=await unwrapSnapshotDek(kek,'key-123',wrapped);
    expect(unwrapped.raw).toEqual(raw);expect(await importSnapshotDek(raw)).toMatchObject({extractable:false});
    const encrypted=await encryptSnapshotFileV2(unwrapped.key,'data/index.cols.enc','snapshot-a',encodeUtf8('columnar'));
    expect(decodeUtf8(await decryptSnapshotFileV2(unwrapped.key,'data/index.cols.enc','snapshot-a',encrypted))).toBe('columnar');
    await expect(decryptSnapshotFileV2(unwrapped.key,'data/index.cols.enc','snapshot-b',encrypted)).rejects.toThrow();
    const wrong=await deriveSnapshotKey('different-passphrase-value-2026',salt,100_000);
    await expect(unwrapSnapshotDek(wrong,'key-123',wrapped)).rejects.toThrow();
  });
});
