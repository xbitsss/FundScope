import { describe, expect, it } from 'vitest';
import { decodeUtf8, decryptSnapshotFile, deriveSnapshotKey, encodeUtf8, encryptSnapshotFile, fromBase64, gzipBytes, gunzipBytes, randomBytes, toBase64 } from '../../src/adapters/crypto/snapshotCrypto';

describe('encrypted static snapshot crypto', () => {
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
});
