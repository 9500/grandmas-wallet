// Records the deployment's live shared outputs, for the tests: they build every transaction against what was
// on chain at the time, and check it in the virtual machine without a server.
//
// usage (from the repository's root):
//   npx tsx packages/paryon/src/snapshot.ts [file]     default: packages/paryon/test/fixtures/<network>-live.json
// For Paryon's mainnet deployment, set NETWORK=mainnet: only outputs are read; nothing is sent.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex } from '@bitauth/libauth';

import { Electrum } from '../../chipnet/src/electrum.js';
import { paryonContracts, paryonDeploymentOn } from './deployment.js';
import { type LiveOutput, readParyonState } from './live.js';

const network = process.env['NETWORK'] ?? 'chipnet';
const deployment = paryonDeploymentOn(network);
if (deployment === undefined) throw new Error(`Paryon has no deployment on ${network}.`);
const file = process.argv[2] ?? fileURLToPath(new URL(`../test/fixtures/${network}-live.json`, import.meta.url));
const server = await Electrum.connect(process.env['ELECTRUM'] ?? (network === 'mainnet' ? 'wss://electrum.imaginary.cash:50004' : 'wss://chipnet.9500.cash:443'));
try {
  const contracts = paryonContracts(deployment);
  const state = await readParyonState(server, contracts);
  const tip = await server.tip();
  const written = (output: LiveOutput) => ({
    transactionId: binToHex(output.transactionHash),
    index: output.index,
    height: output.height,
    valueSatoshis: String(output.output.valueSatoshis),
    lockingBytecode: binToHex(output.output.lockingBytecode),
    ...(output.output.token === undefined
      ? {}
      : {
          token: {
            category: binToHex(output.output.token.category),
            amount: String(output.output.token.amount),
            ...(output.output.token.nft === undefined ? {} : { nft: { capability: output.output.token.nft.capability, commitment: binToHex(output.output.token.nft.commitment) } }),
          },
        }),
  });
  const snapshot = {
    deployment: contracts.deployment.name,
    readAt: new Date().toISOString(),
    server: server.endpoint,
    tip,
    borrowing: state.borrowing.map(written),
    price: state.price.map(written),
    loanKeyFactory: state.loanKeyFactory.map(written),
    manage: state.manage.map(written),
  };
  writeFileSync(file, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`tip ${tip.height}: ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((thread) => thread.period))].join(', ')}), ${state.price.length} price threads (${state.price.map((thread) => `$${Number(thread.state.price) / 100}`).join(', ')}), ${state.loanKeyFactory.length} factories, ${state.manage.length} manage NFTs. Written to ${file}`);
} finally {
  await server.disconnect();
}
