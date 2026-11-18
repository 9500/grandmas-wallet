import { type Output, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { ActionRefusedError, UnknownProfileError } from '@grandmas-wallet/app';
import { ADDRESS_KIND, takeNumber, buildTransaction, p2pkhInput, p2pkhLockingBytecode, readTemplate, recoverableInput, templateOutput, templateUnlockingBytecode, walletAddress } from '@grandmas-wallet/core';
import { bondDeclaration, bondTemplate, strongboxDeclaration, strongboxTemplate, templateText, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, bond, deviceWith, hex, presentation, presentationHash, request, seedOf, strongbox } from './support/applications.js';

const { change, vault } = ADDRESS_KIND;
const outputsOf = async (device: Device, transactionId: string): Promise<Output[]> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) as string));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.outputs;
};
/** The number the next address of a kind will get. */
const next = (device: Device, kind: 1 | 2): number => {
  const taken = takeNumber(device.state().allocation, kind);
  return 'number' in taken ? taken.number : -1;
};
const addressOf = (device: Device, kind: 1 | 2, number: number, seed = 0): string => hex(walletAddress(device.identity, seedOf(seed).viewingKey, kind, number).lockingBytecode);

/**
 * Acceptance tests of the proposal's section 21 for applications (AP), on the simulated chain, with two
 * templates made for the tests. The wallet has never seen either: everything it does comes from the
 * template and its recovery declaration.
 */

describe('carrying out an action of a template the wallet has never seen', () => {
  it('AP04: an action that creates a token category works, and the wallet supplies the coin that defines it', async () => {
    const device = await deviceWith([100_000n]);
    const before = await device.wallet.balance();
    const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: 'c0ffee' });
    const preview = await device.applications.preview(open);
    expect(preview.template.verdict.statement).toBe('not verified');
    expect(preview.figures.payingItself).toBeUndefined();
    const outcome = await device.applications.carryOut(open);
    const [token] = outcome.tokens;
    expect(token?.commitment).toBe('c0ffee');
    // The category is the transaction of the wallet's own coin that the action spent.
    const held = await device.applications.tokens();
    expect(held).toHaveLength(1);
    expect(held[0]?.category).toBe(token?.category);
    expect(held[0]?.meaning).toBe('position');
    expect(held[0]?.position).toMatchObject({ status: 'open', satoshis: 30_000n, coins: 1 });
    const after = await device.wallet.balance();
    expect(after.recoverable).toBe(before.recoverable - 30_000n - 1_000n - outcome.sent.feeSatoshis);
    expect(outcome.sent.feeSatoshis).toBe(BigInt(outcome.sent.bytes));
    // What the wallet showed beforehand is what happened.
    expect(preview.figures.feeSatoshis).toBe(outcome.sent.feeSatoshis);
    expect(preview.figures.toOthers).toMatchObject([{ name: 'Strongbox', satoshis: 30_000n }]);
    expect(device.state().allocation[ADDRESS_KIND.change].held).toEqual([]);
  });

  it('AP04: a wallet without a coin that can define a token pays itself first, and says so beforehand', async () => {
    const device = await deviceWith([100_000n], { outputIndex: 1 });
    const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' });
    const preview = await device.applications.preview(open);
    expect(preview.figures.payingItself?.feeSatoshis).toBeGreaterThan(0n);
    const outcome = await device.applications.carryOut(open);
    const [held] = await device.applications.tokens();
    expect(held?.position).toMatchObject({ status: 'open', satoshis: 30_000n });
    expect(held?.category).not.toBe('00'.repeat(32));
    expect(outcome.tokens[0]?.category).toBe(held?.category);
  });

  it('a position is emptied with its token, which returns to the wallet at a new address', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: 'c0ffee' }));
    const [token] = await device.applications.tokens();
    if (token === undefined) throw new Error('no token');
    const before = await device.wallet.balance();
    const take = device.applications.actionOn(token, 'take');
    const preview = await device.applications.preview(take);
    expect(preview.figures.fromApplication).toEqual({ satoshis: 30_000n, coins: 1 });
    expect(preview.figures.tokensSpent).toHaveLength(1);
    const outcome = await device.applications.carryOut(take);
    const after = await device.wallet.balance();
    expect(after.recoverable).toBe(before.recoverable + 30_000n - outcome.sent.feeSatoshis);
    const [again] = await device.applications.tokens();
    expect(again?.category).toBe(token.category);
    expect(again?.position).toMatchObject({ status: 'closed', satoshis: 0n });
    expect(hex(after.tokens[0]?.utxo.output.lockingBytecode ?? new Uint8Array())).not.toBe(hex(before.tokens[0]?.utxo.output.lockingBytecode ?? new Uint8Array()));
  });
});

describe('the outputs an application leaves to the wallet', () => {
  it('AP11: `receive` and `change` take the next number of chain 1; `lasting` gives a vault address; `return` repeats the input\'s script and takes none', async () => {
    const device = await deviceWith([100_000n, 60_000n, 50_000n]);
    // `receive`: the key of a new strongbox, and what is left over, each at the next change address.
    let first = next(device, change);
    const opened = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    let outputs = await outputsOf(device, opened.transactionId);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(hex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first + 1));
    expect(next(device, change)).toBe(first + 2);

    // `change`, asked for by a request for a template that comes without a declaration.
    const plain = presentation({ ...strongboxTemplate, name: 'Strongbox without a declaration' });
    first = next(device, change);
    const second = await device.applications.carryOut(request(plain, 'open', 'holder', { amount: 5_000, label: '02' }, { bindings: { holder: 'change' }, creates: 'boxKey' }));
    outputs = await outputsOf(device, second.transactionId);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(next(device, change)).not.toBe(first);

    // `lasting`: the address a bond returns to is a vault address, fixed now and paid later.
    // (The device takes note of the addresses that have been used, as it does while it watches the chain.)
    await device.wallet.search({ passes: ['quick'] });
    first = next(device, change);
    const vaultNumber = next(device, vault);
    const posted = await device.applications.carryOut(request(bond, 'post', 'poster', { amount: 20_000, serial: '07' }));
    outputs = await outputsOf(device, posted.transactionId);
    const refundTo = addressOf(device, vault, vaultNumber);
    expect(hex(outputs[1]?.token?.nft?.commitment ?? new Uint8Array())).toBe(refundTo);
    expect(next(device, vault)).toBe(vaultNumber + 1);
    expect(hex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));

    // `return`: the key goes back to the script it left, and no number is taken for it.
    const key = (await device.applications.tokens()).find((token) => token.template?.name === 'Bond');
    if (key === undefined) throw new Error('no bond key');
    expect(key.position).toMatchObject({ status: 'open', satoshis: 20_000n });
    first = next(device, change);
    const redeemed = await device.applications.carryOut(device.applications.actionOn(key, 'redeem'));
    outputs = await outputsOf(device, redeemed.transactionId);
    expect(hex(outputs[0]?.lockingBytecode ?? new Uint8Array())).toBe(refundTo);
    expect(outputs[0]?.valueSatoshis).toBe(20_000n);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(hex((await outputsOf(device, posted.transactionId))[2]?.lockingBytecode ?? new Uint8Array()));
    // Only what was left over took a number.
    expect(hex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(outputs).toHaveLength(3);
    expect((await device.wallet.balance()).vault).toBe(20_000n);
    expect((await device.applications.tokens()).find((token) => token.template?.name === 'Bond')?.position?.status).toBe('closed');
  });

  it('AP12: a `return` that names an input that is not the wallet\'s is refused', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(bond, 'post', 'poster', { amount: 20_000, serial: '07' }));
    // A token the wallet does not hold.
    const stranger = { ...request(bond, 'redeem', 'poster'), tokens: ['ab'.repeat(32)] };
    await expect(device.applications.preview(stranger)).rejects.toThrow('holds no such token');
    // An action that spends no token of the wallet has no input for an output to return to.
    const plain = presentation({ ...strongboxTemplate, name: 'Strongbox without a declaration' });
    const nowhere = request(plain, 'open', 'holder', { amount: 5_000, label: '02' }, { bindings: { holder: 'return' }, creates: 'boxKey' });
    await expect(device.applications.preview(nowhere)).rejects.toThrow('an input that is not the wallet\'s');
    await expect(device.applications.carryOut(nowhere)).rejects.toBeInstanceOf(ActionRefusedError);
  });

  it('AP12: a token at an address of an earlier seed is swept first', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.applications.readBackup();
    await taken.applications.trust(strongbox.names, undefined);
    const [key] = await taken.applications.tokens();
    expect(key).toMatchObject({ place: 'earlier', meaning: 'position', position: { status: 'open' } });
    if (key === undefined) throw new Error('no key');
    await expect(taken.applications.preview(taken.applications.actionOn(key, 'take'))).rejects.toThrow('It is swept first');
    await taken.wallet.sweepEarlier();
    const [swept] = await taken.applications.tokens();
    expect(swept?.place).toBe('address');
    if (swept === undefined) throw new Error('no key');
    const outcome = await taken.applications.carryOut(taken.applications.actionOn(swept, 'take'));
    expect(outcome.tokens[0]?.category).toBe(key.category);
  }, 60_000);

  it('AP12: an address that the application supplies for an output of the wallet\'s is not used', async () => {
    const device = await deviceWith([100_000n]);
    const theirs = hex(p2pkhLockingBytecode(testKey(0x66).keyHash));
    const first = next(device, change);
    const outcome = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01', holder: theirs }));
    const outputs = await outputsOf(device, outcome.transactionId);
    expect(outputs.map((output) => hex(output.lockingBytecode))).not.toContain(theirs);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect((await device.applications.tokens())[0]?.category).toBe(outcome.tokens[0]?.category);
  });

  it('a token at a vault address is moved to an ordinary address before an action', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const [coin] = (await device.wallet.balance()).tokens;
    if (coin === undefined) throw new Error('no key');
    await device.wallet.sendToken(coin, (await device.wallet.vaultAddress()).address.lockingBytecode);
    const [key] = await device.applications.tokens();
    expect(key?.place).toBe('vault');
    if (key === undefined) throw new Error('no key');
    await expect(device.applications.preview(device.applications.actionOn(key, 'take'))).rejects.toThrow('moved to an ordinary address');
  });
});

describe('what the wallet shows before the user approves', () => {
  it('AP02: a template worded to mislead does not change the wallet\'s own figures', async () => {
    const honest = await deviceWith([100_000n]);
    const misled = await deviceWith([100_000n]);
    const worded = JSON.parse(templateText(strongboxTemplate)) as typeof strongboxTemplate;
    const lying = presentation(
      {
        ...worded,
        actions: { ...worded.actions, open: { ...worded.actions.open, name: 'Claim your reward', description: 'You receive 1,000,000 satoshis. Nothing leaves your wallet.' } },
        transactions: { ...worded.transactions, openTransaction: { ...worded.transactions.openTransaction, description: 'A reward of 1,000,000 satoshis was paid to you.' } },
        outputs: { ...worded.outputs, boxOutput: { ...worded.outputs.boxOutput, name: 'Your reward' } },
      },
      strongboxDeclaration,
    );
    const values = { amount: 30_000, label: '01' };
    const plain = await honest.applications.preview(request(strongbox, 'open', 'holder', values));
    const dressed = await misled.applications.preview(request(lying, 'open', 'holder', values));
    // The words are the template's.
    expect(dressed.words.action.name).toBe('Claim your reward');
    expect(dressed.words.outcome).toContain('1,000,000');
    // The figures are the wallet's: 30,000 satoshis leave it for a script that is not its own.
    const { toOthers: honestOthers, ...honestFigures } = plain.figures;
    const { toOthers: dressedOthers, ...dressedFigures } = dressed.figures;
    expect(dressedFigures).toEqual(honestFigures);
    expect(dressedOthers.map(({ satoshis, lockingBytecode }) => [satoshis, lockingBytecode])).toEqual(honestOthers.map(({ satoshis, lockingBytecode }) => [satoshis, lockingBytecode]));
    expect(dressed.figures.givesSatoshis - dressed.figures.getsSatoshis).toBe(30_000n + dressed.figures.feeSatoshis);
    expect(dressed.figures.toOthers[0]?.satoshis).toBe(30_000n);
  });

  it('an action with a lock time is shown with the earliest time it can be sent', async () => {
    const device = await deviceWith([100_000n]);
    const timed = JSON.parse(templateText(strongboxTemplate)) as typeof strongboxTemplate;
    const later = presentation({ ...timed, transactions: { ...timed.transactions, openTransaction: { ...timed.transactions.openTransaction, locktime: 1_900_000_000 } } }, strongboxDeclaration);
    const preview = await device.applications.preview(request(later, 'open', 'holder', { amount: 30_000, label: '01' }));
    expect(preview.figures.notBefore).toBe(1_900_000_000);
  });

  it('an action the wallet\'s coins do not cover is refused with the figures', async () => {
    const device = await deviceWith([10_000n]);
    await expect(device.applications.preview(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }))).rejects.toThrow('Insufficient funds');
    await expect(device.applications.preview(request(strongbox, 'open', 'holder', { amount: 100, label: '01' }))).rejects.toThrow('less than the');
  });
});

describe('what the wallet says about a template', () => {
  it('AP08: a template that breaks one of the three rules is named with the rule; one the wallet cannot check is shown as not verified, never as verified', async () => {
    const device = await deviceWith([100_000n]);
    const source = JSON.parse(templateText(strongboxTemplate)) as typeof strongboxTemplate;

    // Rule 1: a key of the user's inside an application's script.
    const keyed = presentation(
      {
        ...source,
        scripts: { ...source.scripts, boxBytecode: '<ownerKey.public_key> OP_CHECKSIG' },
        variables: { ...source.variables, ownerKey: { name: 'Owner key', description: 'The key that opens the box.', type: 'private_key' } },
      },
      strongboxDeclaration,
    );
    const first = device.applications.describe(keyed.names, keyed.texts).verdict;
    expect(first.statement).toBe('violation');
    expect(first.statement === 'violation' ? first.violations[0]?.rule : 0).toBe(1);
    expect(first.statement === 'violation' ? first.violations[0]?.consequence : '').toContain('A key cannot be replaced');

    // Rule 2: the token that carries authority goes to a script the application fixes.
    const fixed = presentation({ ...source, outputs: { ...source.outputs, keyOutput: { ...source.outputs.keyOutput, lockingScript: 'boxLockingScript' } } }, strongboxDeclaration);
    expect(device.applications.describe(fixed.names, fixed.texts).verdict).toMatchObject({ statement: 'violation', violations: [{ rule: 2 }] });

    // Rule 3: the position cannot be worked out from the token.
    const lost = presentation(strongboxTemplate, { ...strongboxDeclaration, authority: { boxKey: { ...strongboxDeclaration.authority.boxKey, position: { lockingScript: 'boxLockingScript', variables: {} } } } });
    const third = device.applications.describe(lost.names, lost.texts).verdict;
    expect(third).toMatchObject({ statement: 'violation', violations: [{ rule: 3 }] });
    expect(third.statement === 'violation' ? third.violations[0]?.consequence : '').toContain('could not find');

    // The user is told which rule, and the wallet does not carry out an action of such a template.
    await expect(device.applications.carryOut(request(fixed, 'open', 'holder', { amount: 30_000, label: '01' }))).rejects.toThrow('rule 2');
    expect(device.applications.templates).toEqual([]);

    // A template without a declaration cannot be checked: not verified.
    const bare = presentation(strongboxTemplate);
    expect(device.applications.describe(bare.names, bare.texts).verdict).toMatchObject({ statement: 'not verified' });
    // Nor is a well-formed one verified when the wallet first meets it.
    expect(device.applications.describe(strongbox.names, strongbox.texts).verdict).toMatchObject({ statement: 'not verified' });
  });

  it('a template counts as verified only once a token of it has led to its position on chain', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    expect(device.applications.describe(strongbox.names).verdict.statement).toBe('not verified');
    await device.applications.tokens();
    const verdict = device.applications.describe(strongbox.names).verdict;
    expect(verdict.statement).toBe('verified');
    expect(verdict.statement === 'verified' ? verdict.basis : '').toContain('does not mean that the contract was audited');
  });

  it('AP09: an unknown profile or version is refused explicitly', async () => {
    const device = await deviceWith([100_000n]);
    const { identifier, contentHash } = readTemplate(templateText(strongboxTemplate));
    for (const [profile, version] of [
      ['recoverable-app-v2', 1],
      ['recoverable-app-v1', 2],
    ] as const) {
      const text = JSON.stringify({ profile, version, template: { identifier, contentHash }, ...strongboxDeclaration });
      const presented = { names: { ...strongbox.names, declaration: presentationHash(text) }, texts: { template: strongbox.texts.template, declaration: text } };
      expect(() => device.applications.describe(presented.names, presented.texts)).toThrow(UnknownProfileError);
      await expect(device.applications.preview(request(presented, 'open', 'holder', { amount: 30_000, label: '01' }))).rejects.toThrow(`"${profile}", version ${version}`);
    }
    expect(device.applications.templates).toEqual([]);
  });
});

describe('finding a position through a companion coin', () => {
  /** A bond posted by the wallet, and its key. */
  const posted = async () => {
    const device = await deviceWith([100_000n, 50_000n]);
    // The key goes to the next change address.
    const keyNumber = next(device, change);
    const outcome = await device.applications.carryOut(request(bond, 'post', 'poster', { amount: 20_000, serial: '07' }));
    const [key] = await device.applications.tokens();
    if (key === undefined) throw new Error('no key');
    const outputs = await outputsOf(device, outcome.transactionId);
    return { device, key, outputs, keyNumber };
  };
  const definition = readTemplate(templateText(bondTemplate)).definition;

  it('the position is found from the key, through its companion coin, and returns to the address fixed when it was posted', async () => {
    const { key } = await posted();
    expect(key).toMatchObject({ meaning: 'position', authority: 'bondKey', position: { status: 'open', satoshis: 20_000n, coins: 1 } });
    expect(key.actions?.map(({ action }) => action)).toEqual(['redeem']);
  });

  it('AP14: a look-alike of the companion coin, made by the holder of a token, is not taken for the position', async () => {
    const { device, key, outputs, keyNumber } = await posted();
    // The key's holder can move the companion coin. It is put back at its script, behind an output that is not a bond.
    const [companion] = device.chain.outputsAt(outputs[1]?.lockingBytecode as Uint8Array);
    const [keyCoin] = (await device.wallet.balance()).tokens;
    if (companion === undefined || keyCoin === undefined) throw new Error('coins missing');
    const payer = testKey(0x51);
    const payerAt = p2pkhLockingBytecode(payer.keyHash);
    device.chain.fund(payerAt, 20_000n);
    const [funds] = device.chain.outputsAt(payerAt);
    const keyAddress = walletAddress(device.identity, seedOf(0).viewingKey, change, keyNumber);
    if (funds === undefined || keyAddress.kind === vault) throw new Error('unexpected');
    const unlocking = templateUnlockingBytecode(definition, 'companionLockingScript', 'bondInput', { bondKey: key.category, keyInput: 2n });
    const look = buildTransaction({
      inputs: [{ utxo: companion, unlock: () => unlocking }, p2pkhInput(funds, payer), recoverableInput(keyCoin.utxo, keyAddress.script, seedOf(0).addressKey(change, keyNumber))],
      outputs: [{ lockingBytecode: payerAt, valueSatoshis: 5_000n }, { ...companion.output }, { ...keyCoin.utxo.output }],
      changeLockingBytecode: payerAt,
    });
    expect(device.chain.submit(hex(look.encoded))).toMatchObject({ accepted: true });
    const [after] = await device.applications.tokens();
    expect(after?.position?.status).not.toBe('open');
    expect(after?.reason ?? after?.position?.note ?? '').toContain('not taken for it');
    await expect(device.applications.preview(device.applications.actionOn(key, 'redeem'))).rejects.toThrow('does not lead to a position');
  });

  it('AP14: two candidates are reported as ambiguous, and none is picked', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.trust(bond.names, bond.texts);
    // A transaction that makes one key and two bonds with their companion coins, as a faulty or dishonest issuer might.
    const maker = testKey(0x52);
    const makerAt = p2pkhLockingBytecode(maker.keyHash);
    const category = device.chain.fund(makerAt, 100_000n);
    const [coin] = device.chain.outputsAt(makerAt);
    if (coin === undefined) throw new Error('no coin');
    const holder = hex((await device.wallet.receiveAddress()).address.lockingBytecode);
    const values = { bondKey: category, amount: 10_000n, refundTo: hex(makerAt), holder, serial: '01' };
    const [bondOutput, companionOutput, keyOutput] = ['bondOutput', 'companionOutput', 'keyOutput'].map((output) => templateOutput(definition, output, values)) as [Output, Output, Output];
    const built = buildTransaction({ inputs: [p2pkhInput(coin, maker)], outputs: [bondOutput, companionOutput, bondOutput, companionOutput, keyOutput], changeLockingBytecode: makerAt });
    expect(device.chain.submit(hex(built.encoded))).toMatchObject({ accepted: true });
    const [key] = await device.applications.tokens();
    expect(key).toMatchObject({ category, meaning: 'position', position: { status: 'ambiguous', coins: 0 } });
    expect(key?.position?.note).toContain('picks none');
    if (key === undefined) throw new Error('no key');
    await expect(device.applications.preview(device.applications.actionOn(key, 'redeem'))).rejects.toThrow('picks none');
  });

  it('AP14: a position that needs data the chain does not hold is reported as incomplete', async () => {
    // The same template, with a declaration that takes the return address from the position\'s own token, which a bond does not carry.
    const needy = presentation(bondTemplate, {
      ...bondDeclaration,
      authority: { bondKey: { ...bondDeclaration.authority.bondKey, position: { ...bondDeclaration.authority.bondKey.position, genuine: { lockingScript: 'bondLockingScript', variables: { bondKey: 'token.category', refundTo: 'position.commitment' } } } } },
    });
    const device = await deviceWith([100_000n]);
    await device.applications.trust(needy.names, needy.texts);
    const maker = testKey(0x53);
    const makerAt = p2pkhLockingBytecode(maker.keyHash);
    const category = device.chain.fund(makerAt, 100_000n);
    const [coin] = device.chain.outputsAt(makerAt);
    if (coin === undefined) throw new Error('no coin');
    const holder = hex((await device.wallet.receiveAddress()).address.lockingBytecode);
    const values = { bondKey: category, amount: 10_000n, refundTo: hex(makerAt), holder, serial: '01' };
    const outputs = ['bondOutput', 'companionOutput', 'keyOutput'].map((output) => templateOutput(definition, output, values));
    expect(device.chain.submit(hex(buildTransaction({ inputs: [p2pkhInput(coin, maker)], outputs, changeLockingBytecode: makerAt }).encoded))).toMatchObject({ accepted: true });
    // A note says which template made the token; without it, a position that cannot be worked out shows nothing about the token.
    device.wallet.parts.store({ ...(device.wallet.parts.kept() ?? { templates: [], notes: [] }), notes: [{ category, templateIdentifier: needy.names.identifier, authority: 'bondKey' }] });
    const [key] = await device.applications.tokens();
    expect(key).toMatchObject({ category, meaning: 'incomplete' });
    expect(key?.reason).toContain('cannot be checked');
  });
});
