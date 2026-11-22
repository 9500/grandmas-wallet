import {
  type ActionOutcome,
  type ActionPreview,
  type ApplicationAction,
  type HeldToken,
  type RecordedPosition,
  type ServiceStatus,
  type TemplateAction,
  type TemplateActions,
  type TemplateSummary,
  type TokenAction,
  InputsSpentError,
  ServiceAnswerRefusedError,
  ServiceDeclinedError,
  ServiceUnreachableError,
} from '@grandmas-wallet/app';
import { useState } from 'preact/hooks';

import { Apps } from './Apps.js';
import type { Owner } from './OwnerApp.js';

/*
 * The Applications screen with a template that names a service, fed from fixed data (`fixtures.html?show=apps&service=`):
 * `never` (its service never asked: Connect, which answers after a moment), `reached` (its starting actions, one of
 * them not offered now with the service's reason, a token made by the wallet that waits elsewhere, and a token with the
 * follow-ups its service offers), `unreached` (its last exchange failed) or `unusable` (its address cannot be used).
 * Beside it, a token of a template without a service. With `&fail=unreachable`, `declined` or `refused`, working out an
 * action fails as it would with such a service; with `&fail=spent`, carrying it out fails because a coin was spent first,
 * and asking again goes through. With `&roles`, its starting actions are under two roles, each named beside its action, as
 * for a template whose role the wallet does not settle. The template, its words and the service are invented examples;
 * nothing is sent.
 */

const params = new URLSearchParams(window.location.search);
type Mode = 'never' | 'reached' | 'unreached' | 'unusable';
let mode: Mode = (['never', 'reached', 'unreached', 'unusable'] as const).find((candidate) => candidate === params.get('service')) ?? 'reached';
const fail = params.get('fail');
const twoRoles = params.has('roles');

const AT = 1_795_000_000;
const URL_ = 'https://lending.example.org/xo';
const LENDING = 'c1e4a7b20d93f6581c2e7a4b9d0f3e6a8c1b5d7e9f2a4c6b8d0e1f3a5c7b9d2e';
const POSITION_KEY = '8e2c4a6b1d3f5e7a9c0b2d4f6e8a1c3b5d7f9e0a2c4b6d8f1e3a5c7b9d0f2e4a';
const NEW_KEY = '2b4d6f8a0c1e3a5c7e9b1d3f5a7c9e0b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c';
const UNITS = '5d0c1e7a92b4f6038ce1a7d29b40f5e6c3a8172d9e04b6f1a35c8e27d1f09b4a';
const CLUB = 'b5'.repeat(32);
const CARD = '9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e3f5a7b9c1d2e4f6a8b';
const PAGE = 'https://shared-box.example.org/';

const words = {
  prepare: ['Make a key', 'Make the key of a new position. It waits in the lending contract until the position is opened.'],
  fixed: ['Borrow at a fixed rate', 'Open a position whose interest does not change.'],
  borrow: ['Borrow', 'Open the position with its key: the collateral goes into the contract, the borrowed tokens come to you.'],
  repay: ['Repay and close', 'Repay the whole debt; the collateral comes back.'],
  add: ['Add collateral', 'Put more BCH behind the position.'],
} as const;
const actionOf = (action: keyof typeof words, more: Partial<TemplateAction> = {}): TemplateAction => ({ action, role: 'borrower', name: words[action][0], description: words[action][1], ...more });

const lending: TemplateSummary = {
  identifier: LENDING,
  contentHash: LENDING.split('').reverse().join(''),
  name: 'Example lending with a service (test network)',
  description: 'Borrow a dollar token against BCH held by a contract. The template\'s service brings the price and the contract\'s coins.',
  actions: (Object.keys(words) as (keyof typeof words)[]).map((action) => ({ action, name: words[action][0], description: words[action][1] })),
  trusted: true,
  findings: (Object.keys(words) as (keyof typeof words)[]).map((action) => ({ action, role: 'borrower', name: words[action][0], finding: 'comes back', outputs: [] })),
};
const club: Pick<TemplateSummary, 'identifier' | 'name'> = { identifier: CLUB, name: 'Example club (test network)' };

const status = (): ServiceStatus => {
  const base = { description: 'The lending service', walletRole: { role: 'borrower', name: 'Borrower' } };
  switch (mode) {
    case 'never':
      return { ...base, url: URL_, state: 'never asked' };
    case 'reached':
      return { ...base, url: URL_, state: 'reached', role: { role: 'lender', name: 'Lender' }, reachedAt: AT, checkedAt: AT };
    case 'unreached':
      return { ...base, url: URL_, state: 'not reached', failure: { at: AT + 420, kind: 'unreachable', message: 'The service can\'t be reached. Nothing was sent.' } };
    case 'unusable':
      return { description: base.description, state: 'not usable', problem: 'The address is not https.' };
  }
};

const debt = { variable: 'debt', name: 'Amount to borrow', description: 'Tokens to borrow, in cents.', type: 'integer' };
const lend: TemplateAction = { action: 'lend', role: 'lender', name: 'Lend', description: 'Put coins up for borrowers to take.', asks: [{ variable: 'amount', name: 'Amount', description: 'Satoshis to put up.', type: 'satoshis' }] };
const borrowerStarting = (): TemplateAction[] => {
  if (mode === 'unusable') {
    const needs = 'It needs the template\'s service, which this wallet cannot use here: The address is not https.';
    return [actionOf('prepare', { asks: [debt], service: {}, needsApplication: needs }), actionOf('fixed', { service: {}, needsApplication: needs })];
  }
  if (mode !== 'reached') return [actionOf('prepare', { asks: [debt], service: {} }), actionOf('fixed', { service: {} })];
  return [actionOf('prepare', { asks: [debt], service: { available: true, checkedAt: AT } }), actionOf('fixed', { service: { available: false, reason: 'Fixed rates are not offered now.', checkedAt: AT } })];
};
const startingOf = (): TemplateAction[] => (twoRoles ? [...borrowerStarting(), lend] : borrowerStarting());
const waitingOf = (): TemplateAction[] => (mode === 'reached' ? [actionOf('borrow', { service: { checkedAt: AT }, waiting: { category: NEW_KEY, at: 'Lending contract' } })] : []);

const nft = (category: string, at: number) => ({ category, commitment: '', capability: 'none' as const, outpoint: `${'7c'.repeat(32)}:${at}`, satoshis: 1_000n, place: 'address' as const });
/** The key of an open position: its record names no script, so what it offers comes from the service. */
const positionKey: RecordedPosition = {
  token: nft(POSITION_KEY, 0),
  template: { identifier: LENDING, name: lending.name },
  tokenName: 'Position key',
  status: 'held',
  record: { kind: 'position', token: { category: POSITION_KEY, commitment: '', capability: 'none' }, templateIdentifier: LENDING, values: {} },
  standing: 'own',
};
/** A token of a template without a service: its action is done through the application's page. */
const card: RecordedPosition = {
  token: nft(CARD, 1),
  template: { identifier: CLUB, name: club.name },
  tokenName: 'Member card',
  status: 'open',
  record: { kind: 'position', token: { category: CARD, commitment: '', capability: 'none' }, templateIdentifier: CLUB, lockingScriptIdentifier: 'lockerLockingScript', roleIdentifier: 'holder', values: {}, applicationPage: PAGE },
  standing: 'own',
  lockingBytecode: 'aa20'.padEnd(70, 'c'),
  satoshis: 20_000n,
  coins: 1,
  actions: ['use'],
};
const held: HeldToken[] = [positionKey, card].map((position) => ({ ...position.token, amount: 0n, meaning: 'position', template: { identifier: position.template.identifier, name: position.template.name ?? '' }, ...(position.tokenName === undefined ? {} : { tokenName: position.tokenName }) }));

const offeredFor = (position: Pick<RecordedPosition, 'template'>): TokenAction[] => {
  if (position.template.identifier === CLUB) return [{ action: 'use', role: 'holder', name: 'Use the locker', description: 'Spend credits; the deposit comes back.', needsApplication: 'It spends a coin of the application\'s, "The club\'s door", which only the application can name.', page: PAGE }];
  if (mode !== 'reached') return [];
  return [
    actionOf('repay', { service: { checkedAt: AT, says: [{ variable: 'debt', name: 'Debt', value: '1250' }] } }),
    actionOf('add', { asks: [{ variable: 'amount', name: 'Amount', description: 'Satoshis to add.', type: 'satoshis' }], service: { checkedAt: AT } }),
  ];
};

const servicePart = (says: { variable: string; name: string; value: string }[]): NonNullable<ActionPreview['service']> => ({
  role: 'lender',
  roleName: 'Lender',
  url: URL_,
  values: [
    { variable: 'price', name: 'Price', description: 'Cents per BCH, from the price contract.', value: '52012' },
    { variable: 'rate', name: 'Interest', description: 'Hundredths of a percent a year.', value: '250' },
  ],
  says,
});
const contract = (satoshis: bigint) => ({ name: 'Lending contract', satoshis, token: { category: UNITS, amount: 9_870_000n, nft: { capability: 'minting', commitment: 'f6270000' } } });

/** Making a key: the key is made from the wallet's coin and waits in the lending contract. */
const prepare = (typed: Record<string, string | number>): ActionPreview => ({
  template: lending,
  words: { action: { name: words.prepare[0], description: words.prepare[1] }, outcome: '', values: [{ name: 'Amount to borrow', description: 'Tokens to borrow, in cents.', value: String(typed['debt'] ?? '10000') }] },
  figures: {
    givesSatoshis: 5_000n,
    getsSatoshis: 1_620n,
    feeSatoshis: 380n,
    remainderSatoshis: 0n,
    bytes: 380,
    intoApplicationSatoshis: 3_000n,
    fromApplication: { satoshis: 1_000n, coins: 1 },
    applicationInputs: [{ ...contract(1_000n), outpoint: `${'3467af925ecfe80e459e20b5266ab1b64c996da69fa870ffb23f2b7f5d879f45'}:0` }],
    toOthers: [
      { ...contract(1_000n), lockingBytecode: 'aa20'.padEnd(70, '1') },
      { name: 'Key, waiting', lockingBytecode: 'aa20'.padEnd(70, '6'), satoshis: 3_000n, token: { category: NEW_KEY, amount: 0n, nft: { capability: 'none', commitment: '' } } },
    ],
    toWallet: [{ kind: 'left over', satoshis: 1_620n }],
    tokensSpent: [],
    tokensNet: [],
    tokensDestroyed: [],
  },
  firstUse: false,
  tokensLeaving: [{ token: { category: NEW_KEY, commitment: '', capability: 'none' }, how: 'leaves', made: true, to: 'Key, waiting' }],
  service: servicePart([]),
});

/** Adding collateral to a position: the key is spent and comes back, the amount goes into the position. */
const addCollateral = (typed: Record<string, string | number>): ActionPreview => {
  const amount = BigInt(typed['amount'] ?? 50_000);
  return {
    template: lending,
    words: { action: { name: words.add[0], description: words.add[1] }, outcome: '', values: [{ name: 'Amount', description: 'Satoshis to add.', value: String(amount) }] },
    figures: {
      givesSatoshis: amount + 2_340n,
      getsSatoshis: 2_100n,
      feeSatoshis: 240n,
      remainderSatoshis: 0n,
      bytes: 240,
      intoApplicationSatoshis: amount,
      fromApplication: { satoshis: 59_957_301n, coins: 1 },
      applicationInputs: [{ name: 'The position', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:1`, satoshis: 59_957_301n }],
      toOthers: [{ name: 'The position', lockingBytecode: 'aa20'.padEnd(70, '3'), satoshis: 59_957_301n + amount }],
      toWallet: [
        { kind: 'receive', satoshis: 1_000n, token: { category: POSITION_KEY, amount: 0n, nft: { capability: 'none', commitment: '' } } },
        { kind: 'left over', satoshis: 1_100n },
      ],
      tokensSpent: [{ satoshis: 1_000n, token: { category: POSITION_KEY, amount: 0n, nft: { capability: 'none', commitment: '' } } }],
      tokensNet: [],
      tokensDestroyed: [],
    },
    firstUse: false,
    service: servicePart([{ variable: 'debt', name: 'Debt', value: '1250' }]),
  };
};

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const failure = (): Error | undefined =>
  fail === 'unreachable'
    ? new ServiceUnreachableError('The service can\'t be reached. Nothing was sent.', 'unreachable')
    : fail === 'declined'
      ? new ServiceDeclinedError('The service declined: Nothing is opened for new keys today.', 'not-possible')
      : fail === 'refused'
        ? new ServiceAnswerRefusedError('The service\'s "Lending contract" holds 1500 satoshis; the template\'s holds 2000.', 'output-differs')
        : undefined;

/** What the fixture put aside, for a check that leaving a review frees what it held. */
const discarded: string[] = [];
(window as unknown as { discarded: string[] }).discarded = discarded;
let carried = 0;
let contacting: Promise<ServiceStatus | undefined> | undefined;

const fixtureApplications = {
  readBackup: async () => undefined,
  tokens: async () => held,
  recordedPositions: async () => [positionKey, card],
  templates: [{ identifier: LENDING, contentHash: lending.contentHash, name: lending.name, trustedAt: AT - 86_400, applications: [], stored: true }],
  suggestions: [],
  describe: () => lending,
  describeAction: () => undefined,
  disallow: () => undefined,
  offeredActions: offeredFor,
  serviceOf: (identifier: string) => (identifier === LENDING ? status() : undefined),
  serviceContact: () => contacting,
  connect: (identifier: string) => {
    contacting ??= pause(1_500).then(() => {
      if (mode !== 'unusable') mode = 'reached';
      contacting = undefined;
      return identifier === LENDING ? status() : undefined;
    });
    return contacting;
  },
  templateActions: async (identifier: string): Promise<TemplateActions | undefined> =>
    identifier === LENDING
      ? { template: { identifier, name: lending.name }, ...(twoRoles ? { roleNames: { borrower: 'Borrower', lender: 'Lender' } } : { role: 'borrower' }), service: status(), starting: startingOf(), waiting: waitingOf() }
      : undefined,
  startAction: (identifier: string, action: string, typed: Record<string, string | number> = {}, role = 'borrower'): ApplicationAction => ({ template: { identifier, contentHash: lending.contentHash }, action, role, variables: {}, fromWallet: { typed } }),
  waitingAction: (identifier: string, category: string, action: string, typed: Record<string, string | number> = {}): ApplicationAction => ({ template: { identifier, contentHash: lending.contentHash }, action, role: 'borrower', variables: {}, about: { category, spent: true }, fromWallet: { typed } }),
  actionOn: (position: RecordedPosition, action: string, typed: Record<string, string | number> = {}): ApplicationAction => ({ template: { identifier: position.template.identifier, contentHash: lending.contentHash }, action, role: 'borrower', variables: {}, about: { category: position.token.category, spent: true }, fromWallet: { typed } }),
  preview: async (request: ApplicationAction): Promise<ActionPreview> => {
    await pause(600);
    const refused = failure();
    if (refused !== undefined) throw refused;
    return request.action === 'add' ? addCollateral(request.fromWallet?.typed ?? {}) : prepare(request.fromWallet?.typed ?? {});
  },
  discardPreview: async (request: ApplicationAction) => {
    discarded.push(request.action);
  },
  carryOut: async (): Promise<ActionOutcome> => {
    await pause(900);
    carried += 1;
    if (fail === 'spent' && carried === 1) throw new InputsSpentError('The service declined: The shared coin was spent. Ask again.');
    return { transactionId: '6e'.repeat(32), sent: {} as ActionOutcome['sent'], builtAs: '', tokens: [] };
  },
  backupAnswers: async () => true,
  watch: () => () => undefined,
  lastError: undefined,
};

/** The Applications screen of a wallet with the template that names a service; what changes is shown again, as on the page. */
export const ServiceApps = ({ base }: { base: Owner }) => {
  const [version, setVersion] = useState(0);
  const owner = {
    ...base,
    balance: { ...base.balance, tokens: held.map(() => ({})) },
    apps: { ...base.apps, version, changed: () => setVersion((count) => count + 1), applications: fixtureApplications, registries: { refresh: async () => undefined } },
  } as unknown as Owner;
  return <Apps owner={owner} />;
};
