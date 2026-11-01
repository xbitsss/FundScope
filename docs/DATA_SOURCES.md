# Data source spike (Milestone 0)

Verified 12 October 2026. Requests were read-only. No source payloads or computed values are treated as production data unless they came from a live source.

## Findings

| Need | Source and observed behavior | Decision |
|---|---|---|
| Live scheme master, category, AMC, plan, option, ISIN, latest NAV | `https://portal.amfiindia.com/spages/NAVAll.txt` returned `text/plain`, 17,791 lines in the browser snapshot. Row header is **8** columns: Scheme Code; ISIN Div Payout/ISIN Growth; ISIN Div Reinvestment; Scheme Name; Plan; Option; Net Asset Value; Date. Category and AMC are separate non-delimited header rows. Real examples include missing plan/option fields and multiple spellings/casings for Growth and IDCW. | Use AMFI file as current catalog and NAV snapshot; parser must handle blank values, variable labels, and both ISIN meanings. Category and AMC context must be carried from header lines. |
| NAV history | `https://api.mfapi.in/mf` returned HTTP 200, 5,752,492 bytes, in about 1.0 s; live scheme search returned HTTP 200 / 347 bytes / ~87 ms; `/mf/{code}/latest` returned HTTP 200 / 425 bytes / ~85 ms. Payload fields observed: `meta` (fund house, type, category, code, name, ISINs), `data[]` with `date: DD-MM-YYYY`, `nav` string, and `status`. | Suitable as the history source, with schema validation, caching, backoff and visible source health. Catalog is about 5.75 MB and includes closed/old schemes; active status comes from AMFI's current file. No published rate limit was found; use conservative throttling and honor `Retry-After` if returned. |
| Date-bounded NAV history | `GET /mf/119551?startDate=01-01-2024&endDate=31-01-2024` returned HTTP 200 but its first values were October 2026, not the requested interval; response was ~133 KB / 147 ms. | Do not rely on server-side date bounds. Cache full history and slice dates locally. Measure full-history payload sizes per scheme during ingestion; latency varies by history length. |
| TER | AMFI page `https://www.amfiindia.com/ter-of-mf-schemes` is reachable. `https://www.amfiindia.com/api/populate-mf` returned HTTP 200 / 4,511 bytes / ~53 ms and AMC identifiers. A documented candidate data endpoint is `populate-te-rdata-revised` with AMC, month, category/type and pagination parameters; a probe for October 2026 returned HTTP 500. Scheme performance page candidate returned HTTP 404. | TER is **unavailable in the MVP until a valid dated response and scheme mapping are verified**. Never map the AMFI family-name TER row to a particular scheme by guess. Keep raw response and unmatched records visible if integration is resumed. |
| Scheme AUM | AMFI publishes fund/scheme AUM disclosures, but no dependable, machine-readable per-scheme endpoint and join key was verified in this spike. The candidate performance page returned 404. | AUM is **unavailable**. Do not substitute AMC total AUM or category AUM. |
| Benchmark / risk-free | No free, clean TRI series or trustworthy index-fund proxy mapping and tracking sanity check was established. | No benchmark series is shipped. Benchmark-relative fields return `NO_BENCHMARK`. Risk-free rate can be configured, but risk-adjusted metrics must disclose the rate and chosen window. |

## Sizing, limits, and mapping

- Observed full scheme-list response: 5,752,492 bytes; history database size cannot be responsibly projected until representative history lengths and SQLite row/index overhead are measured. NAV rows are one (scheme code, date) per observation.
- The MFapi scheme code is an integer and matches the AMFI Scheme Code convention. MFapi search results are only a discovery aid; AMFI NAV rows remain the active-catalog and plan/option source.
- AMFI TER `Scheme_Name` is a fund-family name rather than an AMFI code (per the published endpoint shape). Direct/Regular values are distinct but scheme codes can share the same family name. No silent join: require an audited normalized-name + AMC + plan match, otherwise report unmatched.
- Rate-limit behavior (429/Retry-After) could not be characterized without deliberately generating request bursts. The app will remain polite: low concurrency, exponential backoff, respect `Retry-After`, and surface errors.
- Universe count after the default Direct + Growth + Open + fresh filter was not measured in the source spike. It will be shown from actual ingested rows, never hard-coded.

## Unavailable metrics at Milestone 0

`aum_cr`, `ter_pct`, `benchmark_outperformance_ratio`, `beta`, `r_squared`, `treynor`, `jensen_alpha`, `information_ratio`, `upside_capture`, `downside_capture`, and `tracking_error` are unavailable until their verified inputs exist. All other Tier A/B NAV-only fields can be computed once actual growth-plan histories are ingested, with explicit insufficiency/null reasons. No fixture values are used on a production path.

## Sources

- [AMFI current NAV file](https://portal.amfiindia.com/spages/NAVAll.txt)
- [MFapi scheme catalog](https://api.mfapi.in/mf)
- [MFapi search](https://api.mfapi.in/mf/search?q=hdfc%20flexi%20cap)
- [MFapi latest history](https://api.mfapi.in/mf/119551/latest)
- [AMFI TER page](https://www.amfiindia.com/ter-of-mf-schemes)
- [AMFI AMC list endpoint](https://www.amfiindia.com/api/populate-mf)
- [AMFI research and information](https://www.amfiindia.com/research-information)
- Candidate TER API wire description (community discovery, not an AMFI contract): [indian-market-data-endpoints](https://github.com/satwikbasu/indian-market-data-endpoints/blob/main/endpoints/amfi-ter-api.md)

## Sample fixtures

Small source excerpts are checked in under `tests/fixtures/` for parser/schema tests only. They are examples, not bundled app data.

## Follow-up verification and current ingestion (13 October 2026)

- AMFI's [Average AUM page](https://www.amfiindia.com/aum-data/average-aum) uses the official `api/average-aum-schemewise` endpoint. Its latest report response contains `AMFI_Code` and `AverageAumForTheMonth` per scheme. The app joins by AMFI scheme code, stores the combined disclosed AAUM in crore, and records the quarter-end date. This is quarterly average AUM, not point-in-time month-end AUM.
- AMFI's official [TER page](https://www.amfiindia.com/ter-of-mf-schemes) uses `api/populate-mf` and `api/populate-te-rdata-revised`. The latter returned dated per-scheme-family rows for September 2026 during a live read-only probe. The app chooses Direct or Regular TER by the parsed plan, matches the normalized scheme name within the returned AMC, and picks that month's latest date. AMC requests run in a throttled background queue and retry malformed/error responses.
- AMFI's [monthly workbook page](https://www.amfiindia.com/research-information/amfi-monthly) currently links an industry/category report. The September 2026 workbook's `MCR_MonthlyReport` sheet has category totals and no per-scheme AMFI codes. It is intentionally not used for per-fund AUM. The AAUM endpoint above is the source for per-scheme size.
- AUM/TER values can be overridden by `public/config/local_overrides/disclosures.csv`, with `scheme_code,aum_cr,ter_pct` columns. Overrides retain `LOCAL_OVERRIDE` provenance.
- Benchmark mapping is governed by `docs/BENCHMARK_GOVERNANCE.md`. The current registry keeps candidate proxies unresolved until a reviewer records scheme identity, source dates, category suitability and return sanity evidence. Therefore benchmark-relative outputs intentionally remain null with `NO_BENCHMARK`; the discovery script never promotes a code automatically.
- SEBI category allocation values are category floors/profiles only. The UI marks these with `SEBI_HEURISTIC`; they do not represent a fund's actual portfolio. Unsupported breakdowns carry `SOURCE_MISSING`.

## Classification discovery (C0, 1 November 2026)

The read-only discovery run is recorded in [classification-discovery-c0.md](classification-discovery-c0.md). Its source excerpts are in `tests/fixtures/amfi-navall.sample.txt`, `tests/fixtures/mfapi-meta.sample.json`, and `tests/fixtures/amfi-ter.sample.json`. These fixtures are for parsing and source-shape tests only; they are not bundled application data.

### Observed source fields and coverage

- **S1 AMFI NAVAll:** the live response was 1,528,601 bytes and 18,231 physical lines. The column header was `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date`. Category/structure are carried by non-delimited headers such as `Open Ended Schemes(Equity Schemes - Thematic Fund)`; the AMC is the next non-delimited line. The report parsed 14,441 rows, 101 exact category strings and 103 distinct full header lines, with no repeated scheme codes or rejected numeric rows. The complete observed strings, category counts, current v1 outcomes and provisional v2 proposals are in the report.
- Observed AMFI labels include singular and plural `Equity Scheme(s)` and `Hybrid Scheme(s)`, separate `Equity Schemes - Sectoral Fund` and `Equity Schemes - Thematic Fund`, the legacy combined `Equity Scheme - Sectoral/ Thematic`, `Income/Debt Oriented Schemes - …`, four `Life Cycle Funds - Life Cycle Fund with Maturity of … Years` horizons, `Solution Oriented Scheme(s)`, and legacy header-only labels `Growth`, `Income`, `Gilt`, and `ELSS`. These are observed feed strings, not inferred SEBI category names.
- The existing v1 map does not resolve several of those observed labels: plural Equity/Hybrid families, Income/Debt Oriented families, the legacy combined Sectoral/Thematic spelling, and several passive families. The v2 JSON is only a discovery draft and is not imported by the app.
- **S2 MFapi history:** the real `/mf/129008` response had `meta.fund_house`, `scheme_type`, `scheme_category`, `scheme_code`, `scheme_name`, `isin_growth`, and `isin_div_reinvestment`, plus `status` and a `data[]` history. The sampled `scheme_category` matched S1 for that scheme. This is one agreement sample, not a measured cross-source agreement rate.
- **S3 AMFI TER:** the official `populate-te-rdata-revised` row includes `Scheme_Name`, `SchemeType_Desc`, `SchemeCat_Desc`, `TER_Date`, `R_TER`, `D_TER`, and `NSDLSchemeCode`; the sampled row did not include an AMFI scheme code. Its category is available per family row, but code-level reconciliation needs a separately audited source-scheme map. A request with `pageSize=10000` returned `meta.pageSize=100`, `total=2494`, and `pageCount=25` for Axis in October 2026. The current app ingester requests only page 1, so the S3 feed is incomplete until pagination is implemented. This is recorded for a later pipeline milestone, not changed in C0.

## Taxonomy v2 implementation (1 November 2026)

## Snapshot coverage and history cache (1 November 2026)

- The encrypted manifest now carries an aggregate-only `coverage` object for the Direct + Growth + Open universe and the full catalog, plus failed/pending counts and a run timestamp. It contains no secret or fund-level history payload.
- The browser keeps loaded NAV series in IndexedDB with a snapshot ID and an in-memory cache. A new snapshot invalidates the old series; a reload on the same snapshot preserves them.
- Missing references are reported as `not in snapshot yet`; integrity/decryption failures are reported separately and are retryable. The browser does not calculate replacement metrics from loaded history, so ETL metrics and their reason codes remain authoritative.

The production classifier now uses versioned AMFI family/subcategory rules, an explicit passive-family allowlist, and passive candidate patterns. Unknown categories and ambiguous passive candidates stay `other`. The AMFI parser now persists `N.A.` NAV rows as master records and checks feed shape before replacing the cached catalog. Classification provenance, source disagreement, mapping history and SID audit results are stored locally. See [CLASSIFICATION.md](CLASSIFICATION.md) for rules, status behavior, migration and audit commands.

AMFI TER ingestion now walks all response pages and attaches S3 category data only after a unique AMC plus normalized scheme-family match. Its observation timestamp is the date published in `TER_Date`; the separate source mapping record retains the local match time. This improves row coverage but does not turn the family-name join into a verified scheme-code contract. Coverage and unmatched rows must be monitored through the local diagnostics.

### Prompt assumptions checked

- **Confirmed from the live AMFI feed:** new Life Cycle category headers are present; Sectoral and Thematic occur as separate raw strings as well as an older combined string; the Sectoral Debt examples are published under `Income/Debt Oriented Schemes - Sectoral Fund`, not a literal `Sectoral Debt Fund` category label; both old and new singular/plural family spellings occur.
- **Not confirmed:** the specific SEBI 26 February 2026 policy claims in the prompt. The [official SEBI landing page](https://www.sebi.gov.in/legal/circulars/feb-2026/categorization-and-rationalization-of-mutual-fund-schemes_99983.html) confirms the circular title, date and circular number `HO/24/13/15(2)2026-IMD-RAC4/I/5764/2026`; the [linked circular PDF](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1772079826878.pdf) body was not readable in the available source extraction during C0. Do not treat the quoted policy summary or the inferred August deadline as independently verified until the circular text is reviewed.
- The working AMFI feed is a flat-file structure with eight semicolon-separated columns and separate context headers, not a category field embedded in each scheme row. Parsing from the final fields remains appropriate for NAV/date, but names should not be inferred from fixed mid-field offsets if malformed or extra semicolons occur.
