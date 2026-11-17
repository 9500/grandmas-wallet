import type { EndState } from './lifecycle.js';
import type { RunState } from './store.js';

/** What a run's log says about where and with what it ran. */
export interface RunSurroundings {
  title: string;
  /** For example "local node (regtest)" or "chipnet". */
  chain: string;
  /** One line for each server or node the run used. */
  servers: string[];
  /** Compiler, library and runtime versions. */
  versions: Record<string, string>;
  /** The compiled contracts: size in bytes and SHA-256 of the bytecode. */
  contracts: { name: string; bytes: number; sha256: string }[];
  /** The commit of the repository the run was made from, when known. */
  commit?: string;
  end?: EndState;
}

const cell = (text: string): string => text.replaceAll('|', '/').replace(/\s+/g, ' ').trim();

/** The log of a run as markdown: what ran, each step with its transaction, size and fee, and each refusal with the node's words. */
export const renderLog = (state: RunState, surroundings: RunSurroundings): string => {
  const steps = state.stepOrder.flatMap((name) => {
    const step = state.steps[name];
    return step === undefined ? [] : [{ name, step }];
  });
  const sent = steps.filter(({ step }) => step.status === 'done' || step.status === 'pending');
  const refused = steps.filter(({ step }) => step.status === 'refused-as-expected' || step.status === 'ACCEPTED-UNEXPECTEDLY');
  const totalFees = sent.filter(({ step }) => step.status === 'done').reduce((sum, { step }) => sum + BigInt(step.feeSatoshis), 0n);
  const totalBytes = sent.filter(({ step }) => step.status === 'done').reduce((sum, { step }) => sum + step.bytes, 0);
  const first = steps[0]?.step.at;
  const last = steps[steps.length - 1]?.step.at;

  const lines = [
    `# ${surroundings.title}`,
    '',
    'Written by the run itself (`packages/chipnet/src/cli.ts`). Transactions marked refused were deliberately invalid and were never mined.',
    '',
    `- Chain: ${surroundings.chain}`,
    ...surroundings.servers.map((server) => `- ${server}`),
    `- Wallet identity: \`${state.identity ?? 'not created'}\``,
    '- Waiting period: one unit of 512 seconds',
    ...(first === undefined || last === undefined ? [] : [`- First step at ${first}, last at ${last}, by the chain's clock`]),
    ...(surroundings.commit === undefined ? [] : [`- Repository at commit \`${surroundings.commit}\``]),
    ...((state.starts?.length ?? 0) > 1 ? [`- The run was stopped and continued from its saved state: it was started ${state.starts?.length ?? 0} times (${(state.starts ?? []).join(', ')})`] : []),
    '',
    '## Versions',
    '',
    '| | |',
    '| --- | --- |',
    ...Object.entries(surroundings.versions).map(([name, version]) => `| ${name} | ${version} |`),
    '',
    '## Compiled contracts',
    '',
    '| Contract | Bytes | SHA-256 of the bytecode |',
    '| --- | --- | --- |',
    ...surroundings.contracts.map(({ name, bytes, sha256 }) => `| ${name} | ${bytes} | \`${sha256}\` |`),
    '',
    '## Steps',
    '',
    '| Step | What it shows | Result | Transaction | Bytes | Fee (sat) | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...sent.map(({ name, step }) => `| ${name} | ${cell(step.description)} | ${step.status} | \`${step.transactionId}\` | ${step.bytes} | ${step.feeSatoshis} | ${cell(step.note ?? '')} |`),
    '',
    `Accepted transactions: ${sent.filter(({ step }) => step.status === 'done').length}, ${totalBytes} bytes, ${totalFees} satoshis in fees. Every fee is the transaction's size at one satoshi per byte${sent.every(({ step }) => step.feeSatoshis === step.requiredFeeSatoshis) ? '' : ', except where a note says otherwise'}.`,
    '',
    '## Refusals',
    '',
    '| Step | What was tried | Result | The node\'s words | This project\'s own check |',
    '| --- | --- | --- | --- | --- |',
    ...refused.map(({ name, step }) => `| ${name} | ${cell(step.description)} | ${step.status} | ${cell(step.networkReply ?? '')} | ${cell(step.localCheck ?? '')} |`),
    '',
  ];
  if (surroundings.end !== undefined) {
    const { end } = surroundings;
    lines.push(
      '## What is left',
      '',
      `- At the funding address: ${end.returnedSatoshis} satoshis.`,
      `- The controller's history ends with a closing: ${end.closed ? 'yes' : 'no'}.`,
      end.leftBehind.length === 0
        ? '- At every other script of the run (the controller, the recoverer\'s fee address, every address of both seeds): nothing.'
        : `- Left behind: ${end.leftBehind.map(({ name, outputs, valueSatoshis }) => `${name}: ${outputs} output(s), ${valueSatoshis} satoshis`).join('; ')}.`,
      '',
    );
  }
  return lines.join('\n');
};
