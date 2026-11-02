# FundScope runtime architecture

## Hosted static app

GitHub Pages serves the Vite app, a nightly generated encrypted snapshot, and a hand-written service worker. The service worker revalidates the small manifest and caches same-origin hashed assets and snapshot files. Snapshot files use content-specific snapshot paths so a deployed update does not overwrite bytes in place. The page registers the worker under the Vite base path; it does not force a reload during an interaction.

At page load, the browser starts the manifest and index fetch and warms the unlock module worker. The unlock worker runs PBKDF2, unwraps the v2 DEK (or checks the v1 canary), decrypts and gunzips the index, and decodes the compact columnar format. The hosted gate passes the resulting initial funds directly to the app; it skips repository initialization and the previous whole-catalog IndexedDB replacement/read cycle. A device session can unwrap the stable DEK on a return visit. Browser storage failures leave the passphrase path available.

The columnar index stores dictionaries and typed columns for list, facet, and metric values; NAV history and provenance/detail fields remain in per-scheme files. Fund details and histories are fetched on demand. The screener index is built in a separate worker, which returns typed row indices and facet counts; React only materializes the visible virtual row window for the table.

## Local desktop app

Tauri continues to use the existing local repository and SQLite persistence APIs. The columnar static snapshot path is specific to the hosted web gate. A normalized SQLite `schemes`/`detail` table migration and direct SQL-to-typed-array desktop path are still future work; desktop startup currently retains the payload repository.

## Integrity and missing values

The manifest includes each file's ciphertext hash and byte length. The reader checks both before decryption. V2 AES-GCM additional data binds the encrypted file to its relative path and snapshot ID. Missing measurements remain null and retain their reason codes; the codec does not synthesize values for absent metrics.

## Performance boundary

The local Node benchmark measures only deterministic filter-core work. It does not represent phone CPU throttling, worker transfer, browser paint, scroll frame rate, memory pressure, or network. First download time depends on the user's network. See [`PERF_2026-11-02.md`](PERF_2026-11-02.md) for the measured data and limitations.
