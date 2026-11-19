import { hexToBin } from '@bitauth/libauth';
import { type OwnerWallet, finishTakeover, startTakeover } from '@grandmas-wallet/app';
import { makeLink } from '@grandmas-wallet/app/links';
import { Button, Field, Info, More, Spinner, TaskStatus, TextArea, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { followHandOver, handToRecoverer, leaveRecoverer, useHanding } from './hand-to-recoverer.js';
import { ScanCode } from './ScanCode.js';
import { HANDOVER_LINK } from './scan.js';
import { WithScan } from './Scanner.js';
import { type Session, deviceAccount, deviceWords, keep, kept, saveState, sealedContent, sealedOf, seedOf } from './session.js';

/**
 * A new phone takes a wallet over with the recoverer's help (proposal section 11.1, steps 1 and 6): it scans the
 * recoverer's code, makes its own keys and sends its takeover request over the session the code offers. After the
 * waiting period the recoverer completes, and the hand-over reaches the phone over the same session if both pages
 * are open, or by scanning the hand-over's code on the recoverer's screen.
 */
export const Takeover = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: (wallet: OwnerWallet) => void }) => {
  const [asked, setAsked] = useState(() => kept('takeover'));
  const task = useTask();

  const ask = (recipient: Parameters<typeof handToRecoverer>[0]) =>
    task.run('ask', async () => {
      const { sealed, pending } = await startTakeover({ seed: seedOf(session, deviceWords()), stores: session.environment.stores, storeAt: session.storeAt, recovererPublicKey: hexToBin(recipient.publicKey) });
      const link = await makeLink(recipient.page, 'takeover', sealedContent(sealed));
      const made = { pending, recipient, link };
      keep('takeover', made);
      handToRecoverer(recipient, 'takeover', sealed);
      setAsked(made);
    });

  if (asked === undefined) {
    return (
      <>
        <ScanCode title="Scan your helper's code" onBack={onBack} onRead={(recipient) => void ask(recipient)} />
        <TaskStatus task={task} name="ask" />
      </>
    );
  }
  return <Waiting session={session} onDone={onDone} onBack={onBack} onAgain={() => {
    leaveRecoverer();
    keep('takeover', undefined);
    setAsked(undefined);
  }} />;
};

/** After the request: the recoverer asks the network, the waiting period runs, the hand-over comes. */
const Waiting = ({ session, onDone, onBack, onAgain }: { session: Session; onDone: (wallet: OwnerWallet) => void; onBack: () => void; onAgain: () => void }) => {
  const asked = kept('takeover') as NonNullable<ReturnType<typeof kept<'takeover'>>>;
  const handing = useHanding('takeover');
  const [pasted, setPasted] = useState('');
  const task = useTask();
  const name = asked.recipient.name || 'your helper';

  /** Open the wallet with the hand-over. Throws when it cannot be opened. */
  const takeIn = async (sealed: Uint8Array): Promise<void> => {
      const account = await deviceAccount(session);
      const taken = await finishTakeover({ sealedHandOver: sealed, pending: asked.pending, seed: seedOf(session, deviceWords()), backend: account, chain: session.chain, save: saveState });
      keep('arrangement', taken.arrangement);
      keep('recipient', asked.recipient);
      keep('arrival', { from: 'takeover', missing: taken.missing });
      keep('takeover', undefined);
      keep('incoming', undefined);
      // The session is left a moment later: a hand-over that came over it is acknowledged first, so that the page stops sending it.
      setTimeout(() => leaveRecoverer(asked.recipient.session), 3_000);
      onDone(taken.wallet);
  };
  const takeLink = async (text: string) => {
    const sealed = await sealedOf(text, 'handover');
    if (sealed === undefined) throw new Error('This is not the code your helper shows after the waiting period.');
    await takeIn(sealed);
  };

  // The hand-over over the session, when the recoverer's page sends it there; a link the page was opened with likewise.
  useEffect(() => {
    // A request cut off by a reload is sent again: it is the same request to the recoverer's page, which answers it
    // as before. One the page already has is left alone: the recoverer's page may be closed by now.
    if (kept('handing')?.takeover?.status === 'sending') void sealedOf(asked.link, 'takeover').then((sealed) => sealed !== undefined && handToRecoverer(asked.recipient, 'takeover', sealed));
    const incoming = kept('incoming');
    if (incoming?.kind === 'handover') void task.run('link', () => takeLink(incoming.text));
    return followHandOver(asked.recipient, async (sealed) => {
      // The recoverer's page is told only once the wallet is open here; otherwise it sends the hand-over again.
      const opened = await task.run('handover', async () => {
        await takeIn(sealed);
        return true;
      });
      if (opened !== true) throw new Error('The hand-over could not be opened.');
    });
  }, []);

  const failed = handing?.status === 'refused' || handing?.status === 'unreached';
  return (
    <div class="stack set-up" data-testid="takeover-waiting" data-status={handing?.status ?? ''}>
      {/* The way back keeps the request: the recoverer may already have asked the network with it. */}
      <button type="button" class="link" onClick={onBack}>
        ‹ Back
      </button>
      <div class="set-up-head">
        {!failed && (
          <div class="set-up-spinner">
            <Spinner />
          </div>
        )}
        <h1>{failed ? 'Not sent' : handing?.status === 'sending' ? 'Sending…' : `Waiting for ${name}`}</h1>
        {failed ? (
          <p class="set-up-problem">{handing?.reason ?? `${name}'s page did not answer. Keep it open and try again.`}</p>
        ) : (
          <p class="muted">
            Keep this page. You can close it and come back.{' '}
            <Info label="What happens while you wait">
              Your helper asks the network to move your wallet to this phone. Then a waiting period runs, in public, during which your old phone could refuse. Afterwards your helper completes the move and this phone receives the wallet.
            </Info>
          </p>
        )}
      </div>
      {failed && (
        <div class="set-up-actions">
          <Button block onClick={() => void sealedOf(asked.link, 'takeover').then((sealed) => sealed !== undefined && handToRecoverer(asked.recipient, 'takeover', sealed))}>
            Try again
          </Button>
          <Button block kind="quiet" onClick={onAgain}>
            Scan again
          </Button>
        </div>
      )}
      <TaskStatus task={task} />
      <More summary="Scan the code they show after the waiting period">
        <Field label="The code from your helper" id="handover">
          <WithScan filter={HANDOVER_LINK} onScan={(text) => void task.run('link', () => takeLink(text))}>
            <TextArea id="handover" value={pasted} onInput={setPasted} placeholder="https://…#handover=…" />
          </WithScan>
        </Field>
        <Button kind="secondary" task={task} name="link" disabled={pasted.trim() === ''} onClick={() => void task.run('link', () => takeLink(pasted))}>
          Open the wallet
        </Button>
      </More>
    </div>
  );
};
