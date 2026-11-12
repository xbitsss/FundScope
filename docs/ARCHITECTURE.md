# FundScope runtime architecture

## Hosted static app

GitHub Pages serves the Vite app, a nightly generated encrypted snapshot, and a hand-written service worker. The service worker revalidates the small manifest and caches same-origin hashed assets and snapshot files. Snapshot files use content-specific snapshot paths so a deployed update does not overwrite bytes in place. The page registers the worker under the Vite base path; it does not force a reload during an interaction.

At page load, the browser starts the manifest and index fetch and warms the unlock module worker. The unlock worker runs PBKDF2, unwraps the v2 DEK (or checks the v1 canary), decrypts and gunzips the index, and decodes the compact columnar format. The hosted gate passes the resulting initial funds directly to the app; it skips repository initialization and the previous whole-catalog IndexedDB replacement/read cycle. A device session can unwrap the stable DEK on a return visit. Browser storage failures leave the passphrase path available.

The columnar index stores dictionaries and typed columns for list, facet, and metric values; NAV history and provenance/detail fields remain in per-scheme files. Fund details and histories are fetched on demand. The screener index is built in a separate worker, which returns typed row indices and facet counts; React only materializes the visible virtual row window for the table.

## Local desktop app

Tauri keeps SQLite as its local data store. Migration 0004 creates an indexed `fund_list` table for list/facet values, `fund_metrics` for typed nullable metric values and reason codes, `fund_detail` for lazy provenance JSON, and an index on the existing `(scheme_code,date)` NAV table. `schema_meta.normalized_fund_storage_v4` records completion. The migration copies the old JSON payload table to `schemes_typed_v4_backup`, projects each saved fund into typed rows inside a SQLite transaction, checks the migrated row count, then removes the duplicate live payload table. A failed migration rolls back and keeps the payload table; a successful migration keeps the backup for recovery.

The first migration runs in the background while the app can read the old payloads. Later launches read only typed list and metric columns; they do not parse a JSON payload per scheme. Details are read by code when a fund drawer opens, and NAV points are read from the normalized history table. The desktop reader encodes the typed list into the existing compact columnar format and transfers its buffer to the screener worker, which decodes and indexes it away from React. Metric-only recomputes use a separate transaction and do not rewrite list/detail columns. The hosted encrypted snapshot path remains separate and unchanged.

## Integrity and missing values

The manifest includes each file's ciphertext hash and byte length. The reader checks both before decryption. V2 AES-GCM additional data binds the encrypted file to its relative path and snapshot ID. Missing measurements remain null and retain their reason codes; the codec does not synthesize values for absent metrics.

## Performance boundary

The local Node benchmark measures only deterministic filter-core work. It does not represent phone CPU throttling, worker transfer, browser paint, scroll frame rate, memory pressure, or network. First download time depends on the user's network. See [`PERF_2026-11-13.md`](PERF_2026-11-13.md) for the measured data and limitations.

## Applied filter chips

`src/ui/filters/AppliedFilters.tsx` is shared by the screener summary strip and the mobile filter sheet. It shows one chip per active facet, opens a list of removable values, and uses the same `FilterChip` primitive for the small tokens inside facet cards. Chips wrap; a measured row fitter reserves room for the `+N more` and `Clear all` controls. The expanded list grows with the page instead of creating a nested scroller. The live region remains mounted when the last chip is removed so additions, removals, result counts, and the undo message can still be announced. Clear all saves the current filter state for a five-second undo window.

## Compare scatter calculations

`src/domain/scatter/quadrants.ts` owns direction, threshold, tie, quadrant, and percentile rules without React or DOM dependencies. A threshold is calculated from plotted pairs in the chosen scope; peer median means the median of the per-sub-category medians. Exact threshold ties belong to the better side for a higher/lower metric, and to the high side for a no-preference metric. If either axis has no preference, all four quadrants stay neutral and the UI does not call one best or avoid.

`src/domain/scatter/scatterQuery.ts` runs through the existing screener worker. It scopes the loaded catalogue, counts paired axis coverage, excludes funds missing either selected value, and returns typed arrays, reason counts, thresholds, direction-aware ranks, selected flags, and outlier bounds. Missing measurements are never filled. UI request sequence guards prevent an older response from replacing a newer selection. The canvas draws dense points, SVG supplies labels and keyboard navigation, and a virtual row table provides the text alternative and CSV export. PNG and CSV exports are created locally in the browser.

Scatter preferences are stored in local state and `localStorage`, and saved screens now serialize version 3. Version 2 screens remain readable and receive default scatter settings when loaded.
