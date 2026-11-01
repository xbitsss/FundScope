# Classification governance (taxonomy v2)

## Binding data and fail-closed rules

The current production rules are in `config/category-map.json` and `config/passive-rules.json`. Classification first normalizes AMFI category/header labels, applies exact category and subcategory rules, then family rules. Only AMFI passive-family labels may use scheme-name rules. A name match outside those families is never used to infer asset class. Unknown, ambiguous, unmatched, solution-oriented, life-cycle and multi-asset cases remain `other`; the system does not guess an underlying asset class.

`src/domain/taxonomy/navFileParser.ts` parses the full AMFI NAVAll state machine. It retains master rows even when NAV/date is `N.A.`, records rejected and duplicate rows, and rejects a source-shape change if fewer than 80% of semicolon-shaped rows parse. `refreshCatalog` persists all rows to `scheme_master`; only rows with valid NAV/date enter the active fund catalog.

## Independent signals and review states

- **S1:** category, structure and current NAV from AMFI NAVAll; this is the binding category source.
- **S2:** MFapi `scheme_category` from the fetched scheme history.
- **S3:** dated `SchemeCat_Desc` from AMFI TER disclosures, attached only after a unique AMC/name join; source mappings are recorded.
- **S4:** peer plausibility flags computed from local NAV/benchmark data. S4 can flag a record but never changes its class.
- **S5:** human SID audit results imported through the Classification screen.

The consensus engine marks mapped S1 classifications `UNCONFIRMED` until another source agrees, `CONFIRMED` when an independent source agrees, and `CONFLICT_STALE` or `CONFLICT` when a mapped signal disagrees. Repeated conflict evidence spanning at least three days becomes `CONFLICT`. Both conflict states suppress benchmark-relative outputs until a reviewer acts. `Accept S1` is recorded as a local review decision; `Rebind Other` is an explicit user binding. Neither action silently changes the rule configuration.

## SQLite and browser persistence

Tauri stores fund payloads in `schemes`, full master rows in `scheme_master`, and immutable current bindings/provenance in `scheme_taxonomy`. `scheme_category_history`, `taxonomy_conflicts`, `unmapped_categories`, `unmapped_category_members`, `classification_audit` and `source_scheme_map` preserve source observations, migrations and decisions. Before taxonomy v2 migration, the runtime snapshots the old `schemes` and `scheme_taxonomy` tables. Taxonomy version bumps are recorded as conflicts before updating the binding.

The browser preview uses IndexedDB equivalents and makes a one-time backup of existing stores during database upgrade. Application startup performs idempotent setup and backfills stored funds into taxonomy provenance. Apply `src/adapters/sqlite/migrations/0003_classification_v2.sql` only to a schema where `scheme_taxonomy` already exists; runtime initialization handles additive column checks for existing SQLite files.

## Audit workflow

The Classification page downloads a stratified SID review CSV with AMFI, MFapi, TER and current-class context. Fill in `sid_category`, `sid_url`, and `expected_class`, then import that completed CSV in the app. The app records the comparison against the bound class in local SQLite/IndexedDB and reports agreements and disagreements. No audit agreement rate is claimed until reviewed rows have actually been imported.

For offline files, `pnpm classify:audit-sample --input <funds.json> [--output sample.csv]` creates a stratified candidate file. `pnpm classify:audit-import --input <completed.csv> [--output report.json]` validates rows and writes a pre-import summary; the app's Classification page persists them. The commands do not contact AMFI. `pnpm classify:report` is the live, read-only category inventory command and requires network access.

## Plausibility checks and limits

S4 flags are calculated only for open-ended Growth schemes with at least one year of NAV observations. Robust median/MAD peer checks require the configured minimum group size. They report unusual volatility, low equity/hybrid market correlation and class-level volatility mismatches. They do not reclassify a scheme or fabricate holdings. The current run is local to the loaded peer universe and the benchmark proxies available on the device.

The implementation does not manufacture a SEBI agreement percentage, confirm rule interpretation without source evidence, or claim that every SID audit has been completed. Review unresolved categories and run the human audit workflow before treating the classifier as fully audited.
