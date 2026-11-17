import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { recoverableAddressBytecodeHex } from '@grandmas-wallet/contracts/recoverableAddress';
import { vaultAddressBytecodeHex } from '@grandmas-wallet/contracts/vaultAddress';
import { parseTemplate } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';

import { WALLET_TEMPLATES, changeTemplate, controllerTemplate, givenOutTemplate, walletActionsTemplate, walletTemplateIdentifiers, walletTemplateNumbers } from '../src/templates.js';

describe('the wallet\'s templates', () => {
  it.each(Object.entries(WALLET_TEMPLATES))('%s is accepted by the XO template validator', (_name, template) => {
    expect(() => parseTemplate(JSON.stringify(template))).not.toThrow();
  });

  it('carry exactly the contract bytecode that the contract tests run', () => {
    expect(controllerTemplate.scripts.controllerBytecode).toBe(`<$(<identity> OP_REVERSEBYTES)> 0x${controllerBytecodeHex}`);
    for (const template of [givenOutTemplate, changeTemplate]) {
      expect(template.scripts.addressBytecode).toBe(`<$(<addressKey.public_key> OP_HASH160)> <tag> 0x${recoverableAddressBytecodeHex}`);
    }
    expect(walletActionsTemplate.scripts.earlierAddressBytecode).toBe(`<keyHash> <tag> 0x${recoverableAddressBytecodeHex}`);
    expect(walletActionsTemplate.scripts.vaultBytecode).toBe(`<tag> 0x${vaultAddressBytecodeHex}`);
  });

  it('keep the controller key and the two kinds of address key on branches of their own', () => {
    const identifiers = walletTemplateIdentifiers();
    expect(new Set(Object.values(identifiers)).size).toBe(5);
    const numbers = walletTemplateNumbers();
    expect(new Set(Object.values(numbers)).size).toBe(4);
    // The two address templates are the same script and differ in their name only.
    expect(givenOutTemplate.scripts).toEqual(changeTemplate.scripts);
    expect(givenOutTemplate.name).not.toBe(changeTemplate.name);
  });

  it('make keys in three places only: the controller key, the recoverer\'s key, and one key for each address', () => {
    const generated = (template: { start: readonly unknown[]; defaults?: Record<string, unknown> }): string[] => {
      const found: string[] = [];
      JSON.stringify({ start: template.start, defaults: template.defaults ?? {} }, (key, value: unknown) => {
        if (key === 'generate' && Array.isArray(value)) found.push(...(value as string[]));
        return value;
      });
      return found.sort();
    };
    expect(generated(controllerTemplate)).toEqual(['controllerKey', 'recovererKey']);
    expect(generated(givenOutTemplate)).toEqual(['addressKey']);
    expect(generated(changeTemplate)).toEqual(['addressKey']);
    expect(generated(walletActionsTemplate)).toEqual([]);
    // No follow-up action makes a key: a key made there would be a new one each time.
    for (const role of Object.values(controllerTemplate.lockingScripts.controllerLockingScript.roles)) {
      for (const action of role.actions) expect(action).not.toHaveProperty('generate');
    }
  });

  it('keep the controller first among inputs and outputs wherever it continues', () => {
    for (const [name, transaction] of Object.entries(controllerTemplate.transactions)) {
      for (const input of transaction.inputs) expect((input as { inputIndex: number }).inputIndex, name).toBe(0);
      for (const output of transaction.outputs) expect((output as { outputIndex: number }).outputIndex, name).toBe(0);
    }
    expect(controllerTemplate.transactions.closeTransaction.outputs).toEqual([]);
  });
});
