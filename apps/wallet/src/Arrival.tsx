import { binToHex } from '@bitauth/libauth';
import type { WalletSearch } from '@grandmas-wallet/core';
import { Amount, Button, Card, Notice, PageHead, type Step, Steps, TaskStatus, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import type { Owner } from './OwnerApp.js';
import { keep, kept } from './session.js';

/** What the search found at the earlier seeds' addresses, in satoshis. */
const foundEarlier = (search: WalletSearch): bigint => {
  const seen = new Map<string, bigint>();
  for (const seed of search.seeds) {
    if (seed.label === 'the current seed') continue;
    for (const address of [...(seed.quick?.found ?? []), ...(seed.full?.found ?? [])]) {
      for (const coin of address.coins) seen.set(`${binToHex(coin.utxo.transactionHash)}:${coin.utxo.index}`, coin.utxo.output.valueSatoshis);
    }
  }
  return [...seen.values()].reduce((sum, value) => sum + value, 0n);
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * After a takeover, a move or a restore: find the coins and move them to this phone's addresses (proposal
 * sections 11.1, step 7, and 11.2). The quick search comes first so that moving can start; the full search
 * then covers every address of every earlier seed. A reload continues from the step reached.
 */
export const Arrival = ({ owner, onDone }: { owner: Owner; onDone: () => void }) => {
  const [arrival, setArrival] = useState(() => kept('arrival'));
  const [found, setFound] = useState<{ quick?: bigint; full?: bigint; moved?: bigint; status?: WalletSearch['status']; reasons?: string[] }>({});
  const task = useTask();
  const [phase, setPhase] = useState<'quick' | 'sweep' | 'full' | 'done'>(() => (arrival?.searched === undefined ? 'quick' : arrival.searched === 'quick' ? 'full' : 'done'));
  const earlierSeeds = owner.wallet.stored.earlierSeeds?.length ?? 0;
  const update = (change: Partial<NonNullable<typeof arrival>>) => {
    const next = { ...(kept('arrival') ?? { from: 'takeover' as const, missing: [] }), ...change };
    keep('arrival', next);
    setArrival(next);
  };

  /** Move what is at earlier addresses, once the account lists what the search found. */
  const sweep = async (expected: bigint, progress: (step: string) => void) => {
    if (expected === 0n) return 0n;
    setPhase('sweep');
    progress('Waiting for the coins to be listed');
    for (let attempt = 0; attempt < 60 && (await owner.wallet.balance()).toSweep < expected; attempt++) await wait(1_000);
    progress('Moving the coins to this phone\'s addresses');
    const swept = await owner.wallet.sweepEarlier();
    for (const sent of swept.transactions) owner.sent(`Moved ${swept.coins} coins from earlier addresses`, sent);
    return expected;
  };

  const run = () =>
    task.run('arrive', async (progress) => {
      if (kept('arrival')?.searched === undefined) {
        setPhase('quick');
        progress('Quick search of the earlier addresses');
        const quick = await owner.wallet.search({ passes: ['quick'] });
        const amount = foundEarlier(quick);
        setFound((before) => ({ ...before, quick: amount }));
        await sweep(amount, progress);
        update({ searched: 'quick' });
      }
      setPhase('full');
      progress('Full search of every address. This can take a minute.');
      const full = await owner.wallet.search({ passes: ['full'] });
      setFound((before) => ({ ...before, full: foundEarlier(full), status: full.status, reasons: full.reasons }));
      const left = (await owner.wallet.balance()).toSweep;
      if (left > 0n) await sweep(left, progress);
      update({ searched: 'full' });
      setPhase('done');
      await owner.refresh();
    });

  useEffect(() => {
    if (arrival?.searched !== 'full') void run();
  }, []);

  if (arrival === undefined) return null;
  const searched = arrival.searched;
  const order = ['quick', 'sweep', 'full', 'done'];
  const stateOf = (which: string): Step['state'] => (order.indexOf(which) < order.indexOf(phase) ? 'done' : which === phase ? 'current' : 'later');
  const steps: Step[] = [
    {
      title: arrival.from === 'restore' ? 'This phone is the owner again' : 'This phone owns the wallet',
      state: 'done',
      detail: arrival.from === 'takeover' ? 'Your recoverer completed the move, and this phone checked the wallet\'s history on the chain itself.' : arrival.from === 'move' ? 'Your old phone handed the wallet over, and the network has the change.' : 'The chain shows these words as the wallet\'s owner.',
    },
    {
      title: 'Quick search',
      state: stateOf('quick'),
      detail:
        earlierSeeds === 0 ? 'Looks at the first addresses of this wallet, as any wallet does when it is restored.' : (
          <>
            Looks at the first addresses of the earlier phone{earlierSeeds === 1 ? '' : 's'}, where nearly everything is found.
            {found.quick !== undefined && (
              <>
                {' '}
                Found <Amount satoshis={found.quick} exact />.
              </>
            )}
          </>
        ),
    },
    {
      title: 'Moving the coins to this phone',
      state: stateOf('sweep'),
      detail: 'Coins at the earlier phone\'s addresses go to this phone\'s, through the wallet\'s controller. Tokens move unchanged. A coin for cancelling is put aside.',
    },
    {
      title: 'Full search',
      state: stateOf('full'),
      detail: 'Every address the wallet could ever have given out. Only after this is the wallet fully found.',
    },
  ];
  return (
    <div class="stack">
      <PageHead title="Bringing your coins over">You can close the page; it continues from here.</PageHead>
      {arrival.missing.length > 0 && (
        <Notice tone="warn">
          {arrival.missing.map((line) => (
            <div>{line}</div>
          ))}
        </Notice>
      )}
      <Card>
        <Steps steps={steps} />
        <div class="actions" />
        <TaskStatus task={task} name="arrive" />
        {found.status === 'incomplete' && <Notice tone="warn">The search is not complete: {found.reasons?.join(' ')}</Notice>}
        {task.error !== undefined && (
          <div class="actions">
            <Button onClick={() => void run()}>Try again</Button>
          </div>
        )}
        {searched === 'full' && (
          <div class="actions">
            <Button
              onClick={() => {
                update({ swept: true });
                onDone();
              }}
            >
              Open the wallet
            </Button>
          </div>
        )}
      </Card>
      {searched === 'full' && arrival.from !== 'restore' && (
        <Card flat>
          <p class="small">
            People who pay you need a new address from now on, or a vault address. Payments to old addresses still arrive; the wallet moves them over when it finds them, but until then the earlier phone's words can spend them too.
          </p>
        </Card>
      )}
    </div>
  );
};
