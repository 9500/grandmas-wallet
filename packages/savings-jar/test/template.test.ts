import { binToHex, hexToBin } from '@bitauth/libauth';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { readTemplate, templateKeys, templateLockingBytecode, templateUnlockingBytecode, textHash } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { savingsJarDeclarationSource, savingsJarDeclarationText, savingsJarScript, savingsJarTemplateSource, savingsJarTemplateText, savingsJarV4TemplateSource, savingsJarV4TemplateText, unlockTimeBytes, unlockTimeOf } from '../src/index.js';

/**
 * The Savings Jar's template as it is served: the frozen text is the source, the XO validator accepts it,
 * and its script is the compiled contract, byte for byte.
 */

const template = readTemplate(savingsJarTemplateText);
const KEY = 'c1'.repeat(31) + 'd2';
const DATE = 1_900_000_000;

describe('the Savings Jar template', () => {
  it('is served as the text made from its source; a change to the source without freezing fails here', () => {
    expect(savingsJarTemplateText).toBe(JSON.stringify(savingsJarTemplateSource));
    expect(JSON.parse(savingsJarDeclarationText)).toEqual({
      profile: 'recoverable-app-v1',
      version: 1,
      template: { identifier: template.identifier, contentHash: textHash(savingsJarTemplateText) },
      ...savingsJarDeclarationSource,
    });
  });

  it('passes the XO validator and has the identifier this version was published under', () => {
    expect(template.definition.name).toBe('Savings Jar');
    expect(template.identifier).toBe('04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c');
  });

  it('holds no key: authority over a jar is its token', () => {
    expect(templateKeys(template.definition)).toEqual([]);
    expect(savingsJarTemplateText).not.toContain('private_key');
  });

  it('carries the compiled contract, byte for byte, and gives the address the application\'s own code gives', () => {
    expect(savingsJarTemplateSource.scripts.savingsJarBytecode.endsWith(`0x${savingsJarBytecodeHex}`)).toBe(true);
    const script = savingsJarScript(hexToBin(KEY), DATE);
    expect(binToHex(templateLockingBytecode(template.definition, 'savingsJarLockingScript', { keyCategory: KEY, unlockTime: BigInt(DATE) }))).toBe(binToHex(script.lockingBytecode));
    expect(binToHex(templateUnlockingBytecode(template.definition, 'savingsJarLockingScript', 'savingsJarInput', { keyCategory: KEY, unlockTime: BigInt(DATE), keyInput: 2n }))).toBe(binToHex(script.unlock(2)));
    expect(binToHex(script.redeemBytecode).endsWith(savingsJarBytecodeHex)).toBe(true);
  });

  it('writes the jar\'s date on the key as the number the contract is built with', () => {
    expect(binToHex(unlockTimeBytes(DATE))).toBe('00b33f71');
    expect(unlockTimeOf(unlockTimeBytes(DATE))).toBe(DATE);
    expect(() => unlockTimeOf(hexToBin('00b33f7100'))).toThrow('not the date');
  });
});

describe('the Savings Jar template of version 4, which comes with nothing beside it (proposal section 15.3)', () => {
  const v4 = readTemplate(savingsJarV4TemplateText);

  it('is served as the text made from its source, the same text as in frozen/, with the identifier it was frozen with', () => {
    expect(savingsJarV4TemplateText).toBe(JSON.stringify(savingsJarV4TemplateSource));
    expect(readFileSync(new URL('../frozen/savings-jar-v4.json', import.meta.url), 'utf8')).toBe(savingsJarV4TemplateText);
    expect(v4.definition.version).toBe('4');
    expect(v4.identifier).toBe('fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25');
    expect(textHash(savingsJarV4TemplateText)).toBe(v4.contentHash);
  });

  it('holds no key, and differs from version 3 only in the withdrawal: the key an input of its own at index 0, and the jar\'s unlocking that index as a constant', () => {
    expect(templateKeys(v4.definition)).toEqual([]);
    const earlier = JSON.parse(savingsJarTemplateText) as Record<string, unknown>;
    const later = JSON.parse(savingsJarV4TemplateText) as Record<string, unknown>;
    // Every field in the same order: the identifier depends on it.
    expect(Object.keys(later)).toEqual(Object.keys(earlier));
    expect(later['lockingScripts']).toEqual(earlier['lockingScripts']);
    expect(later['outputs']).toEqual(earlier['outputs']);
    expect((later['scripts'] as Record<string, string>)['savingsJarBytecode']).toBe((earlier['scripts'] as Record<string, string>)['savingsJarBytecode']);
    expect((later['scripts'] as Record<string, string>)['unlockSavingsJar']).toBe('<0>');
    expect(Object.keys(later['variables'] as object)).toEqual(['keyCategory', 'unlockTime', 'unlockTimeBytes', 'savedSatoshis', 'keyHolder']);
    expect(v4.definition.actions?.['withdraw']?.roles?.['saver']?.requirements?.variables).toEqual(['keyCategory', 'unlockTime', 'unlockTimeBytes', 'keyHolder']);
    expect((v4.definition.transactions?.['withdrawTransaction'] as { inputs: unknown }).inputs).toEqual([{ input: 'jarKeyInput', inputIndex: 0 }, { input: 'savingsJarInput' }]);
    // An input that names the key's category and has no unlocking script: the wallet's own key coin goes there.
    expect(v4.definition.inputs?.['jarKeyInput']).toEqual({ name: 'Jar key', description: 'The jar\'s key, spent and given back. It opens the jar.', token: { category: '$(<keyCategory>)' } });
    expect(savingsJarV4TemplateText).not.toContain('keyInput"');
  });

  it('gives the same jar as version 3 and the application\'s own code, unlocked for a key at input 0', () => {
    const script = savingsJarScript(hexToBin(KEY), DATE);
    expect(binToHex(templateLockingBytecode(v4.definition, 'savingsJarLockingScript', { keyCategory: KEY, unlockTime: BigInt(DATE) }))).toBe(binToHex(script.lockingBytecode));
    expect(binToHex(templateUnlockingBytecode(v4.definition, 'savingsJarLockingScript', 'savingsJarInput', { keyCategory: KEY, unlockTime: BigInt(DATE) }))).toBe(binToHex(script.unlock(0)));
  });
});
