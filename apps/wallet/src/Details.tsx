import { binToHex } from '@bitauth/libauth';
import { describeDelay } from '@grandmas-wallet/app';
import { ADDRESS_SCHEME_VERSION } from '@grandmas-wallet/core';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Button, Card, Choice, Developer, KeyValues, PageHead, Value, eraseDevice, formatTime, shorten, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import type { Owner } from './OwnerApp.js';
import { ActivityList } from './parts.js';
import { keep, kept, openedAccount } from './session.js';

/** What a developer or a careful user may want to see, and erasing this phone. */
export const Details = ({ owner }: { owner: Owner }) => {
  const { wallet, session, watch } = owner;
  const state = watch.history?.current.state;
  const creation = watch.history?.transactions[0]?.transactionId;
  const arrangement = kept('arrangement');
  const log = kept('watchLog');
  const lastSpan = log?.spans.at(-1);
  const [developer, setDeveloper] = useState(() => kept('developer') === true);
  return (
    <div class="stack">
      <PageHead title="Technical details">For troubleshooting. Nothing here needs to be understood to use the wallet.</PageHead>
      <Card title="The wallet">
        <div class="stack-s">
          <span class="small muted">Identity</span>
          <Value text={wallet.stored.identity ?? ''} testId="identity" />
        </div>
        <div class="actions" />
        <KeyValues
          wide
          entries={[
            ['Created in', creation === undefined ? '…' : <span class="mono">{shorten(creation, 12, 10)}</span>],
            ['Network', `${session.environment.network} (keys for ${session.network})`],
            ['Address scheme', String(ADDRESS_SCHEME_VERSION)],
            ['This phone\'s key', <span class="mono">{keyFingerprint(owner.seed.controllerKey.keyHash)}</span>],
            ['Owner on chain', state === undefined ? '…' : <span class="mono">{keyFingerprint(state.ownerKeyHash)} · epoch {state.ownerEpoch}</span>],
            ['Recoverer on chain', state === undefined ? '…' : <span class="mono">{keyFingerprint(state.recovererKeyHash)}</span>],
            ['State', state === undefined ? '…' : state.status === 'pending' ? `a request is pending, to ${keyFingerprint(state.proposedOwnerKeyHash ?? new Uint8Array())}` : 'active'],
            ['Waiting period', state === undefined ? '…' : describeDelay(state.challengeDelay)],
            ['Earlier phones', String(wallet.stored.earlierSeeds?.length ?? 0)],
            ['Searched fully', wallet.stored.fullySearched ? 'yes' : 'not yet'],
          ]}
        />
      </Card>
      <div class="grid halves">
        <Card title="Servers">
          <KeyValues
            wide
            entries={[
              ['Chain', session.environment.chain.join(', ')],
              ['Answering', `${session.servers.length} of ${session.environment.chain.length}`],
              ['Backup stores', session.environment.stores.join(', ')],
              ['Archive', arrangement === undefined ? 'none on this phone' : <span class="mono">{shorten(arrangement.archive.archiveId, 8, 6)}</span>],
              ['Last check', watch.checkedAt === undefined ? '…' : formatTime(watch.checkedAt)],
              ['Watching since', lastSpan === undefined ? '…' : formatTime(lastSpan.from)],
            ]}
          />
          <p class="small muted">Confirmations are taken from these servers; this phone does not verify them by itself.</p>
          {watch.problem !== undefined && <p class="small">Last problem: {watch.problem}</p>}
        </Card>
        <Card title="Sent from this phone">
          <ActivityList items={kept('activity') ?? []} explorer={session.environment.explorer} />
        </Card>
      </div>
      <Developer
        on={developer}
        onChange={(on) => {
          keep('developer', on ? true : undefined);
          setDeveloper(on);
        }}
        invitations={kept('invitations') ?? []}
        read={async (identifier) => (await openedAccount())?.invitationText(identifier)}
        device="phone"
      />
      <Erase />
      <p class="small muted center">Owner key hash {binToHex(owner.seed.controllerKey.keyHash)}</p>
    </div>
  );
};

/** Erase what this page keeps in this browser: what losing the phone amounts to. */
export const Erase = () => {
  const [sure, setSure] = useState(false);
  const task = useTask();
  return (
    <Card title="Erase this phone" tone="warn">
      <p>Removes the wallet's words and everything this page keeps in this browser. The coins stay where they are; without the words or your recoverer, this phone cannot reach them again.</p>
      <Choice type="checkbox" checked={sure} onChange={setSure} title="I understand. I have a backup, or my recoverer can help me." />
      <div class="actions">
        <Button
          kind="danger"
          disabled={!sure}
          task={task}
          name="erase"
          onClick={() =>
            void task.run('erase', async () => {
              await (await openedAccount())?.close();
              await eraseDevice();
              window.location.replace('/');
            })
          }
        >
          Erase this phone
        </Button>
      </div>
    </Card>
  );
};
