// A read-only look at Paryon's service on chipnet: the service app started on this machine with a configuration of
// chipnet (deploy/config/local.json, which reads chipnet from its Electrum servers), asked over xo_service_v1 for a
// hello and for what is possible with nothing held. Nothing is sent to chipnet: the service only reads Paryon's public
// outputs from an Electrum server.
//
// usage (from the repository's root): timeout 120 node --import tsx spikes/xo-engine/40-paryon-service-chipnet-look.ts [configuration]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { buildServiceHello, buildServicePossibleRequest, serviceExchange } from '../../packages/connect/src/index.ts';
import { paryonChipnetTemplateTextV3 } from '../../packages/paryon/src/index.ts';
import { readTemplate } from '../../packages/core/src/index.ts';

const CONFIG = process.argv[2] ?? 'deploy/config/local.json';
const PORT = 18_000 + Math.floor(Math.random() * 900);
const URL_ = `http://127.0.0.1:${PORT}/service/v1`;
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/paryon-service/src/cli.ts', '--config', CONFIG, '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const lines: string[] = [];
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('the service did not start')), 20_000);
  createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    console.log(`service | ${line}`);
    if (line.startsWith('Paryon\'s service at')) {
      clearTimeout(timer);
      resolve();
    }
  });
});
try {
  const { identifier, contentHash } = readTemplate(paryonChipnetTemplateTextV3);
  const template = { identifier, contentHash };
  let started = Date.now();
  const hello = await serviceExchange(URL_, buildServiceHello({ network: 'chipnet', id: 'look-hello', template, role: 'borrower' }));
  console.log(`hello (${Date.now() - started} ms):`, JSON.stringify(hello, null, 1));
  started = Date.now();
  const possible = await serviceExchange(URL_, buildServicePossibleRequest({ network: 'chipnet', id: 'look-possible', template, role: 'borrower', tokens: [], made: [] }));
  console.log(`possible (${Date.now() - started} ms):`, JSON.stringify(possible, null, 1));
  const other = await serviceExchange(URL_, buildServiceHello({ network: 'mainnet', id: 'look-mainnet', template, role: 'borrower' }));
  console.log('hello for mainnet, which this configuration does not offer:', JSON.stringify(other.carried ? other.answer : other));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('close', resolve));
  console.log('service log lines after the exchange:', lines.filter((line) => /^(hello|possible|join|unreadable) /.test(line)));
}
