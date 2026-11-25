import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The offline pilot opens from disk, so its React bundle must be embedded in the HTML.
const frontend = new URL('../frontend/', import.meta.url);
const [bundle] = await build({
  root: fileURLToPath(frontend),
  configFile: false,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    target: 'es2022',
    lib: { entry: fileURLToPath(new URL('pilot.jsx', frontend)), formats: ['iife'], name: 'HapzoPilot' },
  },
});
const shell = await readFile(new URL('pilot.html', frontend), 'utf8');
const appShell = await readFile(new URL('../build/index.html', import.meta.url), 'utf8');
const appStylesheet = appShell.match(/href="([^\"]+\.css)"/)?.[1];
if (appStylesheet) {
  const stylesheet = await readFile(new URL('../build' + appStylesheet, import.meta.url));
  await writeFile(new URL('../build/style.css', import.meta.url), stylesheet);
}
const font = await readFile(new URL('../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2', import.meta.url));
const fontFace = '@font-face{font-family:"DM Sans";font-style:normal;font-display:swap;font-weight:100 1000;src:url(data:font/woff2;base64,' + font.toString('base64') + ')}';
const code = bundle.output.find(file => file.type === 'chunk' && file.isEntry).code;
const tailwind = bundle.output.find(file => file.type === 'asset' && file.fileName.endsWith('.css'))?.source || '';
const html = shell.replace('/*DM_SANS_FONT*/', fontFace + tailwind).replace('<script type="module" src="/pilot.jsx"></script>',
  () => '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>');
await writeFile(new URL('../HAPZO_Decaste_ERP_Pilot.html', import.meta.url), html);
