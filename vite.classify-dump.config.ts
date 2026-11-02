import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'scripts/classify-dump.mjs',
    outDir: '.data/classify-dump',
    emptyOutDir: true,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'classify-dump.mjs' },
    },
  },
});
