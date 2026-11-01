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

## Milestone 3 · Metrics — partial

- **Built:** Central registry, NAV-only CAGR, rolling consistency, configurable 1Y/3Y/5Y risk windows, and risk-adjusted calculations with nulls for sparse histories; benchmark-dependent inputs remain unavailable.
- **Verified:** Sparse histories render null rather than a zero; metric tests pass.
- **Risk:** Metric reason codes, worker execution, golden/property tests and coverage validation are outstanding. Rolling consistency uses the configured hurdle and sampled 21-observation steps.

## Milestone 4 · Store, screening and scoring — partial

- **Built:** Local cache, plan/option/category/AMC/name and numeric filters, sorting, compare selection, weighted peer percentiles.
- **Verified:** Frontend check passes. Scoring core is pure and shared by the Screener and Score Lab.
- **Risk:** Dataset performance budgets, facets/histograms, comprehensive dimensions/columns, score-model persistence and full missing-value policies are outstanding.

## Milestone 5 · Screener — partial

- **Built:** Filter rail, metric picker, saved-screen local persistence, freshness pill, sortable results, density setting, CSV export and empty/error states.
- **Verified:** Vite production build passes.
- **Risk:** Virtualization, undo actions, customizable columns, histogram controls and keyboard shortcuts are outstanding. The current table has independent horizontal/vertical scrolling and sticky identification columns.

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

## Milestone 9 · AMFI taxonomy and classification governance — implementation complete; audit pending

- **Built:** Production taxonomy v2 rules and passive-family constraints; fail-closed category normalization; AMFI NAVAll master-row parser with N.A. NAV retention and feed-shape diagnostics; S1/S2/S3 reconciliation; local taxonomy migrations, provenance/history, unmapped summaries, drift/conflict and human-decision audit; S4 plausibility flags; screener filters, detail provenance and Classification governance UI; SID sample download/import; offline audit CLI commands.
- **Verified:** 30 unit tests pass; TypeScript project checks and production Vite build pass; audit command help paths run without network access.
- **Pending:** A human must complete and import the stratified SID review. The live AMFI category report could not be refreshed in this environment because network DNS access was unavailable. No independent audit agreement percentage is claimed.
