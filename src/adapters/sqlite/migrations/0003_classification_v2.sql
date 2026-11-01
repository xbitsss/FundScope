-- FundScope taxonomy v2 migration (0003).
-- The current repository stores scheme rows in `schemes.payload` and binding metadata in
-- `scheme_taxonomy`; runtime code snapshots those tables before applying these additive changes.
-- ensureTaxonomyColumns() applies these three ALTERs idempotently on existing SQLite databases.
ALTER TABLE scheme_taxonomy ADD COLUMN class_status TEXT NOT NULL DEFAULT 'UNCONFIRMED';
ALTER TABLE scheme_taxonomy ADD COLUMN class_detail TEXT;
ALTER TABLE scheme_taxonomy ADD COLUMN class_checked_at INTEGER;

CREATE TABLE IF NOT EXISTS scheme_category_history (
  scheme_code INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  category_raw TEXT NOT NULL,
  structure TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (scheme_code, source_id, category_raw)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS unmapped_categories (
  category_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sample_raw TEXT NOT NULL,
  scheme_count INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (category_key, source_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS unmapped_category_members (
  scheme_code INTEGER NOT NULL,
  category_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sample_raw TEXT NOT NULL,
  PRIMARY KEY (scheme_code, category_key, source_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS classification_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_code INTEGER NOT NULL,
  audited_at INTEGER NOT NULL,
  auditor TEXT,
  sid_category TEXT NOT NULL,
  sid_url TEXT,
  expected_class TEXT NOT NULL,
  agrees INTEGER NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheme_master (
  scheme_code INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_scheme_map (
  scheme_code INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_scheme_code TEXT NOT NULL,
  source_name TEXT NOT NULL,
  join_method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  matched_at INTEGER NOT NULL,
  PRIMARY KEY (scheme_code, source_id, source_scheme_code, source_name)
) WITHOUT ROWID;
