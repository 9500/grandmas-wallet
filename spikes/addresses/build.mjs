// Compiles the trial contracts in this directory and keeps the result:
//   artifacts/<name>.json  the CashScript artifact (without its timestamp)
//   artifacts/<name>.hex   the compiled bytecode, before constructor arguments
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asmToBytecode } from '@cashscript/utils';
import { compileFile } from 'cashc';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'artifacts');
mkdirSync(out, { recursive: true });

for (const file of readdirSync(here).filter((name) => name.endsWith('.cash'))) {
  const name = file.replace(/\.cash$/, '');
  const { updatedAt: _updatedAt, ...artifact } = compileFile(join(here, file));
  const hex = Buffer.from(asmToBytecode(artifact.bytecode)).toString('hex');
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(out, `${name}.hex`), `${hex}\n`);
  console.log(`${file}: ${hex.length / 2} bytes (compiler ${artifact.compiler.name} ${artifact.compiler.version})`);
}
