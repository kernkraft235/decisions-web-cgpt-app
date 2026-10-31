import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv.includes('--widget-only')) await build({ root });
await build({
  root, configFile: false, plugins: [react()],
  build: {
    outDir: 'dist/widget', emptyOutDir: true, cssCodeSplit: false, minify: true,
    lib: { entry: fileURLToPath(new URL('../widget/entry.jsx', import.meta.url)), formats: ['es'], fileName: 'widget', cssFileName: 'widget' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
