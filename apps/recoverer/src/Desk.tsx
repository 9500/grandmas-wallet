import {
  type DeskView,
  type EnrolledWallet,
  type RecoveryTicket,
  NotYetValidError,
  RecoveryDesk,
  addressOf,
  describeDelay,
  makeLink,
  readLink,
} from '@grandmas-wallet/app';
import type { RestoreReport } from '@grandmas-wallet/archive';
import {
  Amount,
  Button,
  Card,
  CopyBox,
  Field,
  Inspector,
  Spinner,
  TaskStatus,
  TextArea,
  TransactionLink,
  download,
  formatDuration,
  formatTime,
  shorten,
  useEvery,
  useTask,
} from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Session, deskDependencies, goTo, takeIncoming } from './session.js';

/** What travels between the recoverer and the new device during a move. */
interface RequestMessage {
  identity: string;
  invitation: string;
}

/** One wallet, as its recoverer sees it. */
export const Desk = ({ session, identity }: { session: Session; identity: string }) => {
  const [desk, setDesk] = useState<RecoveryDesk | undefined>();
  const [coinAddress, setCoinAddress] = useState('');
  const [invitations, setInvitations] = useState<() => Promise<string>>();
  const [problem, setProblem] = useState<string | undefined>();

  useEffect(() => {
    const enrolled = session.vault.get<EnrolledWallet>(`wallet/${identity}`);
    if (enrolled === undefined) {
      setProblem('This recoverer does not look after that wallet.');
      return;
    }
    (async () => {
      const deps = await deskDependencies(session, enrolled);
      setCoinAddress(addressOf(deps.account.coinLockingBytecode, session.environment.network));
      setInvitations(() => async () => JSON.stringify((await deps.account.invitations()).map((item) => JSON.parse(item.invitation) as unknown), null, 1));
      setDesk(await RecoveryDesk.open(deps, enrolled));
    })().catch((error: Error) => setProblem(error.message));
  }, []);

  if (problem !== undefined) {
    return (
      <Card tone="danger">
        <h2>This wallet could not be opened</h2>
        <p>{problem}</p>
        <Button kind="secondary" onClick={() => goTo(undefined)}>
          Back to all wallets
        </Button>
      </Card>
    );
  }
  if (desk === undefined) {
    return (
      <Card>
        <p>
          <Spinner /> Reading the wallet from the network…
        </p>
      </Card>
    );
  }
  return <OpenDesk session={session} desk={desk} coinAddress={coinAddress} saveInvitations={invitations} />;
};

const OpenDesk = ({
  session,
  desk,
  coinAddress,
  saveInvitations,
}: {
  session: Session;
  desk: RecoveryDesk;
  coinAddress: string;
  saveInvitations: (() => Promise<string>) | undefined;
}) => {
  const { environment } = session;
  const { enrolled, enrollment } = desk;
  const task = useTask();
  const [view, setView] = useState<DeskView>(desk.current);
  const [preview, setPreview] = useState<RestoreReport | undefined>();
  const [confirmed, setConfirmed] = useState(false);
  const [restoreLink, setRestoreLink] = useState(session.vault.get<string>(`restore-link/${view.identity}`) ?? '');
  const [joined, setJoined] = useState(session.incoming?.kind === 'join' ? session.incoming.text : '');
  const [requestedLink, setRequestedLink] = useState('');
  const [, setTick] = useState(0);

  const refresh = async () => setView(await desk.refresh());
  useEvery(15_000, async () => {
    if (task.busy === undefined) await refresh();
  });
  useEffect(() => {
    void desk.preview().then(setPreview, () => undefined);
  }, []);
  useEffect(() => {
    const last = enrolled.lastRequest;
    if (last === undefined) return;
    const message: RequestMessage = { identity: view.identity, invitation: last.invitation };
    void makeLink(environment.walletUrl, 'requested', message).then(setRequestedLink);
  }, [enrolled.lastRequest?.transactionId]);

  const start = () =>
    task.run('start', async (progress) => {
      progress('Preparing the request');
      const ticket: RecoveryTicket = await desk.startRequest();
      const link = await makeLink(environment.walletUrl, 'restore', ticket);
      session.vault.set(`restore-link/${view.identity}`, link);
      setRestoreLink(link);
    });

  const send = () =>
    task.run('send', async (progress) => {
      const message = await readLink<RequestMessage>(joined, 'join');
      if (message === undefined) throw new Error('That is not the link the new device shows after it was set up.');
      if (message.identity !== view.identity) throw new Error('That link is about a different wallet.');
      progress('Signing and sending the request');
      try {
        await desk.sendRequest(message.invitation);
      } catch (error) {
        // The request that was started cannot be used again; the steps begin anew.
        session.vault.remove(`restore-link/${view.identity}`);
        setRestoreLink('');
        setJoined('');
        takeIncoming(session);
        throw new Error(`${(error as Error).message} The request was not sent. Start again, and give the new device the new link.`, { cause: error });
      }
      session.vault.remove(`restore-link/${view.identity}`);
      setRestoreLink('');
      setJoined('');
      takeIncoming(session);
      setConfirmed(false);
      await refresh();
      setTick((tick) => tick + 1);
    });

  const complete = () =>
    task.run('complete', async (progress) => {
      progress('Completing the move');
      try {
        await desk.complete();
      } catch (error) {
        if (error instanceof NotYetValidError) throw new Error('The network does not accept this yet. The waiting period has not quite passed; try again in a few minutes.', { cause: error });
        throw error;
      }
      await refresh();
      void desk.preview().then(setPreview, () => undefined);
    });

  const save = async () => {
    if (saveInvitations !== undefined) download(`invitations-recoverer-${view.identity.slice(0, 8)}.json`, await saveInvitations());
  };

  const eligibility = view.pending?.eligibility;
  const ours = view.pending !== undefined && enrolled.lastRequest?.proposedOwnerKeyHash === view.pending.proposedOwnerKeyHash;
  const moved = enrolled.lastRequest !== undefined && view.status === 'active' && view.ownerKeyHash === enrolled.lastRequest.proposedOwnerKeyHash;
  const feeShort = view.feeBalance < view.feeNeeded;
  return (
    <>
      <p>
        <Button kind="quiet" onClick={() => goTo(undefined)}>
          ← All wallets
        </Button>
      </p>
      <Card>
        <div class="row spread">
          <h2>{enrolled.customer}</h2>
          <span class={`pill ${view.status === 'pending' ? 'warn' : 'ok'}`}>{view.status === 'pending' ? 'Move in progress' : 'Normal'}</span>
        </div>
        <p class="small muted">
          Wallet <span class="mono">{shorten(view.identity)}</span> · package received {formatTime(enrolled.importedAt)} · waiting period{' '}
          {describeDelay(enrollment.policy.challengeDelay)}
        </p>
        {!view.authorized && <p class="notice error">This recovery credential is no longer the wallet's recoverer. Nothing can be done for this wallet from here.</p>}
        {view.differences.map((difference) => (
          <p class="notice wait">{difference}</p>
        ))}
        {moved && <p class="notice ok">The wallet has moved to the new device. Nothing more is needed from you.</p>}
      </Card>

      {view.status === 'pending' && view.pending !== undefined && (
        <Card tone="warn">
          <h2>A move is waiting</h2>
          <p>
            Request <TransactionLink environment={environment} transactionId={view.pending.requestedIn} />
            {ours ? '' : ' — not sent from this page'}. The wallet's current device can cancel until the move is completed.
          </p>
          <p class="notice wait">
            {eligibility === undefined || eligibility.ready
              ? 'The waiting period has passed. The move can be completed.'
              : eligibility.waitingFor === 'confirmation'
                ? 'Waiting for the request\'s first confirmation; the waiting period starts then.'
                : eligibility.waitingFor === 'blocks'
                  ? `Waiting period: ${eligibility.remaining} more block(s).`
                  : `Waiting period: about ${formatDuration(eligibility.remainingSeconds)} more by the network's clock.`}
          </p>
          {requestedLink !== '' && ours && (
            <>
              <h3>Give this second link to the new device</h3>
              <p class="small">The device needs it once, at any time before it opens the wallet.</p>
              <CopyBox text={requestedLink} open openLabel="Open on the new device" />
            </>
          )}
          <p>
            <Button task={task} name="complete" onClick={() => void complete()} disabled={eligibility !== undefined && !eligibility.ready}>
              Complete the move
            </Button>
          </p>
        </Card>
      )}

      {view.status === 'active' && view.authorized && !moved && (
        <Card>
          <h2>Move this wallet to a new device</h2>
          <p>
            Do this only when the wallet's owner asks you to, and you are sure it is really them. The move takes{' '}
            {describeDelay(enrollment.policy.challengeDelay)}, and the wallet's current device can cancel it during that time.
          </p>
          <ol class="steps">
            <li class={restoreLink === '' ? 'current' : 'done'}>
              <strong>Start, and give the owner a link for their new device.</strong>
              {restoreLink === '' ? (
                <>
                  <label class="check">
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed((event.currentTarget as HTMLInputElement).checked)} />
                    <span>I have made sure the person asking is the wallet's owner.</span>
                  </label>
                  <p>
                    <Button task={task} name="start" onClick={() => void start()} disabled={!confirmed || feeShort}>
                      Start
                    </Button>
                  </p>
                </>
              ) : (
                <CopyBox text={restoreLink} open openLabel="Open on the new device" />
              )}
            </li>
            <li class={restoreLink === '' ? 'later' : 'current'}>
              <strong>Take the link the new device shows, and send the request.</strong>
              <p>The new device makes its own key and shows a link that names it. Open that link here, or paste it.</p>
              {restoreLink !== '' && (
                <>
                  <Field label="Link from the new device">
                    <TextArea value={joined} onInput={setJoined} placeholder="https://…#join=…" />
                  </Field>
                  <Button task={task} name="send" onClick={() => void send()} disabled={joined.trim() === ''}>
                    Sign and send the request
                  </Button>
                </>
              )}
            </li>
            <li class="later">
              <strong>Wait, then complete the move.</strong>
            </li>
          </ol>
        </Card>
      )}
      <TaskStatus task={task} />

      <Card>
        <h2>What a new device would find</h2>
        {preview === undefined ? (
          <p class="muted">
            <Spinner /> Reading the wallet's records…
          </p>
        ) : (
          <>
            <p>
              Funds: <Amount satoshis={preview.funds.balance} /> ·{' '}
              <span class={`pill ${preview.completeness === 'complete' ? 'ok' : 'warn'}`}>{preview.completeness === 'complete' ? 'Records complete' : 'Records incomplete'}</span>
            </p>
            {preview.positions.length > 0 && (
              <ul class="list">
                {preview.positions.map((position) => (
                  <li>
                    {position.position.label ?? position.position.kind} ·{' '}
                    <Amount satoshis={position.unspent.reduce((sum, entry) => sum + entry.valueSatoshis, 0n)} /> ·{' '}
                    <span class="small muted">
                      {position.onChain === 'live' ? 'holding funds' : position.onChain === 'spent' ? 'emptied' : 'never paid into'}, {position.result}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {preview.unresolved.map((reason) => (
              <p class="notice wait">{reason}</p>
            ))}
            <p class="small muted">You can see where the funds are, but you cannot spend them: that takes the owner's key.</p>
          </>
        )}
      </Card>

      <Card tone={feeShort ? 'warn' : undefined}>
        <h2>Fee account</h2>
        <p>
          Sending a request and completing a move each cost a network fee, paid from this account. It holds <Amount satoshis={view.feeBalance} />
          {feeShort ? `; at least ${view.feeNeeded} are needed for the next step.` : '.'}
        </p>
        {coinAddress !== '' && <CopyBox text={coinAddress} />}
        <p class="small muted">The wallet set this amount aside when it was created.</p>
      </Card>

      {enrolled.activity.length > 0 && (
        <Card>
          <h2>Activity</h2>
          <ul class="list">
            {enrolled.activity.map((item) => (
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

      <Inspector
        entries={[
          ['Wallet identity', view.identity],
          ['Controller state', `${view.status}, owner epoch ${view.ownerEpoch}`],
          ['Owner key hash', view.ownerKeyHash],
          ['Recoverer key hash', enrollment.policy.recovererKeyHash],
          ['Proposed owner', view.pending?.proposedOwnerKeyHash ?? 'none'],
          ['Archive', enrollment.archive.archiveId],
          ['Stores', enrollment.archive.stores.join(', ')],
        ]}
      >
        <Button kind="quiet" onClick={() => void save()}>
          Save this account's XO invitations
        </Button>
      </Inspector>
    </>
  );
};
