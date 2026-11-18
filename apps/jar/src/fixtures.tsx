import '@grandmas-wallet/ui/styles.css';
import './jar.css';

import { Frame } from '@grandmas-wallet/ui';
import { render } from 'preact';

import { type JarView, jarLockingBytecode } from './jar.js';
import { type ActionState, ConnectedCard, JarList, OnItsWay, OpenJarForm, type PageFacts } from './view.js';

/*
 * The connected states of the page, fed from fixed data, for looking at them in a browser without a wallet.
 * Served by the development server only (`fixtures.html?show=…`); the build of the page does not include it.
 */

const now = Math.floor(Date.now() / 1000);
const jar = (category: string, unlockTime: number, satoshis: bigint, status: JarView['status'] = satoshis > 0n ? 'open' : 'empty'): JarView => ({
  category,
  unlockTime,
  satoshis,
  lockingBytecode: jarLockingBytecode(category, unlockTime),
  status,
});
const A = '7c1f'.repeat(16);
const B = '2e9a'.repeat(16);
const C = 'b4d0'.repeat(16);
const D = '91aa'.repeat(16);

const show = new URLSearchParams(window.location.search).get('show') ?? 'list';
const kind = show === 'xo' || show === 'xo-empty' ? 'xo' : 'plain';
const facts: PageFacts = { network: 'chipnet', explorer: 'https://chipnet.imaginary.cash/tx/', now, clock: { height: 290_000, medianTime: now - 420 } };

const jars: JarView[] =
  show === 'xo-empty'
    ? []
    : show === 'states'
      ? [jar(A, now - 7_200, 35_000n), jar(C, now - 120, 12_500n), jar(D, now - 86_400, 0n), jar(B, now + 26 * 86_400, 120_000n)]
      : [jar(A, now - 7_200, 35_000n), jar(B, now + 26 * 86_400, 120_000n)];

const state: ActionState =
  show === 'xo'
    ? { running: { name: 'open', title: 'Opening a jar of 0.0002 BCH until 19 Dec 2026, 09:00.', progress: { text: 'Your wallet has the request. Check it there and approve it.', stage: 'accepted' } } }
    : show === 'states'
      ? { error: { name: `withdraw:${C}`, message: 'The transaction was refused: non-final. The network does not take this yet. It goes by the median time of the last eleven blocks, which runs some minutes behind the clock, and a jar opens once that time has passed its date. Try again in a few minutes.' } }
      : show === 'done'
        ? { done: { name: 'open', text: 'The jar is open. Its key is in your wallet.', transactionId: 'ab'.repeat(32) } }
        : {};

const ignore = () => undefined;

render(
  <Frame brand="Savings Jar" role="An application for Bitcoin Cash wallets" environment={{ network: 'chipnet', walletUrl: '', recovererUrl: '', stores: [], chain: [], relays: [], explorer: '', secondsPerBlock: 60 }}>
    <div class="stack">
      <ConnectedCard peerName={kind === 'xo' ? "Grandma's Wallet" : 'Cashonize'} kind={kind} balance={kind === 'plain' ? 184_250n : undefined} onDisconnect={ignore} />
      <div class="columns">
        <div class="stack">
          {state.running !== undefined && <OnItsWay title={state.running.title} progress={state.running.progress} />}
          <JarList jars={jars} trusted={show !== 'xo-empty'} facts={facts} state={state} onDeposit={ignore} onWithdraw={ignore} />
        </div>
        <OpenJarForm kind={kind} facts={facts} state={state} onOpen={ignore} />
      </div>
    </div>
  </Frame>,
  document.getElementById('app') as HTMLElement,
);
