// How does the engine name a template? Compares the identifier it gives on import with ways to compute one.
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { WALLET_TEMPLATES } from '../../packages/app/src/templates.ts';
// @ts-expect-error plain script
import { openEngineRegtest } from './regtest.mjs';
console.error = () => {};
const engine = await openEngineRegtest(`trial28-${Date.now()}`);
try {
  for (const [name, template] of Object.entries(WALLET_TEMPLATES)) {
    const imported = (await engine.importTemplate(template)).templateIdentifier;
    const fromText = (await engine.importTemplate(JSON.stringify(template))).templateIdentifier;
    const direct = generateTemplateIdentifier(template);
    const parsed = generateTemplateIdentifier(parseTemplate(JSON.stringify(template)));
    const stored = generateTemplateIdentifier((await engine.getTemplate(imported)) as never);
    console.log(name.padEnd(10), 'engine', imported.slice(0, 12), '| from text', fromText.slice(0, 12), '| direct', direct.slice(0, 12), '| parsed', parsed.slice(0, 12), '| stored', stored.slice(0, 12));
  }
} finally { await engine.stop().catch(() => {}); process.exit(); }
