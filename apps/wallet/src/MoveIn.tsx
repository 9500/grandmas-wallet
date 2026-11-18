import { type DirectHandOver, type OwnerWallet, finishMove, prepareNewSeed } from '@grandmas-wallet/app';
import { makeLink, readLink } from '@grandmas-wallet/app/links';
import { Button, Card, Field, Fingerprint, HandOff, PageHead, type Step, Steps, TaskStatus, TextArea, useEvery, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { Waiting } from './parts.js';
import { MOVE_LINK } from './scan.js';
import { WithScan } from './Scanner.js';
import { type Session, type StoredRecipient, deviceAccount, deviceWords, keep, kept, saveState, seedOf } from './session.js';

/** What the old phone gives the new one: the direct hand-over (section 9.7, step 2) and who the recoverer is. */
export type MoveContent = DirectHandOver & { recipient?: StoredRecipient };

export const readMoveLink = async (text: string): Promise<MoveContent> => {
  const read = await readLink<MoveContent>(text, 'move');
  if (read === undefined || typeof read.identity !== 'string' || !Array.isArray(read.viewingKeyRecords)) throw new Error('This is not the link your old phone shows for the move. It contains "#move=".');
  return read;
};

/**
 * The new phone's side of a move with the old phone still working (proposal section 9.7): it makes its seed
 * and a new archive, gives the old phone a link, takes the old phone's hand-over, and becomes the owner as
 * soon as the network has the change that names its key, in a block or not. It gives out no address before.
 */
export const MoveIn = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: (wallet: OwnerWallet) => void }) => {
  const [prepared, setPrepared] = useState(() => kept('preparation'));
  const [given, setGiven] = useState(() => kept('moveIn') as MoveContent | undefined);
  const [pasted, setPasted] = useState('');
  const task = useTask();

  const prepare = () =>
    task.run('prepare', async (progress) => {
      progress('Making this phone\'s keys and writing its viewing key to the backup stores');
      const preparation = await prepareNewSeed({ seed: seedOf(session, deviceWords()), stores: session.environment.stores, storeAt: session.storeAt });
      const link = await makeLink(session.environment.walletUrl, 'prepare', preparation);
      const made = { preparation, link };
      keep('preparation', made);
      setPrepared(made);
    });

  const takeIn = (text: string) =>
    task.run('move', async () => {
      const content = await readMoveLink(text);
      keep('moveIn', content);
      keep('incoming', undefined);
      setGiven(content);
    });

  useEffect(() => {
    const incoming = kept('incoming');
    if (prepared !== undefined && given === undefined && incoming?.kind === 'move') void takeIn(incoming.text);
  }, [prepared]);

  // Once the old phone has handed over, this phone goes on as soon as the chain names its key.
  useEvery(
    10_000,
    async () => {
      if (prepared === undefined || given === undefined || task.busy !== undefined) return;
      await task.run('finish', async () => {
        try {
          const account = await deviceAccount(session);
          const { recipient, ...handOver } = given;
          const moved = await finishMove({ handOver, preparation: prepared.preparation, seed: seedOf(session, deviceWords()), backend: account, chain: session.chain, storeAt: session.storeAt, save: saveState });
          keep('arrangement', moved.arrangement);
          if (recipient !== undefined) keep('recipient', recipient);
          keep('arrival', { from: 'move', missing: moved.missing });
          keep('preparation', undefined);
          keep('moveIn', undefined);
          onDone(moved.wallet);
        } catch (error) {
          const message = (error as Error).message;
          if (/not made the change yet/.test(message)) return;
          throw error;
        }
      });
    },
    [prepared, given],
  );

  if (prepared === undefined) {
    return (
      <div class="stack">
        <PageHead title="Move from your other phone">Your old phone hands the wallet to this one at once, without a waiting period. Your recoverer is told first, so that recovery stays on.</PageHead>
        <Card title="What happens">
          <ol>
            <li>This phone makes its own keys and shows a link.</li>
            <li>You open that link on your old phone. It shows you two links: one for your recoverer and one for this phone.</li>
            <li>Once your recoverer has taken theirs in, the old phone hands the wallet over, and this phone moves the coins to its own addresses.</li>
          </ol>
          <TaskStatus task={task} name="prepare" />
          <div class="actions">
            <Button task={task} name="prepare" onClick={() => void prepare()}>
              Start
            </Button>
            <Button kind="quiet" onClick={onBack}>
              Back
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const steps: Step[] = [
    {
      title: 'Open this link on your old phone',
      state: given === undefined ? 'current' : 'done',
      detail:
        given === undefined ? (
          <div class="stack-s">
            <HandOff text={prepared.link} qrLabel="QR code of the link for your old phone" copyLabel="Copy link" testId="prepare-link" />
            <p class="small muted">Your old phone shows this fingerprint for this phone's key. Check that it is the same:</p>
            <Fingerprint value={prepared.preparation.fingerprint} />
          </div>
        ) : undefined,
    },
    {
      title: 'Open the link your old phone shows for this phone',
      state: given === undefined ? 'later' : 'done',
      detail:
        given === undefined ? (
          <div class="stack-s">
            <Field label="The link from your old phone" id="move" hint={'It contains "#move=". Whoever has it can see what the wallet holds, so send it only to yourself.'}>
              <WithScan filter={MOVE_LINK} onScan={setPasted}>
                <TextArea id="move" value={pasted} onInput={setPasted} placeholder="https://…#move=…" />
              </WithScan>
            </Field>
            <TaskStatus task={task} name="move" />
            <div>
              <Button task={task} name="move" disabled={pasted.trim() === ''} onClick={() => void takeIn(pasted)}>
                Use this link
              </Button>
            </div>
          </div>
        ) : undefined,
    },
    {
      title: 'Your old phone hands the wallet over',
      state: given === undefined ? 'later' : 'current',
      detail:
        given === undefined ? (
          'It does so once your recoverer has taken in the link it sends them.'
        ) : (
          <>
            <Waiting>Waiting for your old phone. It hands the wallet over as soon as your recoverer has taken in the link it was sent.</Waiting>
            <TaskStatus task={task} name="finish" />
          </>
        ),
    },
  ];
  return (
    <div class="stack">
      <PageHead title="Move from your other phone">This phone has its own keys now. Keep this page; you can close it and come back.</PageHead>
      <Card>
        <Steps steps={steps} />
      </Card>
    </div>
  );
};
