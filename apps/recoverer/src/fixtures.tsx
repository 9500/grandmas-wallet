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

/*
 * The recoverer's screens without a chain, for looking at them in a browser: the first run (`fixtures.html?show=start`),
 * a bank's code for a new customer (`show=bank`), a friend's code and the question that follows a phone's request
 * (`show=friend`), and the settings (`show=settings`). The code offers its session through the relays of
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
useFixedFunds({
  address: async () => p2pkhLockingBytecode(new Uint8Array(20).fill(0x5a)),
  balance: async () => 1_250_000n,
} as unknown as RecovererFunds);

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
            current: show === 'settings' ? 'settings' : 'new',
            onNavigate: () => undefined,
          })}
    >
      <Incoming key={arrivals} session={session} onChanged={() => undefined} toast={toast} onShowRequests={() => undefined} />
      {show === 'start' ? <Start onDone={() => toast('Chosen.')} /> : show === 'settings' ? <Settings onSaved={() => toast('Saved.')} /> : <NewWallet session={session} onDone={() => undefined} />}
      {toastElement}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
