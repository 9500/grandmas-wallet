import '@grandmas-wallet/ui/styles.css';
import './apps.css';

import { type Output, binToHex, encodeLockingBytecodeP2sh32 as p2sh32, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import type { ActionPreview, HeldToken, TemplateSummary, TokenNaming, TokenSendQuote, TokenSendRequest } from '@grandmas-wallet/app';
import { INPUT_BYTES, smallestOutputValue, transactionBytes } from '@grandmas-wallet/core';
import { Button, Card, Field, Frame, HandOff, TextArea, TextInput } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useState } from 'preact/hooks';

import { ActionReview } from './ActionReview.js';
import { TokenRow } from './Apps.js';
import { Receive } from './Receive.js';
import { Send } from './Send.js';
import { chooseToken } from './token-choice.js';
import { handToRecoverer } from './hand-to-recoverer.js';
import type { Owner } from './OwnerApp.js';
import { RecipientCheck, RecipientEntry } from './parts.js';
import { RECOVERER_LINK, paymentAddress } from './scan.js';
import { ScanDialog, WithScan } from './Scanner.js';
import { SealedHandOff } from './SealedHandOff.js';
import type { StoredRecipient } from './session.js';

/*
 * Parts of the wallet's screens, fed from fixed data, for looking at them in a browser without a wallet: the
 * Applications screen (`fixtures.html?show=tokens|review|closing`), the fields that take a scanned code
 * (`show=scan`, and `&open` to show the scanner already opened), and a recoverer's code taken in, with something
 * sealed handed to the recoverer's page over the session the code offers (`show=recoverer`), the Send screen with
 * tokens to choose from (`show=send-token`, `&nft` to open with the key chosen), and the Receive screen
 * (`show=receive`). Served by the
 * development server; the build of the page does not include it. The template here is an invented example, as
 * a template would describe itself, and what is handed to the recoverer is a sample that their page cannot open.
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
 * A recoverer's code taken in as on the first step of making a wallet, and something sealed handed to their page
 * as after the wallet is made. The sample is random bytes: the recoverer's page receives it and refuses it.
 */
const RecovererFixture = () => {
  const [recipient, setRecipient] = useState<StoredRecipient | undefined>();
  const [matched, setMatched] = useState(false);
  const [sample, setSample] = useState<string | undefined>();
  if (recipient === undefined) {
    return (
      <Card title="1. Your recoverer">
        <RecipientEntry onRead={setRecipient} purpose="It holds their name and the key your wallet seals their kit to." />
      </Card>
    );
  }
  const name = recipient.name || 'your recoverer';
  return (
    <div class="stack">
      <Card title="1. Your recoverer">
        <RecipientCheck recipient={recipient} matched={matched} onMatched={setMatched} onClear={() => setRecipient(undefined)} />
      </Card>
      <Card title={`Send the recovery kit to ${name}`} tone="warn">
        {sample === undefined ? (
          <Button
            disabled={!matched}
            onClick={() => {
              const sealed = crypto.getRandomValues(new Uint8Array(900));
              handToRecoverer(recipient, 'enroll', sealed);
              setSample(`${recipient.page}#enroll=sample`);
            }}
          >
            Send a sample to their page
          </Button>
        ) : (
          <SealedHandOff kind="enroll" name={name}>
            <HandOff text={sample} qrLabel="QR code of the recovery kit link" copyLabel="Copy link" testId="kit-link">
              <p>Send this link to {name}, by message or by letting them scan the code. Only they can open it.</p>
            </HandOff>
          </SealedHandOff>
        )}
      </Card>
    </div>
  );
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

/** A wallet that holds the tokens above, quotes as the wallet would, and sends nothing. */
const tokenOwner = {
  session: { network: 'testnet', environment: { explorer: '' } },
  balance: { recoverable: 52_340n, vault: 0n, notRecoverable: 0n, voided: 0n, toSweep: 0n, tokens: held.map(() => ({})) },
  apps: { version: 0, applications: { tokens: async () => held, suggestions: [] } },
  wallet: {
    quoteTokens: async (request: TokenSendRequest) => quoteOf(request),
    sendTokens: async (request: TokenSendRequest) => ({ transactionId: '3f'.repeat(32), bytes: quoteOf(request).bytes, feeSatoshis: quoteOf(request).feeSatoshis, remainderSatoshis: 0n, quote: quoteOf(request) }),
    receiveAddress: async () => ({ address: { number: 7 }, again: false }),
    vaultAddress: async () => ({ address: { number: 2 }, again: false }),
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

const show = new URLSearchParams(window.location.search).get('show') ?? 'tokens';
if (show === 'send-token') chooseToken(new URLSearchParams(window.location.search).has('nft') ? `nft:${namedKey.outpoint}` : `fungible:${DOLLARS}`);
const owner = { apps: { applications: { suggestions: [] } } } as unknown as Owner;
const ignore = () => undefined;

/** The wallet's own screens are shown in the frame the wallet gives them: with its navigation, and as wide. */
const screen = show === 'send-token' ? 'send' : show === 'receive' ? 'receive' : undefined;
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
          <Destinations />
        </>
      ) : show === 'receive' ? (
        <Receive owner={tokenOwner} />
      ) : show === 'scan' ? (
        <ScanFields />
      ) : show === 'recoverer' ? (
        <RecovererFixture />
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
        <div class="grid two">
          <Card title="Check and carry out" cls="request-card">
            <div class="stack">
              <ActionReview preview={show === 'closing' ? closing : borrowing} />
            </div>
          </Card>
        </div>
      )}
    </div>
  </Frame>,
  document.getElementById('app') as HTMLElement,
);
