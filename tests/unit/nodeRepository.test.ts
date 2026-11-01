import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteRepository } from '../../src/adapters/node/NodeSqliteRepository.mjs';

const openRepositories: NodeSqliteRepository[] = [];
afterEach(async () => {
  for (const repository of openRepositories.splice(0)) repository.close();
});

describe('nightly ETL SQLite repository', () => {
  it('round-trips fund payloads and source status and reports database integrity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fundscope-etl-'));
    const repository = new NodeSqliteRepository(join(directory, 'fundscope.db')).initialize();
    openRepositories.push(repository);
    try {
      const fund = { code: 120, name: 'Test Fund', history: [{ date: 20000, nav: 10 }], metrics: { cagr_1y: null } };
      repository.saveFunds([fund]);
      repository.setSourceState('amfi_nav', { fetchedAt: 100, dataAsOf: 200 * 86_400_000, status: 'ok', detail: 'one scheme' });
      expect(repository.getFunds()).toEqual([fund]);
      expect(repository.getSourceState('amfi_nav')).toEqual({ fetchedAt: 100, dataAsOf: 200 * 86_400_000, status: 'ok', detail: 'one scheme' });
      expect(repository.integrityCheck()).toEqual(['ok']);
    } finally {
      repository.close();
      openRepositories.splice(openRepositories.indexOf(repository), 1);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
