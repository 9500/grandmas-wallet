import { binToHex, hexToBin } from '@bitauth/libauth';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { readTemplate, templateKeys, templateLockingBytecode, templateUnlockingBytecode, textHash } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { savingsJarDeclarationSource, savingsJarDeclarationText, savingsJarScript, savingsJarTemplateSource, savingsJarTemplateText, unlockTimeBytes, unlockTimeOf } from '../src/index.js';

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
