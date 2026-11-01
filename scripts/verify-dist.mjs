import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const limit = Number(process.env.MAX_SITE_SIZE_MB ?? 950) * 1024 * 1024;
const manifest = JSON.parse(await readFile(join(dist, 'data', 'manifest.json'), 'utf8'));
const files = [manifest.index, manifest.encryption?.canary, ...Object.values(manifest.histories ?? {})].filter(Boolean);
let total = 0;
for (const ref of files) {
  const path = resolve(dist, ref.path);
  if (!path.startsWith(`${dist}\`) && !path.startsWith(`${dist}/`)) throw new Error(`Snapshot reference escapes dist: ${ref.path}`);
  const bytes = await readFile(path); const actual = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== ref.encryptedBytes || actual !== ref.sha256) throw new Error(`Snapshot file integrity mismatch: ${ref.path}`);
  total += bytes.byteLength;
}
async function size(dir) { let sum = 0; for (const entry of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); sum += entry.isDirectory() ? await size(path) : (await stat(path)).size; } return sum; }
const siteBytes = await size(dist);
if (siteBytes > limit) throw new Error(`dist is ${(siteBytes / 1048576).toFixed(1)} MiB; limit is ${process.env.MAX_SITE_SIZE_MB ?? 950} MiB.`);
console.log(`Verified ${files.length.toLocaleString('en-IN')} encrypted snapshot files (${(total / 1048576).toFixed(1)} MiB) and ${(siteBytes / 1048576).toFixed(1)} MiB dist.`);
