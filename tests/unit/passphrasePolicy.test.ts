import { describe, expect, it } from 'vitest';
import { estimatePassphraseBits, isPassphraseStrong } from '../../scripts/passphrase-policy.mjs';

describe('published snapshot passphrase policy', () => {
  it('accepts the generated 20-character base32 format and rejects common or patterned passphrases', () => {
    expect(estimatePassphraseBits('A7QK-P2XM-9D4R-T8VW-3C6J')).toBeGreaterThanOrEqual(80);
    expect(isPassphraseStrong('A7QK-P2XM-9D4R-T8VW-3C6J')).toBe(true);
    expect(isPassphraseStrong('password-password')).toBe(false);
    expect(isPassphraseStrong('abcdabcdabcdabcdabcd')).toBe(false);
  });

  it('estimates more bits as independent character classes and length are added', () => {
    expect(estimatePassphraseBits('randomword')).toBeLessThan(estimatePassphraseBits('Ab7!randomword-longer'));
  });
});
