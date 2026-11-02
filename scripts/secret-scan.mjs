import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { isPassphraseStrong } from './passphrase-policy.mjs';

const scanRoots = ['src', 'config', 'etl', 'scripts', '.github', 'dist'];
const allowedExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.yml', '.yaml', '.md', '.txt', '.toml']);
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{35,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
];
const findings = [];
if (process.env.ENCRYPT_DATA !== 'false' && process.env.DATA_PASSPHRASE && !isPassphraseStrong(process.env.DATA_PASSPHRASE)) {
  console.error('DATA_PASSPHRASE is estimated below 80 bits (value omitted).');
  process.exitCode = 1;
}
if (process.env.ALLOW_WEAK_PASSPHRASE === 'true' && (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true')) {
  console.error('ALLOW_WEAK_PASSPHRASE is forbidden in CI and GitHub Actions.');
  process.exitCode = 1;
}
async function scan(path) {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (['node_modules', '.git', '.data', 'target'].includes(entry.name) || entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await scan(child);
    else if (allowedExtensions.has(extname(entry.name).toLowerCase())) {
      const content = await readFile(child, 'utf8');
      for (const signature of signatures) if (signature.test(content)) { findings.push(resolve(child)); break; }
    }
  }
}
for (const root of scanRoots) await scan(resolve(root));
if (findings.length) {
  console.error('Potential credential material found (values omitted):');
  for (const path of findings) console.error(`- ${path}`);
  process.exitCode = 1;
} else console.log('Secret scan passed; no known credential signatures found in source or build output.');
