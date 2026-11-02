import type { Fund } from '../../domain/types';
import type { SnapshotManifest } from './types';
import { constantTimeEqual, decodeUtf8, decryptSnapshotFile, decryptSnapshotFileV2, deriveSnapshotKey, encodeUtf8, fromBase64, gunzipBytes, unwrapSnapshotDek } from '../crypto/snapshotCrypto';
import { decodeFundColumns } from './columnar';
import { saveDeviceSession, type DeviceSession } from './deviceSession';

type UnlockRequest = { type: 'unlock'; passphrase: string; manifest: SnapshotManifest; index: ArrayBuffer; canary?: ArrayBuffer; remember?: boolean; rememberDays?: number | null };
type RestoreRequest = { type: 'restore'; manifest: SnapshotManifest; index: ArrayBuffer; session: DeviceSession };
type UnlockResponse = { type: 'success'; funds: Fund[]; key: CryptoKey; timings: Record<string, number>; remembered: boolean } | { type: 'error'; message: string };

self.addEventListener('message', (event: MessageEvent<UnlockRequest | RestoreRequest>) => {
  if (event.data?.type !== 'unlock' && event.data?.type !== 'restore') return;
  void (async () => {
    const marks: Record<string, number> = {};
    try {
      const { manifest, index } = event.data;
      const progress = (phase: string) => { if (event.data.type === 'unlock') self.postMessage({ type: 'progress', phase }); };
      const mark = (name: string, start: number) => { marks[name] = performance.now() - start; };
      let key: CryptoKey;
      let rawDek: Uint8Array | undefined;
      if (event.data.type === 'restore') {
        if (manifest.schema_version !== 2 || manifest.encryption.keyId !== event.data.session.keyId) throw new Error('The saved device key does not match this snapshot.');
        const unwrapped = await unwrapSnapshotDek(event.data.session.key, event.data.session.keyId, event.data.session.wrappedDek);
        rawDek = unwrapped.raw;
        key = unwrapped.key;
        marks.unwrap = 0;
      } else {
        let start = performance.now();
        progress('Deriving key…');
        const kek = await deriveSnapshotKey(event.data.passphrase, fromBase64(manifest.encryption.salt), manifest.encryption.iterations);
        mark('kdf', start);
        if (manifest.schema_version === 2) {
          progress('Checking passphrase…');
          start = performance.now();
          try {
            const unwrapped = await unwrapSnapshotDek(kek, manifest.encryption.keyId!, manifest.encryption.wrappedDek!);
            key = unwrapped.key; rawDek = unwrapped.raw;
          } catch { throw new Error('Incorrect passphrase.'); }
          mark('unwrap', start);
        } else {
          key = kek;
          if (!event.data.canary) throw new Error('Snapshot canary is missing.');
          const canary = decodeUtf8(await decryptSnapshotFile(key, manifest.encryption.canary!.path, new Uint8Array(event.data.canary)));
          if (!constantTimeEqual(encodeUtf8(canary), encodeUtf8('FundScope snapshot canary:v1'))) throw new Error('Incorrect passphrase or damaged snapshot.');
        }
      }
      progress('Decrypting snapshot…');
      let start = performance.now();
      const compressed = manifest.schema_version === 2
        ? await decryptSnapshotFileV2(key, manifest.index.path, manifest.snapshot_id ?? '', new Uint8Array(index))
        : await decryptSnapshotFile(key, manifest.index.path, new Uint8Array(index));
      const unpacked = await gunzipBytes(compressed);
      mark('decrypt', start);
      progress('Loading fund list…');
      start = performance.now();
      let funds: Fund[];
      if (manifest.schema_version === 2) funds = decodeFundColumns(unpacked);
      else {
        const value: unknown = JSON.parse(decodeUtf8(unpacked));
        if (!Array.isArray(value)) throw new Error('Snapshot index is not an array.');
        funds = value.map((item) => {
          if (!item || typeof item !== 'object' || !Number.isInteger((item as Fund).code)) throw new Error('Snapshot contains an invalid fund record.');
          return { ...(item as Fund), history: Array.isArray((item as Fund).history) ? (item as Fund).history : [] };
        });
      }
      if (funds.length !== manifest.fund_count) throw new Error('Snapshot fund count does not match its manifest.');
      mark('decode', start);
      let remembered = false;
      if (event.data.type === 'unlock' && event.data.remember && manifest.schema_version === 2 && rawDek) {
        remembered = await saveDeviceSession(manifest.encryption.keyId!, rawDek, event.data.rememberDays ?? 30);
      }
      rawDek?.fill(0);
      const response: UnlockResponse = { type: 'success', funds, key, timings: marks, remembered };
      self.postMessage(response);
    } catch (error) {
      const response: UnlockResponse = { type: 'error', message: error instanceof Error ? error.message : 'Snapshot data could not be unlocked.' };
      self.postMessage(response);
    }
  })();
});
