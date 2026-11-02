import { isPassphraseStrong } from './passphrase-policy.mjs';

const passphrase = process.env.DATA_PASSPHRASE ?? '';
const allowWeak = process.env.ALLOW_WEAK_PASSPHRASE === 'true' && process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true';
if (!passphrase) { console.error('DATA_PASSPHRASE is not set.'); process.exit(1); }
if (!isPassphraseStrong(passphrase) && !allowWeak) {
  console.error('DATA_PASSPHRASE is estimated below 80 bits. Generate a 20-character base32 passphrase with `pnpm passphrase:generate`.');
  process.exit(1);
}
if (allowWeak && !isPassphraseStrong(passphrase)) console.warn('Weak passphrase accepted for local testing only; it can never be accepted in GitHub Actions.');
else console.log('DATA_PASSPHRASE meets the configured entropy estimate (value redacted).');
