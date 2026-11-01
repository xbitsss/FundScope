# Backlog

- Finish production coverage monitoring for paginated AMFI TER records and manual review of the AMC/name/category joins; rows without a unique join stay unmatched.
- Monitor AMFI quarterly average AUM source dates and distinguish average AUM from point-in-time AUM in the UI.
- Complete independent review for candidate MFapi proxy series and record evidence in `config/benchmarks.json`; until then, proxy-dependent metrics remain gated with explicit `NO_BENCHMARK` reasons.
- Measure filter-scoped NAV storage size and MFapi completion/rate-limit behavior on Windows. The UI queues missing/stale histories only for schemes in the active screener universe, persists each batch, and supports pause/resume; proxy, disclosure, and holdings fields still require their own verified sources.
- Complete growth, rolling-return and drawdown charts; synchronized compare crosshair and chart data tables.
- Saved score models/screens in SQLite; table columns chooser and per-condition result histograms/facets.
- Backup/restore, CSV benchmark import, diagnostics export and data reset.
- Add golden/property tests, performance measurements on the real default universe, accessibility review and M8 UX walkthrough. Core unit tests now cover AMFI parsing, v2 taxonomy, consensus and audit CSV behavior.
- Complete the stratified SID audit with human-reviewed Scheme Information Documents; agreement rates remain unclaimed until imported evidence exists.
