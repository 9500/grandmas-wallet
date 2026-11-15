import { fileURLToPath } from 'node:url';

import { binToHex } from '@bitauth/libauth';
import { asmToBytecode } from '@cashscript/utils';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { compileFile } from 'cashc';
import { describe, expect, it } from 'vitest';

describe('compiled contracts', () => {
  it('controller bytecode in use matches its source', () => {
    const source = fileURLToPath(new URL('../../../contracts/controller.cash', import.meta.url));
    const compiled = compileFile(source);
    expect(binToHex(asmToBytecode(compiled.bytecode))).toBe(controllerBytecodeHex);
    expect(compiled.constructorInputs).toEqual([]);
  });
});
