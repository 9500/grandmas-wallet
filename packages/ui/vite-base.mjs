// Build settings shared by the web applications.
//
// The XO state package imports Node-only modules (fs, path, better-sqlite3, indexeddbshim) for a storage
// driver a browser never uses; they are replaced with empty stand-ins, as the XO web tool does.
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const here = new URL('.', import.meta.url).pathname;

/** @param {string} root - the application's directory  @param {number} port - port for the development server */
export const appConfig = (root, port) =>
  defineConfig({
    root,
    base: '/',
    logLevel: 'warn',
    plugins: [nodePolyfills({ include: ['path', 'process', 'buffer'], globals: { process: true, Buffer: true, global: true }, protocolImports: true })],
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    resolve: {
      alias: { fs: `${here}mocks/fs.js`, 'better-sqlite3': `${here}mocks/empty-module.js`, indexeddbshim: `${here}mocks/indexeddbshim.js` },
    },
    build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
    server: { port, host: '127.0.0.1', strictPort: true },
  });
