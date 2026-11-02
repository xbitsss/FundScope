# Build status

## Milestone 0 · Data-source spike — complete

- **Built:** Live-source notes, AMFI parser fixture and MFapi search fixture.
- **Verified:** AMFI eight-column format; MFapi catalog, search and latest endpoint; `startDate` / `endDate` are ignored in the tested request; no validated AUM or benchmark series.
- **Risk:** TER endpoint probe returned HTTP 500. AUM and TER remain unavailable. See `DATA_SOURCES.md`.

## Milestone 1 · Scaffold — partial

- **Built:** React/Vite/strict TypeScript frontend, Tauri 2 shell, SQLite plugin, source-domain types, registry, app layers, exact dependency pins and CI-friendly check/test scripts.
- **Verified:** `pnpm test` and `pnpm check` pass; Tauri JSON configuration parses.
- **Risk:** Rust and Cargo are absent on the build host, so Windows Tauri launch/installer and Rust permission compilation are not verified.

## Milestone 2 · Ingestion — partial

- **Built:** AMFI parser, zod-validated MFapi payload parsing, SQLite repository, batched catalog persistence, and three-worker historical NAV batches for the next 100 funds in the current view.
- **Verified:** AMFI parser tests pass; refresh failure preserves cached rows.
- **Risk:** There is no opt-in continuous full-universe queue, retry/backoff stage machine, source detail table for MFapi failures, or real in-app backfill measurement.

### One-shot repair update · 1 November 2026

- Added persisted history status fields, deterministic retry/backoff queue ordering, no-starvation ordering, and a >20% attempted-fetch quality gate. The queue is unit-tested; a complete nightly coverage run still requires the GitHub Actions data secret and live MFapi responses.

## Milestone 3 · Metrics — partial

- **Built:** Central registry, NAV-only CAGR, rolling consistency, configurable 1Y/3Y/5Y risk windows, and risk-adjusted calculations with nulls for sparse histories; benchmark-dependent inputs remain unavailable.
- **Verified:** Sparse histories render null rather than a zero; metric tests pass.
- **Risk:** Metric reason codes, worker execution, golden/property tests and coverage validation are outstanding. Rolling consistency uses the configured hurdle and sampled 21-observation steps.

## Milestone 4 · Store, screening and scoring — partial

- **Built:** Local cache, plan/option/category/AMC/name and numeric filters, sorting, compare selection, weighted peer percentiles.
- **Verified:** Frontend check passes. Scoring core is pure and shared by the Screener and Score Lab.
- **Risk:** Dataset performance budgets, facets/histograms, comprehensive dimensions/columns, score-model persistence and full missing-value policies are outstanding.

### One-shot repair update · 1 November 2026

- Facet counts, structured filter state, v2 saved screens, disabled zero-count options and the Open/Closed/Interval control are now implemented and tested. The remaining risk is a production measurement of full-universe latency.

## Milestone 5 · Screener — partial

- **Built:** Filter rail, metric picker, saved-screen local persistence, freshness pill, sortable results, density setting, CSV export and empty/error states.
- **Verified:** Vite production build passes.
- **Risk:** Virtualization, undo actions, customizable columns, histogram controls and keyboard shortcuts are outstanding. The current table has independent horizontal/vertical scrolling and sticky identification columns.

### One-shot repair update · 1 November 2026

- Phone widths now use card results, a bottom tab bar, a full-width filter sheet and hidden page scrollbars. Desktop table virtualization remains the primary desktop result path.

## Milestone 6 · Detail and Compare — partial

- **Built:** Fund detail drawer, compare tray, growth chart, risk/return plot and metric comparison table.
- **Verified:** The frontend compiles with empty-history states.
- **Risk:** Rolling-return and drawdown charts, benchmark overlays, synchronized crosshair, chart data tables and compare best-value highlights are not complete.

## Milestone 7 · Score Lab — partial

- **Built:** Factor selection, editable weights/directions, peer-group label, live relative ranking and apply-to-screener flow.
- **Verified:** Shared score calculation is deterministic for a fixed input order and data set.
- **Risk:** Saved models, exact per-factor contribution UI, missing-value policy choices and coverage warnings need completion.

## Milestone 8 · Health, settings and polish — partial

- **Built:** Source freshness/detail view, actual metric coverage percentages, basic theme/risk-rate/density settings and disclaimer.
- **Verified:** Typecheck, test suite, production bundle, whitespace check and Tauri JSON parse passed.
- **Risk:** Backup/restore, default-universe completion and packaging remain outstanding.

## Milestone 9 · AMFI taxonomy and classification governance — implementation complete; live measurement pending

- **Built:** Versioned taxonomy v3 in `config/taxonomy-tree.json`; AMFI Scheme Master parser, retrying refresh fetch, scheme-code/ISIN joins, lifecycle fields and S0 primary/S1 fallback classification; AMFI TER/AAUM corroboration; MFapi S2 retained as informational history metadata only; fail-closed raw category rules with specific reason codes; governance review queue grouped by reason and active/dormant lifecycle, copyable review stubs, all-unclassified CSV export, field provenance in fund details, S5 audit import, and taxonomy coverage CI test against the offline C0 inventory.
- **Verified locally:** `pnpm check` passes (TypeScript, production Vite bundle, 103 raw-category coverage cases); `pnpm test` passes (173 tests across 17 files).
- **Not measured:** The live source pull failed DNS resolution on 2 November 2026. The checked-in inventory has 14,441 historical S1 rows and 101 category strings, but no active counts or sample names. Therefore current AMFI Scheme Master join rate, category totals, dormant split, active Unclassified percentage, and change from the historical user-reported 5,612 are unknown. No target attainment is claimed from the offline fixture.
- **Pending:** Refresh a live inventory and review the scheme-level joins, then import human SID checks. Agreement rates remain unclaimed until actual audit rows are imported.
- **Mobile audit pending:** Existing fluid layout, bottom tabs, filter sheet, card results and viewport metadata were source-reviewed, and the rigid app-shell minimum width was removed. The requested Playwright viewport/route/overlay run remains unverified because Playwright/browser installation is unavailable in this environment.
