import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

describe('hosting environment configuration', () => {
  it('fails closed when snapshot encryption is enabled without a passphrase', () => {
    expect(() => parseEnv({ ENCRYPT_DATA: 'true', DATA_PASSPHRASE: '' })).toThrow(/DATA_PASSPHRASE/);
  });

  it('allows a code-only snapshot restore without a data key', () => {
    expect(parseEnv({ ENCRYPT_DATA: 'false', GITHUB_REPOSITORY: 'xbitsss/FundScope' }).ENCRYPT_DATA).toBe(false);
  });

  it('rejects insecure public path configuration', () => {
    expect(() => parseEnv({ ENCRYPT_DATA: 'false', PUBLIC_BASE_PATH: 'FundScope' })).toThrow(/PUBLIC_BASE_PATH/);
  });
});
