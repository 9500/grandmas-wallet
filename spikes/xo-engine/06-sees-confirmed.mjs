// Experiment 6: with header verification stuck, does the engine still record confirmed outputs?
// The controller script already has confirmed outputs on chipnet from the earlier scripted run.
import { spikeTemplate } from './template.mjs';
import { openEngine, show } from './common.mjs';

const engine = await openEngine('owner');
const errors = new Set();
const original = console.error;
console.error = (...args) => errors.add(String(args[0]).slice(0, 140));
try {
  const { templateIdentifier } = await engine.importTemplate(spikeTemplate);
  const intent = (await engine.getTemplate(templateIdentifier)).start[0];
  const stored = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'initialize', intent,
    variables: [
      { variableIdentifier: 'identity', roleIdentifier: 'owner', value: '11'.repeat(32) },
      { variableIdentifier: 'ownerKeyHash', roleIdentifier: 'owner', value: 'aa'.repeat(20) },
      { variableIdentifier: 'recovererKeyHash', roleIdentifier: 'owner', value: 'bb'.repeat(20) },
      { variableIdentifier: 'walletSatoshis', roleIdentifier: 'owner', value: 20000n },
    ],
  });
  const id = stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
  await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'initialControllerOutput' }] });
  await new Promise((r) => setTimeout(r, 20000));
  const unspent = await engine.listUnspentOutputs();
  show('tracked script hashes', (await engine.listScriptHashes()).length);
  show('unspent outputs recorded', unspent);
} finally {
  console.error = original;
  console.log('distinct errors logged:', [...errors]);
  await engine.stop().catch(() => undefined);
  process.exit(0);
}
