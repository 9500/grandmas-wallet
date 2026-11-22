// The engine's part of one join, in a process of its own (see engine.ts). Started by the server; not by hand.
//
// Standard output carries the answers alone, one line of JSON each: whatever the libraries print goes to standard
// error, which the server does not keep. Nothing is written to disk: the engine keeps its state in memory.
import 'fake-indexeddb/auto';
import { createInterface } from 'node:readline';

import { generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { typedValues } from '@grandmas-wallet/core';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork, validateInvitation } from '@xo-cash/engine';
import type { XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

import type { ChildMessage, EngineJob, EngineServer, ParentMessage } from './engine.js';

const write = process.stdout.write.bind(process.stdout);
for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) console[name] = (...parts: unknown[]) => void process.stderr.write(`${parts.map(String).join(' ')}\n`);
const send = (message: ChildMessage): void => void write(`${JSON.stringify(message)}\n`);
const short = (error: unknown): string => String((error as Error)?.message ?? error).replace(/\s+/g, ' ').slice(0, 160);

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const next = async (): Promise<ParentMessage | undefined> => {
  const line = await lines.next();
  return line.done === true ? undefined : (JSON.parse(line.value) as ParentMessage);
};

/** A regtest chain, as the local node and the mockup network run it, from a block of it the server read. */
const REGTEST_TARGET = BigInt(`0x7fffff${'00'.repeat(29)}`);
const regtestBlockchain = (checkpoint: NonNullable<EngineServer['checkpoint']>) => ({
  genesis: { height: 0, blockHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b' },
  checkpoint,
  difficultyParameters: {
    minimumDifficultyTarget: REGTEST_TARGET,
    allowMinimumDifficultyBlocks: true,
    difficultyAlgorithm: 'aserti3-2d',
    asertActivationHeight: 1,
    asertAnchoredBlockHeight: 0,
    asertAnchoredTarget: REGTEST_TARGET,
    asertAnchoredParentTimestamp: 1296688602,
    asertHalfLifeInSeconds: 3600,
    asertIdealBlockTimeSchedule: [{ fromHeight: 0, idealBlockTimeInSeconds: 600 }],
  },
});

/** The engine reads nothing of the chain for a join, but it opens only with a server it has checked. */
const serversOf = (job: EngineJob, network: (typeof XO_SUPPORTED_NETWORKS)[keyof typeof XO_SUPPORTED_NETWORKS]) => {
  if (job.server === undefined) return undefined;
  const url = new URL(job.server.url);
  const encrypted = url.protocol === 'wss:';
  const port = url.port === '' ? (encrypted ? 443 : 80) : Number(url.port);
  const blockchain = job.server.checkpoint === undefined ? (resolveElectrumServersForNetwork(network) as unknown as { blockchain: unknown }[])[0]?.blockchain : regtestBlockchain(job.server.checkpoint);
  return [{ electrumSocket: new ElectrumWebSocket(url.hostname, { port, encrypted }), blockchain }];
};

const run = async (): Promise<void> => {
  const first = await next();
  if (first?.kind !== 'job') return;
  const network = first.engineNetwork === 'mainnet' ? XO_SUPPORTED_NETWORKS.mainnet : XO_SUPPORTED_NETWORKS.chipnet;
  const servers = serversOf(first, network);
  let engine: Engine;
  try {
    engine = await Engine.create(generateBip39Mnemonic(), { network, ...(servers === undefined ? {} : { electrumServers: servers as never }) });
  } catch (error) {
    send({ kind: 'failed', reason: `The engine could not be opened: ${short(error)}` });
    return;
  }
  try {
    const { templateIdentifier } = await engine.importTemplate(first.templateText);
    const template = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
    let invitation: ReturnType<typeof deserializeInvitation>;
    try {
      invitation = deserializeInvitation(first.invitation);
      if (invitation.templateIdentifier !== templateIdentifier) throw new Error('The invitation is for another template.');
      validateInvitation(invitation, template, network);
    } catch (error) {
      send({ kind: 'refused', reason: `The invitation does not pass the engine's checks: ${short(error)}` });
      return;
    }
    send({ kind: 'checked' });
    const order = await next();
    if (order?.kind !== 'share') return;
    const variables = Object.entries(typedValues(template as never, order.variables)).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'service', value }));
    // One commit, in the service's role, with everything the service adds: its values, Paryon's coins with their
    // unlocking, and the template outputs that put them back. Places are the template's.
    const accepted = await engine.acceptInvitation(invitation, {
      roleIdentifier: 'service',
      ...(variables.length === 0 ? {} : { variables }),
      ...(order.inputs.length === 0
        ? {}
        : {
            inputs: order.inputs.map((input) => {
              const [transactionId, index] = input.outpoint.split(':') as [string, string];
              return { outpointTransactionHash: hexToBin(transactionId), outpointIndex: Number(index), inputIdentifier: input.inputIdentifier, unlockingBytecode: hexToBin(input.unlockingBytecode), sequenceNumber: input.sequenceNumber, roleIdentifier: 'service' };
            }),
          }),
      ...(order.outputs.length === 0 ? {} : { outputs: order.outputs.map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })) }),
    } as never);
    send({ kind: 'joined', invitation: serializeInvitation(accepted.invitation) });
  } catch (error) {
    send({ kind: 'failed', reason: short(error) });
  } finally {
    await engine.stop().catch(() => undefined);
  }
};

await run().catch((error: unknown) => send({ kind: 'failed', reason: short(error) }));
process.exit(0);
