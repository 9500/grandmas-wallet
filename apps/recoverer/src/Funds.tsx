import { type RecovererFunds, addressOf, creationCost } from '@grandmas-wallet/app';
import { Amount, Card, HandOff, Loading, Notice, plainError, useEvery } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Session, fundsOf, settingsOf } from './session.js';

/** The recoverer's own coins, once the page's account is open. */
export const useFunds = (session: Session): { funds?: RecovererFunds; problem?: string } => {
  const [state, setState] = useState<{ funds?: RecovererFunds; problem?: string }>({});
  useEffect(() => {
    fundsOf(session).then(
      (funds) => setState({ funds }),
      (error: unknown) => setState({ problem: plainError(error) }),
    );
  }, []);
  return state;
};

/**
 * The recoverer's balance and the address to fund it at (proposal section 9.6). Every wallet the recoverer sets up
 * is created from it, with the starting balance and a reserve for the recoverer's own fees.
 */
export const FundsCard = ({ session, funds, problem }: { session: Session; funds: RecovererFunds | undefined; problem: string | undefined }) => {
  const [balance, setBalance] = useState<bigint | undefined>();
  const [address, setAddress] = useState<string | undefined>();
  useEffect(() => {
    if (funds !== undefined) void funds.address().then((locking) => setAddress(addressOf(locking, session.environment.network === 'mainnet' ? 'mainnet' : 'chipnet')));
  }, [funds]);
  useEvery(
    8_000,
    async () => {
      if (funds !== undefined) setBalance(await funds.balance());
    },
    [funds],
  );
  const each = creationCost(BigInt(settingsOf().startingSatoshis));
  const test = session.environment.network !== 'mainnet';
  return (
    <Card title="Your balance" cls="funds">
      {problem !== undefined ? (
        <Notice tone="bad">{problem}</Notice>
      ) : funds === undefined || balance === undefined ? (
        <Loading>Opening your account. The page checks the chain's block headers first.</Loading>
      ) : (
        <div class="stack">
          <div class="balance">
            <span class="balance-main" data-testid="funds-balance" data-value={balance.toString()}>
              <Amount satoshis={balance} />
            </span>
            <span class="balance-sub">
              Each new wallet takes about <Amount satoshis={each} exact />: its starting balance, a reserve for your fees if its owner ever needs you, and the network's fees.
            </span>
          </div>
          {balance < each && <Notice tone="warn">Your balance does not cover a new wallet. Add coins to the address below.</Notice>}
          {address !== undefined && (
            <HandOff text={address} qrLabel="QR code of the address of your balance" copyLabel="Copy address" testId="funds-address">
              <p class="small muted">{test ? 'Send test coins to this address.' : 'Send Bitcoin Cash to this address, from any wallet.'}</p>
            </HandOff>
          )}
        </div>
      )}
    </Card>
  );
};
