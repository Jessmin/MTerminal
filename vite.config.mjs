import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react(), {
    name: 'development-csp',
    transformIndexHtml(html) {
      // Vite's local React refresh preamble uses an inline module in development.
      // The packaged HTML retains its restrictive production policy.
      return command === 'serve' ? html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '') : html;
    },
  }], base: './',
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
}));
