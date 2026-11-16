import { type OwnerWallet, MINIMUM_TO_CREATE, OwnerWallet as Wallet, addressOf, describeDelay } from '@grandmas-wallet/app';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { Amount, Button, Card, CopyBox, Field, TaskStatus, useEvery, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type Session, walletDependencies } from './session.js';

// Waiting periods are counted in time, in units of 512 seconds, so that they mean the same on every network
// whatever its block rate.
const DELAYS: { delay: ChallengeDelay; note: string }[] = [
  { delay: { unit: 'time512', value: 1 }, note: 'for trying it out' },
  { delay: { unit: 'time512', value: 169 }, note: '' },
  { delay: { unit: 'time512', value: 1181 }, note: 'a reasonable choice for real use' },
];

/** A new account waits for coins, then becomes a wallet. */
export const Funding = ({ session, onCreated }: { session: Session; onCreated: (wallet: OwnerWallet) => void }) => {
  const task = useTask();
  const [arrived, setArrived] = useState(0n);
  const [choice, setChoice] = useState(0);
  const account = session.account;
  if (account === undefined) return null;
  const address = addressOf(account.coinLockingBytecode, session.environment.network);

  useEvery(4_000, async () => {
    if (task.busy !== undefined) return;
    const coins = await account.coins();
    setArrived(coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n));
  });

  const create = () =>
    task.run('create', async (progress) => {
      const delay = DELAYS[choice]?.delay ?? { unit: 'time512', value: 1181 };
      const wallet = await Wallet.create(walletDependencies(session, progress), {
        network: session.environment.network,
        stores: session.environment.stores,
        challengeDelay: delay,
      });
      session.vault.remove('intent');
      onCreated(wallet);
    });

  const enough = arrived >= MINIMUM_TO_CREATE;
  return (
    <>
      <Card>
        <h2>1. Put some coins in</h2>
        <p>
          Send at least <Amount satoshis={MINIMUM_TO_CREATE} /> of test coins to this address. A small part pays network fees and is set aside so that your
          recoverer can pay theirs; the rest is yours to use.
        </p>
        <CopyBox text={address} />
        <p class="notice">
          Arrived so far: <strong><Amount satoshis={arrived} /></strong>
          {enough ? ' — that is enough.' : ''}
        </p>
        <p class="small muted">
          Test coins are free from a faucet such as <a href="https://tbch.googol.cash/" target="_blank" rel="noopener">tbch.googol.cash</a> (choose chipnet).
        </p>
      </Card>
      <Card>
        <h2>2. Choose the waiting period</h2>
        <p>If your recoverer asks to move the wallet to a new device, this is how long you have to cancel before it happens.</p>
        <Field label="Waiting period">
          <select value={String(choice)} onChange={(event) => setChoice(Number((event.currentTarget as HTMLSelectElement).value))}>
            {DELAYS.map(({ delay, note }, index) => (
              <option value={String(index)}>
                {describeDelay(delay)}
                {note === '' ? '' : ` — ${note}`}
              </option>
            ))}
          </select>
        </Field>
        <Button task={task} name="create" onClick={() => void create()} disabled={!enough}>
          Create the wallet
        </Button>
        <TaskStatus task={task} />
      </Card>
    </>
  );
};
