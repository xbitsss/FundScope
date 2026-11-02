# Benchmark governance

## Classification

`config/category-map.json` is the versioned allowlist for AMFI category parsing. A parsed fund stores the rule identifier and taxonomy version with its asset class. Unknown categories are quarantined as `other`; they do not inherit an equity classification. The additive `scheme_taxonomy` store records the first classification. Later category or taxonomy-version changes are appended to `taxonomy_conflicts` for review and do not rewrite the original record.

Taxonomy v3 signal states, AMFI-only classification provenance, human review actions and migration snapshots are described in [CLASSIFICATION.md](CLASSIFICATION.md). Benchmark gating rejects both `CONFLICT_STALE` and `CONFLICT` classifications until an explicit review action is recorded.

## Proxy approval

`config/benchmarks.json` is the only production mapping registry. A discovered MFapi scheme is not approved by discovery alone. Before changing a proxy from `unresolved` to `verified`, a reviewer must confirm the exact scheme and option, AMC/source identity, full usable history, plausible history dates, fund/index category fit, NAV and return sanity against an independent reference, and document date, scheme name, ISIN where available, and checks in the `verification` block. MFapi NAV proxies are price-return comparators; do not call them TRI series unless the underlying source establishes that fact. Composite weights must sum to one and composites cannot mix asset classes except the explicitly defined hybrid blend.

Run `pnpm benchmarks:discover --write-report` to produce `config/benchmark-discovery-candidates.json`. It queries MFapi search and histories, throttles requests, and labels every output candidate-only. It never edits the production mapping. Search matches and history checks are not proof of benchmark suitability.

The config validator checks schema version, taxonomy version, unique IDs, verified-only codes, component weights, category mapping classes and override references. Resolution is fail-closed: unmapped, unresolved, cross-class, or quarantined funds cannot produce benchmark metrics. There is no class-wide fallback.

## Regression gate and missing-value outcomes

The worker aligns observed NAV levels on exact UTC epoch-day timestamps, then computes daily returns only between adjacent common dates no more than seven days apart. It requires the selected 1Y/3Y/5Y fund window, at least 200 aligned daily returns, at least 96% of 85%-adjusted expected weekday coverage, current benchmark history (at most ten days behind the fund NAV), and non-zero benchmark variance. Failed checks return explicit reason codes/details; no regression function is exposed outside `domain/benchmarks/gate.ts`.

`domain/governance/reasonMessages.ts` is the shared UI catalog. A null is accompanied by its machine-readable reason and a plain-language explanation. Reason codes distinguish `NO_BENCHMARK`, `NA_CATEGORY`, `INSUFFICIENT_HISTORY`, `DATA_GAPS`, `TOO_FEW_SAMPLES`, and `ZERO_DENOMINATOR`. A benchmark display is green only when regression inputs passed the gate.

## Operational status

The checked-in benchmark entries currently remain unresolved because the project does not have auditable proxy approval evidence. Benchmark metrics therefore stay null. This is an intentional governance result, not an MFapi fetch failure. Approve mappings only after completing and recording the validation above.
