import { readFileSync } from 'node:fs';

import { binToHex, deriveSeedFromBip39Mnemonic } from '@bitauth/libauth';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { deriveXoTemplateKey, xoTemplateKeyPath } from '@grandmas-wallet/core';
import { Crypto } from '@xo-cash/crypto';
import { compileCashAssemblyString, generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';

import {
  grandmasWalletTemplate,
  grandmasWalletTemplateIdentifier,
  savingsJarTemplate,
  savingsJarTemplateIdentifier,
} from '../src/index.js';

const frozen = (name: string) => parseTemplate(readFileSync(new URL(`../frozen/${name}.json`, import.meta.url), 'utf8'));

describe('templates', () => {
  it('are accepted by the XO template validator', () => {
    expect(() => parseTemplate(grandmasWalletTemplate)).not.toThrow();
    expect(() => parseTemplate(savingsJarTemplate)).not.toThrow();
  });

  it('match their frozen version 1; every wallet key depends on the wallet template\'s identifier', () => {
    expect(generateTemplateIdentifier(frozen('grandmas-wallet-v1'))).toBe(grandmasWalletTemplateIdentifier);
    expect(frozen('grandmas-wallet-v1')).toEqual(grandmasWalletTemplate);
    expect(generateTemplateIdentifier(frozen('savings-jar-v1'))).toBe(savingsJarTemplateIdentifier);
    expect(frozen('savings-jar-v1')).toEqual(savingsJarTemplate);
  });

  it('carry exactly the contract bytecode that the contract tests run', () => {
    expect(grandmasWalletTemplate.scripts['controllerBytecode']).toBe(`<$(<identity> OP_REVERSEBYTES)> 0x${controllerBytecodeHex}`);
    expect(grandmasWalletTemplate.scripts['walletBytecode']).toBe(`<$(<identity> OP_REVERSEBYTES)> 0x${assetBytecodeHex}`);
    expect(savingsJarTemplate.scripts['savingsJarBytecode']).toBe(`<unlockTime> <$(<identity> OP_REVERSEBYTES)> 0x${savingsJarBytecodeHex}`);
  });

  it('keep keys out of applications: the savings jar has no secrets and wallet funds need no signature', () => {
    expect(JSON.stringify(savingsJarTemplate)).not.toMatch(/private_key|secrets|signature/);
    expect(grandmasWalletTemplate.scripts['unlockWalletFunds']).toBe('');
    expect(savingsJarTemplate.scripts['unlockSavingsJar']).toBe('');
  });

  it('generates a key only where a wallet or a new owner first appears', () => {
    const generating = Object.entries(grandmasWalletTemplate.actions).flatMap(([action, { roles }]) =>
      Object.entries(roles ?? {}).flatMap(([role, { generate }]) => (generate === undefined ? [] : [`${action}/${role}`])),
    );
    expect(generating.sort()).toEqual(['createWallet/owner', 'requestRecovery/owner']);
  });

  it('keeps the controller first among inputs and outputs wherever it is spent', () => {
    for (const [name, transaction] of Object.entries(grandmasWalletTemplate.transactions ?? {})) {
      expect(transaction.outputs[0]?.outputIndex, name).toBe(0);
      if (name !== 'createWalletTransaction') expect(transaction.inputs[0]?.inputIndex, name).toBe(0);
      expect(transaction.version, name).toBe(2);
    }
  });
});

describe.each([
  ['wallet', grandmasWalletTemplate],
  ['savings jar', savingsJarTemplate],
])('variables each %s action needs', (_name, template) => {
  const variableNames = new Set(Object.keys(template.variables ?? {}));
  const scriptNames = new Set(Object.keys(template.scripts));

  /** Variables a piece of CashAssembly reads, following references to the template's named scripts. */
  const reads = (text: unknown, seen = new Set<string>()): Set<string> => {
    const found = new Set<string>();
    if (typeof text !== 'string') return found;
    for (const [word] of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (variableNames.has(word)) found.add(word);
      if (scriptNames.has(word) && !seen.has(word)) {
        seen.add(word);
        reads(template.scripts[word], seen).forEach((name) => found.add(name));
      }
    }
    return found;
  };
  const union = (...sets: Set<string>[]): Set<string> => new Set(sets.flatMap((set) => [...set]));

  const usedBy = (actionName: string): Set<string> => {
    const action = template.actions[actionName];
    const transaction = template.transactions?.[action?.transaction ?? ''];
    if (transaction === undefined) throw new Error(`no transaction for ${actionName}`);
    const fromOutputs = transaction.outputs.map(({ output }) => {
      const definition = template.outputs[output];
      const lockingScript = template.lockingScripts[definition?.lockingScript ?? ''];
      return union(
        reads(definition?.valueSatoshis),
        reads(definition?.lockingScript),
        reads(definition?.token?.category),
        reads(definition?.token?.nft?.commitment),
        reads(lockingScript?.lockingBytecode),
      );
    });
    const fromInputs = transaction.inputs.map(({ input }) => {
      const definition = template.inputs[input];
      return union(reads(definition?.unlockingScript), reads(definition?.sequenceNumber));
    });
    return union(reads(transaction.locktime), ...fromOutputs, ...fromInputs);
  };

  it.each(Object.keys(template.actions))('%s declares every variable its transaction uses', (actionName) => {
    const roles = Object.values(template.actions[actionName]?.roles ?? {});
    const declared = new Set(roles.flatMap((role) => [...(role.requirements?.variables ?? []), ...(role.requirements?.secrets ?? [])]));
    const missing = [...usedBy(actionName)].filter((name) => !declared.has(name));
    // A key that the action itself creates is declared without being used in that transaction.
    const created = new Set(roles.flatMap((role) => role.generate ?? []));
    const unused = [...declared].filter((name) => !usedBy(actionName).has(name) && !created.has(name));
    expect(missing, 'used but not declared').toEqual([]);
    expect(unused, 'declared but not used').toEqual([]);
  });
});

describe('controller states written by the template', () => {
  const owner = 'aa'.repeat(20);
  const recoverer = 'bb'.repeat(20);
  const proposed = 'cc'.repeat(20);
  const none = '00'.repeat(20);
  const pending = `010107000000${owner}${recoverer}010040${proposed}`;
  const commitment = (output: string, variables: Record<string, string>): string => {
    const expression = grandmasWalletTemplate.outputs[output]?.token?.nft?.commitment;
    if (expression === undefined) throw new Error(`no commitment on ${output}`);
    return compileCashAssemblyString({
      cashAssemblyText: expression,
      variables,
      evaluationDecodeMode: 'utf8',
      templateVariables: grandmasWalletTemplate.variables ?? {},
      templateScripts: grandmasWalletTemplate.scripts,
    });
  };

  it('starts a wallet active at owner epoch 0', () => {
    expect(
      commitment('newControllerOutput', { ownerKeyHash: owner, recovererKeyHash: recoverer, challengeDelay: '010040' }),
    ).toBe(`010000000000${owner}${recoverer}010040${none}`);
  });

  it('clears a claim and keeps everything else for owner actions', () => {
    expect(commitment('activeControllerOutput', { controllerState: pending })).toBe(
      `010007000000${owner}${recoverer}010040${none}`,
    );
  });

  it('records a claim and keeps everything else for a recovery request', () => {
    const active = `010007000000${owner}${recoverer}010040${none}`;
    expect(commitment('pendingControllerOutput', { controllerState: active, proposedOwnerKeyHash: proposed })).toBe(pending);
  });

  it('passes a supplied state through unchanged', () => {
    expect(commitment('nextControllerOutput', { nextControllerState: pending })).toBe(pending);
  });
});

describe('XO key derivation', () => {
  // A published test mnemonic; never used for funds.
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('derives the same keys as the XO crypto package', () => {
    for (const network of ['testnet', 'mainnet'] as const) {
      const crypto = new Crypto(deriveSeedFromBip39Mnemonic(mnemonic), { network });
      for (const derivationIndex of [0, 1, 7]) {
        const expected = crypto.derivePublicKey({ templateIdentifier: grandmasWalletTemplateIdentifier, derivationIndex });
        const derived = deriveXoTemplateKey(mnemonic, grandmasWalletTemplateIdentifier, derivationIndex, network);
        expect(binToHex(derived.publicKey), `${network} ${derivationIndex}`).toBe(binToHex(expected));
      }
    }
  });

  it('uses a different path per network and template', () => {
    const other = 'ff'.repeat(32);
    expect(xoTemplateKeyPath(other, 0, 'testnet')).toBe("m/42415'/2147483647'/0'/0");
    expect(xoTemplateKeyPath(other, 3, 'mainnet')).toBe("m/2415'/2147483647'/0'/3");
    expect(() => xoTemplateKeyPath('zz', 0, 'testnet')).toThrow();
    expect(() => xoTemplateKeyPath(other, -1, 'testnet')).toThrow();
  });
});
