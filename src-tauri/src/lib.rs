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
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:fundscope.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running FundScope");
}
