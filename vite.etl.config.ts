import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'etl/cli.mjs',
    outDir: '.data/etl-build',
    emptyOutDir: true,
    rollupOptions: {
      external: ['better-sqlite3'],
      output: { format: 'es', entryFileNames: 'cli.mjs' },
    },
  },
  ssr: { external: ['better-sqlite3', 'dotenv'] },
});
