import { performance } from 'node:perf_hooks';
import { webcrypto } from 'node:crypto';

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('benchmark-only-generated-input'), 'PBKDF2', false, ['deriveKey']);
const iterations = [100_000, 150_000, 200_000, 250_000, 300_000];
console.log(`Node ${process.version} WebCrypto PBKDF2-SHA256 benchmark (${iterations.length} samples each)`);
console.log('The 4× column is a rough CPU-bound estimate only. It is not Chromium/CDP phone emulation.');
for (const count of iterations) {
  const samples = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: count }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[2];
  console.log(`${String(count).padStart(7)} iterations  p50 ${p50.toFixed(1)} ms  4× estimate ${(p50 * 4).toFixed(1)} ms`);
}
