import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { deriveSnapshotKey, encodeUtf8, encryptSnapshotFile, encryptSnapshotFileV2, generateSnapshotDek, gzipBytes, importSnapshotDek, randomBytes, sha256Hex, toBase64, wrapSnapshotDek } from '../../src/adapters/crypto/snapshotCrypto';
import { loadSnapshotHistories, lockSnapshot, unlockSnapshot } from '../../src/adapters/snapshot/browserReader';
import { encodeFundColumns } from '../../src/adapters/snapshot/columnar';

afterEach(() => {
  lockSnapshot();
  vi.unstubAllGlobals();
});

describe('static snapshot reader', () => {
  it('unlocks the encrypted catalog and lazily reads an integrity-checked NAV pack', async () => {
    const salt = randomBytes(16);
    const key = await deriveSnapshotKey('fundscope-browser-test-passphrase', salt, 310_000);
    const encryptedFiles = new Map<string, Uint8Array>();
    async function encryptedRef(path: string, plaintext: string) {
      const compressed = await gzipBytes(encodeUtf8(plaintext));
      const bytes = await encryptSnapshotFile(key, path, compressed);
      encryptedFiles.set(`/FundScope/${path}`, bytes);
      return { path, sha256: await sha256Hex(bytes), encryptedBytes: bytes.byteLength, compressedBytes: compressed.byteLength, plaintextBytes: plaintext.length };
    }
    const canaryPath = 'data/canary.enc';
    const canaryBytes = await encryptSnapshotFile(key, canaryPath, encodeUtf8('FundScope snapshot canary:v1'));
    encryptedFiles.set(`/FundScope/${canaryPath}`, canaryBytes);
    const canary = { path: canaryPath, sha256: await sha256Hex(canaryBytes), encryptedBytes: canaryBytes.byteLength, compressedBytes: 0, plaintextBytes: 28, plaintext: 'FundScope snapshot canary:v1' as const };
    const index = await encryptedRef('data/index.enc', JSON.stringify([{ code: 123, name: 'Example Fund', history: [] }]));
    const history = await encryptedRef('data/nav/123.enc', JSON.stringify([{ date: 20000, nav: 10 }, { date: 20001, nav: 11 }]));
    const manifest = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      data_as_of: 20001 * 86_400_000,
      fund_count: 1,
      history_count: 1,
      encryption: { algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 310_000, salt: toBase64(salt), canary },
      index,
      histories: { '123': history },
    };
    vi.stubGlobal('location', new URL('https://scope.test/'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/FundScope/data/manifest.json') return new Response(JSON.stringify(manifest), { status: 200 });
      const file = encryptedFiles.get(url.pathname);
      return file ? new Response(Uint8Array.from(file).buffer as ArrayBuffer, { status: 200 }) : new Response('', { status: 404 });
    }));

    const unlocked = await unlockSnapshot('fundscope-browser-test-passphrase', 'https://scope.test/FundScope/');
    expect(unlocked.funds).toEqual([{ code: 123, name: 'Example Fund', history: [] }]);
    await expect(loadSnapshotHistories([123])).resolves.toEqual(new Map([[123, [{ date: 20000, nav: 10 }, { date: 20001, nav: 11 }]]]));
    const callsAfterFirstLoad = vi.mocked(fetch).mock.calls.length;
    const cached = await loadSnapshotHistories([123]);
    expect(cached.loaded).toEqual(new Map([[123, [{ date: 20000, nav: 10 }, { date: 20001, nav: 11 }]]]));
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterFirstLoad);
    const missing = await loadSnapshotHistories([999]);
    expect(missing.loaded.size).toBe(0);
    expect(missing.unavailable).toEqual([999]);
    expect(missing.failed).toEqual([]);
    const tampered = Uint8Array.from(encryptedFiles.get('/FundScope/data/nav/123.enc')!);
    tampered[0] ^= 1;
    const tamperedPath = 'data/nav/123-tampered.enc';
    encryptedFiles.set(`/FundScope/${tamperedPath}`, tampered);
    manifest.histories['123'] = { ...history, path: tamperedPath, sha256: await sha256Hex(tampered) };
    manifest.generated_at = new Date(Date.now() + 1000).toISOString();
    lockSnapshot();
    await unlockSnapshot('fundscope-browser-test-passphrase', 'https://scope.test/FundScope/');
    const failed = await loadSnapshotHistories([123]);
    expect(failed.loaded.size).toBe(0);
    expect(failed.failed[0]?.code).toBe(123);
  });

  it('unlocks a v2 KEK/DEK columnar snapshot without IndexedDB catalogue writes', async () => {
    const passphrase = 'generated-test-passphrase-2026';
    const salt = randomBytes(16);
    const kek = await deriveSnapshotKey(passphrase, salt, 100_000);
    const keyId = 'test-key-id';
    const rawDek = generateSnapshotDek();
    const wrappedDek = await wrapSnapshotDek(kek, keyId, rawDek);
    const dek = await importSnapshotDek(rawDek);
    const snapshotId = 'snapshot-test-id';
    const fund: Fund = {
      code: 987, isinGrowth: null, isinReinvestment: null, name: 'Columnar Fund', amc: 'Test AMC', category: 'Equity',
      assetClass: 'equity', classRuleId: 'TEST', taxonomyVersion: 3, subCategory: 'Flexi Cap', structure: 'open',
      plan: 'Direct', option: 'Growth', nav: 12.3, navDate: 20_500, history: [], metrics: { cagr_1y: 12.3 },
      management: 'Active', group: 'Diversified', riskBand: 'High', philosophy: 'Blend/Unspecified', speciality: [], lifecycle: 'active',
    };
    const path = `data/${snapshotId}/index.cols.enc`;
    const compressed = await gzipBytes(encodeFundColumns([fund]));
    const encrypted = await encryptSnapshotFileV2(dek, path, snapshotId, compressed);
    const index = { path, sha256: await sha256Hex(encrypted), encryptedBytes: encrypted.byteLength, compressedBytes: compressed.byteLength, plaintextBytes: compressed.byteLength };
    const manifest = {
      schema_version: 2, snapshot_id: snapshotId, generated_at: new Date().toISOString(), data_as_of: null,
      fund_count: 1, history_count: 0, encryption: { version: 2, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 100_000, salt: toBase64(salt), keyId, wrappedDek },
      index, details: {}, histories: {},
    };
    vi.stubGlobal('location', new URL('https://scope.test/'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/FundScope/data/manifest.json') return new Response(JSON.stringify(manifest), { status: 200 });
      if (url.pathname === `/FundScope/${path}`) return new Response(Uint8Array.from(encrypted).buffer as ArrayBuffer, { status: 200 });
      return new Response('', { status: 404 });
    }));
    const unlocked = await unlockSnapshot(passphrase, 'https://scope.test/FundScope/');
    expect(unlocked.funds).toHaveLength(1);
    expect(unlocked.funds[0]).toMatchObject({ code: 987, name: 'Columnar Fund', history: [] });
    expect(unlocked.funds[0]!.metrics.cagr_1y).toBeCloseTo(12.3, 5);
    await expect(unlockSnapshot('incorrect-test-passphrase-2026', 'https://scope.test/FundScope/')).rejects.toThrow('Incorrect passphrase.');
  });
});
