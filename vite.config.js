import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { showPhotosScanPlugin } from './plugins/showPhotosScan.js';

export default defineConfig({
  plugins: [showPhotosScanPlugin(), react()],
  // Use relative paths so assets work on GitHub Pages project sites.
  base: './',
});

