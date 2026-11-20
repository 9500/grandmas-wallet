import '@grandmas-wallet/ui/styles.css';
import './apps.css';
import './set-up.css';

import { type Output, binToHex, encodeLockingBytecodeP2sh32 as p2sh32, generateBip39Mnemonic, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import {
  type ActionFinding,
  type ActionPreview,
  type ApplicationAction,
  type Finding,
  type HeldToken,
  type RecordedPosition,
  type RecoveryArrangement,
  type TemplateSummary,
  type TokenAction,
  type TokenSendQuote,
  type TokenSendRequest,
  type UserBackup,
  FindingRefusalError,
  userBackupText,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import type { LedgerEntry } from '@grandmas-wallet/connect';
import { type ChallengeDelay, INPUT_BYTES, InsufficientFundsError, deriveSeedKeys, smallestOutputValue, transactionBytes } from '@grandmas-wallet/core';
import { sealPackage, signEnrollmentRequest } from '@grandmas-wallet/enrollment';
import { type Environment, Button, Card, Field, Frame, PageHead, Pill, TextArea, TextInput, formatTime } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { ActionReview } from './ActionReview.js';
import { Apps, TokenListView } from './Apps.js';
import { Receive } from './Receive.js';
import { Backup, Recovery } from './Recovery.js';
import { Send } from './Send.js';
import { tokenList } from './review-gate.js';
import { chooseToken } from './token-choice.js';
import { askToSetUp, meetRecoverer } from './hand-to-recoverer.js';
import type { Owner } from './OwnerApp.js';
import { RECOVERER_LINK, paymentAddress } from './scan.js';
import { ScanDialog, WithScan } from './Scanner.js';
import { ScanCode } from './ScanCode.js';
import { type Session, type StoredRecipient, keep } from './session.js';
import { Ready, SettingUpView, TryItHint } from './SetUp.js';
import { Welcome } from './Welcome.js';

/*
 * Parts of the wallet's screens, fed from fixed data, for looking at them in a browser without a wallet: the list of
 * tokens and positions (`fixtures.html?show=tokens`); the Applications screen (`show=apps`, `&connected` with a
 * connection, `&held` with tokens that no record ties to a position, `&linked` as opened from an application's
 * connection link, `&templates` with a trusted template and one the user stopped trusting, `&offer` for an application
 * that offers its template, `&offer=pool` for one offered with an action this wallet refuses, `&request=tick`,
 * `backup`, `tied`, `unclear` or `spent` (approved, then refused because another transaction spent one of its coins first) for a request, and `&records` for the list of positions from records); a request for a
 * decision on an action (`show=review` to borrow, `closing` to repay and close, `box-open` and `box-empty` for the
 * actions of a second template); the fields that take a scanned code (`show=scan`, and `&open` to show the scanner
 * already opened); the start (`show=welcome`), setting a wallet up with a recoverer's code (`show=setup-bank`,
 * `setup-friend`) and the wallet ready (`show=ready`); the Send screen for Bitcoin Cash (`show=send`, `&little` for a
 * wallet that holds too little to send everything) and with tokens to choose from (`show=send-token`, `&nft` to open
 * with the key chosen, `&nft=ticket` with a key whose record names no script, `&nft=spent` with one whose position is
 * emptied); the Receive screen (`show=receive`, `&again` for an address shown again); the Recovery screen
 * (`show=recovery`) and the user's own backup (`show=backup`, with a sample complete backup). Served by the
 * development server; the build of the page does not include it. The templates here are invented examples, as a
 * template would describe itself, and what is handed to the recoverer is a sample that their page cannot open.
 */

const CATEGORY = '5c1d8c7d635141a15d9d41747ebe30422ca50237c41c54c45714d09114439382';
const UNITS = 'e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8';
/** What the wallet found about each action of a template: here, that what it leaves comes back. */
const comesBack = (actions: TemplateSummary['actions']): ActionFinding[] => actions.map(({ action, name }) => ({ action, role: 'holder', name, finding: 'comes back', outputs: [] }));
const lendingActions: TemplateSummary['actions'] = [
  { action: 'borrow', name: 'Borrow', description: 'Open a position: the collateral goes into the contract, the borrowed tokens and the key come to the wallet.' },
  { action: 'manage', name: 'Change the collateral', description: 'Add collateral, or take some out.' },
  { action: 'close', name: 'Repay and close', description: 'Repay the whole debt; the collateral comes back.' },
];
const template: TemplateSummary = {
  identifier: 'aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be',
  contentHash: '99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61',
  name: 'Example lending (test network)',
  description: 'Borrow a dollar token against BCH held by a contract, manage the collateral and repay.',
  actions: lendingActions,
  trusted: true,
  findings: comesBack(lendingActions),
};

/** The key of a lending position, which a record ties to the lending template. */
const open: HeldToken = {
  category: CATEGORY,
  commitment: '',
  capability: 'minting',
  amount: 0n,
  place: 'address',
  outpoint: `${'c53e3c4bc0de782ba4791fa3c0b80fad8c650b525160d4ff1b475e5129cea3b1'}:5`,
  satoshis: 1_000n,
  meaning: 'position',
  template: { identifier: template.identifier, name: template.name },
  tokenName: 'Example key',
};
const unknown: HeldToken = { category: UNITS, commitment: '', amount: 10_000n, place: 'address', outpoint: `${'c53e3c4bc0de782ba4791fa3c0b80fad8c650b525160d4ff1b475e5129cea3b1'}:6`, satoshis: 1_000n, meaning: 'unknown' };

const borrowing: ActionPreview = {
  template,
  words: {
    action: { name: 'Borrow', description: 'Open a position: the collateral goes into the contract, the borrowed tokens and the key come to the wallet.' },
    outcome: '',
    values: [
      { name: 'Debt', description: 'Tokens borrowed, in cents.', value: '10000' },
      { name: 'Collateral', description: 'Satoshis the contract holds as collateral.', value: '59857301' },
      { name: 'Borrowing fee', description: 'Satoshis for opening the position.', value: '90915' },
    ],
  },
  figures: {
    givesSatoshis: 60_133_380n,
    getsSatoshis: 86_333n,
    feeSatoshis: 2_079n,
    remainderSatoshis: 0n,
    bytes: 2_079,
    intoApplicationSatoshis: 60_044_968n,
    fromApplication: { satoshis: 4_000n, coins: 4 },
    applicationInputs: [
      { name: 'The lending contract', outpoint: `${'3467af925ecfe80e459e20b5266ab1b64c996da69fa870ffb23f2b7f5d879f45'}:0`, satoshis: 1_000n, token: { category: UNITS, amount: 9_870_000n, nft: { capability: 'minting', commitment: 'f6270000' } } },
      { name: 'The price contract', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:0`, satoshis: 1_000n, token: { category: UNITS, amount: 0n, nft: { capability: 'mutable', commitment: '00a4110000656b0000' } } },
      { name: 'The new key', outpoint: `${'c53e3c4bc0de782ba4791fa3c0b80fad8c650b525160d4ff1b475e5129cea3b1'}:2`, satoshis: 1_000n },
      { name: 'The key\'s proof of origin', outpoint: `${'c53e3c4bc0de782ba4791fa3c0b80fad8c650b525160d4ff1b475e5129cea3b1'}:3`, satoshis: 1_000n },
    ],
    toOthers: [
      { name: 'The lending contract', lockingBytecode: 'aa20'.padEnd(70, '1'), satoshis: 1_000n },
      { name: 'The price contract', lockingBytecode: 'aa20'.padEnd(70, '2'), satoshis: 1_000n },
      { name: 'The position', lockingBytecode: 'aa20'.padEnd(70, '3'), satoshis: 59_857_301n },
      { name: 'Borrowing fee', lockingBytecode: 'aa20'.padEnd(70, '4'), satoshis: 90_915n },
    ],
    toWallet: [
      { kind: 'receive', satoshis: 1_000n, token: { category: CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } } },
      { kind: 'receive', satoshis: 1_000n, token: { category: UNITS, amount: 10_000n } },
      { kind: 'left over', satoshis: 84_333n },
    ],
    tokensSpent: [],
    tokensNet: [{ category: UNITS, amount: 10_000n }],
    tokensDestroyed: [{ name: 'The key\'s proof of origin', token: { category: '8a51671cdc956212bd6b9c5ff2ad75a5d5364ef916162d1b82ee64a3438557f8', amount: 0n, nft: { capability: 'none', commitment: '' } }, how: 'not carried on', wallet: false }],
  },
  firstUse: false,
};

const closing: ActionPreview = {
  template,
  words: { action: { name: 'Repay and close', description: 'Repay the whole debt; the collateral comes back.' }, outcome: '', values: [] },
  figures: {
    givesSatoshis: 2_000n,
    getsSatoshis: 59_958_451n,
    feeSatoshis: 1_850n,
    remainderSatoshis: 0n,
    bytes: 1_850,
    intoApplicationSatoshis: -59_958_301n,
    fromApplication: { satoshis: 59_960_301n, coins: 4 },
    applicationInputs: [
      { name: 'The price contract', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:0`, satoshis: 1_000n },
      { name: 'The position', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:1`, satoshis: 59_957_301n },
      { name: 'The position\'s sidecar', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:2`, satoshis: 1_000n },
      { name: 'The repay function', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:3`, satoshis: 1_000n },
    ],
    toOthers: [
      { name: 'The price contract', lockingBytecode: 'aa20'.padEnd(70, '2'), satoshis: 1_000n },
      { name: 'The repay function', lockingBytecode: 'aa20'.padEnd(70, '5'), satoshis: 1_000n },
    ],
    toWallet: [
      { kind: 'receive', satoshis: 1_000n, token: { category: CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } } },
      { kind: 'left over', satoshis: 59_957_451n },
    ],
    tokensSpent: [{ satoshis: 1_000n, token: { category: CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } } }, { satoshis: 1_000n, token: { category: UNITS, amount: 10_000n } }],
    tokensNet: [{ category: UNITS, amount: -10_000n }],
    tokensDestroyed: [
      { name: 'Tokens repaid', token: { category: UNITS, amount: 10_000n }, how: 'data output', wallet: true },
      { name: 'The position\'s record', token: { category: UNITS, amount: 0n, nft: { capability: 'mutable', commitment: '01102700000000000000000000f62700000000000000ff7f' } }, how: 'data output', wallet: false },
      { name: 'The position\'s sidecar', token: { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '01' } }, how: 'not carried on', wallet: false },
    ],
  },
  firstUse: false,
};

// ------------------------------------------------------------------ a second template: money kept until a date

const BOX_KEY = '41c7a9e3d2b8f0657a1c3e9d4b2f8a6c0e5d7b9a1f3c6e8d2b4a7f9c1e3d5b80';
const boxActions: TemplateSummary['actions'] = [
  { action: 'open', name: 'Open a money box', description: 'Make a new box with its key, and pay the first money in. It stays in the box until its date.' },
  { action: 'deposit', name: 'Pay into a money box', description: 'Add money to a box. It stays there until the box\'s date.' },
  { action: 'withdraw', name: 'Empty a money box', description: 'Take everything out of the box. Possible from the box\'s date on. The key stays with you, so the box can be used again.' },
];
/** A template that has come back once: a token made with it led to its position after a recovery. */
const box: TemplateSummary = {
  identifier: '6f0b3d1e9c2a4857b6d1e0f3a9c8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0',
  contentHash: 'd2e4f6a8b0c1d3e5f7a9b1c3d5e7f9a0b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0',
  name: 'Example money box (test network)',
  description: 'Money kept until a date. Anyone can pay into a box. From its date on, whoever holds the box\'s key can empty it.',
  actions: boxActions,
  trusted: false,
  cameBack: true,
  findings: comesBack(boxActions),
};
const boxAt = 'aa20'.padEnd(70, '9');

const boxOpening: ActionPreview = {
  template: box,
  words: {
    action: { name: 'Open a money box', description: 'Make a new box with its key, and pay the first money in. It stays in the box until its date.' },
    outcome: 'A money box was opened with 50000 satoshis.',
    values: [
      { name: 'Box key', description: 'The token category of the box\'s key.', value: BOX_KEY },
      { name: 'Opens on', description: 'When the box can be emptied, as a Unix time.', value: '1798761600' },
      { name: 'Amount to put in', description: 'Satoshis to put into the box.', value: '50000' },
      { name: 'Key holder', description: 'Where the box\'s key goes: an address of the wallet.', value: 'aa20'.padEnd(70, 'b') },
    ],
  },
  figures: {
    givesSatoshis: 60_000n,
    getsSatoshis: 9_550n,
    feeSatoshis: 450n,
    remainderSatoshis: 0n,
    bytes: 450,
    intoApplicationSatoshis: 50_000n,
    fromApplication: { satoshis: 0n, coins: 0 },
    applicationInputs: [],
    toOthers: [{ name: 'Money box', lockingBytecode: boxAt, satoshis: 50_000n }],
    toWallet: [
      { kind: 'receive', satoshis: 1_000n, token: { category: BOX_KEY, amount: 0n, nft: { capability: 'none', commitment: '80f55e6b' } } },
      { kind: 'left over', satoshis: 8_550n },
    ],
    tokensSpent: [],
    tokensNet: [],
    tokensDestroyed: [],
    payingItself: { feeSatoshis: 219n },
  },
  firstUse: true,
};

const boxEmptying: ActionPreview = {
  template: { ...box, trusted: true },
  words: {
    action: { name: 'Empty a money box', description: 'Take everything out of the box. Possible from the box\'s date on. The key stays with you, so the box can be used again.' },
    outcome: 'Everything was taken out of a money box.',
    values: [
      { name: 'Box key', description: 'The token category of the box\'s key.', value: BOX_KEY },
      { name: 'Opens on', description: 'When the box can be emptied, as a Unix time.', value: '1798761600' },
    ],
  },
  figures: {
    givesSatoshis: 1_000n,
    getsSatoshis: 50_610n,
    feeSatoshis: 390n,
    remainderSatoshis: 0n,
    bytes: 390,
    intoApplicationSatoshis: -50_000n,
    fromApplication: { satoshis: 50_000n, coins: 1 },
    applicationInputs: [{ name: 'Money box', outpoint: `${'e1'.repeat(32)}:0`, satoshis: 50_000n }],
    toOthers: [],
    toWallet: [
      { kind: 'receive', satoshis: 1_000n, token: { category: BOX_KEY, amount: 0n, nft: { capability: 'none', commitment: '80f55e6b' } } },
      { kind: 'left over', satoshis: 49_610n },
    ],
    tokensSpent: [{ satoshis: 1_000n, token: { category: BOX_KEY, amount: 0n, nft: { capability: 'none', commitment: '80f55e6b' } } }],
    tokensNet: [],
    tokensDestroyed: [],
    notBefore: 1_798_761_600,
  },
  firstUse: false,
};

/** A request for a decision, as the Applications screen shows it, with the buttons that do nothing here. */
const RequestFixture = ({ preview }: { preview: ActionPreview }) => (
  <Card title={`${preview.template.name.replace(/ \(test network\)$/, '')} asks for your decision`} cls="request-card">
    <div class="stack">
      <div class="asker">
        <Pill>Its own name, not verified</Pill>
        <span class="small muted">Asked {formatTime(1_795_000_000)}</span>
      </div>
      <ActionReview preview={preview} />
      <div class="actions decide">
        <Button onClick={ignore}>Approve</Button>
        <Button kind="quiet" onClick={ignore}>
          Decline
        </Button>
      </div>
      <p class="small muted">Nothing is signed or sent unless you approve.</p>
    </div>
  </Card>
);

/** Two fields that take a scanned code: the recoverer's link, and an address to pay. */
const ScanFields = () => {
  const [link, setLink] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(new URLSearchParams(window.location.search).has('open'));
  return (
    <Card title="Fields that take a code">
      <Field label="Your recoverer's link" id="recipient-link" hint="Scan the code your recoverer's page shows, or paste the link.">
        <WithScan filter={RECOVERER_LINK} onScan={setLink}>
          <TextArea id="recipient-link" value={link} onInput={setLink} placeholder="https://…#recoverer=…" />
        </WithScan>
      </Field>
      <Field label="To" id="to" hint="A Bitcoin Cash address.">
        <WithScan filter={paymentAddress('testnet')} onScan={setTo}>
          <TextInput id="to" value={to} onInput={setTo} placeholder="bchtest:…" />
        </WithScan>
      </Field>
      {open && <ScanDialog filter={RECOVERER_LINK} onScan={setLink} onClose={() => setOpen(false)} />}
    </Card>
  );
};

/**
 * Setting a wallet up, as on a phone: the recoverer's code scanned (or its text pasted), then a real request, signed
 * and sealed to the recoverer, sent over the session the code offers, and "Setting up…" for as long as the page has
 * not answered. The fixtures have no backup stores and no engine: the request is made without writing the viewing
 * key to a store, and a wallet that comes back is not opened.
 */
const FIXTURE_ENVIRONMENT: Environment = { network: 'chipnet', walletUrl: '', recovererUrl: '', stores: [], chain: [], relays: [], explorer: '', secondsPerBlock: 60 };

const SetUpFixture = ({ kind }: { kind: 'bank' | 'friend' }) => {
  const [recipient, setRecipient] = useState<StoredRecipient | undefined>();
  const [stage, setStage] = useState('meeting');
  const [delay, setDelay] = useState<ChallengeDelay | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [created, setCreated] = useState(false);
  useEffect(() => {
    if (recipient === undefined) return;
    const run = async () => {
      const said = await meetRecoverer(recipient);
      if (said.offer === undefined) throw new Error('This code does not set wallets up.');
      setDelay(said.offer.challengeDelay);
      const seed = deriveSeedKeys(generateBip39Mnemonic(), 'testnet', walletTemplateNumbers());
      const archive = { stores: [], archiveId: '00'.repeat(16), contentKey: '00'.repeat(32) };
      const requestId = binToHex(crypto.getRandomValues(new Uint8Array(16)));
      const sealed = await sealPackage(signEnrollmentRequest(seed, { requestId, archive, challengeDelay: said.offer.challengeDelay, firstAddress: 0 }), hexToBin(recipient.publicKey));
      const pending = { requestId, archive, requestHash: '', viewingKeyRecordHash: '', challengeDelay: said.offer.challengeDelay, firstAddress: 0, sealed: binToHex(sealed) };
      setStage('asking');
      await askToSetUp(recipient, pending, () => setStage('waiting'));
      setCreated(true);
    };
    run().catch((error: unknown) => setProblem((error as Error).message));
  }, [recipient]);
  if (recipient === undefined) return <ScanCode title={kind === 'bank' ? 'Scan your bank\'s code' : 'Scan the code on their screen'} hint={<TryItHint environment={{ ...FIXTURE_ENVIRONMENT, recovererUrl: 'https://recoverer.example/' }} kind={kind} />} onRead={setRecipient} onBack={() => undefined} />;
  if (created) return <Ready name={recipient.name} startingSatoshis={20_000n} onOpen={() => undefined} />;
  return <SettingUpView name={recipient.name || 'your helper'} kind={kind} stage={stage} challengeDelay={delay} problem={problem} onRetry={() => setProblem(undefined)} onAgain={() => setRecipient(undefined)} />;
};

// ------------------------------------------------------------------ sending and receiving tokens

const DOLLARS = 'a1d53bd8fa94e1c3a42e6d5c3e6d0b0a6b9f0e2c5d17c8f9e3b1a20475c6d8e9';
const dollars: HeldToken = { category: DOLLARS, commitment: '', amount: 25_000n, place: 'address', outpoint: `${'7b'.repeat(32)}:1`, satoshis: 1_000n, meaning: 'unknown' };
/** A key whose position sits at a script many users share: its record names no script, and the application's page. */
const SEND_TICKET = 'd7'.repeat(32);
const ticket: HeldToken = { category: SEND_TICKET, commitment: '', capability: 'minting', amount: 0n, place: 'address', outpoint: `${'d8'.repeat(32)}:0`, satoshis: 1_000n, meaning: 'position', template: { identifier: 'b6'.repeat(32), name: 'Example cloakroom (test network)' }, tokenName: 'Ticket' };
/** A key whose position at a script of its own was emptied. */
const SPENT_KEY = 'd9'.repeat(32);
const spentKey: HeldToken = { category: SPENT_KEY, commitment: '01', capability: 'none', amount: 0n, place: 'address', outpoint: `${'da'.repeat(32)}:0`, satoshis: 1_000n, meaning: 'position', template: { identifier: 'b4'.repeat(32), name: 'Example money box (test network)' }, tokenName: 'Box key' };
const held: HeldToken[] = [dollars, unknown, open, ticket, spentKey];
/** Where the key's position stands, as the wallet's record and the chain say. */
const keyPosition: RecordedPosition = {
  token: { category: open.category, commitment: open.commitment, capability: 'minting', outpoint: open.outpoint, satoshis: open.satoshis, place: 'address' },
  template: { identifier: template.identifier, name: template.name },
  tokenName: 'Example key',
  status: 'open',
  record: { kind: 'position', token: { category: open.category, commitment: '', capability: 'minting' }, templateIdentifier: template.identifier, lockingScriptIdentifier: 'position', roleIdentifier: 'borrower', values: {} },
  standing: 'own',
  lockingBytecode: 'aa20'.padEnd(70, '7'),
  satoshis: 59_957_301n,
  coins: 1,
};
const ticketPosition: RecordedPosition = {
  token: { category: SEND_TICKET, commitment: '', capability: 'minting', outpoint: ticket.outpoint, satoshis: ticket.satoshis, place: 'address' },
  template: { identifier: 'b6'.repeat(32), name: 'Example cloakroom (test network)' },
  tokenName: 'Ticket',
  status: 'held',
  record: { kind: 'position', token: { category: SEND_TICKET, commitment: '', capability: 'minting' }, templateIdentifier: 'b6'.repeat(32), values: {}, applicationPage: 'https://cloakroom.example.org/coats/' },
  standing: 'own',
  page: 'https://cloakroom.example.org/coats/',
};
const spentPosition: RecordedPosition = {
  token: { category: SPENT_KEY, commitment: '01', capability: 'none', outpoint: spentKey.outpoint, satoshis: spentKey.satoshis, place: 'address' },
  template: { identifier: 'b4'.repeat(32), name: 'Example money box (test network)' },
  tokenName: 'Box key',
  status: 'closed',
  record: { kind: 'position', token: { category: SPENT_KEY, commitment: '01', capability: 'none' }, templateIdentifier: 'b4'.repeat(32), lockingScriptIdentifier: 'boxLockingScript', roleIdentifier: 'holder', variables: { boxKey: SPENT_KEY }, values: {} },
  standing: 'own',
  lockingBytecode: 'aa20'.padEnd(70, '9'),
  satoshis: 0n,
  coins: 0,
};

/** Where the fixtures send to: a script, written in either form. */
const destination = p2sh32(new Uint8Array(32).fill(0x2c));
const written = (tokens: boolean): string => (lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: destination, tokenSupport: tokens }) as { address: string }).address;

/** What the wallet would work out: one token coin and one ordinary coin in, the tokens, any token change and the change out. */
const quoteOf = (request: TokenSendRequest): TokenSendQuote => {
  const token = request.kind === 'fungible' ? held.find((entry) => entry.category === request.category && entry.capability === undefined) : held.find((entry) => entry.outpoint === request.outpoint);
  if (token === undefined) throw new Error('No such token.');
  const amount = request.kind === 'fungible' ? request.amount : token.amount;
  const category = hexToBin(token.category);
  const sent: Output = { lockingBytecode: request.to, valueSatoshis: 0n, token: { category, amount, ...(token.capability === undefined ? {} : { nft: { capability: token.capability, commitment: hexToBin(token.commitment) } }) } };
  const left = token.amount - amount;
  const change: Output[] = left > 0n && token.capability === undefined ? [{ lockingBytecode: destination, valueSatoshis: 0n, token: { category, amount: left } }] : [];
  const outputs = [sent, ...change].map((output) => ({ ...output, valueSatoshis: smallestOutputValue(output) }));
  const bytes = transactionBytes([INPUT_BYTES.byKey, INPUT_BYTES.byKey], [...outputs, { lockingBytecode: destination, valueSatoshis: 0n }]);
  const fee = BigInt(bytes);
  const [sends, back] = outputs as [Output, Output | undefined];
  return {
    sends: { category: token.category, amount, ...(token.capability === undefined ? {} : { nft: { capability: token.capability, commitment: token.commitment } }), satoshis: sends.valueSatoshis },
    ...(back === undefined ? {} : { tokenChange: { category: token.category, amount: left, satoshis: back.valueSatoshis } }),
    changeSatoshis: 48_211n,
    feeSatoshis: fee,
    remainderSatoshis: 0n,
    bytes,
    tokenCoins: 1,
    payingCoins: 1,
    leavesSatoshis: sends.valueSatoshis + fee,
  };
};

const again = new URLSearchParams(window.location.search).has('again');
/** A payment of Bitcoin Cash from two coins, with change: the fee as the wallet would work it out. */
const paymentBytes = transactionBytes([INPUT_BYTES.byKey, INPUT_BYTES.byKey], [{ lockingBytecode: destination, valueSatoshis: 0n }, { lockingBytecode: destination, valueSatoshis: 0n }]);

/** What the fixtures' wallet can spend: `&little` for less than sending it would cost. */
const spendable = new URLSearchParams(window.location.search).has('little') ? 500n : 52_340n;
/** Sending everything from the two coins to one destination, with the fee that destination's length gives. */
const everythingOf = (to: Uint8Array) => {
  const bytes = transactionBytes([INPUT_BYTES.byKey, INPUT_BYTES.byKey], [{ lockingBytecode: to, valueSatoshis: 0n }]);
  const fee = BigInt(bytes);
  const smallest = smallestOutputValue({ lockingBytecode: to, valueSatoshis: 0n });
  if (spendable - fee < smallest) throw new InsufficientFundsError(spendable, fee, fee + smallest, 'too little to send everything.');
  return { sentSatoshis: spendable - fee, feeSatoshis: fee, bytes, transactions: 1, leftOut: 0 };
};

/** A wallet that holds the tokens above, quotes as the wallet would, and sends nothing. */
const tokenOwner = {
  session: { network: 'testnet', environment: { explorer: '' } },
  balance: { recoverable: spendable, vault: 0n, notRecoverable: 0n, voided: 0n, toSweep: 0n, tokens: held.map(() => ({})) },
  apps: { version: 0, applications: { tokens: async () => held, recordedPositions: async () => [keyPosition, ticketPosition, spentPosition], suggestions: [] } },
  wallet: {
    quoteTokens: async (request: TokenSendRequest) => quoteOf(request),
    sendTokens: async (request: TokenSendRequest) => ({ transactionId: '3f'.repeat(32), bytes: quoteOf(request).bytes, feeSatoshis: quoteOf(request).feeSatoshis, remainderSatoshis: 0n, quote: quoteOf(request) }),
    quotePay: async () => ({ feeSatoshis: BigInt(paymentBytes), remainderSatoshis: 0n, bytes: paymentBytes, change: true }),
    quoteSendEverything: async (to: Uint8Array) => everythingOf(to),
    sendEverything: async (to: Uint8Array) => {
      const quote = everythingOf(to);
      return { transactions: [{ transactionId: '5d'.repeat(32), bytes: quote.bytes, feeSatoshis: quote.feeSatoshis, remainderSatoshis: 0n }], sentSatoshis: quote.sentSatoshis, feeSatoshis: quote.feeSatoshis, leftOut: [] };
    },
    pay: async () => ({ transactionId: '4e'.repeat(32), feeSatoshis: BigInt(paymentBytes), bytes: paymentBytes, remainderSatoshis: 0n }),
    receiveAddress: async () => ({ address: { number: 7 }, again }),
    vaultAddress: async () => ({ address: { number: 2 }, again }),
    address: (kind: number) => {
      const bytecode = p2sh32(new Uint8Array(32).fill(kind === 2 ? 0x5b : 0x3a));
      const text = (tokens: boolean) => (lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode, tokenSupport: tokens }) as { address: string }).address;
      return { number: 7, lockingBytecode: bytecode, address: text(false), tokenAddress: text(true) };
    },
  },
  navigate: () => undefined,
  sent: () => undefined,
  toast: () => undefined,
} as unknown as Owner;

/** The two forms of the fixtures' destination, to paste. */
const Destinations = () => (
  <Card flat>
    <div class="stack-s small">
      <span class="muted">Addresses to try</span>
      <span>
        Token address: <span class="mono" data-testid="fixture-token-address">{written(true)}</span>
      </span>
      <span>
        Plain address: <span class="mono" data-testid="fixture-plain-address">{written(false)}</span>
      </span>
      <span class="muted">{binToHex(destination).slice(0, 12)}…, the same script in both forms.</span>
    </div>
  </Card>
);

/** The same wallet with no tokens: the Send screen goes straight to Bitcoin Cash. */
const coinOwner = { ...tokenOwner, balance: { ...tokenOwner.balance, tokens: [] } } as unknown as Owner;

// ------------------------------------------------------------------ the Applications screen, Recovery, the backup

const params = new URLSearchParams(window.location.search);
const pairing = 'f3'.repeat(16);

// ------------------------------------------------------------------ requests, and positions from records

/*
 * The Applications screen fed from fixed data through the real screen: `show=apps&request=` with `tick` (a token made
 * from the wallet's coin goes to the application, with the tick), `backup` (no backup store answers), `tied` (an
 * action that would tie money to the phone alone) or `unclear` (one of which the wallet cannot tell);
 * `show=apps&records` for the list of positions from records.
 */

const MONEY_KEY = '7d2e9a41c3b05f68e1d7a2c4b9f03e5d6a8c1b2e4f7a9d0c3b5e8f1a2d4c6b9e';
const TICKET = '3c8e1f5a7b9d2c4e6f8a0b1c3d5e7f9a2b4c6d8e0f1a3b5c7d9e2f4a6b8c0d1e';
const CARD = '9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e3f5a7b9c1d2e4f6a8b';
const PAGE = 'https://shared-box.example.org/';
const CLOAKROOM_PAGE = 'https://cloakroom.example.org/coats/';

/** What a template says about itself, with what the wallet found about each of its actions. */
const bare = (identifier: string, name: string, description: string, actions: [string, string, string, Finding?][], trusted: boolean): TemplateSummary => ({
  identifier,
  contentHash: identifier.split('').reverse().join(''),
  name,
  description,
  actions: actions.map(([action, actionName, actionDescription]) => ({ action, name: actionName, description: actionDescription })),
  trusted,
  findings: actions.map(([action, actionName, , finding]) => ({ action, role: 'holder', name: actionName, finding: finding ?? 'comes back', outputs: [] })),
});

const lending = bare(
  'b1'.repeat(32),
  'Example lending, step by step (test network)',
  'Borrow a dollar token against BCH. A key is made from your coin first and waits in the lending contract until the position is opened.',
  [
    ['prepare', 'Start borrowing', 'Make the key of a new position. It waits in the lending contract until the position is opened.'],
    ['borrow', 'Borrow', 'Open the position with the key.'],
  ],
  true,
);
const moneyBox = bare(
  'b2'.repeat(32),
  'Example money box (test network)',
  'Money kept until a date. Whoever holds the box\'s key can empty it from that date on.',
  [
    ['open', 'Open a money box', 'Make a new box with its key, and pay the first money in.'],
    ['deposit', 'Put money in', 'Add money to a box.'],
    ['withdraw', 'Take everything out', 'Empty the box. The key stays with you.'],
  ],
  true,
);
const keyedPool = bare(
  'b3'.repeat(32),
  'Example pool (test network)',
  'Provide coins to a trading pool, or trade with one.',
  [
    ['open', 'Open a pool', 'Put coins in a pool that this device\'s key unlocks.', 'does not come back'],
    ['trade', 'Trade', 'Trade with a pool. Nothing is left behind.'],
  ],
  false,
);
const ruleBox = bare(
  'b4'.repeat(32),
  'Example box with a rule (test network)',
  'Coins kept in a box, which a wallet follows only while it holds enough.',
  [
    ['open', 'Open a box', 'Make a box and its key, and put coins in.', 'cannot tell'],
    ['take', 'Take everything out', 'Empty the box. The key stays with you.'],
  ],
  false,
);

/** Starting to borrow: a key is made from the wallet's coin and goes to the lending contract. */
const startBorrowing: ActionPreview = {
  template: lending,
  finding: { action: 'prepare', role: 'holder', name: 'Start borrowing', finding: 'comes back', outputs: [] },
  words: { action: { name: 'Start borrowing', description: 'Make the key of a new position. It waits in the lending contract until the position is opened.' }, outcome: '', values: [] },
  figures: {
    givesSatoshis: 50_000n,
    getsSatoshis: 46_620n,
    feeSatoshis: 380n,
    remainderSatoshis: 0n,
    bytes: 380,
    intoApplicationSatoshis: 3_000n,
    fromApplication: { satoshis: 1_000n, coins: 1 },
    applicationInputs: [{ name: 'The lending contract', outpoint: `${'3467af925ecfe80e459e20b5266ab1b64c996da69fa870ffb23f2b7f5d879f45'}:0`, satoshis: 1_000n, token: { category: UNITS, amount: 9_870_000n, nft: { capability: 'minting', commitment: 'f6270000' } } }],
    toOthers: [
      { name: 'The lending contract', lockingBytecode: 'aa20'.padEnd(70, '1'), satoshis: 1_000n, token: { category: UNITS, amount: 9_870_000n, nft: { capability: 'minting', commitment: 'f6270000' } } },
      { name: 'Key, waiting', lockingBytecode: 'aa20'.padEnd(70, '6'), satoshis: 3_000n, token: { category: MONEY_KEY, amount: 0n, nft: { capability: 'minting', commitment: '' } } },
    ],
    toWallet: [{ kind: 'left over', satoshis: 46_620n }],
    tokensSpent: [],
    tokensNet: [],
    tokensDestroyed: [],
  },
  firstUse: false,
  tokensLeaving: [{ token: { category: MONEY_KEY, commitment: '', capability: 'minting' }, how: 'leaves', made: true, to: 'Key, waiting' }],
};

const { payingItself: _paying, ...withoutPayingItself } = boxOpening.figures;
/** Opening a money box: it leaves a position, so its record is stored before anything is signed. */
const openMoneyBox: ActionPreview = {
  ...boxOpening,
  template: moneyBox,
  finding: { action: 'open', role: 'holder', name: 'Open a money box', finding: 'comes back', outputs: [{ output: 'boxOutput', name: 'Money box', lockingScript: 'boxLockingScript', scriptName: 'Money box', keys: [] }] },
  figures: { ...withoutPayingItself, toWallet: [{ kind: 'receive', satoshis: 1_000n, token: { category: MONEY_KEY, amount: 0n, nft: { capability: 'none', commitment: '01' } } }, { kind: 'left over', satoshis: 8_550n }] },
  words: { ...boxOpening.words, values: boxOpening.words.values.map((value) => (value.value === BOX_KEY ? { ...value, value: MONEY_KEY } : value)) },
  firstUse: false,
  recordsPosition: true,
};

/** Paying into a money box, from the wallet's own list. */
const payIntoBox: ActionPreview = {
  template: moneyBox,
  finding: { action: 'deposit', role: 'holder', name: 'Put money in', finding: 'comes back', outputs: [{ output: 'boxOutput', name: 'Money box', lockingScript: 'boxLockingScript', scriptName: 'Money box', keys: [] }] },
  words: { action: { name: 'Put money in', description: 'Add money to a box.' }, outcome: '20000 satoshis were put into a money box.', values: [{ name: 'Amount', description: 'Satoshis to put in.', value: '20000' }] },
  figures: {
    givesSatoshis: 52_340n,
    getsSatoshis: 32_100n,
    feeSatoshis: 240n,
    remainderSatoshis: 0n,
    bytes: 240,
    intoApplicationSatoshis: 20_000n,
    fromApplication: { satoshis: 0n, coins: 0 },
    applicationInputs: [],
    toOthers: [{ name: 'Money box', lockingBytecode: boxAt, satoshis: 20_000n }],
    toWallet: [{ kind: 'left over', satoshis: 32_100n }],
    tokensSpent: [],
    tokensNet: [],
    tokensDestroyed: [],
  },
  firstUse: false,
};

/** Emptying a money box, from the wallet's own list: the key is spent and comes back. */
const { notBefore: _date, ...anyTime } = boxEmptying.figures;
const emptyBox: ActionPreview = { ...boxEmptying, template: moneyBox, finding: { action: 'withdraw', role: 'holder', name: 'Take everything out', finding: 'comes back', outputs: [] }, figures: anyTime };

/** Requests, as the application sends them. */
const requested = (id: string, summary: TemplateSummary, action: string): LedgerEntry => ({
  id,
  application: pairing,
  templateKnown: summary.trusted,
  receivedAt: 1_795_000_300,
  status: 'asked',
  template: { identifier: summary.identifier, contentHash: summary.contentHash },
  ...(summary.trusted ? {} : { definition: { template: '' } }),
  templateAction: action,
  role: 'holder',
  variables: {},
});

const findingOf = (summary: TemplateSummary, action: string): ActionFinding => {
  const found = summary.findings?.find((candidate) => candidate.action === action) as ActionFinding;
  return { ...found, outputs: [{ output: 'poolOutput', name: found.finding === 'cannot tell' ? 'Box' : 'Pool', lockingScript: 'poolLockingScript', scriptName: found.finding === 'cannot tell' ? 'Box' : 'Pool', keys: found.finding === 'cannot tell' ? [] : ['poolKey'], ...(found.finding === 'cannot tell' ? { expression: true as const } : {}) }] };
};

const REQUESTS: Record<string, { entry: LedgerEntry; summary: TemplateSummary; preview: () => Promise<ActionPreview> }> = {
  tick: { entry: requested('tick', lending, 'prepare'), summary: lending, preview: async () => startBorrowing },
  backup: { entry: requested('backup', moneyBox, 'open'), summary: moneyBox, preview: async () => openMoneyBox },
  tied: { entry: requested('tied', keyedPool, 'open'), summary: keyedPool, preview: async () => Promise.reject(new FindingRefusalError(findingOf(keyedPool, 'open'))) },
  unclear: { entry: requested('unclear', ruleBox, 'open'), summary: ruleBox, preview: async () => Promise.reject(new FindingRefusalError(findingOf(ruleBox, 'open'))) },
  spent: { entry: requested('spent', template, 'close'), summary: template, preview: async () => closing },
};
/** `request=spent`: approved, and refused by the network because another transaction spent one of its coins first. */
const SPENT_FIRST_ERROR =
  'Transaction broadcast failed for transaction hash "98f2adfaf4599445e6bf06b7ad6bfafe571b1d73535141825e39356800357e1f" of invitation "7b853d9fccb242d7155e47ebc7d16d5e": Error: Failed to broadcast transaction: Error: Failed to request \'blockchain.transaction.broadcast\': the transaction was rejected by network rules.\n\ntxn-mempool-conflict (code 18)';
const approveFixture = (entry: LedgerEntry) => async (): Promise<void> => {
  if (entry.id !== 'spent') return;
  Object.assign(entry, { status: 'failed', error: SPENT_FIRST_ERROR, code: 'inputs-spent' });
};

// The positions a record ties to tokens of the wallet's: confirmed, held under a template's name (its page named by
// the record), and not confirmed.
const nft = (category: string, commitment: string, at: number) => ({ category, commitment, capability: 'none' as const, outpoint: `${'5e'.repeat(32)}:${at}`, satoshis: 1_000n, place: 'address' as const });
const recordOf = (templateIdentifier: string, category: string, commitment: string, script?: string): RecordedPosition['record'] => ({
  kind: 'position',
  token: { category, commitment, capability: 'none' },
  templateIdentifier,
  ...(script === undefined ? {} : { lockingScriptIdentifier: script, roleIdentifier: 'holder', variables: { boxKey: category } }),
  values: {},
});
const clubIdentifier = 'b5'.repeat(32);
const cloakIdentifier = 'b6'.repeat(32);
const recordedHeld: RecordedPosition[] = [
  { token: nft(MONEY_KEY, '01', 1), template: { identifier: moneyBox.identifier, name: moneyBox.name }, tokenName: 'Box key', status: 'open', record: recordOf(moneyBox.identifier, MONEY_KEY, '01', 'boxLockingScript'), standing: 'own', lockingBytecode: boxAt, satoshis: 50_000n, coins: 1, actions: ['withdraw', 'deposit'] },
  { token: nft(CARD, '01', 2), template: { identifier: clubIdentifier, name: 'Example club (test network)' }, tokenName: 'Member card', status: 'open', record: { ...recordOf(clubIdentifier, CARD, '01', 'lockerLockingScript'), applicationPage: PAGE }, standing: 'own', lockingBytecode: 'aa20'.padEnd(70, 'c'), satoshis: 20_000n, coins: 1, actions: ['use'] },
  { token: nft(TICKET, '01', 3), template: { identifier: cloakIdentifier, name: 'Example cloakroom (test network)' }, tokenName: 'Ticket', status: 'held', record: { ...recordOf(cloakIdentifier, TICKET, '01'), applicationPage: CLOAKROOM_PAGE }, standing: 'own', page: CLOAKROOM_PAGE },
  { token: nft(BOX_KEY, '02', 4), template: { identifier: moneyBox.identifier, name: moneyBox.name }, tokenName: 'Box key', status: 'unconfirmed', reason: 'No transaction on chain carried this token and paid the record\'s script.', record: recordOf(moneyBox.identifier, BOX_KEY, '02', 'boxLockingScript'), standing: 'suggested', lockingBytecode: 'aa20'.padEnd(70, 'd'), satoshis: 75_000n, coins: 1, actions: ['withdraw', 'deposit'] },
];
const take: TokenAction = { action: 'withdraw', role: 'holder', name: 'Take everything out', description: 'Empty the box. The key stays with you.' };
const putIn: TokenAction = { action: 'deposit', role: 'holder', name: 'Put money in', description: 'Add money to a box.', asks: [{ variable: 'amount', name: 'Amount', description: 'Satoshis to put in.', type: 'satoshis' }] };
/** As the wallet offers them: taking out not once the box is closed, paying in not while it is not confirmed. */
const offeredFor = (position: Pick<RecordedPosition, 'template' | 'status'>): TokenAction[] =>
  position.template.identifier === clubIdentifier
    ? [{ action: 'use', role: 'holder', name: 'Use the locker', description: 'Spend credits; the deposit comes back.', needsApplication: 'It spends a coin of the application\'s, "The club\'s door", which only the application can name.', page: PAGE }]
    : position.template.identifier === moneyBox.identifier
      ? position.status === 'unconfirmed'
        ? [take]
        : position.status === 'closed'
          ? [putIn]
          : [take, putIn]
      : [];
/** A wallet's tokens with records: the positions above, and one token with no record. */
const heldWithRecords: HeldToken[] = [...recordedHeld.map((position) => ({ ...position.token, amount: 0n, meaning: 'unknown' as const })), unknown];

/** A position that holds nothing now, for the list of tokens. */
const closedBox: RecordedPosition = { ...(recordedHeld[0] as RecordedPosition), token: nft(MONEY_KEY, '03', 5), status: 'closed', satoshis: 0n, coins: 0, record: recordOf(moneyBox.identifier, MONEY_KEY, '03', 'boxLockingScript') };
/** A template an earlier owner stored in the backup, not trusted on this phone. */
const lendingSuggestion = { identifier: template.identifier, contentHash: template.contentHash, name: template.name, texts: { template: '' } };
/** Tokens that a record ties to a template not trusted here: one the backup holds, which can be trusted, and one it does not. */
const { tokenName: _keyName, ...unnamedKey } = open;
const incomplete: HeldToken[] = [
  { ...unnamedKey, outpoint: `${'6a'.repeat(32)}:0`, meaning: 'incomplete', reason: `A record of this wallet says the template "${template.name}" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet.` },
  { category: CARD, commitment: '02', capability: 'none', amount: 0n, place: 'address', outpoint: `${'6a'.repeat(32)}:1`, satoshis: 1_000n, meaning: 'incomplete', reason: 'A record of this wallet says which template made this token, and that template is not on this device. The token is safe; what it controls cannot be shown or operated until the template is had again.' },
];

const withRecords = params.has('records');
const asked = REQUESTS[params.get('request') ?? ''];
const appsHeld = withRecords ? heldWithRecords : params.has('held') ? [dollars, unknown, ...incomplete] : [];
const summaries = [lending, moneyBox, keyedPool, ruleBox];
/** The previews of actions started from the wallet's own list, by action. */
const fromList: Record<string, ActionPreview> = { withdraw: emptyBox, deposit: payIntoBox };
/** The Applications screen's part of a wallet: no request, a connection with `&connected`, tokens with `&held`. */
const appsOwner = {
  ...tokenOwner,
  balance: { ...tokenOwner.balance, tokens: appsHeld.map(() => ({})) },
  apps: {
    version: 0,
    connector: { ledger: asked === undefined ? [] : [asked.entry] },
    proposals: asked === undefined ? [] : [{ entry: asked.entry, approve: approveFixture(asked.entry), decline: async () => undefined }],
    asks: [],
    connections: params.has('connected') || asked !== undefined || params.get('offer') === 'pool' ? [{ uri: 'wiz://relay.example.org/?p=example', privateKey: '', pairing, name: 'Example app', addedAt: 1_795_000_000 }] : [],
    statuses: params.has('connected') || asked !== undefined || params.get('offer') === 'pool' ? { [pairing]: { state: 'connected', peerName: 'Example app' } } : {},
    // Templates with `&templates`: one trusted, one the user stopped trusting; an app's offer of one with `&offer`.
    offers: params.get('offer') === 'pool'
      ? [{ application: pairing, template: { identifier: keyedPool.identifier, contentHash: keyedPool.contentHash }, definition: { template: '' }, receivedAt: 1_795_000_600, accept: async () => undefined, decline: async () => undefined }]
      : params.has('offer')
      ? [{ application: pairing, template: { identifier: template.identifier, contentHash: template.contentHash }, definition: { template: '' }, receivedAt: 1_795_000_600, accept: async () => undefined, decline: async () => undefined }]
      : [],
    stopTrusting: async () => ({ name: box.name, backupTold: true }),
    applications: {
      readBackup: async () => undefined,
      tokens: async () => appsHeld,
      templates: params.has('templates')
        ? [{ identifier: box.identifier, contentHash: box.contentHash, name: box.name, trustedAt: 1_794_000_000, applications: [pairing], stored: true }]
        : withRecords
          ? [{ identifier: moneyBox.identifier, contentHash: moneyBox.contentHash, name: moneyBox.name, trustedAt: 1_794_000_000, applications: [pairing], stored: true }]
          : [],
      suggestions: params.has('templates') ? [{ ...lendingSuggestion, withdrawn: { renewal: 0, stored: true } }] : params.has('held') ? [lendingSuggestion] : [],
      describe: (names: { identifier: string }, presented?: unknown) => summaries.find((summary) => summary.identifier === names.identifier) ?? (names.identifier === box.identifier ? box : { ...template, trusted: presented === undefined }),
      disallow: () => undefined,
      describeAction: () => undefined,
      recordedPositions: async () => (withRecords ? recordedHeld : []),
      offeredActions: offeredFor,
      actionOn: (_target: unknown, action: string): ApplicationAction => ({ template: { identifier: moneyBox.identifier, contentHash: moneyBox.contentHash }, action, role: 'holder', variables: {} }),
      preview: async (request: ApplicationAction) => (asked !== undefined ? asked.preview() : (fromList[request.action] ?? emptyBox)),
      backupAnswers: async () => params.get('request') !== 'backup',
      watch: () => () => undefined,
    },
    changed: () => undefined,
    connect: () => undefined,
    retry: () => undefined,
    end: () => undefined,
    answerAsk: () => undefined,
  },
} as unknown as Owner;
if (params.get('show') === 'apps') keep('incoming', params.has('linked') ? { kind: 'connect', text: 'wiz://relay.example.org/?p=example-from-a-link' } : undefined);
// A backup arrangement, so that an action that is stored first can be offered: whether a store answers is the fixture's.
if (params.get('show') === 'apps') keep('arrangement', asked !== undefined || withRecords ? ({ archive: { stores: ['https://store.example.org/'], archiveId: '4e'.repeat(16), contentKey: 'a1'.repeat(32) }, earlierArchives: [], earlierViewingKeyRecords: [] } as unknown as RecoveryArrangement) : undefined);

/** A wallet whose watch has found it quiet and protected, with a waiting period of a day. */
const recoveryOwner = {
  ...tokenOwner,
  wallet: { ...tokenOwner.wallet, recovery: 'on', stored: { earlierSeeds: [{}] } },
  recovery: { on: true, reasons: [] },
  watch: { status: { kind: 'quiet' }, history: { current: { state: { challengeDelay: { unit: 'time512', value: 169 } } } }, protection: { full: true, canRefuse: true, gaps: [], notWatched: [] }, check: async () => undefined },
  change: {},
} as unknown as Owner;

/** A complete backup as the wallet writes it, with sample words and a wallet that had one earlier phone. */
const sampleBackup: UserBackup = {
  network: 'testnet',
  addressScheme: 1,
  identity: 'b7'.repeat(32),
  words: 'sample words only shown on the fixtures page and never a real wallet of anyone at all',
  creationTransactionId: '9c'.repeat(32),
  earlierViewingKeyRecords: [{ json: JSON.stringify({ kind: 'viewing key', network: 'testnet', walletIdentity: 'b7'.repeat(32), seed: 1, viewingKey: `xpub${'6Cvz3Hq'.repeat(15)}`, firstAddress: 0 }), signature: '30'.repeat(72) }] as unknown as NonNullable<UserBackup['earlierViewingKeyRecords']>,
  archives: [
    { stores: ['https://store-one.example.org/', 'https://store-two.example.org/'], archiveId: '4e'.repeat(16), contentKey: 'a1'.repeat(32) },
    { stores: ['https://store-one.example.org/', 'https://store-two.example.org/'], archiveId: '7d'.repeat(16), contentKey: 'c2'.repeat(32) },
  ] as unknown as NonNullable<UserBackup['archives']>,
};
const makeSample = async (complete: boolean): Promise<string> => {
  const { creationTransactionId: _transaction, earlierViewingKeyRecords: _records, archives: _archives, ...least } = sampleBackup;
  return userBackupText(complete ? sampleBackup : least);
};

const show = params.get('show') ?? 'tokens';
const REVIEWS: Record<string, ActionPreview> = { review: borrowing, closing, 'box-open': boxOpening, 'box-empty': boxEmptying };
const chosenNft = new URLSearchParams(window.location.search).get('nft');
if (show === 'send-token') chooseToken(chosenNft === null ? `fungible:${DOLLARS}` : `nft:${chosenNft === 'ticket' ? ticket.outpoint : chosenNft === 'spent' ? spentKey.outpoint : open.outpoint}`);
const ignore = () => undefined;
/** The list of tokens on its own: what the wallet offers at each position, and the template the backup holds. */
const listOwner = { apps: { applications: { suggestions: [lendingSuggestion], offeredActions: offeredFor } }, navigate: ignore } as unknown as Owner;
const everyKind = tokenList([...recordedHeld.slice(0, 1), closedBox, ...recordedHeld.slice(1)], [...recordedHeld.map((position) => ({ ...position.token, amount: 0n, meaning: 'unknown' as const })), unknown, dollars, ...incomplete]);

/** The wallet's own screens are shown in the frame the wallet gives them: with its navigation, and as wide. */
const screen = show === 'send-token' || show === 'send' ? 'send' : show === 'receive' ? 'receive' : REVIEWS[show] !== undefined || show === 'apps' ? 'apps' : show === 'recovery' || show === 'backup' ? 'recovery' : undefined;
const navigation =
  screen === undefined
    ? {}
    : {
        nav: [
          { route: 'home', label: 'Home', icon: 'home' as const },
          { route: 'receive', label: 'Receive', icon: 'receive' as const },
          { route: 'send', label: 'Send', icon: 'send' as const },
          { route: 'apps', label: 'Apps', icon: 'apps' as const },
          { route: 'recovery', label: 'Recovery', icon: 'shield' as const },
        ],
        current: screen,
        onNavigate: ignore,
      };

render(
  <Frame brand="Grandma's Wallet" role="Fixtures" environment={FIXTURE_ENVIRONMENT} {...navigation}>
    <div class="stack">
      {show === 'send-token' ? (
        <>
          <Send owner={tokenOwner} />
          <div class="focus-page send-page"><Destinations /></div>
        </>
      ) : show === 'send' ? (
        <>
          <Send owner={coinOwner} />
          <div class="focus-page send-page"><Destinations /></div>
        </>
      ) : show === 'receive' ? (
        <Receive owner={tokenOwner} />
      ) : show === 'apps' ? (
        <Apps owner={appsOwner} />
      ) : show === 'recovery' ? (
        <Recovery owner={recoveryOwner} />
      ) : show === 'backup' ? (
        <Backup owner={recoveryOwner} onBack={ignore} make={makeSample} />
      ) : show === 'scan' ? (
        <ScanFields />
      ) : show === 'welcome' ? (
        <Welcome session={{ environment: { network: 'chipnet' } } as unknown as Session} onChoose={ignore} />
      ) : show === 'setup-bank' || show === 'setup-friend' ? (
        <SetUpFixture kind={show === 'setup-bank' ? 'bank' : 'friend'} />
      ) : show === 'ready' ? (
        <Ready name="Example Bank" startingSatoshis={20_000n} onOpen={ignore} />
      ) : show === 'tokens' ? (
        <div class="grid two apps-layout">
          <Card title="Tokens" cls="tokens-card">
            <TokenListView owner={listOwner} list={everyKind} onView={ignore} />
          </Card>
        </div>
      ) : (
        <div class="stack">
          <PageHead title="Applications" />
          <div class="grid two">
            <div class="stack">
              <RequestFixture preview={REVIEWS[show] ?? borrowing} />
            </div>
            <div class="stack">
              <Card title="Tokens" cls="tokens-card">
                <TokenListView owner={listOwner} list={tokenList(recordedHeld.slice(0, 1), [unknown])} onView={ignore} />
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  </Frame>,
  document.getElementById('app') as HTMLElement,
);
