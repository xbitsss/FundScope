# Classification governance (taxonomy v3)

## Authoritative inputs

Classification is sourced from AMFI only. `config/taxonomy-tree.json` is the v3 source of truth for the tree, aliases, facets, category-implied risk bands, and dormant NAV threshold.

- **S0 · AMFI Scheme Master:** primary category, scheme type, launch/closure dates, ISIN and scheme-code join.
- **S1 · AMFI NAVAll:** fallback category/header, structure, plan, option and daily NAV. S1 becomes primary when S0 is absent or generic.
- **S3 · AMFI TER** and **S4 · AMFI AAUM:** AMFI category observations that corroborate S0/S1 where the scheme mapping is sufficiently specific.
- **S2 · MFapi:** NAV-history metadata only. Its free-text category is retained for transparency and never votes, sets a leaf, creates a conflict, or confirms a class.
- **S5 · Human SID audit:** reviewer-provided evidence; importing an audit records agreement or disagreement without silently rewriting rule configuration.

`src/domain/parse/amfiSchemeMaster.ts` parses the public Scheme Master CSV with header aliases, quoting/BOM support, date validation and a minimum parsed-row shape check. Refresh joins by scheme code, then ISIN, and reports join rate and both orphan sets in source status. If the file shape changes or the request fails, the catalog refresh continues with S1 and preserves cached S0 records; it does not make up S0 fields.

`src/domain/taxonomy/classifyV3.ts` classifies categories from explicit AMFI family and leaf rules. Name keywords are a fallback only for AMFI-labelled Index, ETF and FoF categories where the AMFI category does not identify the underlying. Unresolved records remain `assetClass: other`, are presented as **Unclassified**, and carry a specific reason code. No keyword fallback is used to force an ordinary active category into an asset class.

## Field rules and interpretation

- Management is Active/Passive when AMFI categories identify an active scheme or explicitly identify Index/ETF; FoF management remains Not specified unless the AMFI label identifies a passive type.
- Structure comes from the NAVAll section header.
- Philosophy is Value or Contra only when the AMFI category says so. Otherwise it is Blend/Unspecified.
- Specialities are explicit category/name tags (ETF, Index, Fund of Funds, Fixed Maturity Plan, Capital Protection, International, Sectoral/Thematic, Solution-oriented, Gold/Silver).
- Lifecycle is dormant when the Scheme Master closure date is in the past, or when that date is blank and the NAV is more than the configured 90 days older than the newest NAV date in the file. Dormant schemes are retained. A stale-NAV result is labelled “No recent NAV,” not described as proof of closure.
- Risk bands are **category-implied, not the scheme's official riskometer**. NAVAll does not provide the official riskometer. The configurable rules in `config/taxonomy-tree.json` are product heuristics and must not be described as a SEBI risk rating.

Consensus is `CONFIRMED` when two or more AMFI observations support the same category leaf, `UNCONFIRMED` when there is only one AMFI observation or a last-resort name rule, and a conflict only when AMFI sources map to different asset classes. MFapi is excluded from the vote. Human `USER_REBIND_OTHER` and `REVIEWED_S1` decisions survive taxonomy migrations.

## Governance page

The Classification page shows per-asset/status totals and an Unclassified review queue grouped by reason code. Each reason group reports active/dormant counts using the configured lifecycle rule, shows up to 100 examples, and can copy a review-ready rule stub. A stub deliberately does not assign a class; reviewers must inspect AMFI evidence before adding a rule. “Export all unclassified” writes every unclassified row and its S0/S1 raw values, rule, reason and lifecycle to CSV. A separate expandable table lists raw source-label observations recorded by the local diagnostics store.

The fund drawer's “Why this classification?” section shows S0–S4 observations, the S2 informational-only rule, and field-level rule/source provenance. Risk is labeled as category-implied.

## Persistence and migration

Tauri stores fund payloads in `schemes`, master rows in `scheme_master`, and current bindings/provenance in `scheme_taxonomy`. `scheme_category_history`, `taxonomy_conflicts`, `unmapped_categories`, `unmapped_category_members`, `classification_audit` and `source_scheme_map` retain observations, migrations and decisions. Browser builds use IndexedDB equivalents. Taxonomy version is 3; migrations preserve audit records and human decisions. Startup reconciliation is idempotent.

## Audit commands and evidence limits

- `pnpm classify:dump` downloads one live NAVAll file, creates the category inventory, and includes current active counts and sample scheme names; it also reports AMFI disclosure-category observations when those endpoints are reachable.
- `pnpm classify:fixture` rebuilds the offline reference inventory from the checked-in C0 discovery report.
- `pnpm classify:report` prints the live, read-only inventory.
- `pnpm classify:audit-sample` and `pnpm classify:audit-import` support an offline SID audit workflow; the in-app Classification page persists imported results.

The checked-in `docs/category-inventory.json` and `tests/fixtures/category-inventory.json` are explicitly marked `offline-c0-reference`: 14,441 scheme rows, 101 distinct observed NAVAll category strings, no active counts or sample names. The prompt's earlier 5,612 held-as-Other total is retained only as a historical user-reported baseline, not a v3 result. The live dump attempt on 2 November 2026 failed because DNS resolution for `portal.amfiindia.com` was unavailable. Therefore current S0 join coverage, active Unclassified percentage, dormant split, current class totals and reduction from 5,612 cannot be reported from this environment. CI verifies that each of the 101 historical raw category strings maps to a leaf or a named reason; it does not claim the active ≤1% target is measured until a live inventory with active counts is available.

The scheme inventory does not imply full historical NAV has been downloaded, nor does a category mapping provide fund holdings or an official riskometer. Do not present those fields as available based on classification alone.
