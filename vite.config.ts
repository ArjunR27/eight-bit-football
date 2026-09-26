import { defineConfig } from 'vite';

// Relative base so the build works from any static host path (GitHub Pages, Netlify, etc.)
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
