import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const directory = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: directory('./frontend/'),
  publicDir: directory('./public/'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: ['./frontend', './src', './node_modules'].map(directory) },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: directory('./build/'), emptyOutDir: true, target: 'es2022' },
});
