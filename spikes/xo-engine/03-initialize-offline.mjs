// Experiment 3: create an "initialize" invitation and see what the engine resolves for the controller output,
// without spending anything.
import { binToHex, hexToBin, hash256, encodeLockingBytecodeP2sh32 } from '@bitauth/libauth';
import { spikeTemplate } from './template.mjs';
import { openEngine, show } from './common.mjs';

const engine = await openEngine('owner');
try {
  const { templateIdentifier } = await engine.importTemplate(spikeTemplate);
  const intent = (await engine.getTemplate(templateIdentifier)).start[0];
  const identity = '11'.repeat(4) + '22'.repeat(28); // asymmetric placeholder
  let stored = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'initialize',
    intent,
    variables: [
      { variableIdentifier: 'identity', roleIdentifier: 'owner', value: identity },
      { variableIdentifier: 'recovererKeyHash', roleIdentifier: 'owner', value: 'bb'.repeat(20) },
      { variableIdentifier: 'walletSatoshis', roleIdentifier: 'owner', value: 20000n },
    ],
  });
  const id = stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
  const secrets = await engine.listSecretData();
  show('secrets', secrets);
  const ownerPublicKey = await engine.getSecretPublicKey(secrets[0].secretLookupKey);
  console.log('owner public key', ownerPublicKey);
  const { hash160 } = await import('@bitauth/libauth');
  stored = await engine.appendInvitation(id, {
    variables: [{ variableIdentifier: 'ownerKeyHash', roleIdentifier: 'owner', value: binToHex(hash160(hexToBin(ownerPublicKey))) }],
  });
  show('missing after create', await engine.listMissingRequirements(id));
  stored = await engine.appendInvitation(id, {
    outputs: [{ outputIdentifier: 'initialControllerOutput' }, { outputIdentifier: 'walletOutput' }],
  });
  show('missing after outputs', await engine.listMissingRequirements(id));
  const invitation = (await engine.getInvitation(id)).invitation ?? (await engine.getInvitation(id));
  const outputs = invitation.commits.flatMap((commit) => commit.data.outputs ?? []);
  show('outputs', outputs);

  const controllerHex = spikeTemplate.scripts.controllerBytecode.slice(2);
  console.log('expected controller locking', binToHex(encodeLockingBytecodeP2sh32(hash256(hexToBin(controllerHex)))));
  show('secrets', await engine.listSecretData());
} catch (error) {
  console.log('FAILED:', error.name, error.message, (error.stack ?? '').split('\n').slice(1, 9).join(' <- '));
} finally {
  await engine.stop().catch(() => undefined);
}
