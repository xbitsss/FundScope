import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { decodeFundColumns } from '../../src/adapters/snapshot/columnar';
import { encodeNormalizedFundIndex, fromNormalizedFundRows, toNormalizedFundWrite, type NormalizedFundListRow } from '../../src/adapters/sqlite/normalized';
import { NodeSqliteRepository } from '../../src/adapters/node/NodeSqliteRepository.mjs';

const openRepositories: NodeSqliteRepository[] = [];
afterEach(() => {
  for (const repository of openRepositories.splice(0)) repository.close();
});

const fund=(values:Partial<Fund>={}):Fund=>({
  code:123,isinGrowth:'INF123A01010',isinReinvestment:null,name:'Example Direct Growth Fund',amc:'Example AMC',category:'Equity',assetClass:'equity',classRuleId:'TEST_RULE',taxonomyVersion:3,subCategory:'Flexi Cap',management:'Active',group:'Diversified',riskBand:'High',philosophy:'Blend/Unspecified',speciality:['Large Cap'],lifecycle:'active',structure:'open',plan:'Direct',option:'Growth',nav:25.5,navDate:20_500,history:[{date:20_499,nav:25.1},{date:20_500,nav:25.5}],historyFetchedAt:1_767_000_000_000,metricsNavAsOf:20_500,metrics:{cagr_3y:12.5,sharpe:0.84,ter_pct:null},metricReasons:{ter_pct:'SOURCE_MISSING'},schemeMaster:{name:'Example Direct Growth Fund',schemeType:'Open Ended Schemes',categoryRaw:'Equity',navName:'Example',minimumAmount:500,launchDate:null,closureDate:null,isinGrowth:'INF123A01010',isinReinvestment:null,joinMethod:'scheme_code'},...values,
});

describe('normalized desktop SQLite storage',()=>{
  it('projects typed columns and rebuilds a lightweight fund with nullable metrics and reason codes',()=>{
    const original=fund();const write=toNormalizedFundWrite(original);
    expect(write.list.code).toBe(original.code);
    expect(write.list.nav_date).toBe(original.navDate);
    expect(write.metrics).toContainEqual({metricId:'ter_pct',value:null,reasonCode:'SOURCE_MISSING'});
    const list:NormalizedFundListRow={scheme_code:write.list.code,isin_growth:write.list.isin_growth,isin_reinvestment:write.list.isin_reinvestment,name:write.list.name,amc:write.list.amc,category:write.list.category,asset_class:write.list.asset_class,class_rule_id:write.list.class_rule_id,taxonomy_version:write.list.taxonomy_version,sub_category:write.list.sub_category,management:write.list.management,fund_group:write.list.fund_group,risk_band:write.list.risk_band,philosophy:write.list.philosophy,speciality:write.list.speciality,lifecycle:write.list.lifecycle,structure:write.list.structure,plan:write.list.plan,option:write.list.option,nav:write.list.nav,nav_date:write.list.nav_date,class_status:write.list.class_status,header_raw:write.list.header_raw,history_fetched_at:write.list.history_fetched_at,history_status:write.list.history_status,history_attempts:write.list.history_attempts,history_last_error:write.list.history_last_error,history_next_retry_at:write.list.history_next_retry_at,metrics_nav_as_of:write.list.metrics_nav_as_of};
    const decoded=fromNormalizedFundRows([list],write.metrics.map(metric=>({scheme_code:write.list.code,metric_id:metric.metricId,metric_value:metric.value,reason_code:metric.reasonCode})));
    expect(decoded[0]).toMatchObject({code:123,name:original.name,nav:25.5,navDate:20_500,history:[],metrics:{cagr_3y:12.5,sharpe:0.84,ter_pct:null},metricReasons:{ter_pct:'SOURCE_MISSING'}});
    expect(decoded[0]?.schemeMaster).toBeUndefined();
    const workerIndex=decodeFundColumns(encodeNormalizedFundIndex([list],write.metrics.map(metric=>({scheme_code:write.list.code,metric_id:metric.metricId,metric_value:metric.value,reason_code:metric.reasonCode}))));
    expect(workerIndex[0]).toMatchObject({code:123,name:original.name,nav:25.5,navDate:20_500,metrics:{cagr_3y:12.5,ter_pct:null},metricReasons:{ter_pct:'SOURCE_MISSING'}});
    expect(workerIndex[0]?.metrics.sharpe).toBeCloseTo(0.84,6);
  });

  it('keeps the JSON backup and writes the normalized rows, details, metrics and NAV in one SQLite transaction',()=>{
    const dir=mkdtempSync(join(tmpdir(),'fundscope-normalized-'));
    const repo=new NodeSqliteRepository(join(dir,'fundscope.db')).initialize();openRepositories.push(repo);
    const migrationPath=fileURLToPath(new URL('../../src/adapters/sqlite/migrations/0004_normalized_fund_list.sql',import.meta.url));
    repo.db.exec(readFileSync(migrationPath,'utf8'));
    const original=fund();repo.saveFunds([original]);
    const apply=repo.db.transaction(()=>{
      repo.db.exec('CREATE TABLE IF NOT EXISTS schemes_typed_v4_backup AS SELECT * FROM schemes');
      const source=repo.db.prepare('SELECT scheme_code,payload FROM schemes ORDER BY scheme_code').get() as {scheme_code:number;payload:string};
      const write=toNormalizedFundWrite(JSON.parse(source.payload) as Fund);
      const list=write.list;const columns=Object.keys(list).map(key=>key==='code'?'scheme_code':key);const values=Object.values(list);
      repo.db.prepare(`INSERT INTO fund_list (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...values);
      const metric=repo.db.prepare('INSERT INTO fund_metrics(scheme_code,metric_id,metric_value,reason_code) VALUES(?,?,?,?)');
      for(const row of write.metrics)metric.run(list.code,row.metricId,row.value,row.reasonCode);
      repo.db.prepare('INSERT INTO fund_detail(scheme_code,payload) VALUES(?,?)').run(list.code,write.detailJson);
      const nav=repo.db.prepare('INSERT INTO nav(scheme_code,date,nav) VALUES(?,?,?)');for(const point of write.history)nav.run(list.code,point.date,point.nav);
      repo.db.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('normalized_fund_storage_v4','applied');
      repo.db.exec('DROP TABLE schemes');
    });
    apply();
    expect(repo.db.prepare('SELECT COUNT(*) AS count FROM schemes_typed_v4_backup').get()).toMatchObject({count:1});
    expect(repo.db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'schemes\'').get()).toBeUndefined();
    expect(repo.db.prepare('SELECT metric_value,reason_code FROM fund_metrics WHERE scheme_code=123 AND metric_id=\'ter_pct\'').get()).toMatchObject({metric_value:null,reason_code:'SOURCE_MISSING'});
    expect(repo.db.prepare('SELECT COUNT(*) AS count FROM nav WHERE scheme_code=123').get()).toMatchObject({count:2});
    expect(repo.db.prepare('SELECT value FROM schema_meta WHERE key=\'normalized_fund_storage_v4\'').get()).toMatchObject({value:'applied'});
    openRepositories.splice(openRepositories.indexOf(repo),1);repo.close();rmSync(dir,{recursive:true,force:true});
  });
});
