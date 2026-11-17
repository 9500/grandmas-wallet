import { binToHex } from '@bitauth/libauth';
import { Amount, Button, Card, Icon, KeyValues, LinkRow, Loading, More, TaskStatus, formatBch, formatSatoshis, shorten, useTask } from '@grandmas-wallet/ui';

import type { Owner } from './OwnerApp.js';
import { ActivityList } from './parts.js';
import { Alarm, CancelCoin, KitCard, ProtectionStatus } from './Protection.js';
import { kept } from './session.js';

/**
 * The home screen: what the wallet holds, whether it is protected, then receiving and sending. Everything
 * else is one step away.
 */
export const Home = ({ owner }: { owner: Owner }) => {
  const { balance } = owner;
  if (balance === undefined) return <Loading>Reading what the wallet holds…</Loading>;
  const total = balance.recoverable + balance.cancelling + balance.vault + balance.toSweep + balance.notRecoverable;
  const rows: [preact.ComponentChildren, preact.ComponentChildren][] = [[<>Ready to spend</>, <Amount satoshis={balance.recoverable} />]];
  if (balance.vault > 0n) rows.push([<>At vault addresses<small>Spending from these goes through the wallet's controller.</small></>, <Amount satoshis={balance.vault} />]);
  rows.push([<>Kept for cancelling<small>Pays for refusing a request.</small></>, balance.cancelling > 0n ? <Amount satoshis={balance.cancelling} /> : <span class="muted">none</span>]);
  if (balance.toSweep > 0n) rows.push([<>At earlier addresses<small>Not yet moved to this phone's addresses.</small></>, <Amount satoshis={balance.toSweep} />]);
  if (balance.notRecoverable > 0n) rows.push([<>At the address for the first coins<small>Not recoverable. Only this phone can move it.</small></>, <Amount satoshis={balance.notRecoverable} />]);
  if (balance.tokens.length > 0) rows.push([<>Tokens</>, <span>{balance.tokens.length}</span>]);
  return (
    <div class="stack">
      <Alarm owner={owner} />
      <div class="grid two home">
        <div class="stack">
          <Card cls="o1">
            <div class="balance">
              <span class="balance-label">In your wallet</span>
              <span class="balance-main" data-testid="balance">
                {formatBch(total)}
                <span class="unit">BCH</span>
              </span>
              <span class="balance-sub">{formatSatoshis(total)} satoshis</span>
            </div>
            <div class="big-actions">
              <a
                class="button"
                href="/receive"
                onClick={(event) => {
                  event.preventDefault();
                  owner.navigate('receive');
                }}
              >
                <Icon name="receive" /> Receive
              </a>
              <a
                class="button secondary"
                href="/send"
                onClick={(event) => {
                  event.preventDefault();
                  owner.navigate('send');
                }}
              >
                <Icon name="send" /> Send
              </a>
            </div>
            <More summary="What it is made of">
              <KeyValues entries={rows} />
              {balance.tokens.length > 0 && (
                <p class="small muted">
                  Tokens: {balance.tokens.map((coin) => shorten(binToHex(coin.utxo.output.token?.category ?? new Uint8Array()), 6, 4)).join(', ')}. The wallet does not know what they stand for; it moves them unchanged.
                </p>
              )}
            </More>
          </Card>
          <EarlierCoins owner={owner} />
          <Card title="Recent" cls="o5">
            <ActivityList items={kept('activity') ?? []} limit={4} explorer={owner.session.environment.explorer} />
          </Card>
        </div>
        <div class="stack">
          <Card cls="o2">
            <ProtectionStatus owner={owner} compact />
            {owner.canCancel === false && (
              <div class="actions">
                <CancelCoin owner={owner} bare />
              </div>
            )}
            <div class="card-foot">
              <LinkRow label="Recovery" hint="Your recoverer, the waiting period, a new phone, your own backup" onClick={() => owner.navigate('recovery')} />
            </div>
          </Card>
          <KitCard owner={owner} />
          <div class="center small muted o6">
            <button type="button" class="link" onClick={() => owner.navigate('details')}>
              Technical details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Coins at an earlier seed's addresses: until they are moved, the earlier seed can spend them too. */
const EarlierCoins = ({ owner }: { owner: Owner }) => {
  const task = useTask();
  const toSweep = owner.balance?.toSweep ?? 0n;
  if (toSweep === 0n) return null;
  return (
    <Card title="Coins at earlier addresses" tone="warn" cls="o4">
      <p>
        <Amount satoshis={toSweep} exact /> arrived at addresses of a phone this wallet had before. Until they are moved, whoever has that phone's words can spend them too.
      </p>
      <div class="actions">
        <Button
          task={task}
          name="sweep"
          onClick={() =>
            void task.run('sweep', async () => {
              const swept = await owner.wallet.sweepEarlier();
              for (const sent of swept.transactions) owner.sent(`Moved ${swept.coins} coins from earlier addresses`, sent);
            })
          }
        >
          Move them to this phone
        </Button>
      </div>
      <p class="small muted">The fee is taken from the coins moved.</p>
      <TaskStatus task={task} name="sweep" />
    </Card>
  );
};
