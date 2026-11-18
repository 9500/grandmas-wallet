import '@grandmas-wallet/ui/styles.css';

import type { AppChain } from '@grandmas-wallet/app';
import { generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { Frame, keyNetwork, loadEnvironment, useToast } from '@grandmas-wallet/ui';
import { render } from 'preact';

import { Incoming } from './Incoming.js';
import { useArrivals } from './offered-session.js';
import type { Session } from './session.js';
import { YourLink } from './YourLink.js';

/*
 * The recoverer's "Your link" screen without a chain, for looking at it in a browser: its code, the session the
 * code offers through the relays of `config.json`, and a kit that arrives over it, shown as an opened link.
 * Served by the development server (`fixtures.html`), or by a build that includes it; the page's own build does
 * not. The encryption key is a new one at every load. Nothing here reads or checks the chain.
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

const Root = () => {
  const arrivals = useArrivals();
  const [toastElement, toast] = useToast();
  return (
    <Frame
      brand="Recoverer"
      role="Fixtures"
      environment={environment}
      nav={[
        { route: 'wallets', label: 'Wallets', icon: 'wallets' },
        { route: 'requests', label: 'Requests', icon: 'inbox' },
        { route: 'link', label: 'Your link', icon: 'key' },
      ]}
      current="link"
    >
      <Incoming key={arrivals} session={session} onChanged={() => undefined} toast={toast} onShowRequests={() => undefined} />
      <YourLink session={session} />
      {toastElement}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
