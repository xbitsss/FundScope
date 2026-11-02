# Free static hosting

FundScope is served from GitHub Pages. A nightly GitHub Actions job downloads the free AMFI and MFapi sources, updates a private SQLite working file, calculates metrics from available NAV history, builds encrypted catalog and NAV snapshots, and publishes the static app. The site has no backend server.

## One-time repository setup

1. Keep `xbitsss/FundScope` public and leave Pages configured to deploy with GitHub Actions.
2. In **Settings → Secrets and variables → Actions → New repository secret**, add `DATA_PASSPHRASE`. Generate a 20-character Base32 passphrase with `pnpm passphrase:generate`, store it in a password manager, and do not put it in source files, Issues, or chat. The ETL rejects an estimated entropy below 80 bits. This one shared passphrase unlocks the public encrypted snapshot in each browser.
3. Run **Actions → Refresh data and deploy FundScope → Run workflow** with `code_only` left unchecked. This creates the encrypted data release and deploys the app. Later code-only deployments reuse the last generated snapshot.

No paid API keys are needed. AMFI and MFapi are public data sources; `GITHUB_TOKEN` is created automatically for Actions. Optional `NTFY_TOPIC_URL` can be added as a repository secret if refresh notifications are configured.

## Local publishing and development

Copy `.env.example` to `.env`, set a private `DATA_PASSPHRASE`, then run `corepack pnpm etl:bundle` and `corepack pnpm etl:run` with a GitHub token that can manage releases. To only build the static site after the latest data release exists, run the ETL bundle with `--restore-snapshot`, then `corepack pnpm build:web`.

`corepack pnpm dev` and the normal Tauri build remain the local desktop development path. The hosted web build uses a separate unlock screen. The page prefetches the encrypted index and warms a module worker; the worker derives the key, decrypts and decodes the compact columnar catalogue. The hosted unlock path does not write the full catalogue to IndexedDB. History and detail packs load lazily. “Stay unlocked on this device” stores a non-extractable device key in IndexedDB; anyone with access to that unlocked browser profile can read the data. The setting can be changed to 7, 30, 90 days, or never, and **Lock & clear** removes the saved device session. If browser storage is unavailable, passphrase unlock still works. FundScope displays explicit missing-data reasons where a source has not provided a value.

After first install the service worker caches same-origin app assets and snapshot files, and revalidates the small snapshot manifest. Browsers must support service workers, WebCrypto, module workers, and `DecompressionStream` for the fast path; embedded WebViews without module-worker support retain a synchronous compatibility fallback.

The ETL limits each NAV backfill batch to `ETL_BATCH_SIZE` (3,000 by default) so it stays within public-source and workflow time limits. Unfetched histories remain marked as unavailable and are retried on later nightly runs. Public Pages has a 1 GB site limit; the workflow stops before publishing if the configured `MAX_SITE_SIZE_MB` limit is exceeded.
