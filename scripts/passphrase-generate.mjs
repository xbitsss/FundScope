import { randomInt } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const chars = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]);
const passphrase = chars.map((char, index) => index > 0 && index % 4 === 0 ? `-${char}` : char).join('');
console.log('Generated 100-bit FundScope passphrase (shown once):');
console.log(passphrase);
console.log('Store it in a password manager, then set the same value as DATA_PASSPHRASE in GitHub Actions Secrets.');
