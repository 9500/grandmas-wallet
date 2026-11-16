import { readFileSync } from 'node:fs';

import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';

import { savingsJarTemplate, savingsJarTemplateIdentifier } from '../src/index.js';

const frozen = (name: string) => parseTemplate(readFileSync(new URL(`../frozen/${name}.json`, import.meta.url), 'utf8'));

describe('the Savings Jar application\'s template', () => {
  it('is accepted by the XO template validator', () => {
    expect(() => parseTemplate(savingsJarTemplate)).not.toThrow();
  });

  it('matches its frozen version 2; positions on record name the template by its identifier', () => {
    expect(generateTemplateIdentifier(frozen('savings-jar-v2'))).toBe(savingsJarTemplateIdentifier);
    expect(frozen('savings-jar-v2')).toEqual(savingsJarTemplate);
  });

  it('carries exactly the contract bytecode that the contract tests run', () => {
    expect(savingsJarTemplate.scripts['savingsJarBytecode']).toBe(`<unlockTime> <$(<identity> OP_REVERSEBYTES)> 0x${savingsJarBytecodeHex}`);
  });

  it('keeps keys out of the application: no secrets, and a jar needs no signature of its own', () => {
    expect(JSON.stringify(savingsJarTemplate)).not.toMatch(/private_key|secrets|schnorr|ecdsa/);
    expect(savingsJarTemplate.scripts['unlockSavingsJar']).toBe('');
  });

  it('says everything a wallet needs to carry out its actions without knowing the application', () => {
    const { actions, transactions, outputs, lockingScripts, variables } = savingsJarTemplate;
    // Paying in creates one output, at the jar's script, of the amount given.
    expect(transactions?.['depositTransaction']).toMatchObject({ inputs: [], outputs: [{ output: 'savingsJarOutput' }] });
    expect(outputs['savingsJarOutput']).toMatchObject({ lockingScript: 'savingsJarLockingScript', valueSatoshis: '$(<savedSatoshis>)' });
    // Emptying spends the jar and is not valid before the unlock time; what comes out is left to the wallet.
    expect(transactions?.['withdrawTransaction']).toMatchObject({ inputs: [{ input: 'savingsJarInput' }], outputs: [], locktime: '$(<unlockTime>)' });
    // A wallet holding a jar learns from the jar's own script what can be done with it.
    expect(lockingScripts['savingsJarLockingScript']?.roles?.['saver']?.actions).toEqual([{ action: 'withdraw', role: 'saver' }]);
    // Every action has words for the user, and every variable a type a wallet can show.
    for (const action of Object.values(actions)) expect(action.name !== undefined && action.description !== undefined).toBe(true);
    expect(Object.fromEntries(Object.entries(variables ?? {}).map(([name, variable]) => [name, variable.type]))).toEqual({
      identity: 'token_category',
      unlockTime: 'timestamp',
      savedSatoshis: 'satoshis',
    });
  });

  it('declares for each action the variables a wallet has to be given', () => {
    const needs = (action: string) => [...(savingsJarTemplate.actions[action]?.roles?.['saver']?.requirements?.variables ?? [])].sort();
    expect(needs('deposit')).toEqual(['identity', 'savedSatoshis', 'unlockTime']);
    expect(needs('withdraw')).toEqual(['identity', 'unlockTime']);
  });
});
