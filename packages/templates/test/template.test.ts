import { readFileSync } from 'node:fs';

import { binToHex, deriveSeedFromBip39Mnemonic } from '@bitauth/libauth';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { deriveXoTemplateKey, xoTemplateKeyPath } from '@grandmas-wallet/core';
import { Crypto } from '@xo-cash/crypto';
import { compileCashAssemblyString, generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';

import { grandmasWalletTemplate, grandmasWalletTemplateIdentifier } from '../src/index.js';

const frozen = parseTemplate(
  readFileSync(new URL('../frozen/grandmas-wallet-v1.json', import.meta.url), 'utf8'),
);

describe("Grandma's Wallet template", () => {
  it('is accepted by the XO template validator', () => {
    expect(() => parseTemplate(grandmasWalletTemplate)).not.toThrow();
  });

  it('matches the frozen version 1, whose identifier every key depends on', () => {
    expect(generateTemplateIdentifier(frozen)).toBe(grandmasWalletTemplateIdentifier);
    expect(frozen).toEqual(grandmasWalletTemplate);
  });

  it('carries exactly the contract bytecode that the contract tests run', () => {
    const { scripts } = grandmasWalletTemplate;
    expect(scripts['controllerBytecode']).toBe(`<$(<identity> OP_REVERSEBYTES)> 0x${controllerBytecodeHex}`);
    expect(scripts['walletBytecode']).toBe(`<$(<identity> OP_REVERSEBYTES)> 0x${assetBytecodeHex}`);
    expect(scripts['savingsJarBytecode']).toBe(`<unlockTime> <$(<identity> OP_REVERSEBYTES)> 0x${savingsJarBytecodeHex}`);
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
