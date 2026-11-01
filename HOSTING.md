# Free static hosting

FundScope is served from GitHub Pages. A nightly GitHub Actions job downloads the free AMFI and MFapi sources, updates a private SQLite working file, calculates metrics from available NAV history, builds encrypted catalog and NAV snapshots, and publishes the static app. The site has no backend server.

## One-time repository setup

1. Keep `xbitsss/FundScope` public and leave Pages configured to deploy with GitHub Actions.
2. In **Settings → Secrets and variables → Actions → New repository secret**, add `DATA_PASSPHRASE`. Use a unique password of at least 16 characters. Do not put it in source files, Issues, or chat. This one shared passphrase unlocks the public encrypted snapshot in each browser.
3. Run **Actions → Refresh data and deploy FundScope → Run workflow** with `code_only` left unchecked. This creates the encrypted data release and deploys the app. Later code-only deployments reuse the last generated snapshot.

No paid API keys are needed. AMFI and MFapi are public data sources; `GITHUB_TOKEN` is created automatically for Actions. Optional `NTFY_TOPIC_URL` can be added as a repository secret if refresh notifications are configured.

## Local publishing and development

Copy `.env.example` to `.env`, set a private `DATA_PASSPHRASE`, then run `corepack pnpm etl:bundle` and `corepack pnpm etl:run` with a GitHub token that can manage releases. To only build the static site after the latest data release exists, run the ETL bundle with `--restore-snapshot`, then `corepack pnpm build:web`.

`corepack pnpm dev` and the normal Tauri build remain the local desktop development path. The hosted web build uses a separate unlock screen and IndexedDB; the passphrase never leaves the browser tab. History is loaded lazily from per-scheme encrypted packs. FundScope displays explicit missing-data reasons where a source has not provided a value.

The ETL limits each NAV backfill batch to `ETL_BATCH_SIZE` (3,000 by default) so it stays within public-source and workflow time limits. Unfetched histories remain marked as unavailable and are retried on later nightly runs. Public Pages has a 1 GB site limit; the workflow stops before publishing if the configured `MAX_SITE_SIZE_MB` limit is exceeded.
