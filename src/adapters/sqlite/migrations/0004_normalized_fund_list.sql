-- Normalized desktop list, metric and on-demand detail storage.
-- The existing schemes table is copied to schemes_typed_v4_backup before migration.
CREATE TABLE IF NOT EXISTS fund_list (
  scheme_code INTEGER PRIMARY KEY,
  isin_growth TEXT,
  isin_reinvestment TEXT,
  name TEXT NOT NULL,
  amc TEXT NOT NULL,
  category TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  class_rule_id TEXT NOT NULL,
  taxonomy_version INTEGER NOT NULL,
  sub_category TEXT NOT NULL,
  management TEXT,
  fund_group TEXT,
  risk_band TEXT,
  philosophy TEXT,
  speciality TEXT NOT NULL DEFAULT '',
  lifecycle TEXT,
  structure TEXT NOT NULL,
  plan TEXT NOT NULL,
  option TEXT NOT NULL,
  nav REAL NOT NULL,
  nav_date INTEGER NOT NULL,
  class_status TEXT,
  header_raw TEXT,
  history_fetched_at INTEGER,
  history_status TEXT,
  history_attempts INTEGER,
  history_last_error TEXT,
  history_next_retry_at INTEGER,
  metrics_nav_as_of INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fund_list_amc ON fund_list(amc);
CREATE INDEX IF NOT EXISTS idx_fund_list_category ON fund_list(sub_category);
CREATE INDEX IF NOT EXISTS idx_fund_list_asset_class ON fund_list(asset_class);
CREATE INDEX IF NOT EXISTS idx_fund_list_structure ON fund_list(structure);
CREATE INDEX IF NOT EXISTS idx_fund_list_plan ON fund_list(plan);
CREATE INDEX IF NOT EXISTS idx_fund_list_option ON fund_list(option);
CREATE INDEX IF NOT EXISTS idx_fund_list_management ON fund_list(management);
CREATE INDEX IF NOT EXISTS idx_fund_list_group ON fund_list(fund_group);
CREATE INDEX IF NOT EXISTS idx_fund_list_risk_band ON fund_list(risk_band);
CREATE INDEX IF NOT EXISTS idx_fund_list_lifecycle ON fund_list(lifecycle);
CREATE INDEX IF NOT EXISTS idx_fund_list_nav_date ON fund_list(nav_date);

CREATE TABLE IF NOT EXISTS fund_metrics (
  scheme_code INTEGER NOT NULL,
  metric_id TEXT NOT NULL,
  metric_value REAL,
  reason_code TEXT,
  PRIMARY KEY (scheme_code, metric_id),
  FOREIGN KEY (scheme_code) REFERENCES fund_list(scheme_code) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_fund_metrics_id_value ON fund_metrics(metric_id, metric_value);

CREATE TABLE IF NOT EXISTS fund_detail (
  scheme_code INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  FOREIGN KEY (scheme_code) REFERENCES fund_list(scheme_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nav_scheme_date ON nav(scheme_code, date DESC);
