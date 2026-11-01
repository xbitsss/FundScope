import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Node adapter matching the FundScope SQLite tables used by the desktop repository. */
export class NodeSqliteRepository {
  constructor(filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.filePath = filePath;
    this.db = new Database(filePath, { timeout: 15_000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 15000');
    this.db.pragma('foreign_keys = ON');
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schemes (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scheme_master (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS nav (scheme_code INTEGER NOT NULL, date INTEGER NOT NULL, nav REAL NOT NULL, PRIMARY KEY(scheme_code,date)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS benchmark_series (scheme_code INTEGER PRIMARY KEY, scheme_name TEXT NOT NULL, fetched_at INTEGER NOT NULL, history TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_state (source_id TEXT PRIMARY KEY, fetched_at INTEGER, data_as_of INTEGER, status TEXT NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scheme_taxonomy (scheme_code INTEGER PRIMARY KEY, category_raw TEXT NOT NULL, sub_category TEXT NOT NULL, asset_class TEXT NOT NULL, rule_id TEXT NOT NULL, taxonomy_version INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, class_status TEXT NOT NULL DEFAULT 'UNCONFIRMED', class_detail TEXT, class_checked_at INTEGER);
      CREATE TABLE IF NOT EXISTS taxonomy_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme_code INTEGER NOT NULL, stored_category TEXT NOT NULL, incoming_category TEXT NOT NULL, stored_class TEXT NOT NULL, incoming_class TEXT NOT NULL, stored_rule TEXT NOT NULL, incoming_rule TEXT NOT NULL, stored_version INTEGER NOT NULL, incoming_version INTEGER NOT NULL, observed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_scheme_map (scheme_code INTEGER NOT NULL, source_id TEXT NOT NULL, source_scheme_code TEXT NOT NULL, source_name TEXT NOT NULL, join_method TEXT NOT NULL, confidence TEXT NOT NULL, matched_at INTEGER NOT NULL, PRIMARY KEY(scheme_code,source_id,source_scheme_code,source_name)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    return this;
  }

  getFunds() {
    return this.db.prepare('SELECT payload FROM schemes ORDER BY scheme_code').all().map(({ payload }) => JSON.parse(payload));
  }

  getFund(code) {
    const row = this.db.prepare('SELECT payload FROM schemes WHERE scheme_code = ?').get(code);
    return row ? JSON.parse(row.payload) : null;
  }

  saveFunds(funds) {
    const upsert = this.db.prepare(`INSERT INTO schemes(scheme_code,payload) VALUES(?,?)
      ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload`);
    const transaction = this.db.transaction((records) => {
      for (const fund of records) upsert.run(fund.code, JSON.stringify(fund));
    });
    for (let start = 0; start < funds.length; start += 200) transaction(funds.slice(start, start + 200));
  }

  saveSchemeMasterRows(rows, funds) {
    const byCode = new Map(funds.map((fund) => [fund.code, fund]));
    const now = Date.now();
    const upsert = this.db.prepare(`INSERT INTO scheme_master(scheme_code,payload,first_seen_at,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload,last_seen_at=excluded.last_seen_at`);
    const transaction = this.db.transaction((batch) => {
      for (const row of batch) {
        const fund = byCode.get(row.schemeCode);
        if (!fund) continue;
        const prior = this.db.prepare('SELECT first_seen_at FROM scheme_master WHERE scheme_code=?').get(row.schemeCode);
        const firstSeenAt = prior?.first_seen_at ?? now;
        const payload = { ...row, assetClass: fund.assetClass, classRuleId: fund.classRuleId, classStatus: fund.classStatus, classDetail: fund.classDetail, taxonomyVersion: fund.taxonomyVersion, firstSeenAt, lastSeenAt: now };
        upsert.run(row.schemeCode, JSON.stringify(payload), firstSeenAt, now);
      }
    });
    for (let start = 0; start < rows.length; start += 200) transaction(rows.slice(start, start + 200));
  }

  getSourceState(sourceId) {
    const row = this.db.prepare('SELECT fetched_at AS fetchedAt,data_as_of AS dataAsOf,status,detail FROM source_state WHERE source_id=?').get(sourceId);
    return row ?? { fetchedAt: null, dataAsOf: null, status: 'never', detail: null };
  }

  setSourceState(sourceId, state) {
    this.db.prepare(`INSERT INTO source_state(source_id,fetched_at,data_as_of,status,detail) VALUES(?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET fetched_at=excluded.fetched_at,data_as_of=excluded.data_as_of,status=excluded.status,detail=excluded.detail`)
      .run(sourceId, state.fetchedAt ?? null, state.dataAsOf ?? null, state.status, state.detail ?? null);
  }

  getLocalState(key, fallback = null) {
    const row = this.db.prepare('SELECT payload FROM app_state WHERE state_key=?').get(key);
    return row ? JSON.parse(row.payload) : fallback;
  }

  setLocalState(key, value) {
    this.db.prepare(`INSERT INTO app_state(state_key,payload) VALUES(?,?)
      ON CONFLICT(state_key) DO UPDATE SET payload=excluded.payload`).run(key, JSON.stringify(value));
  }

  getBenchmarkSeries(schemeCode) {
    const row = this.db.prepare('SELECT scheme_name AS schemeName,fetched_at AS fetchedAt,history FROM benchmark_series WHERE scheme_code=?').get(schemeCode);
    return row ? { schemeCode, schemeName: row.schemeName, fetchedAt: row.fetchedAt, history: JSON.parse(row.history) } : null;
  }

  saveBenchmarkSeries(series) {
    this.db.prepare(`INSERT INTO benchmark_series(scheme_code,scheme_name,fetched_at,history) VALUES(?,?,?,?)
      ON CONFLICT(scheme_code) DO UPDATE SET scheme_name=excluded.scheme_name,fetched_at=excluded.fetched_at,history=excluded.history`)
      .run(series.schemeCode, series.schemeName, series.fetchedAt, JSON.stringify(series.history));
  }

  recordSourceSchemeMapping(row) {
    this.db.prepare(`INSERT INTO source_scheme_map(scheme_code,source_id,source_scheme_code,source_name,join_method,confidence,matched_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(scheme_code,source_id,source_scheme_code,source_name) DO UPDATE SET
      join_method=excluded.join_method,confidence=excluded.confidence,matched_at=excluded.matched_at`)
      .run(row.schemeCode, row.sourceId, row.sourceSchemeCode, row.sourceName, row.joinMethod, row.confidence, row.matchedAt);
  }

  checkpoint() {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  integrityCheck() {
    return this.db.pragma('quick_check').map((row) => Object.values(row)[0]);
  }

  close() {
    if (!this.db.open) return;
    this.checkpoint();
    this.db.close();
  }
}
