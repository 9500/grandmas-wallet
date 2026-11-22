// Run Paryon's service.
//
// usage (from the repository's root):
//   node --import tsx apps/paryon-service/src/cli.ts --config deploy/config/production.json [--host 127.0.0.1] [--port 8106] [--path /service/v1]
//
// The networks it serves, Paryon's deployment on each and the Electrum servers it reads them from come from the
// configuration file, as for the pages: mainnet only with "mainnetEnabled": true. It listens on plain HTTP; on the loan
// page's host, deploy/serve.mjs forwards the path to it (--forward /service/=http://127.0.0.1:8106).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { type ServiceConfig, paryonServiceServer } from './server.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string', default: 'deploy/config/production.json' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8106' },
    path: { type: 'string', default: '/service/v1' },
  },
});

const configPath = resolve(values.config);
const config = JSON.parse(readFileSync(configPath, 'utf8')) as ServiceConfig;
let service: ReturnType<typeof paryonServiceServer>;
try {
  service = paryonServiceServer({ config, path: values.path });
} catch (error) {
  console.error(`${configPath}: ${(error as Error).message} Not started.`);
  process.exit(1);
}
for (const { network, reason } of service.skipped) console.log(`not served: ${network}, ${reason}`);
if (service.served.some(({ network }) => network === 'mainnet')) console.log('MAINNET served: enabled only to meet the requirements of BCH Blaze. Nothing here has been audited; coins can be lost. This project does not recommend enabling it.');
service.server.listen(Number(values.port), values.host, () => {
  console.log(`Paryon's service at http://${values.host}:${values.port}${values.path} with ${configPath}`);
  for (const { network, template } of service.served) console.log(`serves ${network}: template ${template.identifier}, content ${template.contentHash}`);
});
const stop = (): void => {
  void service.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
