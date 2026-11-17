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

  it('the templates that hold keys are final: their identifiers, and with them every key, do not change', () => {
    // A change to one of these three templates, even to a description, gives every wallet other keys. If
    // this test fails, the change has to be undone, or made on purpose as a new version of the controller
    // rules or of the address scheme (proposal sections 7.2 and 18.3).
    const identifiers = walletTemplateIdentifiers();
    expect(identifiers.controller).toBe('a6998934ebc12728630ccd54e4d28f879484f6c4432f855eb14499c16bf59fc8');
    expect(identifiers.givenOut).toBe('a67fcc2d0b479552a03669b3ac5a95da53b1490489364127898b01199b2f475c');
    expect(identifiers.change).toBe('c7419f58e404da2a9847df27cebd6e38cf3240f66e46e4e94a36d0958f72acd1');
    // The numbers under which the engine, and this project's own code, derive the keys.
    expect(walletTemplateNumbers()).toMatchObject({ controller: 881_432_998, givenOut: 768_376_742, change: 1_486_832_071 });
    // XO's standard wallet template is theirs, used at the pinned version: the funding key and the fee key.
    expect(identifiers.coins).toBe('a31eb85891dbf248f1709a92b0fa7e3e6fdc518e6b34e376b197ed7f12dbc672');
    expect(walletTemplateNumbers().standardWallet).toBe(1_488_461_475);
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
