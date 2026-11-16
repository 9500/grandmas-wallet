import { type OwnerWallet, type WalletView, type WatchStatus, Monitor, describeDelay, hex, lockingBytecodeOf, walletKeys } from '@grandmas-wallet/app';
import {
  Button,
  Card,
  CopyBox,
  Field,
  Inspector,
  TaskStatus,
  TextInput,
  TransactionLink,
  download,
  eraseDevice,
  formatSatoshis,
  formatTime,
  useEvery,
  useTask,
} from '@grandmas-wallet/ui';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { Apps } from './Apps.js';
import { Positions } from './Positions.js';
import { RecoveryCard } from './RecoveryCard.js';
import type { Session } from './session.js';

/** The wallet as its owner uses it day to day. */
export const WalletScreen = ({ session, wallet, arrived }: { session: Session; wallet: OwnerWallet; arrived: boolean }) => {
  const { environment } = session;
  const task = useTask();
  const [view, setView] = useState<WalletView>(wallet.current);
  const [watch, setWatch] = useState<WatchStatus | undefined>();
  const [autoCancel, setAutoCancel] = useState(session.vault.get<boolean>('autoCancel') === true);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sentIn, setSentIn] = useState<string | undefined>();
  const [, setTick] = useState(0);
  const redraw = () => setTick((tick) => tick + 1);

  const refresh = async () => {
    setView(await wallet.refresh());
  };
  useEvery(15_000, async () => {
    if (task.busy === undefined) await refresh();
  });

  // The monitor reads the wallet's history from every server by itself, independently of the screen.
  const monitor = useMemo(
    () =>
      new Monitor({
        servers: session.servers,
        identity: wallet.record.identity,
        genesisTransactionId: wallet.record.genesisTransactionId,
        ownKeyHashes: walletKeys(session.mnemonic ?? '', wallet.record.network).map((key) => hex(key.keyHash)),
        onStatus: (status) => {
          setWatch(status);
          void refresh();
        },
        ...(autoCancel ? { autoCancel: () => wallet.cancelRecovery().then(refresh) } : {}),
      }),
    [autoCancel],
  );
  useEffect(() => {
    monitor.start();
    return () => monitor.stop();
  }, [monitor]);

  const send = () =>
    task.run('send', async (progress) => {
      const satoshis = BigInt(amount.replaceAll(/[,\s]/g, '') || '0');
      const lockingBytecode = lockingBytecodeOf(to, environment.network);
      progress('Signing and sending');
      const sent = await wallet.send(lockingBytecode, satoshis);
      setSentIn(sent.transactionId);
      setTo('');
      setAmount('');
      await refresh();
    });

  const cancel = () =>
    task.run('cancel', async (progress) => {
      progress('Cancelling the request');
      await wallet.cancelRecovery();
      await monitor.check();
      await refresh();
    });

  const erase = async () => {
    if (!window.confirm('Erase everything this site keeps in this browser? The wallet can then only be reached again through your recoverer.')) return;
    await eraseDevice();
    window.location.href = window.location.pathname;
  };

  const saveInvitations = async () => {
    const invitations = await session.account?.invitations();
    download(`invitations-${wallet.record.identity.slice(0, 8)}.json`, JSON.stringify((invitations ?? []).map((item) => JSON.parse(item.invitation) as unknown), null, 1));
  };

  if (!view.ownedHere) {
    return (
      <>
        <Card tone="danger">
          <h2>This wallet has moved to another device</h2>
          <p>
            A recovery was completed, and the wallet now belongs to a key on another device. This device can no longer spend from it. If that was you setting
            up a new device, everything is as it should be.
          </p>
          <p>If it was not you, contact your recoverer at once.</p>
          <Button kind="danger" onClick={() => void erase()}>
            Erase this device
          </Button>
        </Card>
        <Details session={session} wallet={wallet} view={view} onErase={erase} onSave={saveInvitations} />
      </>
    );
  }

  const alarm = watch?.kind === 'recovery-requested' ? watch : undefined;
  return (
    <>
      {arrived && (
        <Card tone="success">
          <h2>Your wallet is on this device now</h2>
          <p>Your funds and what you hold with applications were found from the wallet's records. The earlier device can no longer use the wallet.</p>
        </Card>
      )}
      {alarm !== undefined && (
        <Card tone="danger">
          <h2>Someone asked to move this wallet to another device</h2>
          <p>
            If you did not ask your recoverer for this, cancel it now. If nobody cancels, the wallet moves after the waiting period of{' '}
            {describeDelay(view.challengeDelay)}.
          </p>
          <p class="small">
            Request: <TransactionLink environment={environment} transactionId={alarm.requestedIn} /> {alarm.confirmed ? '(confirmed)' : '(not yet confirmed)'}
          </p>
          <Button task={task} name="cancel" kind="danger" onClick={() => void cancel()}>
            Cancel the request
          </Button>
        </Card>
      )}

      <Card>
        <div class="balance">
          {formatSatoshis(view.balance)}
          <span class="unit">sat</span>
        </div>
        <p class="muted small">{(Number(view.balance) / 1e8).toFixed(8)} tBCH in the wallet</p>
        <h3>Receive</h3>
        <CopyBox text={view.address} />
      </Card>

      <Card>
        <h2>Send</h2>
        <Field label="To address">
          <TextInput value={to} onInput={setTo} placeholder="bchtest:…" />
        </Field>
        <Field label="Amount in satoshis" hint={`You can send up to ${formatSatoshis(view.spendable)} sat. The network fee is about 1,100 sat.`}>
          <TextInput value={amount} onInput={setAmount} numeric placeholder="0" />
        </Field>
        <Button task={task} name="send" onClick={() => void send()} disabled={to.trim() === '' || amount.trim() === ''}>
          Send
        </Button>
        {sentIn !== undefined && task.busy === undefined && task.error === undefined && (
          <p class="notice ok">
            Sent. <TransactionLink environment={environment} transactionId={sentIn} />
          </p>
        )}
      </Card>
      <TaskStatus task={task} />

      <Positions session={session} wallet={wallet} view={view} onChanged={refresh} />

      <Apps session={session} wallet={wallet} view={view} onChanged={refresh} />

      <RecoveryCard session={session} wallet={wallet} view={view} onChanged={redraw} />

      <Card>
        <h2>Protection</h2>
        <p>
          While this page is open, it watches for requests to move the wallet and warns you here. It reads from {session.servers.length} independent server
          {session.servers.length === 1 ? '' : 's'}.
        </p>
        <label class="check">
          <input
            type="checkbox"
            checked={autoCancel}
            onChange={(event) => {
              const on = (event.currentTarget as HTMLInputElement).checked;
              session.vault.set('autoCancel', on);
              setAutoCancel(on);
            }}
          />
          <span>
            Cancel such requests by itself, without asking me.
            <br />
            <span class="small muted">Turn this off before you ask your recoverer to move the wallet, or this device will cancel that too.</span>
          </span>
        </label>
      </Card>

      {wallet.record.activity.length > 0 && (
        <Card>
          <h2>Activity</h2>
          <ul class="list">
            {wallet.record.activity.map((item) => (
              <li>
                {item.summary}
                <div class="small muted">
                  {formatTime(item.at)} · <TransactionLink environment={environment} transactionId={item.transactionId} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Details session={session} wallet={wallet} view={view} onErase={erase} onSave={saveInvitations} />
    </>
  );
};

const Details = ({ wallet, view, onErase, onSave }: { session: Session; wallet: OwnerWallet; view: WalletView; onErase: () => void; onSave: () => void }) => {
  const [backup, setBackup] = useState<{ name: string; held: number; total: number }[]>([]);
  useEvery(30_000, async () => setBackup(await wallet.backupStatus()));
  return (
    <Inspector
      entries={[
        ['Wallet identity', view.identity],
        ['Controller state', `${view.status}, owner epoch ${view.ownerEpoch}`],
        ['Owner key hash', hex(wallet.controller.current.state.ownerKeyHash)],
        ['Recoverer key hash', view.recovererKeyHash],
        ['Waiting period', describeDelay(view.challengeDelay)],
        ['Wallet template', wallet.record.templates.wallet.identifier],
        ['Trusted application templates', wallet.trustedTemplates.map((template) => `${template.name} (${template.identifier.slice(0, 12)}…)`).join(' · ') || 'none'],
        ['Archive', wallet.record.archive.archiveId],
        ['Backup', backup.map((store) => `${store.name}: ${store.held} of ${store.total}`).join(' · ') || 'not yet checked'],
      ]}
    >
      <div class="row">
        <Button kind="quiet" onClick={onSave}>
          Save this account's XO invitations
        </Button>
        <Button kind="quiet" onClick={() => void wallet.syncBackup().then(async () => setBackup(await wallet.backupStatus()))}>
          Send the backup again
        </Button>
        <Button kind="quiet" onClick={onErase}>
          Erase this device (as if it were lost)
        </Button>
      </div>
      <p class="small muted">Saved invitations can be loaded into the XO developer tool to inspect each transaction.</p>
    </Inspector>
  );
};
