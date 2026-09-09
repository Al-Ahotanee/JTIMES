import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Alias 'vue' to the full build (runtime + compiler) because src/components.js
// and src/pages.js define components with inline `template` strings, which
// keeps the whole frontend inside the project's file-count budget instead of
// spreading dozens of individual .vue SFCs across the tree.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { vue: 'vue/dist/vue.esm-bundler.js' },
  },
  server: {
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:3000', changeOrigin: true, secure: false },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
    },
  },
  build: { outDir: 'dist' },
});

