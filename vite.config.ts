import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parsePublicBasePath } from './src/config/env';

export default defineConfig(({ mode }) => ({
  base: mode === 'web' ? parsePublicBasePath() : '/',
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
}));
