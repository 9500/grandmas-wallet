import type { XOTemplate } from '@xo-cash/types';
import { describe, expect, it } from 'vitest';

import { inputsToSign, outputForEngine } from '../src/account.js';

/** A contract that one role pays into and another spends: only the spending role is named on its locking script. */
const template = {
  outputs: {
    contractOutput: { lockingScript: 'contractLockingScript' },
    ownOutput: { lockingScript: 'ownLockingScript' },
    givenOutput: { lockingScript: '$(<recipientLockingScript>)' },
  },
  lockingScripts: {
    contractLockingScript: { roles: { spender: { actions: [{ role: 'spender', action: 'spend' }] } } },
    ownLockingScript: { roles: { payer: {} } },
  },
} as unknown as XOTemplate;

describe('the role an output of a template is given to the engine with', () => {
  it('leaves an output untagged whose locking script does not name the acting role', () => {
    expect(outputForEngine(template, { outputIdentifier: 'contractOutput' }, 'payer')).toEqual({ outputIdentifier: 'contractOutput' });
  });

  it('gives such an output with the locking bytecode the wallet worked out, so that the engine does not follow its script', () => {
    const lockingBytecode = Uint8Array.of(0xaa, 0x20);
    expect(outputForEngine(template, { outputIdentifier: 'contractOutput', lockingBytecode }, 'payer')).toEqual({ outputIdentifier: 'contractOutput', lockingBytecode });
  });

  it('tags an output with the acting role where its locking script names that role, and leaves its script to the engine', () => {
    expect(outputForEngine(template, { outputIdentifier: 'ownOutput' }, 'payer')).toEqual({ outputIdentifier: 'ownOutput', roleIdentifier: 'payer' });
    expect(outputForEngine(template, { outputIdentifier: 'contractOutput' }, 'spender')).toEqual({ outputIdentifier: 'contractOutput', roleIdentifier: 'spender' });
  });

  it('gives an output to a script the role names with its locking bytecode where the wallet gives one, as for a contract many share', () => {
    const lockingBytecode = Uint8Array.of(0xaa, 0x20);
    expect(outputForEngine(template, { outputIdentifier: 'contractOutput', lockingBytecode }, 'spender')).toEqual({ outputIdentifier: 'contractOutput', lockingBytecode });
  });

  it('leaves untagged an output whose locking script is a value, and an output given whole', () => {
    expect(outputForEngine(template, { outputIdentifier: 'givenOutput' }, 'payer')).toEqual({ outputIdentifier: 'givenOutput' });
    const whole = { lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n };
    expect(outputForEngine(template, whole, 'payer')).toBe(whole);
  });

  it('does not take a role from the object prototype as named', () => {
    expect(outputForEngine(template, { outputIdentifier: 'contractOutput' }, 'toString')).toEqual({ outputIdentifier: 'contractOutput' });
  });
});

describe('the inputs the engine is asked to sign', () => {
  it('leaves out a coin given with its unlocking, though the engine lists it as its own', () => {
    const inputs = [{ unlocking: { bytecode: Uint8Array.of(0x51), sequenceNumber: 0 } }, {}, {}];
    expect(inputsToSign([0, 1, 2], inputs)).toEqual([1, 2]);
    expect(inputsToSign([0], inputs)).toEqual([]);
    expect(inputsToSign([1], inputs)).toEqual([1]);
  });
});
