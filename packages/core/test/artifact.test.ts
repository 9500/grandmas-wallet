import { fileURLToPath } from 'node:url';

import { binToHex } from '@bitauth/libauth';
import { asmToBytecode } from '@cashscript/utils';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { compileFile } from 'cashc';
import { describe, expect, it } from 'vitest';

const compile = (name: string) =>
  compileFile(fileURLToPath(new URL(`../../../contracts/${name}.cash`, import.meta.url)));

describe('compiled contracts', () => {
  it.each([
    ['controller', controllerBytecodeHex, []],
    ['asset', assetBytecodeHex, ['identity']],
    ['savingsJar', savingsJarBytecodeHex, ['identity', 'unlockTime']],
  ])('%s bytecode in use matches its source', (name, bytecodeHex, constructorInputs) => {
    const compiled = compile(name);
    expect(binToHex(asmToBytecode(compiled.bytecode))).toBe(bytecodeHex);
    expect(compiled.constructorInputs.map((input) => input.name)).toEqual(constructorInputs);
  });
});
