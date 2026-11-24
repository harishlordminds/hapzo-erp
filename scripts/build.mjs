import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

// The offline pilot opens from disk, so its React bundle must be embedded in the HTML.
const frontend = new URL('../frontend/', import.meta.url);
const [bundle] = await build({
  root: fileURLToPath(frontend),
  configFile: false,
  publicDir: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    target: 'es2022',
    lib: { entry: fileURLToPath(new URL('pilot.jsx', frontend)), formats: ['iife'], name: 'HapzoPilot' },
  },
});
const shell = await readFile(new URL('pilot.html', frontend), 'utf8');
const code = bundle.output.find(file => file.type === 'chunk' && file.isEntry).code;
const html = shell.replace('<script type="module" src="/pilot.jsx"></script>',
  () => '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>');
await writeFile(new URL('../HAPZO_Decaste_ERP_Pilot.html', import.meta.url), html);
