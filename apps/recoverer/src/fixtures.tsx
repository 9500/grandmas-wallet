import '@grandmas-wallet/ui/styles.css';
import './recoverer.css';

import type { AppChain, RecovererFunds } from '@grandmas-wallet/app';
import { p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { Frame, keyNetwork, loadEnvironment, useToast } from '@grandmas-wallet/ui';
import { render } from 'preact';

import { Incoming } from './Incoming.js';
import { NewWallet } from './NewWallet.js';
import { useArrivals } from './offered-session.js';
import { type Mode, type Session, keep, useFixedFunds, vault } from './session.js';
import { Settings } from './Settings.js';
import { Start } from './Start.js';
import { Wallets } from './Wallets.js';

/*
 * The recoverer's screens without a chain, for looking at them in a browser: the first run (`fixtures.html?show=start`),
 * a bank's code for a new customer (`show=bank`), a friend's code and the question that follows a phone's request
 * (`show=friend`), the settings (`show=settings`), and the list of wallets with the balance and its "Send all"
 * (`show=wallets`, `&earlier` with coins an earlier version kept with wallets, `&opening` with an account that
 * does not open). The code offers its session through the relays of
 * `config.json`, so that a phone can ask over it. Served by the development server (`fixtures.html`), or by a build
 * that includes it; the page's own build does not. The encryption key is a new one at every load, the balance is
 * a figure given here, and nothing reads or checks the chain: a wallet asked for here is not created.
 */

const environment = await loadEnvironment();
const key = await generateRecipientKeyPair();
const session: Session = {
  environment,
  network: keyNetwork(environment),
  chain: {} as AppChain,
  servers: [],
  storeAt: () => {
    throw new Error('The fixtures have no backup stores.');
  },
  publicKey: key.publicKey,
  privateKey: key.privateKey,
};

const show = new URLSearchParams(window.location.search).get('show') ?? 'bank';
// What these screens read from the browser, set afresh for each load.
for (const name of vault.names()) vault.remove(name);
if (show !== 'start') {
  const mode: Mode = show === 'friend' ? 'friend' : 'bank';
  keep('mode', mode);
  keep('name', mode === 'bank' ? 'Example Bank' : 'Anna');
  keep('settings', { startingSatoshis: '20000', challengeDelay: { unit: 'time512', value: 169 } });
}
let held = 1_250_000n;
// With `&opening`: an account that does not get past opening, as when the check of block headers is stuck.
const never = new URLSearchParams(window.location.search).has('opening');
useFixedFunds(never ? new Promise<RecovererFunds>(() => undefined) : ({
  address: async () => p2pkhLockingBytecode(new Uint8Array(20).fill(0x5a)),
  balance: async () => held,
  // There is no chain here: a set-up that begins stays at its beginning.
  create: () => new Promise(() => undefined),
  // Sending the whole balance: two coins to one output.
  quoteSendEverything: async () => ({ sentSatoshis: held - 326n, feeSatoshis: 326n, transactions: 1, leftOut: 0, heldBack: 0n }),
  sendEverything: async () => {
    const sent = { transactions: [{ transactionId: '7c4f1e0b9a2d48c6b1f35e8a0d6c9b247a1e5f3c8d0b6a4927e1c5f8b3d0a6e9', bytes: 326, feeSatoshis: 326n, remainderSatoshis: 0n }], sentSatoshis: held - 326n, feeSatoshis: 326n, leftOut: [] };
    held = 0n;
    return sent;
  },
  // With `&earlier`: coins an earlier version kept with two wallets.
  takeInQuote: () => (new URLSearchParams(window.location.search).has('earlier') && held === 1_250_000n ? { arrives: 9_474n, feeSatoshis: 326n } : undefined),
  takeIn: async () => {
    held += 9_474n;
    return { transactionId: '', bytes: 326, feeSatoshis: 326n, remainderSatoshis: 0n };
  },
} as unknown as RecovererFunds));

const Root = () => {
  const arrivals = useArrivals();
  const [toastElement, toast] = useToast();
  const bank = show !== 'friend';
  return (
    <Frame
      brand="Recoverer"
      role="Fixtures"
      environment={environment}
      {...(show === 'start'
        ? {}
        : {
            nav: [
              { route: 'wallets', label: bank ? 'Customers' : 'People', icon: 'wallets' as const },
              { route: 'new', label: bank ? 'New customer' : 'Set up', icon: 'key' as const },
              { route: 'settings', label: 'Settings', icon: 'details' as const },
            ],
            current: show === 'settings' ? 'settings' : show === 'wallets' ? 'wallets' : 'new',
            onNavigate: () => undefined,
          })}
    >
      <Incoming key={arrivals} session={session} onChanged={() => undefined} toast={toast} onShowRequests={() => undefined} />
      {show === 'start' ? <Start onDone={() => toast('Chosen.')} /> : show === 'settings' ? <Settings session={session} onSaved={() => toast('Saved.')} /> : show === 'wallets' ? <Wallets session={session} onNew={() => undefined} /> : <NewWallet session={session} onDone={() => undefined} />}
      {toastElement}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
