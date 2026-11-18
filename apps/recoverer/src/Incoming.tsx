import { binToHex } from '@bitauth/libauth';
import { acceptEnrollment, acceptUpdate, describeDelay } from '@grandmas-wallet/app';
import { EnrollmentError, keyFingerprint, openPackage, readTakeover, readUpdate, recoveryKeyOf } from '@grandmas-wallet/enrollment';
import { Button, Card, Field, Notice, TaskStatus, TextInput, plainError, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { answerIncoming } from './offered-session.js';
import { type Session, keep, kept, saveWallet, sealedOf, wallets } from './session.js';

type Outcome =
  | { kind: 'enroll'; stage: 'ask' | 'new recoverer'; reason?: string }
  | { kind: 'enrolled'; label: string; identity: string; asNewRecoverer: boolean }
  | { kind: 'takeover'; fingerprint: string; fresh: boolean }
  | { kind: 'update'; label: string; what: string };

/**
 * A link the page was opened with: a recovery kit (`enroll`), a takeover request (`takeover`) or an update
 * from an owner (`update`). Each is dealt with here and the result shown above the page. A kit or a request
 * that arrived over the session the page's code offers is put into the same link and dealt with in the same
 * way; the wallet that sent it is told what became of it.
 */
export const Incoming = ({ session, onChanged, toast, onShowRequests }: { session: Session; onChanged: () => void; toast: (text: string) => void; onShowRequests: () => void }) => {
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const [label, setLabel] = useState('');
  const task = useTask();
  const incoming = kept('incoming');

  useEffect(() => {
    if (incoming === undefined) return;
    if (incoming.kind === 'enroll') setOutcome({ kind: 'enroll', stage: 'ask' });
    else if (incoming.kind === 'takeover') {
      void task.run('takeover', () =>
        takeTakeover(incoming.text).then(
          () => answerIncoming('kept'),
          (error: unknown) => {
            answerIncoming('refused', plainError(error));
            throw error;
          },
        ),
      );
    }
    else if (incoming.kind === 'update') void task.run('update', () => takeUpdate(incoming.text));
  }, []);

  const takeTakeover = async (text: string) => {
    const sealed = await sealedOf(text, 'takeover');
    const read = readTakeover(await openPackage(sealed, session.privateKey), session.network);
    const inbox = kept('inbox') ?? [];
    const fresh = !inbox.some((entry) => entry.messageHash === read.hash);
    if (fresh) {
      keep('inbox', [
        { sealed: binToHex(sealed), messageHash: read.hash, proposedKeyHash: read.takeover.proposedKeyHash, fingerprint: keyFingerprint(read.takeover.proposedKeyHash), receivedAt: Math.floor(Date.now() / 1000) },
        ...inbox,
      ]);
    }
    keep('incoming', undefined);
    setOutcome({ kind: 'takeover', fingerprint: keyFingerprint(read.takeover.proposedKeyHash), fresh });
    onChanged();
  };

  const takeUpdate = async (text: string) => {
    const sealed = await sealedOf(text, 'update');
    const read = readUpdate(await openPackage(sealed, session.privateKey), session.network);
    const looked = wallets()[read.update.identity];
    if (looked === undefined) throw new Error('This update is for a wallet you do not look after. Ask its owner to send you a recovery kit first.');
    const recoveryKey = recoveryKeyOf(looked.kept.kit);
    await acceptUpdate({ sealed, privateKey: session.privateKey, kept: looked.kept, chain: session.chain, recoveryKey, storeAt: session.storeAt, save: (next) => saveWallet(read.update.identity, { ...looked, kept: next }) });
    keep('incoming', undefined);
    const what =
      read.update.newSeed !== undefined
        ? `The owner is moving the wallet to a new phone, with key ${keyFingerprint(read.update.newSeed.proposedKeyHash)}. You now hold that phone's viewing key, so recovery stays on after the move.`
        : read.update.challengeDelay !== undefined
          ? `The owner is changing the waiting period to ${describeDelay(read.update.challengeDelay)}.`
          : 'The owner sent an update.';
    setOutcome({ kind: 'update', label: looked.label || 'A wallet', what });
    onChanged();
  };

  const enroll = (asNewRecoverer: boolean) =>
    task.run('enroll', async (progress) => {
      if (incoming === undefined) return;
      progress('Opening the kit and checking it against the chain');
      let identity = '';
      const name = label.trim();
      try {
        await acceptEnrollment({
          link: incoming.text,
          privateKey: session.privateKey,
          chain: session.chain,
          network: session.network,
          storeAt: session.storeAt,
          ...(asNewRecoverer ? { forNewRecoverer: true } : {}),
          // The kit is kept before the receipt is left: a receipt says that the kit is held.
          save: (next) => {
            identity = next.kit.identity;
            const before = wallets()[identity];
            saveWallet(identity, { ...(before ?? {}), kept: next, label: name || before?.label || '', addedAt: before?.addedAt ?? Math.floor(Date.now() / 1000), ...(asNewRecoverer ? { asNewRecoverer: true } : {}) });
          },
        });
        keep('incoming', undefined);
        answerIncoming('kept');
        setOutcome({ kind: 'enrolled', label: name, identity, asNewRecoverer });
        toast('The kit is kept and your receipt is on the backup stores.');
        onChanged();
      } catch (error) {
        if (!asNewRecoverer && error instanceof EnrollmentError && /not the recoverer the controller names/.test(error.message)) {
          setOutcome({ kind: 'enroll', stage: 'new recoverer', reason: error.message });
          return;
        }
        answerIncoming('refused', plainError(error));
        throw error;
      }
    });

  if (outcome === undefined && task.error === undefined && task.busy === undefined) return null;
  if (task.busy !== undefined && outcome?.kind !== 'enroll') return <Notice busy tone="wait">Reading the link…</Notice>;
  if (outcome === undefined) {
    return (
      <div class="stack">
        <Card title="The link could not be used" tone="bad">
          <TaskStatus task={task} />
          <div class="actions">
            <Button kind="quiet" onClick={() => { keep('incoming', undefined); window.location.reload(); }}>
              Dismiss
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  const dismiss = (
    <Button kind="quiet" small onClick={() => setOutcome(undefined)}>
      Close
    </Button>
  );
  return (
    <div class="incoming">
      {outcome.kind === 'enroll' && (
        <Card title={outcome.stage === 'ask' ? 'A recovery kit has arrived' : 'This kit is for a new recoverer'} tone={outcome.stage === 'ask' ? undefined : 'warn'}>
          {outcome.stage === 'ask' ? (
            <p>Someone has asked you to be the recoverer of their wallet. The page checks the kit against the chain, keeps it in this browser and leaves a signed receipt for their wallet to find.</p>
          ) : (
            <p>The wallet does not name you as its recoverer yet: its owner is replacing their recoverer with you. Take the kit in as the new recoverer; the owner's wallet makes the change once it finds your receipt. Until then you are not its recoverer and cannot act for it.</p>
          )}
          <Field label="Whose wallet is this?" id="label" hint="Your own name for it, so that you can tell wallets apart. Only you see it.">
            <TextInput id="label" value={label} onInput={setLabel} placeholder="For example: Grandma" />
          </Field>
          <TaskStatus task={task} name="enroll" />
          <div class="actions">
            <Button task={task} name="enroll" onClick={() => void enroll(outcome.stage === 'new recoverer')}>
              {outcome.stage === 'ask' ? 'Check and keep the kit' : 'Keep it as the new recoverer'}
            </Button>
            <Button kind="quiet" onClick={() => { keep('incoming', undefined); answerIncoming('refused', 'The recoverer did not take it in now.'); setOutcome(undefined); }}>
              Not now
            </Button>
          </div>
          <p class="small muted">The kit lets you see what the wallet holds. It never lets you spend from it.</p>
        </Card>
      )}
      {outcome.kind === 'enrolled' && (
        <Card title={`You look after ${outcome.label || 'this wallet'} now`} tone="good" aside={dismiss}>
          <p>
            {outcome.asNewRecoverer
              ? 'Your receipt is prepared. As soon as the owner\'s wallet makes the change, you are its recoverer.'
              : 'Your receipt is on the backup stores; the owner\'s wallet shows that recovery is on as soon as it finds it.'}
          </p>
        </Card>
      )}
      {outcome.kind === 'takeover' && (
        <Card title="A takeover request has arrived" aside={dismiss}>
          <p>
            Someone asks you to move a wallet to a new phone with key <strong class="mono">{outcome.fingerprint}</strong>.{outcome.fresh ? '' : ' You had received this request before.'} The request does not say which wallet: you decide that, after making sure who is asking.
          </p>
          <div class="actions">
            <Button onClick={onShowRequests}>See the request</Button>
          </div>
        </Card>
      )}
      {outcome.kind === 'update' && (
        <Card title={`${outcome.label}: update taken in`} tone="good" aside={dismiss}>
          <p>{outcome.what}</p>
          <p class="small muted">Your prepared receipt is on the backup stores. The owner's phone makes the change when it finds it.</p>
        </Card>
      )}
    </div>
  );
};
