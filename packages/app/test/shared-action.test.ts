import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type SharedAccepted,
  type SharedRefusalCode,
  askServiceHello,
  askServiceJoin,
  builtAsPlanned,
  checkOtherParticipant,
  planSharedFinish,
  servedRole,
  takeJoinedInvitation,
} from '@grandmas-wallet/app';
import { type ServiceHandlers, answerServiceRequest } from '@grandmas-wallet/connect';
import { type AccountCoin, INPUT_BYTES, invitationFromText, invitationToText, readTemplate, templateLockingBytecode, templateUnlockingBytecode } from '@grandmas-wallet/core';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * An action another participant joins, on the tests' backend with a fake service made of hand-built answers: the
 * wallet's checks of what the service added refuse each tampering, the smallest that triggers each refusal, and
 * accept the honest answer, whose transaction is then built as the wallet worked it out and taken by the chain.
 */

const hex = binToHex;
const view = (name: string, description: string) => ({ name, description });
/** A minimal two-role template of the tests' own: a user and a service, which brings a price and a coin at a shared script. */
const TEMPLATE = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Two-party test', 'A user and a service: the service brings a coin at a shared script and a price; the user is paid an amount plus that price.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { user: view('User', 'The wallet.'), service: view('Service', 'The other participant.') },
  start: [{ action: 'act', role: 'user' }],
  actions: {
    act: {
      ...view('Act', 'The service brings its coin and price; the user is paid.'),
      roles: { user: { requirements: { variables: ['userAmount', 'userHolder'] } }, service: { requirements: { variables: ['servicePrice'] } } },
      requirements: { participants: [{ role: 'user', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] },
      transaction: 'actTransaction',
    },
  },
  transactions: {
    actTransaction: {
      ...view('Acted', 'The user was paid.'),
      inputs: [{ input: 'sharedInput', inputIndex: 0 }],
      outputs: [{ output: 'sharedOutput', outputIndex: 0 }, { output: 'userOutput', outputIndex: 1 }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: { sharedInput: { ...view('Shared coin', 'A coin at the shared script, brought by the service.'), unlockingScript: 'unlockShared' } },
  outputs: {
    sharedOutput: { ...view('Shared coin', 'Put back.'), lockingScript: 'sharedScript', valueSatoshis: '2000' },
    userOutput: { ...view('To the user', 'The amount plus the price.'), lockingScript: '$(<userHolder>)', valueSatoshis: '$(<userAmount> <servicePrice> OP_ADD)' },
  },
  lockingScripts: {
    sharedScript: {
      ...view('Shared script', 'Anyone may spend it with a positive number.'),
      lockingType: 'p2sh',
      lockingBytecode: 'sharedBytecode',
      selectable: false,
      roles: { user: { selectable: false, relevant: false }, service: { selectable: false, relevant: false } },
    },
  },
  scripts: { sharedBytecode: 'OP_0 OP_GREATERTHAN', unlockShared: '<servicePrice>' },
  variables: {
    userAmount: { ...view('Amount', 'Satoshis to the user.'), type: 'satoshis' },
    userHolder: { ...view('Holder', 'The user\'s address.'), type: 'locking_script' },
    servicePrice: { ...view('Price', 'The service\'s price.'), type: 'integer' },
    spare: { ...view('Spare', 'Given to no role in this action.'), type: 'integer' },
  },
};
const TEXT = JSON.stringify(TEMPLATE);
const { definition } = readTemplate(TEXT);
const SHARED = templateLockingBytecode(definition, 'sharedScript', {});
const PRICE = 7n;
const unlockingFor = (price: bigint): Uint8Array => templateUnlockingBytecode(definition, 'sharedScript', 'sharedInput', { servicePrice: price });

type Invitation = ReturnType<typeof invitationFromText>;
type Commit = Invitation['commits'][number];
type CommitData = Commit['data'];

const setUp = async (options: { walletValues?: Record<string, bigint | string>; bring?: boolean } = {}) => {
  const chain = new SimulatedChain();
  const backend = new KeyBackend(chain, { controllerKey: testKey(1), fundingKey: testKey(2), addressKey: () => testKey(3) });
  const template = await backend.importTemplate(TEXT);
  const holder = await backend.ordinaryAddress();
  for (const value of [200_000n, 50_000n]) chain.fund(holder, value);
  const sharedId = chain.fund(SHARED, 2_000n);
  const coins = await backend.coins();
  const brought = options.bring === false ? [] : [coins.find((coin) => coin.utxo.output.valueSatoshis === 50_000n) as AccountCoin];
  const values = options.walletValues ?? { userAmount: 10_000n, userHolder: hex(holder) };
  const started = await backend.startShared({ template, action: 'act', role: 'user', variables: values, inputs: brought.map((coin) => ({ coin })) });
  return { chain, backend, template, holder, sharedId, brought, started, available: coins.filter((coin) => !brought.includes(coin)) };
};

/** The service's honest commit, and what a test changes in it. */
const serviceData = (sharedId: string): CommitData => ({
  roleIdentifier: 'service',
  variables: [{ variableIdentifier: 'servicePrice', roleIdentifier: 'service', value: PRICE }],
  inputs: [{ outpointTransactionHash: hexToBin(sharedId), outpointIndex: 0, inputIdentifier: 'sharedInput', unlockingBytecode: unlockingFor(PRICE), sequenceNumber: 0 }],
  outputs: [{ outputIdentifier: 'sharedOutput', roleIdentifier: 'service', lockingBytecode: SHARED }],
});

/** The fake service: the invitation it received, with commits of its own appended, and the whole changed as a test says. */
const join = (text: string, data: CommitData, change: (invitation: Invitation) => void = () => undefined, extra = 0): string => {
  const invitation = invitationFromText(text);
  const now = Date.now();
  for (let n = 0; n <= extra; n++) {
    const previous = invitation.commits.at(-1) as Commit;
    invitation.commits.push({
      commitIdentifier: `service-commit-${n}`,
      previousCommitIdentifier: previous.commitIdentifier,
      entityIdentifier: 'service-entity',
      createdAtTimestamp: now,
      expiresAtTimestamp: now + 60_000,
      signature: 'service-signature',
      data: n === 0 ? data : { roleIdentifier: 'service' },
    });
  }
  change(invitation);
  return invitationToText(invitation);
};

/** Everything up to the wallet's checks, with the service's commit changed by `tamper`. */
const verdictFor = async (tamper: (data: CommitData, ids: { sharedId: string; chain: SimulatedChain }) => void, options: { walletValues?: Record<string, bigint | string>; late?: boolean; change?: (invitation: Invitation) => void; extra?: number } = {}) => {
  const set = await setUp(options);
  const data = serviceData(set.sharedId);
  tamper(data, { sharedId: set.sharedId, chain: set.chain });
  const text = join(set.started.text, data, options.change, options.extra ?? 0);
  const took = await takeJoinedInvitation(set.backend, set.started, text);
  if (!took.ok) return { set, verdict: took };
  const now = Date.now();
  const verdict = await checkOtherParticipant({
    template: definition,
    action: 'act',
    walletRole: 'user',
    otherRole: 'service',
    committed: took.taken.own,
    added: took.taken.others,
    chain: set.chain,
    now,
    answerBy: options.late === true ? now - 1 : now + 25_000,
  });
  return { set, verdict };
};

const refusedWith = async (code: SharedRefusalCode, tamper: Parameters<typeof verdictFor>[0], options: Parameters<typeof verdictFor>[1] = {}) => {
  const { set, verdict } = await verdictFor(tamper, options);
  expect(verdict.ok ? 'accepted' : verdict.code).toBe(code);
  if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(10);
  // The wallet puts the invitation aside: the coin it brought is free again.
  await set.backend.abandonShared(set.started.invitationIdentifier);
  expect((await set.backend.coins()).length).toBe(2);
  return verdict;
};

const elsewhere = hexToBin(`76a914${'66'.repeat(20)}88ac`);
const first = <T>(items: T[] | undefined): T => (items as T[])[0] as T;

describe('the wallet\'s checks of what another participant added', () => {
  it('accepts the honest answer; the transaction is built as worked out, signed, checked and taken by the chain', async () => {
    const { set, verdict } = await verdictFor(() => undefined);
    expect(verdict.ok).toBe(true);
    const accepted = verdict as SharedAccepted;
    expect(accepted.values['servicePrice']).toBe(PRICE);
    expect(accepted.theirInputs.map(({ inputIdentifier, lockingScript, sequence }) => ({ inputIdentifier, lockingScript, sequence }))).toEqual([{ inputIdentifier: 'sharedInput', lockingScript: 'sharedScript', sequence: 0 }]);
    expect(accepted.theirOutputs.map(({ outputIdentifier, output }) => [outputIdentifier, output.valueSatoshis])).toEqual([['sharedOutput', 2_000n]]);
    expect(accepted.left).toEqual({ inputs: [], outputs: ['userOutput'] });

    const plan = planSharedFinish({
      template: definition,
      action: 'act',
      invitationIdentifier: set.started.invitationIdentifier,
      committed: set.brought.map((coin) => ({ coin, bytes: INPUT_BYTES.p2pkh })),
      accepted,
      outputs: [{ outputIdentifier: 'userOutput' }],
      available: set.available.filter((coin) => coin.utxo.output.lockingBytecode.length === 25).map((coin) => ({ coin, bytes: INPUT_BYTES.p2pkh })),
      change: set.holder,
      feeRate: 1,
    });
    if (!plan.ok) throw new Error(plan.reason);
    // The coin the wallet brought pays the fee: no other coin is needed.
    expect(plan.finish.inputs).toEqual([]);
    const prepared = await set.backend.finishShared(plan.finish);
    expect(builtAsPlanned(plan.planned, prepared)).toBeUndefined();
    expect(prepared.feeSatoshis).toBe(plan.feeSatoshis);
    expect(prepared.bytes).toBe(plan.bytes);
    const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof transaction === 'string') throw new Error(transaction);
    expect(transaction.outputs.map((output) => [hex(output.lockingBytecode), output.valueSatoshis])).toEqual([
      [hex(SHARED), 2_000n],
      [hex(set.holder), 10_007n],
      [hex(set.holder), 50_000n + 2_000n - 2_000n - 10_007n - plan.feeSatoshis],
    ]);
    expect(transaction.inputs.map((input) => hex(input.unlockingBytecode) === hex(unlockingFor(PRICE)))).toEqual([true, false]);
    expect(await set.backend.send(prepared)).toBe(prepared.transactionId);
  });

  it('refuses a late answer: the engine does not enforce a commit\'s expiry', () => refusedWith('late', () => undefined, { late: true }));
  it('refuses two commits added instead of one', () => refusedWith('commit-count', () => undefined, { extra: 1 }));
  it('refuses an answer in which the wallet\'s own commit was changed', () =>
    refusedWith('changed-invitation', () => undefined, {
      change: (invitation) => {
        first(first(invitation.commits).data.variables).value = 1n;
      },
    }));
  it('refuses a value of the wallet\'s role stated by the service', () =>
    refusedWith('wallet-variable', (data) => data.variables?.push({ variableIdentifier: 'userHolder', roleIdentifier: 'service', value: hex(elsewhere) }), { walletValues: { userAmount: 10_000n } }));
  it('refuses a value of the wallet\'s role stated again, after the wallet set it', () =>
    refusedWith('wallet-variable', (data) => data.variables?.push({ variableIdentifier: 'userAmount', roleIdentifier: 'service', value: 1n })));
  it('refuses a value the wallet set stated again', () =>
    refusedWith('restated-variable', (data) => data.variables?.push({ variableIdentifier: 'spare', roleIdentifier: 'service', value: 1n }), { walletValues: { userAmount: 10_000n, userHolder: hex(elsewhere), spare: 3n } }));
  it('refuses a value outside the service\'s role', () => refusedWith('foreign-variable', (data) => data.variables?.push({ variableIdentifier: 'spare', roleIdentifier: 'service', value: 1n })));
  it('refuses an item tagged with the wallet\'s role', () =>
    refusedWith('role-tag', (data) => {
      first(data.outputs).roleIdentifier = 'user';
    }));
  it('refuses an input that is not a template input', () =>
    refusedWith('not-template-input', (data) => {
      delete first(data.inputs).inputIdentifier;
    }));
  it('refuses a coin unlocked otherwise than the template compiles', () =>
    refusedWith('unlocking', (data) => {
      first(data.inputs).unlockingBytecode = unlockingFor(PRICE + 1n);
    }));
  it('refuses another sequence number', () =>
    refusedWith('sequence', (data) => {
      first(data.inputs).sequenceNumber = 1;
    }));
  it('refuses a spent coin', () => refusedWith('coin-spent', (_data, { sharedId, chain }) => void chain.spendElsewhere(`${sharedId}:0`)));
  it('refuses a coin that is not at the template\'s script', () =>
    refusedWith('coin-script', (data, { chain }) => {
      first(data.inputs).outpointTransactionHash = hexToBin(chain.fund(elsewhere, 2_000n));
    }));
  it('refuses an output whose script differs from the template\'s', () =>
    refusedWith('output-differs', (data) => {
      first(data.outputs).lockingBytecode = elsewhere;
    }));
  it('refuses an output whose value differs from the template\'s', () =>
    refusedWith('output-differs', (data) => {
      first(data.outputs).valueSatoshis = 1_500n;
    }));
  it('refuses an output that carries a token the template\'s does not', () =>
    refusedWith('output-differs', (data) => {
      first(data.outputs).token = { category: new Uint8Array(32).fill(9), amount: 1n };
    }));
  it('refuses a free output', () => refusedWith('free-output', (data) => data.outputs?.push({ lockingBytecode: elsewhere, valueSatoshis: 5_000n })));
  it('refuses a resolution', () =>
    refusedWith('resolution', (data) => {
      data.resolutions = [{ resolutionIdentifier: 'someKey.public_key', value: new Uint8Array(33) }];
    }));
  it('refuses a commit in a role other than the one the service named', () =>
    refusedWith('participant', (data) => {
      data.roleIdentifier = 'user';
    }));
});

describe('the client for a service', () => {
  const template = { identifier: 'a1'.repeat(32), contentHash: 'b2'.repeat(32) };
  const fakeService = (handlers: Partial<ServiceHandlers>) => {
    const all: ServiceHandlers = {
      hello: () => ({ ok: false, error: 'Not served.', code: 'unknown-template' }),
      possible: () => ({ ok: false, error: 'Not served.', code: 'unknown-template' }),
      join: () => ({ ok: false, error: 'Not served.', code: 'unknown-template' }),
      ...handlers,
    };
    return async (_url: string, init: RequestInit): Promise<Response> => {
      const answer = await answerServiceRequest({ method: init.method ?? 'GET', body: String(init.body) }, { regtest: all });
      return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
    };
  };

  it('reads a hello answer and the role the service takes', async () => {
    const result = await askServiceHello('https://service.example/xo', { template, role: 'user' }, { network: 'regtest', fetch: fakeService({ hello: () => ({ ok: true, serves: [{ template, role: 'service' }] }) }) });
    if (!result.ok) throw new Error(result.message);
    expect(servedRole(result.serves, template, 'user')).toBe('service');
  });

  it('gives the service\'s refusal in its own words', async () => {
    const result = await askServiceJoin('https://service.example/xo', { invitation: '{}' }, { network: 'regtest', fetch: fakeService({}) });
    // An invitation that is not one is not even sent.
    expect(result.ok ? 'sent' : result.kind).toBe('unreadable');
    const set = await setUp();
    const declined = await askServiceJoin('https://service.example/xo', { invitation: set.started.text }, { network: 'regtest', fetch: fakeService({ join: () => ({ ok: false, error: 'The shared coin was spent. Ask again.', code: 'inputs-spent' }) }) });
    expect(declined).toEqual({ ok: false, kind: 'declined', message: 'The service declined: The shared coin was spent. Ask again.', code: 'inputs-spent' });
  });

  it('says plainly when the service cannot be reached', async () => {
    const result = await askServiceHello('https://service.example/xo', { template, role: 'user' }, { network: 'regtest', fetch: () => Promise.reject(new TypeError('fetch failed')) });
    expect(result).toEqual({ ok: false, kind: 'unreachable', message: 'The service can\'t be reached. Nothing was sent.' });
  });

  it('carries an invitation the service joined', async () => {
    const set = await setUp();
    const result = await askServiceJoin('https://service.example/xo', { invitation: set.started.text }, { network: 'regtest', fetch: fakeService({ join: (request) => ({ ok: true, invitation: join(request.invitation, serviceData(set.sharedId)) }) }) });
    if (!result.ok) throw new Error(result.message);
    expect((await takeJoinedInvitation(set.backend, set.started, result.invitation)).ok).toBe(true);
  });
});
