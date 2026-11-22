import { binToHex } from '@bitauth/libauth';
import { paryonArtifacts } from '@paryonusd/contracts';
import { describe, expect, it } from 'vitest';

import { CHIPNET_FAST_PERIODS_6, MAINNET_V1, paryonChipnetTemplateTextV1, paryonChipnetTemplateTextV2, paryonContracts, paryonMainnetTemplateTextV2, paryonTemplateSource } from '../src/index.js';

/**
 * What the template offers, and where: the actions a borrower may start with, and those a script of the template offers
 * a borrower who holds a coin there (follow-up actions). Version 2 starts only what needs no coin of the borrower's;
 * version 1, kept as frozen, offered everything as a start and declared nothing on its scripts.
 */

interface Intent { action: string; role: string }
interface TemplateParts {
  start: Intent[];
  actions: Record<string, { transaction: string; roles: Record<string, { requirements: { variables: string[] } }> }>;
  transactions: Record<string, { inputs: { input: string; inputIndex: number }[]; outputs: { output: string; outputIndex: number }[]; version: number; locktime: number }>;
  inputs: Record<string, { unlockingScript: string }>;
  outputs: Record<string, { lockingScript: string; valueSatoshis: string; token?: { category: string; amount: string | null; nft: { capability: string; commitment: string } | null } }>;
  lockingScripts: Record<string, { lockingBytecode: string; roles: Record<string, { selectable: boolean; relevant: boolean; actions?: Intent[] }> }>;
  scripts: Record<string, string>;
  variables: Record<string, { type: string }>;
}
const parts = (text: string): TemplateParts => JSON.parse(text) as TemplateParts;
/** Which actions each script offers the borrower, for the scripts that offer any. */
const offered = (template: TemplateParts): Record<string, string[]> =>
  Object.fromEntries(Object.entries(template.lockingScripts).flatMap(([name, script]) => (script.roles['borrower']?.actions === undefined ? [] : [[name, script.roles['borrower'].actions.map(({ action }) => action)]])));

describe('version 2: where each action is offered', () => {
  for (const [deployment, text] of [[CHIPNET_FAST_PERIODS_6, paryonChipnetTemplateTextV2], [MAINNET_V1, paryonMainnetTemplateTextV2]] as const) {
    it(`${deployment.name}: starts with making a key and bringing Paryon up to date, and nothing else`, () => {
      expect(parts(text).start).toEqual([
        { action: 'createKey', role: 'borrower' },
        { action: 'movePeriod', role: 'borrower' },
      ]);
    });

    it(`${deployment.name}: the key waiting in Paryon's contract offers the borrowing; a loan offers managing, repaying, closing and changing its interest rate; no other script offers anything`, () => {
      const template = parts(text);
      expect(offered(template)).toEqual({ originEnforcerContract: ['borrow'], loanContract: ['manage', 'repay', 'close', 'changeInterest'] });
      for (const script of Object.values(template.lockingScripts)) expect(script.roles['borrower']?.actions?.every(({ role }) => role === 'borrower') ?? true).toBe(true);
      // Every action is reachable: a start, or offered by a script.
      const reachable = new Set([...template.start.map(({ action }) => action), ...Object.values(offered(template)).flat()]);
      expect([...reachable].sort()).toEqual(Object.keys(template.actions).sort());
    });

    it(`${deployment.name}: each action offered by a script spends a coin at that script, and a loan left open is again at the loan's script, with the same actions`, () => {
      const template = parts(text);
      for (const [scriptName, actions] of Object.entries(offered(template))) {
        for (const action of actions) {
          const transaction = template.transactions[template.actions[action]?.transaction ?? ''];
          const spentScripts = (transaction?.inputs ?? []).map(({ input }) => template.inputs[input]?.unlockingScript);
          // The input that spends a coin at the script: the loan's for the loan, the waiting key's for the borrowing.
          const inputOf = { loanContract: 'loanInput', originEnforcerContract: 'enforcerInput' }[scriptName as 'loanContract' | 'originEnforcerContract'];
          expect(transaction?.inputs.map(({ input }) => input)).toContain(inputOf);
          expect(spentScripts.length).toBeGreaterThan(0);
        }
      }
      // Borrowing, managing, repaying and changing the rate make the loan's output at the loan's script; closing makes none.
      const leavesALoan = Object.entries(template.actions)
        .filter(([, action]) => template.transactions[action.transaction]?.outputs.some(({ output }) => template.outputs[output]?.lockingScript === 'loanContract'))
        .map(([name]) => name);
      expect(leavesALoan.sort()).toEqual(['borrow', 'changeInterest', 'manage', 'repay']);
    });
  }
});

describe('version 2: changing the interest rate, as Paryon\'s contract requires it', () => {
  const source = (deployment = CHIPNET_FAST_PERIODS_6) => paryonTemplateSource(paryonContracts(deployment), 2) as unknown as TemplateParts;

  it('is the borrower\'s function of `changeInterest.cash` as published, at the same script for chipnet and mainnet', () => {
    const artifact = paryonArtifacts.loanContractFunctions.artifactFunctionChangeInterest;
    expect(artifact.abi).toEqual([{ name: 'changeInterest', inputs: [{ name: 'nextInterestRate', type: 'bytes2' }] }]);
    expect(artifact.constructorInputs).toEqual([]);
    expect(source().scripts['changeInterestBytecode']).toBe(`0x${binToHex(paryonContracts(CHIPNET_FAST_PERIODS_6).changeInterest.redeemBytecode)}`);
    expect(source(MAINNET_V1).scripts['changeInterestBytecode']).toBe(source().scripts['changeInterestBytecode']);
    // A contract with one function takes no function number: the rate alone, then the script.
    expect(source().scripts['unlockChangeInterest']).toBe('<nextInterestRate>');
  });

  it('spends the loan at input 0, its sidecar at 1 and a coin of the interest function at 2, and leaves input 3 to the wallet\'s loan key; recreates them at outputs 0 to 3', () => {
    // `changeInterest.cash`: "Inputs: 00-loan, 01-loanTokenSidecar, 02-changeInterest, 03-loanKey-or-loanManagementToken, 04-feeBch".
    const template = source();
    const transaction = template.transactions['changeInterestTransaction'];
    expect(transaction?.inputs).toEqual([
      { input: 'loanInput', inputIndex: 0 },
      { input: 'sidecarInput', inputIndex: 1 },
      { input: 'changeInterestInput', inputIndex: 2 },
    ]);
    expect(transaction?.outputs).toEqual([
      { output: 'loanOutput', outputIndex: 0 },
      { output: 'sidecarOutput', outputIndex: 1 },
      { output: 'changeInterestOutput', outputIndex: 2 },
      { output: 'keyBackOutput', outputIndex: 3 },
    ]);
    expect(template.outputs['changeInterestOutput']).toEqual({ name: 'Paryon\'s interest function', description: 'Put back as it was.', lockingScript: 'changeInterestContract', valueSatoshis: '1000', token: { category: CHIPNET_FAST_PERIODS_6.tokenIds.paryon, amount: null, nft: { capability: 'none', commitment: '08' } } });
    expect(template.lockingScripts['changeInterestContract']?.roles['borrower']).toEqual({ selectable: false, relevant: false });
    expect(template.actions['changeInterest']?.roles['borrower']?.requirements.variables).toEqual(['keyCategory', 'collateral', 'loanCommitment', 'nextInterestRate', 'keySatoshis', 'keyHolder']);
    expect(template.variables['nextInterestRate']?.type).toBe('bytes');
  });

  it('is in version 2 only: version 1 is as it was, every action a start and nothing declared on a script', () => {
    const v1 = parts(paryonChipnetTemplateTextV1);
    expect(v1.start.map(({ action }) => action)).toEqual(['createKey', 'movePeriod', 'borrow', 'manage', 'repay', 'close']);
    expect(offered(v1)).toEqual({});
    expect(Object.keys(v1.actions)).not.toContain('changeInterest');
    expect(Object.keys(v1.scripts)).not.toContain('changeInterestBytecode');
    expect(Object.keys(parts(paryonChipnetTemplateTextV2).actions)).toEqual([...Object.keys(v1.actions), 'changeInterest']);
  });
});
