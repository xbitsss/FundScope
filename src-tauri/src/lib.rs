use serde_json::{json, Map, Value};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    QueryBuilder, Row, Sqlite, SqlitePool, Transaction,
};
use std::{collections::HashSet, time::Duration};
use tauri::{AppHandle, Manager};

async fn connect_fundscope_db(app: &AppHandle) -> Result<SqlitePool, String> {
    let path = app.path().app_config_dir().map_err(|error| error.to_string())?.join("fundscope.db");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(15));
    SqlitePoolOptions::new().max_connections(1).connect_with(options).await.map_err(|error| error.to_string())
}

fn as_text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn as_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn as_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite())
}

fn field_text<'a>(value: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    as_text(value, key).unwrap_or(fallback)
}

async fn write_normalized_rows(
    transaction: &mut Transaction<'_, Sqlite>,
    records: &[Value],
    metrics_only: bool,
) -> Result<(), String> {
    if !metrics_only {
        for batch in records.chunks(24) {
            let mut query = QueryBuilder::<Sqlite>::new(
                "INSERT INTO fund_list (scheme_code,isin_growth,isin_reinvestment,name,amc,category,asset_class,class_rule_id,taxonomy_version,sub_category,management,fund_group,risk_band,philosophy,speciality,lifecycle,structure,plan,option,nav,nav_date,class_status,header_raw,history_fetched_at,history_status,history_attempts,history_last_error,history_next_retry_at,metrics_nav_as_of) ",
            );
            query.push_values(batch, |mut row, record| {
                let list = record.get("list").unwrap_or(record);
                row.push_bind(as_i64(list, "code").unwrap_or_default())
                    .push_bind(as_text(list, "isin_growth").map(str::to_owned))
                    .push_bind(as_text(list, "isin_reinvestment").map(str::to_owned))
                    .push_bind(field_text(list, "name", "").to_owned())
                    .push_bind(field_text(list, "amc", "").to_owned())
                    .push_bind(field_text(list, "category", "").to_owned())
                    .push_bind(field_text(list, "asset_class", "other").to_owned())
                    .push_bind(field_text(list, "class_rule_id", "UNKNOWN").to_owned())
                    .push_bind(as_i64(list, "taxonomy_version").unwrap_or_default())
                    .push_bind(field_text(list, "sub_category", "Not specified").to_owned())
                    .push_bind(as_text(list, "management").map(str::to_owned))
                    .push_bind(as_text(list, "fund_group").map(str::to_owned))
                    .push_bind(as_text(list, "risk_band").map(str::to_owned))
                    .push_bind(as_text(list, "philosophy").map(str::to_owned))
                    .push_bind(field_text(list, "speciality", "").to_owned())
                    .push_bind(as_text(list, "lifecycle").map(str::to_owned))
                    .push_bind(field_text(list, "structure", "unknown").to_owned())
                    .push_bind(field_text(list, "plan", "Unknown").to_owned())
                    .push_bind(field_text(list, "option", "").to_owned())
                    .push_bind(as_f64(list, "nav").unwrap_or_default())
                    .push_bind(as_i64(list, "nav_date").unwrap_or_default())
                    .push_bind(as_text(list, "class_status").map(str::to_owned))
                    .push_bind(as_text(list, "header_raw").map(str::to_owned))
                    .push_bind(as_i64(list, "history_fetched_at"))
                    .push_bind(as_text(list, "history_status").map(str::to_owned))
                    .push_bind(as_i64(list, "history_attempts"))
                    .push_bind(as_text(list, "history_last_error").map(str::to_owned))
                    .push_bind(as_i64(list, "history_next_retry_at"))
                    .push_bind(as_i64(list, "metrics_nav_as_of"));
            });
            query.push(" ON CONFLICT(scheme_code) DO UPDATE SET ")
                .push("isin_growth=excluded.isin_growth,isin_reinvestment=excluded.isin_reinvestment,name=excluded.name,amc=excluded.amc,category=excluded.category,asset_class=excluded.asset_class,class_rule_id=excluded.class_rule_id,taxonomy_version=excluded.taxonomy_version,sub_category=excluded.sub_category,management=excluded.management,fund_group=excluded.fund_group,risk_band=excluded.risk_band,philosophy=excluded.philosophy,speciality=excluded.speciality,lifecycle=excluded.lifecycle,structure=excluded.structure,plan=excluded.plan,option=excluded.option,nav=excluded.nav,nav_date=excluded.nav_date,class_status=excluded.class_status,header_raw=excluded.header_raw,history_fetched_at=excluded.history_fetched_at,history_status=excluded.history_status,history_attempts=excluded.history_attempts,history_last_error=excluded.history_last_error,history_next_retry_at=excluded.history_next_retry_at,metrics_nav_as_of=excluded.metrics_nav_as_of ")
                .push("WHERE fund_list.isin_growth IS NOT excluded.isin_growth OR fund_list.isin_reinvestment IS NOT excluded.isin_reinvestment OR fund_list.name IS NOT excluded.name OR fund_list.amc IS NOT excluded.amc OR fund_list.category IS NOT excluded.category OR fund_list.asset_class IS NOT excluded.asset_class OR fund_list.class_rule_id IS NOT excluded.class_rule_id OR fund_list.taxonomy_version IS NOT excluded.taxonomy_version OR fund_list.sub_category IS NOT excluded.sub_category OR fund_list.management IS NOT excluded.management OR fund_list.fund_group IS NOT excluded.fund_group OR fund_list.risk_band IS NOT excluded.risk_band OR fund_list.philosophy IS NOT excluded.philosophy OR fund_list.speciality IS NOT excluded.speciality OR fund_list.lifecycle IS NOT excluded.lifecycle OR fund_list.structure IS NOT excluded.structure OR fund_list.plan IS NOT excluded.plan OR fund_list.option IS NOT excluded.option OR fund_list.nav IS NOT excluded.nav OR fund_list.nav_date IS NOT excluded.nav_date OR fund_list.class_status IS NOT excluded.class_status OR fund_list.header_raw IS NOT excluded.header_raw OR fund_list.history_fetched_at IS NOT excluded.history_fetched_at OR fund_list.history_status IS NOT excluded.history_status OR fund_list.history_attempts IS NOT excluded.history_attempts OR fund_list.history_last_error IS NOT excluded.history_last_error OR fund_list.history_next_retry_at IS NOT excluded.history_next_retry_at OR fund_list.metrics_nav_as_of IS NOT excluded.metrics_nav_as_of");
            query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
        }

        for batch in records.chunks(24) {
            let mut details = Vec::new();
            for record in batch {
                if let (Some(code), Some(payload)) = (record.get("list").and_then(|list| as_i64(list, "code")).or_else(|| as_i64(record, "code")), as_text(record, "detailJson")) {
                    details.push((code, payload.to_owned()));
                }
            }
            if details.is_empty() { continue; }
            let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO fund_detail (scheme_code,payload) ");
            query.push_values(details, |mut row, (code, payload)| { row.push_bind(code).push_bind(payload); });
            query.push(" ON CONFLICT(scheme_code) DO UPDATE SET payload=excluded.payload WHERE fund_detail.payload IS NOT excluded.payload");
            query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
        }

        let mut nav_points: Vec<(i64, i64, f64)> = Vec::new();
        let mut unique = HashSet::new();
        for record in records {
            let list = record.get("list").unwrap_or(record);
            let Some(code) = as_i64(list, "code") else { continue };
            if let (Some(date), Some(nav)) = (as_i64(list, "nav_date"), as_f64(list, "nav")) {
                if unique.insert((code, date)) { nav_points.push((code, date, nav)); }
            }
            if let Some(history) = record.get("history").and_then(Value::as_array) {
                for point in history {
                    if let (Some(date), Some(nav)) = (as_i64(point, "date"), as_f64(point, "nav")) {
                        if unique.insert((code, date)) { nav_points.push((code, date, nav)); }
                    }
                }
            }
        }
        for batch in nav_points.chunks(200) {
            let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO nav (scheme_code,date,nav) ");
            query.push_values(batch, |mut row, (code, date, nav)| { row.push_bind(*code).push_bind(*date).push_bind(*nav); });
            query.push(" ON CONFLICT(scheme_code,date) DO UPDATE SET nav=excluded.nav WHERE nav.nav IS NOT excluded.nav");
            query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
        }
    }

    let mut codes = Vec::with_capacity(records.len());
    let mut metric_values: Vec<(i64, String, Option<f64>, Option<String>)> = Vec::new();
    for record in records {
        let code = if let Some(list) = record.get("list") { as_i64(list, "code") } else { as_i64(record, "code") };
        let Some(code) = code else { return Err("Normalized fund record is missing its scheme code.".into()) };
        codes.push(code);
        if let Some(metrics) = record.get("metrics").and_then(Value::as_array) {
            for metric in metrics {
                if let Some(id) = as_text(metric, "metricId") {
                    let value = metric.get("value").and_then(Value::as_f64).filter(|value| value.is_finite());
                    let reason = as_text(metric, "reasonCode").map(str::to_owned);
                    metric_values.push((code, id.to_owned(), value, reason));
                }
            }
        }
    }
    sqlx::query("CREATE TEMP TABLE IF NOT EXISTS fund_metrics_sync_codes (scheme_code INTEGER PRIMARY KEY)")
        .execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    sqlx::query("CREATE TEMP TABLE IF NOT EXISTS fund_metrics_sync_rows (scheme_code INTEGER NOT NULL,metric_id TEXT NOT NULL,metric_value REAL,reason_code TEXT,PRIMARY KEY(scheme_code,metric_id)) WITHOUT ROWID")
        .execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM fund_metrics_sync_codes").execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM fund_metrics_sync_rows").execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    for batch in codes.chunks(200) {
        if batch.is_empty() { continue; }
        let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO fund_metrics_sync_codes (scheme_code) ");
        query.push_values(batch, |mut row, code| { row.push_bind(*code); });
        query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    }
    for batch in metric_values.chunks(200) {
        if batch.is_empty() { continue; }
        let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO fund_metrics_sync_rows (scheme_code,metric_id,metric_value,reason_code) ");
        query.push_values(batch, |mut row, (code, id, value, reason)| { row.push_bind(*code).push_bind(id).push_bind(*value).push_bind(reason); });
        query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    }
    sqlx::query("DELETE FROM fund_metrics WHERE scheme_code IN (SELECT scheme_code FROM fund_metrics_sync_codes) AND NOT EXISTS (SELECT 1 FROM fund_metrics_sync_rows AS incoming WHERE incoming.scheme_code=fund_metrics.scheme_code AND incoming.metric_id=fund_metrics.metric_id)")
        .execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    for batch in metric_values.chunks(200) {
        if batch.is_empty() { continue; }
        let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO fund_metrics (scheme_code,metric_id,metric_value,reason_code) ");
        query.push_values(batch, |mut row, (code, id, value, reason)| { row.push_bind(*code).push_bind(id).push_bind(*value).push_bind(reason); });
        query.push(" ON CONFLICT(scheme_code,metric_id) DO UPDATE SET metric_value=excluded.metric_value,reason_code=excluded.reason_code WHERE fund_metrics.metric_value IS NOT excluded.metric_value OR fund_metrics.reason_code IS NOT excluded.reason_code");
        query.build().execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    }
    sqlx::query("DELETE FROM fund_metrics_sync_codes").execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM fund_metrics_sync_rows").execute(&mut **transaction).await.map_err(|error| error.to_string())?;
    Ok(())
}

fn record_from_legacy_payload(payload: &str, stored_code: i64) -> Result<Value, String> {
    let fund: Value = serde_json::from_str(payload).map_err(|error| format!("Invalid legacy scheme JSON {stored_code}: {error}"))?;
    let mut detail = Map::new();
    for key in ["schemeMaster", "classDetail", "classificationReason", "classificationProvenance", "lifecycleReason", "metricReasonDetails", "metricFlags", "metricProvenance", "metricAsOf"] {
        if let Some(value) = fund.get(key).filter(|value| !value.is_null()) { detail.insert(key.to_owned(), value.clone()); }
    }
    let metrics = fund.get("metrics").and_then(Value::as_object).map(|values| values.iter().map(|(metric_id, value)| json!({
        "metricId": metric_id,
        "value": value,
        "reasonCode": fund.get("metricReasons").and_then(|reasons| reasons.get(metric_id)).cloned().unwrap_or(Value::Null),
    })).collect::<Vec<_>>()).unwrap_or_default();
    let list = json!({
        "code": stored_code,
        "isin_growth": fund.get("isinGrowth").cloned().unwrap_or(Value::Null),
        "isin_reinvestment": fund.get("isinReinvestment").cloned().unwrap_or(Value::Null),
        "name": fund.get("name").cloned().unwrap_or(json!("")),
        "amc": fund.get("amc").cloned().unwrap_or(json!("")),
        "category": fund.get("category").cloned().unwrap_or(json!("")),
        "asset_class": fund.get("assetClass").cloned().unwrap_or(json!("other")),
        "class_rule_id": fund.get("classRuleId").cloned().unwrap_or(json!("UNKNOWN")),
        "taxonomy_version": fund.get("taxonomyVersion").cloned().unwrap_or(json!(0)),
        "sub_category": fund.get("subCategory").cloned().unwrap_or(json!("Not specified")),
        "management": fund.get("management").cloned().unwrap_or(Value::Null),
        "fund_group": fund.get("group").cloned().unwrap_or(Value::Null),
        "risk_band": fund.get("riskBand").cloned().unwrap_or(Value::Null),
        "philosophy": fund.get("philosophy").cloned().unwrap_or(Value::Null),
        "speciality": fund.get("speciality").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\u{1f}")).unwrap_or_default(),
        "lifecycle": fund.get("lifecycle").cloned().unwrap_or(Value::Null),
        "structure": fund.get("structure").cloned().unwrap_or(json!("unknown")),
        "plan": fund.get("plan").cloned().unwrap_or(json!("Unknown")),
        "option": fund.get("option").cloned().unwrap_or(json!("")),
        "nav": fund.get("nav").cloned().unwrap_or(json!(0)),
        "nav_date": fund.get("navDate").cloned().unwrap_or(json!(0)),
        "class_status": fund.get("classStatus").cloned().unwrap_or(Value::Null),
        "header_raw": fund.get("headerRaw").cloned().unwrap_or(Value::Null),
        "history_fetched_at": fund.get("historyFetchedAt").cloned().unwrap_or(Value::Null),
        "history_status": fund.get("historyStatus").cloned().unwrap_or(Value::Null),
        "history_attempts": fund.get("historyAttempts").cloned().unwrap_or(Value::Null),
        "history_last_error": fund.get("historyLastError").cloned().unwrap_or(Value::Null),
        "history_next_retry_at": fund.get("historyNextRetryAt").cloned().unwrap_or(Value::Null),
        "metrics_nav_as_of": fund.get("metricsNavAsOf").cloned().unwrap_or(Value::Null),
    });
    Ok(json!({
        "list": list,
        "metrics": metrics,
        "detailJson": serde_json::to_string(&Value::Object(detail)).map_err(|error| error.to_string())?,
        "history": fund.get("history").and_then(Value::as_array).cloned().unwrap_or_default(),
    }))
}

#[tauri::command]
async fn migrate_normalized_fund_storage(app: AppHandle) -> Result<usize, String> {
    let pool = connect_fundscope_db(&app).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("CREATE TABLE IF NOT EXISTS schemes (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    sqlx::query("CREATE TABLE IF NOT EXISTS schemes_typed_v4_backup AS SELECT * FROM schemes")
        .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    let source_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM schemes")
        .fetch_one(&mut *transaction).await.map_err(|error| error.to_string())?.try_get("count").map_err(|error| error.to_string())?;
    let mut last_code = i64::MIN;
    loop {
        let rows = sqlx::query("SELECT scheme_code,payload FROM schemes WHERE scheme_code>?1 ORDER BY scheme_code LIMIT 100")
            .bind(last_code).fetch_all(&mut *transaction).await.map_err(|error| error.to_string())?;
        if rows.is_empty() { break; }
        let mut batch = Vec::with_capacity(rows.len());
        for row in &rows {
            let code: i64 = row.try_get("scheme_code").map_err(|error| error.to_string())?;
            let payload: String = row.try_get("payload").map_err(|error| error.to_string())?;
            batch.push(record_from_legacy_payload(&payload, code)?);
        }
        write_normalized_rows(&mut transaction, &batch, false).await?;
        last_code = rows.last().and_then(|row| row.try_get::<i64, _>("scheme_code").ok()).unwrap_or(last_code);
    }
    let migrated_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM fund_list")
        .fetch_one(&mut *transaction).await.map_err(|error| error.to_string())?.try_get("count").map_err(|error| error.to_string())?;
    if migrated_count != source_count { return Err(format!("Normalized fund migration count mismatch: {migrated_count}/{source_count}.")); }
    sqlx::query("INSERT INTO schema_meta(key,value) VALUES('normalized_fund_storage_v4','applied') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    // Keep one verified rollback copy and remove the duplicate live JSON table.
    sqlx::query("DROP TABLE schemes").execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    transaction.commit().await.map_err(|error| error.to_string())?;
    Ok(migrated_count as usize)
}

#[tauri::command]
async fn write_normalized_funds(app: AppHandle, records: Vec<Value>, metrics_only: bool, replace_all: Option<bool>) -> Result<(), String> {
    let pool = connect_fundscope_db(&app).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    if replace_all.unwrap_or(false) {
        sqlx::query("DELETE FROM fund_detail").execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM fund_metrics").execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM fund_list").execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM nav").execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    write_normalized_rows(&mut transaction, &records, metrics_only).await?;
    transaction.commit().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_normalized_nav_history(app: AppHandle, code: i64, points: Vec<Value>, loaded_at: i64) -> Result<(), String> {
    let pool = connect_fundscope_db(&app).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    for batch in points.chunks(200) {
        let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO nav (scheme_code,date,nav) ");
        query.push_values(batch, |mut row, point| { row.push_bind(code).push_bind(as_i64(point, "date").unwrap_or_default()).push_bind(as_f64(point, "nav").unwrap_or_default()); });
        query.push(" ON CONFLICT(scheme_code,date) DO UPDATE SET nav=excluded.nav WHERE nav.nav IS NOT excluded.nav");
        query.build().execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    sqlx::query("UPDATE fund_list SET history_fetched_at=?1,history_status='ok',history_last_error=NULL,history_next_retry_at=NULL WHERE scheme_code=?2")
        .bind(loaded_at).bind(code).execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    transaction.commit().await.map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create local source and scheme tables",
            sql: "CREATE TABLE IF NOT EXISTS schemes (scheme_code INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS nav (scheme_code INTEGER NOT NULL, date INTEGER NOT NULL, nav REAL NOT NULL, PRIMARY KEY(scheme_code,date)); CREATE TABLE IF NOT EXISTS source_state (source_id TEXT PRIMARY KEY, fetched_at INTEGER, data_as_of INTEGER, status TEXT NOT NULL, detail TEXT);",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "add immutable fund taxonomy history",
            sql: "CREATE TABLE IF NOT EXISTS scheme_taxonomy (scheme_code INTEGER PRIMARY KEY, category_raw TEXT NOT NULL, sub_category TEXT NOT NULL, asset_class TEXT NOT NULL, rule_id TEXT NOT NULL, taxonomy_version INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS taxonomy_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme_code INTEGER NOT NULL, stored_category TEXT NOT NULL, incoming_category TEXT NOT NULL, stored_class TEXT NOT NULL, incoming_class TEXT NOT NULL, stored_rule TEXT NOT NULL, incoming_rule TEXT NOT NULL, stored_version INTEGER NOT NULL, incoming_version INTEGER NOT NULL, observed_at INTEGER NOT NULL, UNIQUE(scheme_code,stored_category,incoming_category,stored_class,incoming_class,stored_rule,incoming_rule,stored_version,incoming_version));",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "create typed fund list, metrics and detail tables",
            sql: "CREATE TABLE IF NOT EXISTS fund_list (scheme_code INTEGER PRIMARY KEY,isin_growth TEXT,isin_reinvestment TEXT,name TEXT NOT NULL,amc TEXT NOT NULL,category TEXT NOT NULL,asset_class TEXT NOT NULL,class_rule_id TEXT NOT NULL,taxonomy_version INTEGER NOT NULL,sub_category TEXT NOT NULL,management TEXT,fund_group TEXT,risk_band TEXT,philosophy TEXT,speciality TEXT NOT NULL DEFAULT '',lifecycle TEXT,structure TEXT NOT NULL,plan TEXT NOT NULL,option TEXT NOT NULL,nav REAL NOT NULL,nav_date INTEGER NOT NULL,class_status TEXT,header_raw TEXT,history_fetched_at INTEGER,history_status TEXT,history_attempts INTEGER,history_last_error TEXT,history_next_retry_at INTEGER,metrics_nav_as_of INTEGER); CREATE INDEX IF NOT EXISTS idx_fund_list_amc ON fund_list(amc); CREATE INDEX IF NOT EXISTS idx_fund_list_category ON fund_list(sub_category); CREATE INDEX IF NOT EXISTS idx_fund_list_asset_class ON fund_list(asset_class); CREATE INDEX IF NOT EXISTS idx_fund_list_structure ON fund_list(structure); CREATE INDEX IF NOT EXISTS idx_fund_list_plan ON fund_list(plan); CREATE INDEX IF NOT EXISTS idx_fund_list_option ON fund_list(option); CREATE INDEX IF NOT EXISTS idx_fund_list_management ON fund_list(management); CREATE INDEX IF NOT EXISTS idx_fund_list_nav_date ON fund_list(nav_date); CREATE TABLE IF NOT EXISTS fund_metrics (scheme_code INTEGER NOT NULL,metric_id TEXT NOT NULL,metric_value REAL,reason_code TEXT,PRIMARY KEY(scheme_code,metric_id),FOREIGN KEY(scheme_code) REFERENCES fund_list(scheme_code) ON DELETE CASCADE) WITHOUT ROWID; CREATE INDEX IF NOT EXISTS idx_fund_metrics_id_value ON fund_metrics(metric_id,metric_value); CREATE TABLE IF NOT EXISTS fund_detail (scheme_code INTEGER PRIMARY KEY,payload TEXT NOT NULL,FOREIGN KEY(scheme_code) REFERENCES fund_list(scheme_code) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_nav_scheme_date ON nav(scheme_code,date DESC);",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "index remaining fund facets",
            sql: "CREATE INDEX IF NOT EXISTS idx_fund_list_group ON fund_list(fund_group); CREATE INDEX IF NOT EXISTS idx_fund_list_risk_band ON fund_list(risk_band); CREATE INDEX IF NOT EXISTS idx_fund_list_lifecycle ON fund_list(lifecycle);",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:fundscope.db", migrations).build())
        .invoke_handler(tauri::generate_handler![migrate_normalized_fund_storage, write_normalized_funds, save_normalized_nav_history])
        .run(tauri::generate_context!())
        .expect("error while running FundScope");
}

#[cfg(test)]
mod tests {
    use super::record_from_legacy_payload;

    #[test]
    fn legacy_projection_separates_typed_list_metrics_details_and_nav() {
        let payload = r#"{"code":123,"name":"Fund A","amc":"AMC A","category":"Equity","assetClass":"equity","classRuleId":"TEST","taxonomyVersion":3,"subCategory":"Flexi Cap","structure":"open","plan":"Direct","option":"Growth","nav":25.5,"navDate":20500,"history":[{"date":20499,"nav":25.1},{"date":20500,"nav":25.5}],"metrics":{"cagr_3y":12.5,"ter_pct":null},"metricReasons":{"ter_pct":"SOURCE_MISSING"},"classDetail":{"s1":{"categoryRaw":"Equity"}}}"#;
        let projected = record_from_legacy_payload(payload, 123).expect("valid legacy fund");
        assert_eq!(projected["list"]["code"], 123);
        assert_eq!(projected["list"]["nav_date"], 20500);
        assert_eq!(projected["metrics"].as_array().unwrap().len(), 2);
        assert_eq!(projected["metrics"][1]["reasonCode"], "SOURCE_MISSING");
        assert_eq!(projected["history"].as_array().unwrap().len(), 2);
        let detail: serde_json::Value = serde_json::from_str(projected["detailJson"].as_str().unwrap()).unwrap();
        assert_eq!(detail["classDetail"]["s1"]["categoryRaw"], "Equity");
        assert!(detail.get("history").is_none());
    }
}
