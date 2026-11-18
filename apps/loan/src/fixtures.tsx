import '@grandmas-wallet/ui/styles.css';
import './loan.css';

import { hexToBin } from '@bitauth/libauth';
import { type BorrowingThread, type FoundLoan, type PriceThread, decodePriceState } from '@grandmas-wallet/paryon';
import { Frame } from '@grandmas-wallet/ui';
import { render } from 'preact';

import { type LoanView, type Market, CONTRACTS, lowerPrice } from './loan.js';
import type { MadeKey } from './market.js';
import { type ActionState, ConnectCard, ConnectedCard, HowItWorks, Independent, Intro, LoanList, NewLoanCard, OnItsWay, PricesCard } from './view.js';

/*
 * The states of the page, fed from fixed data, for looking at them in a browser without a wallet. Served by the
 * development server only (`fixtures.html?show=connect|new|ready|loans|running`); the build does not include it.
 */

const now = Math.floor(Date.now() / 1000);
const coin = (fill: number, index: number, valueSatoshis: bigint) => ({ transactionHash: new Uint8Array(32).fill(fill), index, height: 336_300, output: { lockingBytecode: CONTRACTS.loan.lockingBytecode, valueSatoshis } });
const thread = (period: number): BorrowingThread => ({ ...coin(1, 0, 1_000n), period, supply: 9_223_372_036_854_775_807n });
const priceThread: PriceThread = { ...coin(2, 0, 1_000n), state: decodePriceState(hexToBin('00a0f21c00426b0000')) };
const market: Market & { oracleProblem?: string } = {
  height: 336_400,
  lockHeight: 332_844,
  period: 10_288,
  borrowing: [thread(show() === 'new' ? 9_139 : 10_288)],
  priceThread,
  stored: priceThread.state.price,
  oracle: { price: 20_867n, time: now - 240 },
  lower: lowerPrice(priceThread.state.price, 20_867n),
};
function show(): string {
  return new URLSearchParams(window.location.search).get('show') ?? 'loans';
}
const A = '5c1d8c7d635141a15d9d41747ebe30422ca50237c41c54c45714d09114439382';
const B = '2d3f21018a219ed7a0665be8db173d774fa74448b07ec1c12bf459a97f8acd10';
const C = 'c3346ebbc6b48d6f7b6e36693d79e9ef9f6c99ace86e87e0e1f40ac81bf0d1a3';
const found = (collateral: bigint): FoundLoan => ({ loan: coin(3, 2, collateral), sidecar: coin(3, 3, 1_000n), state: undefined as never, keyCategory: new Uint8Array(32) });
const loan = (category: string, debt: bigint, collateral: bigint, rate = 0): LoanView => ({ category, status: 'open', satoshis: collateral, debt, beingRedeemed: 0n, interestRate: rate, found: found(collateral) });
const keys: MadeKey[] = show() === 'ready' ? [{ category: C, transactionId: 'c5'.repeat(32), enforcer: coin(4, 2, 1_000n), proof: coin(4, 3, 1_000n) }] : [];
const loans: LoanView[] =
  show() === 'loans' || show() === 'running'
    ? [loan(A, 100_00n, 59_957_301n), loan(B, 350_00n, 190_000_000n), { category: C, status: 'closed', satoshis: 0n }]
    : [];
const state: ActionState =
  show() === 'running'
    ? { running: { name: `close:${A}`, title: 'Repaying 100.00 PUSD and closing the loan.', progress: { text: 'Your wallet has the request. Check it there and approve it.', stage: 'accepted' } } }
    : show() === 'loans'
      ? { done: { name: `manage:${A}`, text: 'The collateral is changed. The key is back where it was in your wallet.', transactionId: 'ab'.repeat(32) } }
      : {};
const facts = { network: 'chipnet', explorer: 'https://chipnet.imaginary.cash/tx/' };
const ignore = () => undefined;

render(
  <Frame brand="Loan desk" role="Independent, not affiliated with Paryon" environment={{ network: 'chipnet', walletUrl: '', recovererUrl: '', stores: [], chain: [], relays: [], explorer: '', secondsPerBlock: 60 }}>
    {show() === 'connect' ? (
      <div class="stack">
        <Intro />
        <Independent />
        <div class="columns">
          <ConnectCard uri={`wiz://?p=${'02'.repeat(33)}&s=${'7f'.repeat(16)}`} state="waiting" />
          <HowItWorks />
        </div>
      </div>
    ) : (
      <div class="stack">
        <Independent />
        <ConnectedCard peerName="Grandma's Wallet" onDisconnect={ignore} />
        <div class="columns">
          <div class="stack">
            {state.running !== undefined && <OnItsWay title={state.running.title} progress={state.running.progress} />}
            <LoanList loans={loans} trusted market={market} facts={facts} state={state} onManage={ignore} onRepay={ignore} onClose={ignore} />
          </div>
          <div class="stack">
            <NewLoanCard market={market} keys={keys} facts={facts} state={state} onMakeKey={ignore} onMove={ignore} onBorrow={ignore} />
            <PricesCard market={market} />
          </div>
        </div>
      </div>
    )}
  </Frame>,
  document.getElementById('app') as HTMLElement,
);
