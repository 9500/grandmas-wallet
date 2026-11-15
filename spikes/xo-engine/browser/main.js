// Experiment 7: the engine in a browser, with its default IndexedDB storage.
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { generateBip39Mnemonic } from '@bitauth/libauth';
import template from './template.json';

const lines = [];
const log = (...parts) => {
  lines.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
  document.getElementById('out').textContent = lines.join('\n');
};

try {
  const mnemonic = localStorage.getItem('spike-mnemonic') ?? generateBip39Mnemonic();
  localStorage.setItem('spike-mnemonic', mnemonic);
  const started = performance.now();
  const engine = await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet });
  log('engine started in', Math.round(performance.now() - started), 'ms');
  log('connections', (await engine.listElectrumConnections()).map((c) => `${c.hostIdentifier}:${c.status}`));
  log('templates already stored', (await engine.listTemplates()).length);
  log('secrets already stored', (await engine.listSecretData()).length);
  const { templateIdentifier } = await engine.importTemplate(template);
  log('template imported', templateIdentifier);
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
  const secrets = await engine.listSecretData();
  log('owner public key', await engine.getSecretPublicKey(secrets[0].secretLookupKey));
  log('secrets stored now', secrets.length, 'invitations', (await engine.listInvitations()).length);
  log('DONE');
} catch (error) {
  log('FAILED', error?.name, error?.message);
}
