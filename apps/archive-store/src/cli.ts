// Run a backup store.
//
// usage: tsx cli.ts [--port 8787] [--host 127.0.0.1] [--directory ./data] [--origin https://wallet.example ...]
import { parseArgs } from 'node:util';

import { createStoreServer } from './server.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    host: { type: 'string', default: '127.0.0.1' },
    directory: { type: 'string' },
    origin: { type: 'string', multiple: true },
  },
});

const server = createStoreServer({
  ...(values.directory === undefined ? {} : { directory: values.directory }),
  ...(values.origin === undefined ? {} : { allowedOrigins: values.origin }),
});
server.listen(Number(values.port), values.host, () => {
  console.log(`Backup store listening on http://${values.host}:${values.port}` + (values.directory === undefined ? ' (memory only)' : `, keeping blobs in ${values.directory}`));
});
