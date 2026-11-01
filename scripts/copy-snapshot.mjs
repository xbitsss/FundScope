import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = resolve('.data/snapshot/data');
const target = resolve('dist/data');
const manifest = join(source, 'manifest.json');
try { await stat(manifest); } catch { throw new Error('No generated encrypted snapshot was found. Run the full ETL first or restore the latest snapshot release.'); }
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

async function sizeOf(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await sizeOf(path) : (await stat(path)).size;
  }
  return bytes;
}
const size = await sizeOf(resolve('dist'));
const limitMb = Number(process.env.MAX_SITE_SIZE_MB || 950);
if (!Number.isFinite(limitMb) || limitMb < 1 || size > limitMb * 1024 * 1024) throw new Error(`Built Pages site is ${(size / 1048576).toFixed(1)} MiB; limit is ${limitMb} MiB.`);
console.log(`Copied encrypted snapshot into Pages output: ${(size / 1048576).toFixed(1)} MiB total.`);
