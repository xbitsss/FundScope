# Decisions

## ADR-001: Start with evidence, not bundled sample data

- **Context:** The workspace had no app scaffold and the product depends on sources that can change or fail.
- **Decision:** Complete a live source spike before app code. Fixtures are test-only. Production starts empty and refreshes from AMFI/MFapi.
- **Consequences:** A first launch needs network access before there are cached funds; later offline launches can use the local database. Fields whose sources are unverified stay unavailable.

## ADR-002: Client-side history range slicing

- **Context:** MFapi's tested `startDate` and `endDate` query returned records dated well outside the requested range.
- **Decision:** Cache validated full histories and apply date windows locally.
- **Consequences:** First backfill may transfer more data. It remains deterministic and avoids silently truncated/incorrect history.

## ADR-003: Do not guess TER, AUM, or benchmark joins

- **Context:** TER family rows have no direct AMFI scheme code, AUM feed was not verified, and no benchmark series/proxy passed a sanity check.
- **Decision:** Keep these metrics explicitly unavailable until a source and join strategy are demonstrated.
- **Consequences:** Some requested filters/scores are disabled or null with explanations in the MVP, while NAV-only analysis remains usable.

## ADR-004: Scaffold and dependency versions

- **Context:** The product needs an offline desktop shell and strict frontend build with reproducible packages.
- **Decision:** React 18.3.1, TypeScript 5.9.3, Vite 7.3.7, Tauri 2.12.2, Tauri SQL 2.5.0, Tauri HTTP 2.8.2, Zustand 5.0.15, Zod 4.6.6, Vitest 3.2.7, pnpm 12.11.2. Use SQLite in Tauri; the browser preview uses IndexedDB.
- **Consequences:** Exact versions are in `package.json` and `pnpm-lock.yaml`. Desktop launch is unverified on this host because Rust is not installed. The web preview is useful for UI development but network refresh requires the Tauri HTTP plugin if the browser blocks cross-origin requests.

## ADR-005: Taxonomy v2 begins with live category discovery

- **Context:** The taxonomy prompt explicitly requires observing current AMFI labels before changing the classifier. A live read-only C0 run observed 101 exact category strings across 14,441 scheme rows and found multiple plural, legacy and post-2026 labels that the v1 map does not cover.
- **Decision:** Add a standalone `classify:report` discovery command, real source-shape fixtures, and a separately named `category-map-v2-draft.json`. Do not change the production taxonomy version or bound asset classes in C0. Unknown and ambiguous observations remain `other` in any future classifier until an evidence-backed rule is approved.
- **Consequences:** The report is repeatable against the live feed; fixtures retain trimmed real examples for parser work. Passive name outcomes remain candidates only. The official SEBI page metadata was verified, but its linked circular body was not readable during this milestone, so the prompt's detailed regulatory interpretation is not recorded as established fact.

## ADR-006: Fail-closed taxonomy v2 with persisted provenance (superseded by ADR-007)

- **Context:** C0 observed current AMFI category labels, including plural/legacy variants, passive families and categories that do not identify a single asset class. The app also needs to distinguish source disagreement from a source outage and preserve local review decisions.
- **Decision:** Promote a versioned v2 rule file with normalization aliases and narrowly scoped passive-name rules. Unknown and ambiguous outcomes remain `other`. Keep AMFI NAVAll as S1 binding category, record MFapi/AMFI TER as dated S2/S3 signals, gate benchmark-relative outputs on conflicts, and persist observations, unmapped summaries, source mappings, migration snapshots and human audit records locally.

## ADR-007: AMFI-only taxonomy v3 with Scheme Master priority

- **Status:** Accepted; supersedes ADR-006 source-voting rules.
- **Decision:** Use AMFI Scheme Master as S0 primary when its category is specific, NAVAll as S1 fallback, and AMFI TER/AAUM as corroborating sources. MFapi category metadata is informational only and never participates in classification or conflict votes. Keep unknown cases Unclassified with specific reason codes, preserve human review records, and derive the category tree, facets, category-implied risk bands and 90-day dormant threshold from `config/taxonomy-tree.json`.
- **Evidence limit:** A new live inventory is required before reporting current join rates, active Unclassified share, or current counts. The checked-in C0 fixture is historical and contains no active counts or scheme names.
- **Consequences:** Category and rule changes are traceable; current status and conflicts are visible in a dedicated governance page. Classification is not represented as independently audited until real SID rows are reviewed and imported. Source timestamps and join method/confidence remain attached to reconciliation records.
