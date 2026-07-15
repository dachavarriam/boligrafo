import { defineConfig } from 'vite';

// base: './' hace que el build funcione en cualquier ruta
// (Cloudflare Pages, subcarpeta de tu homelab, file://, etc.)
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});
