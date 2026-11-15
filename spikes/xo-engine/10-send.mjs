// Experiment 10: a first real transaction through the engine — an ordinary payment from the engine's own address.
// usage: node 10-send.mjs <account> <address> <satoshis>
import { binToHex, cashAddressToLockingBytecode, hexToBin } from '@bitauth/libauth';
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngine, address, show } from './common.mjs';

const [account, recipient, amount] = process.argv.slice(2);
const recipientLocking = cashAddressToLockingBytecode(recipient);
if (typeof recipientLocking === 'string') throw new Error(recipientLocking);

const engine = await openEngine(account);
console.error = () => undefined; // header verification noise, see experiment 5
try {
  const { templateIdentifier } = await engine.importTemplate(p2pkhTemplate);
  await engine.setDefaultPolicies({ change: { templateIdentifier }, receive: { templateIdentifier }, address: { templateIdentifier } });
  console.log('own address', address(await engine.generateLockingBytecodeFromDefaultPolicy('receive')));
  let spendable = [];
  for (let attempt = 0; attempt < 20 && spendable.length === 0; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    spendable = await engine.listSpendableUnspentOutputs({ templateIdentifier });
  }
  show('spendable', spendable.map((u) => ({ tx: u.outpointTransactionHash, index: u.outpointIndex, sats: u.valueSatoshis, status: u.status })));
  if (spendable.length === 0) throw new Error('no spendable outputs');

  const template = await engine.getTemplate(templateIdentifier);
  const intent = template.lockingScripts.receivingLockingScript.roles.receiver.actions.find((a) => a.action === 'sendSatoshis');
  let stored = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'sendSatoshis',
    intent,
    variables: [
      { variableIdentifier: 'transferredSatoshis', roleIdentifier: 'sender', value: BigInt(amount) },
      { variableIdentifier: 'recipientLockingscript', roleIdentifier: 'sender', value: binToHex(recipientLocking.bytecode) },
    ],
    inputs: spendable.map((u) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex })),
  });
  const id = stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
  show('missing', await engine.listMissingRequirements(id));
  await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'transferSatoshisOutput' }] });
  show('change', await engine.calculateChange(id));
  console.log('fee estimate', await engine.estimateTransactionFee(id));
  await engine.addChangeToInvitation(id);
  for (const index of await engine.listOwnInputIndexes(id)) await engine.signInvitation(id, index);
  show('missing before execute', await engine.listMissingRequirements(id));
  const result = await engine.executeAction(id, { broadcastTransaction: true });
  show('executed', { hash: result.builtTransaction?.transactionHash, bytes: result.builtTransaction?.transactionByteLength });
} catch (error) {
  console.log('FAILED:', error.name, error.message);
} finally {
  await engine.stop().catch(() => undefined);
  process.exit(0);
}
