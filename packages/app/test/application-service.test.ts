import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type ApplicationAction,
  type ServiceStatus,
  Applications,
  InputsSpentError,
  NotStoredError,
  ServiceAnswerRefusedError,
  ServiceDeclinedError,
  ServiceUnreachableError,
  TickNeededError,
  applicationArchive,
  applicationConnector,
} from '@grandmas-wallet/app';
import { type ServiceHandlers, type ServiceJoinOutcome, type ServicePossibleOutcome, type ServicePossibleRequest, type TemplateName, answerServiceRequest } from '@grandmas-wallet/connect';
import { invitationFromText, invitationToText, readTemplate, templateLockingBytecode, templateUnlockingBytecode } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, presentation, request, seedOf, strongbox } from '../../../test/support/applications.js';

/**
 * The wallet's handling of applications with an application's service (docs/xo-service.md), on the tests' backend and a
 * service in memory: a fake `fetch` that feeds `answerServiceRequest`, whose join appends the service's commit to the
 * invitation the wallet sent. The template is a minimal one of the tests' own with a user and a service: a starting
 * action that makes a token from the wallet's coin, and a follow-up on that token; the service brings a coin at a
 * shared script and a price each time.
 */

const hex = binToHex;
const view = (name: string, description: string) => ({ name, description });
const URL_ = 'https://service.example/xo';
const both = { user: { selectable: false, relevant: false }, service: { selectable: false, relevant: false } };
const participants = { participants: [{ role: 'user', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] };

const twoRoles = (resources: unknown[] = [{ name: 'xo_service_v1', description: 'The test service', url: URL_ }]) => ({
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Two-role test', 'A user and a service: the user makes a token, then pays with it into a shared script; the service brings a shared coin and a price.'),
  version: '1',
  supported: ['BCH_2026_05'],
  ...(resources.length === 0 ? {} : { resources }),
  roles: { user: view('User', 'The wallet.'), service: view('Service', 'The other participant.') },
  start: [{ action: 'open', role: 'user' }],
  actions: {
    open: {
      ...view('Open', 'Make a token of your own.'),
      roles: { user: { requirements: { variables: ['userCategory', 'userHolder'] } }, service: { requirements: { variables: ['servicePrice'] } } },
      requirements: participants,
      transaction: 'openTransaction',
    },
    act: {
      ...view('Pay in', 'Pay an amount into the shared script with your token.'),
      roles: { user: { requirements: { variables: ['userAmount', 'userCategory', 'userHolder'] } }, service: { requirements: { variables: ['servicePrice'] } } },
      requirements: participants,
      transaction: 'actTransaction',
    },
  },
  transactions: {
    openTransaction: {
      ...view('Opened', 'A token was made.'),
      inputs: [{ input: 'sharedInput', inputIndex: 1 }],
      outputs: [{ output: 'sharedOutput', outputIndex: 1 }, { output: 'tokenOutput', outputIndex: 2 }],
      version: 2,
      locktime: 0,
    },
    actTransaction: {
      ...view('Paid in', 'An amount was paid in.'),
      inputs: [{ input: 'sharedInput', inputIndex: 0 }],
      outputs: [{ output: 'sharedOutput', outputIndex: 0 }, { output: 'payOutput', outputIndex: 1 }, { output: 'backOutput', outputIndex: 2 }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: { sharedInput: { ...view('Shared coin', 'A coin at the shared script, brought by the service.'), unlockingScript: 'unlockShared' } },
  outputs: {
    sharedOutput: { ...view('Shared coin', 'Put back.'), lockingScript: 'sharedScript', valueSatoshis: '2000' },
    payOutput: { ...view('Paid in', 'The amount paid in.'), lockingScript: 'sharedScript', valueSatoshis: '$(<userAmount>)' },
    tokenOutput: { ...view('Test token', 'Your token.'), lockingScript: '$(<userHolder>)', valueSatoshis: '1000', token: { category: '$(<userCategory>)', amount: null, nft: { capability: 'none', commitment: '' } } },
    backOutput: { ...view('Test token', 'Your token, back.'), lockingScript: '$(<userHolder>)', valueSatoshis: '1000', token: { category: '$(<userCategory>)', amount: null, nft: { capability: 'none', commitment: '' } } },
  },
  lockingScripts: {
    sharedScript: {
      ...view('Shared script', 'Anyone may spend it with a positive number.'),
      lockingType: 'p2sh',
      lockingBytecode: 'sharedBytecode',
      selectable: false,
      roles: { user: { ...both.user, actions: [{ action: 'act', role: 'user' }] }, service: both.service },
    },
  },
  scripts: { sharedBytecode: 'OP_0 OP_GREATERTHAN', unlockShared: '<servicePrice>' },
  variables: {
    userAmount: { ...view('Amount', 'Satoshis to pay in.'), type: 'satoshis' },
    userCategory: { ...view('Token', 'The token\'s category.'), type: 'token_category' },
    userHolder: { ...view('Holder', 'The user\'s address.'), type: 'locking_script' },
    servicePrice: { ...view('Price', 'The service\'s price.'), type: 'integer' },
  },
});

const TEMPLATE = presentation(twoRoles());
const NAMES: TemplateName = TEMPLATE.names;
const { definition } = readTemplate(TEMPLATE.texts.template);
const SHARED = templateLockingBytecode(definition, 'sharedScript', {});
const PRICE = 7n;
const SERVICE_OUTPUTS: Record<string, string[]> = { open: ['sharedOutput'], act: ['sharedOutput', 'payOutput'] };

type Invitation = ReturnType<typeof invitationFromText>;
type Commit = Invitation['commits'][number];
type CommitData = Commit['data'];

interface Behaviour {
  /** Fail the carriage for these messages. */
  unreachable?: Set<string>;
  open?: { available: boolean; reason?: string };
  possible?: (request: ServicePossibleRequest) => ServicePossibleOutcome;
  /** Change the honest commit, or answer otherwise. */
  tamper?: (data: CommitData) => void;
  join?: () => ServiceJoinOutcome;
}

/** The service in memory, with every message it was sent. */
const fakeService = (device: Device, behaviour: Behaviour = {}) => {
  const calls: string[] = [];
  const committed: Record<string, unknown>[] = [];
  const handlers: ServiceHandlers = {
    hello: (asked) => ({ ok: true, serves: [{ template: asked.template, role: 'service' }] }),
    possible: (asked) =>
      behaviour.possible?.(asked) ?? {
        ok: true,
        height: 1,
        start: [{ action: 'open', ...(behaviour.open ?? { available: true }) }],
        items: asked.tokens.flatMap((token) => [
          { ref: `act-${token.category.slice(0, 8)}`, category: token.category, action: 'act', about: { category: token.category, spent: true }, bindings: { userHolder: 'receive' }, says: [{ variable: 'servicePrice', value: String(PRICE) }, { variable: 'userAmount', value: '4000' }] },
          // A service cannot invent an action: neither one the template does not have, nor a starting action as a follow-up.
          { ref: 'invented', category: token.category, action: 'takeEverything' },
          { ref: 'not-a-follow-up', category: token.category, action: 'open' },
        ]),
      },
    join: async (asked) => {
      if (behaviour.join !== undefined) return behaviour.join();
      const invitation = invitationFromText(asked.invitation);
      committed.push(Object.fromEntries((invitation.commits[0]?.data.variables ?? []).map(({ variableIdentifier, value }) => [variableIdentifier, value])));
      const [shared] = await device.chain.listUnspent(SHARED);
      if (shared === undefined) return { ok: false, error: 'No shared coin now.', code: 'not-possible' };
      const data: CommitData = {
        roleIdentifier: 'service',
        variables: [{ variableIdentifier: 'servicePrice', roleIdentifier: 'service', value: PRICE }],
        inputs: [{ outpointTransactionHash: hexToBin(shared.transactionId), outpointIndex: shared.index, inputIdentifier: 'sharedInput', unlockingBytecode: templateUnlockingBytecode(definition, 'sharedScript', 'sharedInput', { servicePrice: PRICE }), sequenceNumber: 0 }],
        outputs: (SERVICE_OUTPUTS[invitation.actionIdentifier] ?? []).map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })),
      };
      behaviour.tamper?.(data);
      const previous = invitation.commits.at(-1) as Commit;
      const now = Date.now();
      invitation.commits.push({ commitIdentifier: 'service-commit', previousCommitIdentifier: previous.commitIdentifier, entityIdentifier: 'service-entity', createdAtTimestamp: now, expiresAtTimestamp: now + 60_000, signature: 'service-signature', data });
      return { ok: true, invitation: invitationToText(invitation) };
    },
  };
  const fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    const action = String((JSON.parse(String(init.body)) as { xo_service_v1: { action: string } }).xo_service_v1.action);
    calls.push(action);
    if (behaviour.unreachable?.has(action) === true) throw new TypeError('fetch failed');
    const answer = await answerServiceRequest({ method: init.method ?? 'GET', body: String(init.body) }, { regtest: handlers });
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  return { fetch, calls, committed, behaviour };
};

/** A wallet with coins, a shared coin on the chain, and the handling of applications speaking to the service in memory. */
const withService = async (behaviour: Behaviour = {}, options: { service?: boolean } = {}) => {
  const device = await deviceWith([200_000n, 100_000n]);
  const service = fakeService(device, behaviour);
  const applications = new Applications(device.wallet.parts, {
    archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(0), identity: device.identity, chain: device.chain }),
    now: () => 1_795_000_000,
    ...(options.service === false ? {} : { service: { network: 'regtest', kind: 'public' as const, fetch: service.fetch } }),
  });
  device.chain.fund(SHARED, 2_000n);
  return { device, service, applications };
};

const contacted = async (applications: Applications): Promise<ServiceStatus | undefined> => applications.serviceContact(NAMES.identifier);

/** Trusted as the user trusts a template a page offers, its service asked. */
const trusted = async (applications: Applications) => {
  await applications.trust(NAMES, TEMPLATE.texts, 'the page', { contact: true });
  return contacted(applications);
};

/** The wallet's token of the template, made by the starting action. */
const opened = async (applications: Applications) => {
  await trusted(applications);
  const outcome = await applications.carryOut(applications.startAction(NAMES.identifier, 'open'));
  const [position] = await applications.recordedPositions({ template: NAMES.identifier });
  if (position === undefined) throw new Error('no position');
  return { outcome, position };
};

const nothingHeld = async (device: Device, before: { coins: number; allocation: unknown }) => {
  expect((await device.backend.coins()).length).toBe(before.coins);
  expect(device.state().allocation).toEqual(before.allocation);
};
const snapshot = async (device: Device) => ({ coins: (await device.backend.coins()).length, allocation: structuredClone(device.state().allocation) });

describe('an application\'s service: when the wallet speaks to it', () => {
  it('trusting a template in this session asks the service once: its hello and what is possible, both kept', async () => {
    const { service, applications } = await withService();
    expect(service.calls).toEqual([]);
    const status = await trusted(applications);
    expect(service.calls).toEqual(['xo_service_hello', 'xo_service_possible_request']);
    expect(status).toMatchObject({ state: 'reached', url: URL_, description: 'The test service', walletRole: { role: 'user', name: 'User' }, role: { role: 'service', name: 'Service' }, reachedAt: 1_795_000_000, checkedAt: 1_795_000_000 });
    // Trusted again: nothing more is asked.
    await applications.trust(NAMES, TEMPLATE.texts, 'the page');
    expect(service.calls).toHaveLength(2);
  });

  it('a page\'s offer, accepted, asks the service', async () => {
    const { service, applications } = await withService();
    const connector = applicationConnector(applications, { onProposals: () => undefined });
    await (connector as unknown as { options: { trustOffered: (t: TemplateName, texts: unknown, application: string) => Promise<void> } }).options.trustOffered(NAMES, TEMPLATE.texts, 'the page');
    await contacted(applications);
    expect(service.calls).toEqual(['xo_service_hello', 'xo_service_possible_request']);
  });

  it('a trust restored from the backup asks nothing; the screens show Connect, which asks hello and what is possible', async () => {
    const { device, service, applications } = await withService();
    await trusted(applications);
    expect(await applications.storeNow(NAMES.identifier)).toBe(true);
    // The same seed on a device that knows nothing yet: the backup's template is trusted again, as it was stored.
    let state: ReturnType<Device['wallet']['parts']['kept']>;
    const restored = new Applications(
      { ...device.wallet.parts, kept: () => state, store: (kept) => void (state = kept) },
      {
        archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(0), identity: device.identity, chain: device.chain }),
        now: () => 1_795_000_100,
        service: { network: 'regtest', kind: 'public', fetch: service.fetch },
      },
    );
    const before = service.calls.length;
    await restored.readBackup();
    expect(restored.templates.map(({ identifier }) => identifier)).toEqual([NAMES.identifier]);
    expect(restored.serviceContact(NAMES.identifier)).toBeUndefined();
    expect(service.calls).toHaveLength(before);
    expect(restored.serviceOf(NAMES.identifier)).toMatchObject({ state: 'never asked', url: URL_ });
    // Its starting action is offered all the same, to be checked when the user acts.
    expect((await restored.templateActions(NAMES.identifier))?.starting).toEqual([expect.objectContaining({ action: 'open', name: 'Open', service: {} })]);
    const status = await restored.connect(NAMES.identifier);
    expect(service.calls.slice(before)).toEqual(['xo_service_hello', 'xo_service_possible_request']);
    expect(status).toMatchObject({ state: 'reached', checkedAt: 1_795_000_100 });
  });

  it('nothing is asked on start-up, when tokens and positions are listed, or when the screens read what is offered', async () => {
    const { device, service, applications } = await withService();
    await opened(applications);
    const before = service.calls.length;
    const again = new Applications(device.wallet.parts, { now: () => 1_795_000_000, service: { network: 'regtest', kind: 'public', fetch: service.fetch } });
    for (const handling of [applications, again]) {
      await handling.tokens();
      const positions = await handling.recordedPositions();
      for (const position of positions) handling.offeredActions(position);
      await handling.templateActions(NAMES.identifier);
      handling.serviceOf(NAMES.identifier);
      await handling.positionsFromRecords(NAMES.identifier, 'the page');
      handling.describe(NAMES, TEMPLATE.texts);
    }
    expect(service.calls).toHaveLength(before);
  });

  it('a template added from a file names its service in the review, and asks it once when the user trusts it; reading the file asks nothing', async () => {
    const { service, applications } = await withService();
    const file = applications.readTemplateFile(TEMPLATE.texts.template);
    expect(file).toMatchObject({ kind: 'new', summary: { service: { description: 'The test service', url: URL_ } } });
    expect(service.calls).toEqual([]);
    if (file.kind === 'trusted') throw new Error('not new');
    await applications.trustFile(file);
    await contacted(applications);
    expect(service.calls).toEqual(['xo_service_hello', 'xo_service_possible_request']);
    expect(applications.readTemplateFile(TEMPLATE.texts.template)).toMatchObject({ kind: 'trusted' });
    await applications.templateActions(NAMES.identifier);
    expect(service.calls).toHaveLength(2);
    // Deleted, what the service said is gone with it; added again, it is asked once more.
    await applications.deleteTemplate(NAMES.identifier);
    expect(applications.serviceOf(NAMES.identifier)).toBeUndefined();
    const again = applications.readTemplateFile(TEMPLATE.texts.template);
    if (again.kind === 'trusted') throw new Error('not new');
    expect(applications.serviceOf((await applications.trustFile(again)).identifier)).toMatchObject({ url: URL_ });
    await contacted(applications);
    expect(service.calls).toHaveLength(4);
  });

  it('a service that cannot be reached leaves the template trusted, and says so in plain words', async () => {
    const { service, applications } = await withService({ unreachable: new Set(['xo_service_hello']) });
    const status = await trusted(applications);
    expect(applications.templates.map(({ identifier }) => identifier)).toEqual([NAMES.identifier]);
    expect(status).toMatchObject({ state: 'not reached', failure: { kind: 'unreachable', message: 'The service can\'t be reached. Nothing was sent.' } });
    service.behaviour.unreachable = new Set();
    expect(await applications.connect(NAMES.identifier)).toMatchObject({ state: 'reached' });
    expect(applications.serviceOf(NAMES.identifier)).not.toHaveProperty('failure');
  });
});

describe('an application\'s service: what the wallet offers', () => {
  it('a starting action under the template, as the service says: available, or not with its reason', async () => {
    const { service, applications } = await withService({ open: { available: false, reason: 'Nothing can be opened now.' } });
    await trusted(applications);
    const offered = await applications.templateActions(NAMES.identifier);
    expect(offered).toMatchObject({ template: { identifier: NAMES.identifier, name: 'Two-role test' }, role: 'user', service: { state: 'reached' }, waiting: [] });
    expect(offered?.starting).toEqual([{ action: 'open', role: 'user', name: 'Open', description: 'Make a token of your own.', service: { available: false, reason: 'Nothing can be opened now.', checkedAt: 1_795_000_000 } }]);
    // Carried out all the same, the service's word is asked afresh and stands: nothing is started.
    const error = await applications.carryOut(applications.startAction(NAMES.identifier, 'open')).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ServiceDeclinedError);
    expect((error as Error).message).toBe('The service declined: Nothing can be opened now.');
    expect(service.calls.filter((call) => call === 'xo_service_join_request')).toEqual([]);
  });

  it('follow-ups under the token, from the service\'s answer and checked against the template; an invented action is dropped', async () => {
    const { applications } = await withService();
    const { position } = await opened(applications);
    expect(position).toMatchObject({ status: 'held', tokenName: 'Test token', actions: ['act'] });
    const actions = applications.offeredActions(position);
    expect(actions).toEqual([
      {
        action: 'act',
        role: 'user',
        name: 'Pay in',
        description: 'Pay an amount into the shared script with your token.',
        asks: [{ variable: 'userAmount', name: 'Amount', description: 'Satoshis to pay in.', type: 'satoshis' }],
        // What the service says comes with the template's type for it, so that a screen shows it as the template's other values.
        service: { checkedAt: 1_795_000_000, says: [{ variable: 'servicePrice', name: 'Price', value: '7', type: 'integer' }, { variable: 'userAmount', name: 'Amount', value: '4000', type: 'satoshis' }] },
      },
    ]);
  });
});

describe('an application\'s service: an action carried out with the page closed', () => {
  it('a starting action: the review shows the wallet\'s own figures and, apart, what the service stated; the record is kept and the service asked again', async () => {
    const { device, service, applications } = await withService();
    await trusted(applications);
    const open = applications.startAction(NAMES.identifier, 'open');
    const preview = await applications.preview(open);
    expect(preview.words.action.name).toBe('Open');
    expect(preview.words.values.map(({ name }) => name)).toEqual(['Token', 'Holder']);
    // Each with the template's type for it, so that the review shows it as the template means it.
    expect(preview.words.values.map(({ type }) => type)).toEqual(['token_category', 'locking_script']);
    expect(preview.service).toEqual({ role: 'service', roleName: 'Service', url: URL_, values: [{ variable: 'servicePrice', name: 'Price', description: 'The service\'s price.', value: '7', type: 'integer' }], says: [] });
    expect(preview.figures.applicationInputs.map(({ name, satoshis }) => [name, satoshis])).toEqual([['Shared coin', 2_000n]]);
    expect(preview.figures.toOthers.map(({ name, satoshis }) => [name, satoshis])).toEqual([['Shared coin', 2_000n]]);
    expect(preview.figures.toWallet.map(({ kind, token }) => [kind, token?.nft?.capability])).toEqual([['left over', undefined], ['receive', 'none']]);
    expect(preview.recordsPosition).toBe(true);
    expect(preview.firstUse).toBe(true);
    const calls = service.calls.length;
    const stages: string[] = [];
    const outcome = await applications.carryOut(open, (stage) => stages.push(stage));
    expect(stages).toEqual(['recorded', 'sent']);
    // The review's invitation was finished: no second join. Then what is possible was asked again.
    expect(service.calls.slice(calls)).toEqual(['xo_service_possible_request']);
    const sent = decodeTransactionBch(hexToBin((await device.chain.getTransaction(outcome.transactionId)) ?? ''));
    if (typeof sent === 'string') throw new Error(sent);
    const category = hex(sent.inputs[0]?.outpointTransactionHash as Uint8Array);
    // The coin that defines the token is input 0, the service's coin input 1; what is left over is output 0.
    expect(outcome.tokens).toEqual([{ category, commitment: '', capability: 'none', satoshis: '1000' }]);
    expect(hex(sent.outputs[1]?.lockingBytecode as Uint8Array)).toBe(hex(SHARED));
    expect(applications.positionRecords).toEqual([expect.objectContaining({ templateIdentifier: NAMES.identifier, token: { category, commitment: '', capability: 'none' }, values: expect.objectContaining({ servicePrice: '7', userCategory: category }) as object })]);
    expect(applications.templates[0]?.stored).toBe(true);
    // The category was made: once its token is held, it is among the tokens the service is told of, and no longer kept as made.
    expect(device.state().applications?.made ?? []).toEqual([]);
  });

  it('after an action, the service is asked what is possible once the key holder lists what the action gave the wallet: a token received is told as held', async () => {
    const asked: ServicePossibleRequest[] = [];
    const { device, applications } = await withService({
      possible: (request) => {
        asked.push(request);
        return { ok: true, height: 1, start: [{ action: 'open', available: true }], items: [] };
      },
    });
    await trusted(applications);
    // The key holder lists what a transaction gave the wallet a moment after it was sent, as a server does.
    const listed = device.backend.coins.bind(device.backend);
    const before = new Set((await listed()).map((coin) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
    let shownFrom: number | undefined;
    device.backend.coins = async () => {
      const all = await listed();
      const fresh = all.filter((coin) => !before.has(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
      if (fresh.length === 0) return all;
      shownFrom ??= Date.now() + 600;
      return Date.now() >= shownFrom ? all : all.filter((coin) => !fresh.includes(coin));
    };
    const outcome = await applications.carryOut(applications.startAction(NAMES.identifier, 'open'));
    const [category] = outcome.tokens.map((token) => token.category);
    const after = asked.at(-1);
    expect(after?.tokens.map((token) => token.category)).toEqual([category]);
    expect(after?.made).toEqual([]);
  });

  it('a follow-up: the value a person gives is asked for and committed as a number; the wallet pays in, and its token comes back', async () => {
    const { service, applications } = await withService();
    const { position } = await opened(applications);
    await expect(applications.preview(applications.actionOn(position, 'act'))).rejects.toThrow('Give a value for "Amount".');
    const act = applications.actionOn(position, 'act', { userAmount: '5000' });
    const preview = await applications.preview(act);
    // What the service said of the amount the user gives is left out of the review, which shows the amount the action sets.
    expect(preview.service?.says).toEqual([{ variable: 'servicePrice', name: 'Price', value: '7', type: 'integer' }]);
    expect(preview.figures.toOthers.map(({ name, satoshis }) => [name, satoshis])).toEqual([['Shared coin', 2_000n], ['Paid in', 5_000n]]);
    expect(preview.figures.intoApplicationSatoshis).toBe(5_000n);
    expect(preview.tokensLeaving).toBeUndefined();
    const outcome = await applications.carryOut(act);
    expect(service.committed.at(-1)).toMatchObject({ userAmount: 5_000n, userCategory: position.token.category });
    expect(typeof service.committed.at(-1)?.['userAmount']).toBe('bigint');
    expect(outcome.tokens.map(({ category }) => category)).toEqual([position.token.category]);
  });

  it('a page\'s request that gives only the wallet\'s share goes through the service', async () => {
    const { device, service, applications } = await withService();
    const asked = request(TEMPLATE, 'open', 'user', {}, { application: 'the page', page: 'https://page.example/' });
    const preview = await applications.preview(asked);
    expect(preview.service?.values.map(({ name, value }) => [name, value])).toEqual([['Price', '7']]);
    // Approved as the session does it: the same request, made again from its entry.
    const outcome = await applications.carryOut({ ...asked });
    expect(service.calls.filter((call) => call === 'xo_service_join_request')).toHaveLength(1);
    expect(await device.chain.getTransaction(outcome.transactionId)).toBeDefined();
    // The template was trusted with the action: the service was asked after it.
    expect(applications.serviceOf(NAMES.identifier)).toMatchObject({ state: 'reached', checkedAt: 1_795_000_000 });
    // A page that names the application's coins itself is refused: the service brings them.
    await expect(applications.preview(request(TEMPLATE, 'open', 'user', {}, { inputs: { sharedInput: `${'00'.repeat(32)}:0` } }))).rejects.toThrow(/the service brings the application's coins/);
  });

  it('a page\'s request for a template without another role works as before, and nothing is asked of any service', async () => {
    const { device, service, applications } = await withService();
    const outcome = await applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: 'c0ffee' }));
    expect(await device.chain.getTransaction(outcome.transactionId)).toBeDefined();
    expect(service.calls).toEqual([]);
  });

  it('an action that needs the service is refused where the template names none, or the wallet speaks to none', async () => {
    const lone = presentation(twoRoles([]));
    const { applications } = await withService();
    await expect(applications.preview(request(lone, 'open', 'user', {}))).rejects.toThrow('"Open" needs "Service" to take part, and the template names no service this wallet can use. Nothing was signed.');
    const elsewhere = presentation(twoRoles([{ name: 'xo_service_v1', description: 'Plain', url: 'http://service.example/xo' }]));
    await expect(applications.carryOut(request(elsewhere, 'open', 'user', {}))).rejects.toThrow(/names no service this wallet can use: The address is not https/);
    const without = await withService({}, { service: false });
    await expect(without.applications.preview(request(TEMPLATE, 'open', 'user', {}))).rejects.toThrow(/This wallet speaks to no service here/);
  });
});

describe('an application\'s service: every refusal and failure leaves nothing held', () => {
  const failing = async (behaviour: Behaviour, expected: { type: new (...args: never[]) => Error; message: RegExp }) => {
    const { device, service, applications } = await withService(behaviour);
    await trusted(applications);
    const before = await snapshot(device);
    const broadcasts = device.chain.broadcasts;
    const error = await applications.carryOut(applications.startAction(NAMES.identifier, 'open')).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(expected.type);
    expect((error as Error).message).toMatch(expected.message);
    expect(device.chain.broadcasts).toBe(broadcasts);
    expect(applications.positionRecords).toEqual([]);
    await nothingHeld(device, before);
    // Answered honestly next time, the same action goes through with the same coins.
    Object.assign(service.behaviour, { unreachable: new Set(), tamper: undefined, join: undefined });
    await applications.carryOut(applications.startAction(NAMES.identifier, 'open'));
    return { device, service, applications };
  };

  it('the service cannot be reached', () => failing({ unreachable: new Set(['xo_service_join_request']) }, { type: ServiceUnreachableError, message: /^The service can't be reached\. Nothing was sent\.$/ }));
  it('the service declines', () => failing({ join: () => ({ ok: false, error: 'Not today.', code: 'not-possible' }) }, { type: ServiceDeclinedError, message: /^The service declined: Not today\.$/ }));
  it('the service changes its output: refused by the checks', () =>
    failing(
      {
        tamper: (data) => {
          (data.outputs as NonNullable<CommitData['outputs']>)[0] = { outputIdentifier: 'sharedOutput', roleIdentifier: 'service', valueSatoshis: 1_500n };
        },
      },
      { type: ServiceAnswerRefusedError, message: /^The service's answer was refused: The service's "Shared coin" holds 1500 satoshis; the template's holds 2000\. Nothing was signed\.$/ },
    ));
  it('the service states a value of the wallet\'s', () =>
    failing(
      {
        tamper: (data) => {
          data.variables?.push({ variableIdentifier: 'userHolder', roleIdentifier: 'service', value: hex(SHARED) });
        },
      },
      { type: ServiceAnswerRefusedError, message: /stated "Holder", which is the wallet's to state/ },
    ));
  it('the service says its coin was spent: ask again', async () => {
    const { applications } = await failing({ join: () => ({ ok: false, error: 'The shared coin was spent. Ask again.', code: 'inputs-spent' }) }, { type: InputsSpentError, message: /^The service declined: The shared coin was spent\. Ask again\.$/ });
    expect(applications.positionRecords).toHaveLength(1);
  });

  it('the network says the service\'s coin was spent after the review: ask again, with a fresh approval', async () => {
    const { device, applications } = await withService();
    await trusted(applications);
    const open = applications.startAction(NAMES.identifier, 'open');
    const before = await snapshot(device);
    const preview = await applications.preview(open);
    const [shared] = preview.figures.applicationInputs;
    device.chain.spendElsewhere(shared?.outpoint as string);
    const error = await applications.carryOut(open).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InputsSpentError);
    expect((error as InputsSpentError).code).toBe('inputs-spent');
    // The coins are free again. The addresses stay taken: a signature that names them left the wallet.
    expect((await device.backend.coins()).length).toBe(before.coins);
    // Asked again: a fresh review, then the approval.
    await applications.preview(open);
    await applications.carryOut(open);
    expect((await applications.recordedPositions()).length).toBe(1);
  });

  it('a review put aside frees what its invitation held', async () => {
    const { device, applications } = await withService();
    await trusted(applications);
    const before = await snapshot(device);
    const open: ApplicationAction = applications.startAction(NAMES.identifier, 'open');
    await applications.preview(open);
    expect((await device.backend.coins()).length).toBeLessThan(before.coins);
    await applications.discardPreview(open);
    await nothingHeld(device, before);
  });

  it('the user\'s tick: a token made from the wallet\'s coin that goes elsewhere is shown, and nothing is done without the tick', async () => {
    const away = twoRoles();
    (away.outputs.tokenOutput as { lockingScript: string }).lockingScript = 'sharedScript';
    away.actions.open.roles.user.requirements.variables = ['userCategory'];
    const presented = presentation(away);
    const { device, service, applications } = await withService();
    const asked = request(presented, 'open', 'user', {});
    const before = await snapshot(device);
    const preview = await applications.preview(asked);
    expect(preview.tokensLeaving).toEqual([expect.objectContaining({ how: 'leaves', made: true, to: 'Test token' })]);
    const broadcasts = device.chain.broadcasts;
    await expect(applications.carryOut(asked)).rejects.toBeInstanceOf(TickNeededError);
    expect(device.chain.broadcasts).toBe(broadcasts);
    // The review's invitation still waits for the approval with the tick; declined instead, nothing stays held.
    await applications.discardPreview(asked);
    await nothingHeld(device, before);
    await expect(applications.carryOut(asked)).rejects.toBeInstanceOf(TickNeededError);
    await nothingHeld(device, before);
    const joins = service.calls.filter((call) => call === 'xo_service_join_request').length;
    await applications.preview(asked);
    await expect(applications.carryOut(asked)).rejects.toBeInstanceOf(TickNeededError);
    await applications.carryOut(asked, undefined, { tokensLeave: true });
    expect(service.calls.filter((call) => call === 'xo_service_join_request').length).toBe(joins + 1);
    expect(device.chain.broadcasts).toBe(broadcasts + 1);
  });

  it('the backup first: without a store that confirms the template, nothing is signed', async () => {
    const { device, service } = await withService();
    const unstored = new Applications(device.wallet.parts, { now: () => 1_795_000_000, service: { network: 'regtest', kind: 'public', fetch: service.fetch } });
    const before = await snapshot(device);
    const broadcasts = device.chain.broadcasts;
    await expect(unstored.carryOut(request(TEMPLATE, 'open', 'user', {}))).rejects.toBeInstanceOf(NotStoredError);
    expect(device.chain.broadcasts).toBe(broadcasts);
    await nothingHeld(device, before);
  });

  it('a wallet without a coin that can define the token pays itself first, then asks the service again', async () => {
    const device = await deviceWith([200_000n], { outputIndex: 1 });
    const service = fakeService(device);
    const applications = new Applications(device.wallet.parts, {
      archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(0), identity: device.identity, chain: device.chain }),
      now: () => 1_795_000_000,
      service: { network: 'regtest', kind: 'public', fetch: service.fetch },
    });
    device.chain.fund(SHARED, 2_000n);
    await trusted(applications);
    const open = applications.startAction(NAMES.identifier, 'open');
    const preview = await applications.preview(open);
    expect(preview.figures.payingItself?.feeSatoshis).toBeGreaterThan(0n);
    const broadcasts = device.chain.broadcasts;
    const outcome = await applications.carryOut(open);
    // Paying itself, then the action.
    expect(device.chain.broadcasts).toBe(broadcasts + 2);
    expect(service.calls.filter((call) => call === 'xo_service_join_request')).toHaveLength(2);
    expect(outcome.tokens).toHaveLength(1);
  });
});
