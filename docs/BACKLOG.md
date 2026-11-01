# Backlog

- Verify and integrate AMFI TER responses, monthly snapshot semantics, and audited fund-name/AMC/plan matching.
- Verify a scheme-level AUM feed and its precise definition/date (point AUM vs average AUM).
- Complete independent review for candidate MFapi proxy series and record evidence in `config/benchmarks.json`; until then, proxy-dependent metrics remain gated with explicit `NO_BENCHMARK` reasons.
- Measure filter-scoped NAV storage size and MFapi completion/rate-limit behavior on Windows. The UI queues missing/stale histories only for schemes in the active screener universe, persists each batch, and supports pause/resume; proxy, disclosure, and holdings fields still require their own verified sources.
- Complete growth, rolling-return and drawdown charts; synchronized compare crosshair and chart data tables.
- Saved score models/screens in SQLite; table columns chooser and per-condition result histograms/facets.
- Backup/restore, CSV benchmark import, diagnostics export and data reset.
- Add unit/golden/property tests, performance measurements on the real default universe, accessibility review and M8 UX walkthrough.
