import {
  type OwnerWallet,
  type TakeoverProgress,
  type TakeoverRecord,
  completeTakeover,
  makeLink,
  readLink,
  receiveRequest,
  takeoverProgress,
} from '@grandmas-wallet/app';
import { Button, Card, CopyBox, Field, TaskStatus, TextArea, TransactionLink, formatDuration, shorten, useEvery, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Session, takeIncoming, walletDependencies } from './session.js';

/** What travels between this device and the recoverer during a takeover. */
export interface RequestMessage {
  identity: string;
  invitation: string;
}

const waitText = (progress: TakeoverProgress): string => {
  if (progress.stage !== 'waiting-for-delay') return '';
  const { eligibility } = progress;
  if (eligibility.ready) return 'The waiting period has passed. Your recoverer can complete the move now.';
  if (eligibility.waitingFor === 'confirmation') return 'The request has been sent and is waiting for its first confirmation; the waiting period starts then.';
  if (eligibility.waitingFor === 'blocks') return `The waiting period is running: ${eligibility.remaining} more block(s).`;
  return `The waiting period is running: about ${formatDuration(eligibility.remainingSeconds)} more by the network's clock.`;
};

/** A new device on its way to taking a wallet over. */
export const Takeover = ({ session, takeover, onDone }: { session: Session; takeover: TakeoverRecord; onDone: (wallet: OwnerWallet) => void }) => {
  const task = useTask();
  const [record, setRecord] = useState(takeover);
  const [progress, setProgress] = useState<TakeoverProgress | undefined>();
  const [joinLink, setJoinLink] = useState('');
  const [requested, setRequested] = useState(session.incoming?.kind === 'requested' ? session.incoming.text : '');
  const { mnemonic, account } = session;

  useEffect(() => {
    const message: RequestMessage = { identity: record.wallet.identity, invitation: record.joinedInvitation };
    void makeLink(session.environment.recovererUrl, 'join', message).then(setJoinLink);
  }, []);

  useEvery(10_000, async () => {
    if (mnemonic === undefined || task.busy !== undefined) return;
    setProgress(await takeoverProgress(session.chain, record, mnemonic));
  });

  const takeIn = (text: string) =>
    task.run('receive', async () => {
      if (account === undefined) throw new Error('This device has no account.');
      const message = await readLink<RequestMessage>(text, 'requested');
      if (message === undefined) throw new Error('That is not the second link from your recoverer.');
      if (message.identity !== record.wallet.identity) throw new Error('That link is about a different wallet.');
      await receiveRequest(account, record, message.invitation);
      session.vault.set('takeover', record);
      setRecord({ ...record });
      takeIncoming(session);
    });

  // A second link the page was opened with is taken in without asking.
  useEffect(() => {
    if (requested !== '' && !record.requestReceived) void takeIn(requested);
  }, []);

  const finish = () =>
    task.run('finish', async (step) => {
      step('Reading the wallet\'s records');
      const { wallet, report } = await completeTakeover(walletDependencies(session), record);
      session.vault.set('lastRestore', { completeness: report.completeness, unresolved: report.unresolved, at: Math.floor(Date.now() / 1000) });
      session.vault.remove('takeover');
      onDone(wallet);
    });

  const startOver = () => {
    session.vault.remove('takeover');
    window.location.reload();
  };

  const stage = progress?.stage;
  const sent = stage === 'waiting-for-delay' || stage === 'ready';
  return (
    <>
      <Card>
        <h2>Moving your wallet to this device</h2>
        <p class="muted small">
          Wallet <span class="mono">{shorten(record.wallet.identity)}</span>
        </p>
        <ol class="steps">
          <li class={sent ? 'done' : 'current'}>
            <strong>Give this link to your recoverer.</strong>
            <p>It tells them which key this device made. They use it to send the request.</p>
            {!sent && joinLink !== '' && <CopyBox text={joinLink} open openLabel="Open the recoverer's page" />}
          </li>
          <li class={record.requestReceived ? 'done' : sent ? 'current' : 'later'}>
            <strong>Open the second link from your recoverer.</strong>
            <p>After sending the request they give you a link back. Open it on this device, or paste it here.</p>
            {!record.requestReceived && (
              <>
                <Field label="Second link from your recoverer">
                  <TextArea value={requested} onInput={setRequested} placeholder="https://…#requested=…" />
                </Field>
                <Button task={task} name="receive" kind="secondary" onClick={() => void takeIn(requested)} disabled={requested.trim() === ''}>
                  Take it in
                </Button>
              </>
            )}
          </li>
          <li class={stage === 'ready' ? 'done' : stage === 'waiting-for-delay' ? 'current' : 'later'}>
            <strong>Wait for the waiting period.</strong>
            <p>The wallet's current device can cancel during this time. That is what keeps the wallet safe from a recoverer acting alone.</p>
            {progress?.stage === 'waiting-for-delay' && (
              <p class="notice wait">
                {waitText(progress)} Request: <TransactionLink environment={session.environment} transactionId={progress.requestedIn} />
              </p>
            )}
          </li>
          <li class={stage === 'ready' ? 'current' : 'later'}>
            <strong>Open the wallet here.</strong>
            {stage === 'ready' &&
              (record.requestReceived ? (
                <>
                  <p>The wallet now names this device as its owner.</p>
                  <Button task={task} name="finish" onClick={() => void finish()}>
                    Open my wallet
                  </Button>
                </>
              ) : (
                <p class="notice wait">The move is complete. Open the second link from your recoverer (step 2) to finish.</p>
              ))}
          </li>
        </ol>
        <TaskStatus task={task} />
      </Card>
      {progress?.stage === 'not-proceeding' && (
        <Card tone="warn">
          <h2>The move is not going ahead</h2>
          <p>{progress.reason}</p>
          <Button kind="secondary" onClick={startOver}>
            Start over
          </Button>
        </Card>
      )}
      {progress?.stage === 'waiting-for-request' && (
        <p class="small muted">Waiting for your recoverer to send the request. This page checks by itself.</p>
      )}
    </>
  );
};
