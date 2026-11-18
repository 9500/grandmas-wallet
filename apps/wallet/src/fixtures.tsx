import '@grandmas-wallet/ui/styles.css';
import './apps.css';
import './set-up.css';

import { type Output, binToHex, encodeLockingBytecodeP2sh32 as p2sh32, generateBip39Mnemonic, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type ActionPreview, type HeldToken, type TemplateSummary, type TokenNaming, TokenNames, type TokenSendQuote, type TokenSendRequest, type UserBackup, userBackupText, walletTemplateNumbers } from '@grandmas-wallet/app';
import { type ChallengeDelay, INPUT_BYTES, InsufficientFundsError, deriveSeedKeys, smallestOutputValue, transactionBytes } from '@grandmas-wallet/core';
import { sealPackage, signEnrollmentRequest } from '@grandmas-wallet/enrollment';
import { Button, Card, Field, Frame, PageHead, Pill, TextArea, TextInput, formatTime } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { ActionReview } from './ActionReview.js';
import { Apps, TokenRow } from './Apps.js';
import { Receive } from './Receive.js';
import { Backup, Recovery } from './Recovery.js';
import { Send } from './Send.js';
import { chooseToken } from './token-choice.js';
import { askToSetUp, meetRecoverer } from './hand-to-recoverer.js';
import type { Owner } from './OwnerApp.js';
import { RECOVERER_LINK, paymentAddress } from './scan.js';
import { ScanDialog, WithScan } from './Scanner.js';
import { ScanCode } from './ScanCode.js';
import { type Session, type StoredRecipient, keep } from './session.js';
import { Ready, SettingUpView } from './SetUp.js';
import { TokenNamesContext } from './token-words.js';
import { Welcome } from './Welcome.js';

/*
 * Parts of the wallet's screens, fed from fixed data, for looking at them in a browser without a wallet: the
 * list of tokens (`fixtures.html?show=tokens`), the Applications screen (`show=apps`, `&connected` with a connection,
 * `&held` with tokens, `&linked` as opened from an application's connection link), a request for a decision on an
 * action (`show=review` to borrow, `closing` to repay and close, `box-open` and `box-empty` for the actions of a
 * second template), the fields that take a scanned code (`show=scan`, and `&open` to show the scanner already
 * opened), and a recoverer's code taken in, with something sealed handed to the recoverer's page over the session the
 * code offers (`show=recoverer`), the Send screen for Bitcoin Cash (`show=send`, `&little` for a wallet that holds
 * too little to send everything) and with tokens to choose from (`show=send-token`, `&nft` to open with the key
 * chosen), the Receive screen (`show=receive`, `&again` for an address shown again), the Recovery screen
 * (`show=recovery`) and the user's own backup (`show=backup`, with a sample complete backup). Served by the
 * development server; the build of the page does not include it. The templates here are invented examples, as a
 * template would describe itself, and what is handed to the recoverer is a sample that their page cannot open.
 */

const CATEGORY = '5c1d8c7d635141a15d9d41747ebe30422ca50237c41c54c45714d09114439382';
const UNITS = 'e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8';
const template: TemplateSummary = {
  identifier: 'aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be',
  contentHash: '99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61',
  declaration: '24bd88dd8112304e6b6a2beab24fe36d182a810b52bb60c8e8050b16b6a6ed96',
  name: 'Example lending (test network)',
  description: 'Borrow a dollar token against BCH held by a contract, manage the collateral and repay.',
  actions: [
    { action: 'borrow', name: 'Borrow', description: 'Open a position: the collateral goes into the contract, the borrowed tokens and the key come to the wallet.' },
    { action: 'manage', name: 'Change the collateral', description: 'Add collateral, or take some out.' },
    { action: 'close', name: 'Repay and close', description: 'Repay the whole debt; the collateral comes back.' },
  ],
  verdict: { statement: 'not verified', reasons: ['No token made with this template has yet led to its position on chain.'] },
  trusted: true,
};

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
  authority: 'key',
  position: {
    status: 'open',
    satoshis: 59_957_301n,
    coins: 1,
    lockingBytecode: 'aa20'.padEnd(70, '7'),
    state: [
      { variable: 'debt', name: 'Debt', description: 'Tokens borrowed, in cents.', type: 'token_amount', value: '10000' },
      { variable: 'collateral', name: 'Collateral', description: 'Satoshis the contract holds as collateral.', type: 'satoshis', value: '59957301' },
    ],
  },
  actions: [
    { action: 'manage', role: 'borrower', name: 'Change the collateral', description: 'Add collateral, or take some out.', asks: [{ variable: 'collateral', name: 'Collateral', description: 'Satoshis the contract holds as collateral.', type: 'satoshis' }] },
    {
      action: 'repay',
      role: 'borrower',
      name: 'Repay part',
      description: 'Repay part of the debt; the position stays open.',
      asks: [
        { variable: 'collateral', name: 'Collateral', description: '', type: 'satoshis' },
        { variable: 'repayAmount', name: 'Repayment', description: '', type: 'token_amount' },
      ],
      needsApplication: 'It needs values that the application works out: "Record".',
    },
    { action: 'close', role: 'borrower', name: 'Repay and close', description: 'Repay the whole debt; the collateral comes back.' },
  ],
};
const closed: HeldToken = { ...open, category: '2d3f21018a219ed7a0665be8db173d774fa74448b07ec1c12bf459a97f8acd10', outpoint: `${'95db0d661610df2b244bca03c663a486a4a6a61ac37e6e509fd9f65b502209b0'}:4`, position: { status: 'closed', satoshis: 0n, coins: 0, note: 'It holds nothing now.' }, actions: [] };
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
const box: TemplateSummary = {
  identifier: '6f0b3d1e9c2a4857b6d1e0f3a9c8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0',
  contentHash: 'd2e4f6a8b0c1d3e5f7a9b1c3d5e7f9a0b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0',
  declaration: '8c6e4a2f0d8b6a4c2e0f8d6b4a2c0e8f6d4b2a0c8e6f4d2b0a8c6e4f2d0b8a6c',
  name: 'Example money box (test network)',
  description: 'Money kept until a date. Anyone can pay into a box. From its date on, whoever holds the box\'s key can empty it.',
  actions: [
    { action: 'open', name: 'Open a money box', description: 'Make a new box with its key, and pay the first money in. It stays in the box until its date.' },
    { action: 'deposit', name: 'Pay into a money box', description: 'Add money to a box. It stays there until the box\'s date.' },
    { action: 'withdraw', name: 'Empty a money box', description: 'Take everything out of the box. Possible from the box\'s date on. The key stays with you, so the box can be used again.' },
  ],
  verdict: { statement: 'verified', basis: 'The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.' },
  trusted: false,
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

/** What the templates the user trusts call the tokens of the reviews: the lending template names its dollar and its key, the box template its key. */
const reviewNames = new TokenNames([
  { description: { kind: 'fungible', category: UNITS, name: 'Example dollar', symbol: 'EXD', decimals: 2 }, template: { identifier: template.identifier, name: template.name } },
  { description: { kind: 'nft', category: CATEGORY, name: 'Example key' }, template: { identifier: template.identifier, name: template.name } },
  { description: { kind: 'nft', category: BOX_KEY, name: 'Box key' }, template: { identifier: box.identifier, name: box.name } },
]);

/** A request for a decision, as the Applications screen shows it, with the buttons that do nothing here. */
const RequestFixture = ({ preview }: { preview: ActionPreview }) => (
  <Card title={`${preview.template.name.replace(/ \(test network\)$/, '')} asks for your decision`} cls="request-card">
    <div class="stack">
      <div class="asker">
        <Pill>Its own name, not verified</Pill>
        <span class="small muted">Asked {formatTime(1_795_000_000)}</span>
      </div>
      <TokenNamesContext.Provider value={reviewNames}>
        <ActionReview preview={preview} />
      </TokenNamesContext.Provider>
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
  if (recipient === undefined) return <ScanCode title={kind === 'bank' ? 'Scan your bank\'s code' : 'Scan the code on their screen'} onRead={setRecipient} onBack={() => undefined} />;
  if (created) return <Ready name={recipient.name} startingSatoshis={20_000n} onOpen={() => undefined} />;
  return <SettingUpView name={recipient.name || 'your helper'} kind={kind} stage={stage} challengeDelay={delay} problem={problem} onRetry={() => setProblem(undefined)} onAgain={() => setRecipient(undefined)} />;
};

// ------------------------------------------------------------------ sending and receiving tokens

const DOLLARS = 'a1d53bd8fa94e1c3a42e6d5c3e6d0b0a6b9f0e2c5d17c8f9e3b1a20475c6d8e9';
const fromTemplate = [{ identifier: template.identifier, name: template.name }];
const dollarNames: TokenNaming = { named: { name: 'Example dollar', symbol: 'EXD', decimals: 2, from: fromTemplate } };
const dollars: HeldToken = { category: DOLLARS, commitment: '', amount: 25_000n, place: 'address', outpoint: `${'7b'.repeat(32)}:1`, satoshis: 1_000n, meaning: 'unknown', names: { fungible: dollarNames } };
const namedKey: HeldToken = { ...open, names: { nft: { named: { name: 'Example key', from: fromTemplate } } } };
const held: HeldToken[] = [dollars, unknown, namedKey];

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
  apps: { version: 0, applications: { tokens: async () => held, suggestions: [] } },
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
const appsHeld = params.has('held') ? [open, dollars, unknown] : [];
const pairing = 'f3'.repeat(16);
/** The Applications screen's part of a wallet: no request, a connection with `&connected`, tokens with `&held`. */
const appsOwner = {
  ...tokenOwner,
  balance: { ...tokenOwner.balance, tokens: appsHeld.map(() => ({})) },
  apps: {
    version: 0,
    connector: { ledger: [] },
    proposals: [],
    asks: [],
    connections: params.has('connected') ? [{ uri: 'wiz://relay.example.org/?p=example', privateKey: '', pairing, name: 'Example app', addedAt: 1_795_000_000 }] : [],
    statuses: params.has('connected') ? { [pairing]: { state: 'connected', peerName: 'Example app' } } : {},
    applications: { readBackup: async () => undefined, names: () => reviewNames, tokens: async () => appsHeld, suggestions: [], describeAction: () => undefined },
    changed: () => undefined,
    connect: () => undefined,
    retry: () => undefined,
    end: () => undefined,
    answerAsk: () => undefined,
  },
} as unknown as Owner;
if (params.get('show') === 'apps') keep('incoming', params.has('linked') ? { kind: 'connect', text: 'wiz://relay.example.org/?p=example-from-a-link' } : undefined);

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
if (show === 'send-token') chooseToken(new URLSearchParams(window.location.search).has('nft') ? `nft:${namedKey.outpoint}` : `fungible:${DOLLARS}`);
const owner = { apps: { applications: { suggestions: [] } } } as unknown as Owner;
const ignore = () => undefined;

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
  <Frame brand="Grandma's Wallet" role="Fixtures" environment={{ network: 'chipnet', walletUrl: '', recovererUrl: '', stores: [], chain: [], relays: [], explorer: '', secondsPerBlock: 60 }} {...navigation}>
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
          <Card title="Tokens">
            <ul class="list tokens">
              {[open, closed, unknown, dollars].map((token) => (
                <TokenRow owner={owner} token={token} onView={ignore} />
              ))}
            </ul>
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
              <Card title="Tokens">
                <ul class="list tokens">
                  {[open, unknown].map((token) => (
                    <TokenRow owner={owner} token={token} onView={ignore} />
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  </Frame>,
  document.getElementById('app') as HTMLElement,
);
