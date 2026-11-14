import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parsePublicBasePath } from './src/config/env';

const sourceProxy = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(prefix, ''),
});

export default defineConfig(({ mode }) => ({
  base: mode === 'web' ? parsePublicBasePath() : '/',
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true,
    proxy: {
      '/__fundscope_source/amfi-portal': sourceProxy('https://portal.amfiindia.com', '/__fundscope_source/amfi-portal'),
      '/__fundscope_source/amfi-www': sourceProxy('https://www.amfiindia.com', '/__fundscope_source/amfi-www'),
      '/__fundscope_source/amfi-root': sourceProxy('https://amfiindia.com', '/__fundscope_source/amfi-root'),
      '/__fundscope_source/mfapi': sourceProxy('https://api.mfapi.in', '/__fundscope_source/mfapi'),
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
}));
