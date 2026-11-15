// Browser build settings, following what the XO web dev wallet does: the state package imports Node-only
// modules (fs, path, better-sqlite3, indexeddbshim) that have to be replaced for a browser bundle.
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const here = new URL('.', import.meta.url).pathname;
export default defineConfig({
  root: here,
  base: '',
  logLevel: 'warn',
  plugins: [nodePolyfills({ include: ['path', 'process', 'buffer'], globals: { process: true, Buffer: true, global: true }, protocolImports: true })],
  resolve: {
    alias: { fs: `${here}mocks/fs.js`, 'better-sqlite3': `${here}mocks/empty-module.js`, indexeddbshim: `${here}mocks/indexeddbshim.js` },
  },
  build: { target: 'es2022', outDir: 'dist' },
});
