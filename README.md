# FundScope

FundScope is a local-first desktop mutual-fund research desk for Indian mutual funds. It is designed around transparent data freshness and explicit missing values. This repository currently contains the first working MVP slice; metrics requiring unverified sources stay unavailable.

## Run the frontend

Requirements: Node.js 20+, pnpm 12.11.2 (pinned in `package.json`). Then run `pnpm install`, `pnpm dev` for a browser preview, or `pnpm tauri dev` for the desktop app (Rust stable and the platform's Tauri build prerequisites are required).

`pnpm check` runs strict TypeScript checking and creates the production Vite bundle. Use `pnpm tauri build` to create a desktop installer once the Rust toolchain is installed.

## Data and privacy

On launch, FundScope shows locally cached data and attempts to refresh the AMFI NAV catalog. Historical NAV is fetched from MFapi on demand. In the Tauri build, scheme payloads and NAV rows are stored in the local SQLite file `fundscope.db`; the browser preview uses IndexedDB. No account, telemetry, or remote assets are used. The default view includes open-ended Direct Growth schemes with recent NAV dates. A network failure leaves the last saved catalog available.

The source spike and unavailable fields are listed in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). Metrics and known limitations are documented in [docs/METHODOLOGY.md](docs/METHODOLOGY.md). Exported CSV includes a personal-research disclaimer.

## Backup

The SQLite database is currently stored in the app data directory managed by Tauri's SQL plugin. Close FundScope before copying the database file. In the browser preview, browser site data contains the IndexedDB database. A one-click backup/restore flow is a tracked follow-up.
