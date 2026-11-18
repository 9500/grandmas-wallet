import { hexToBin } from '@bitauth/libauth';
import { type OwnerWallet, finishTakeover, startTakeover } from '@grandmas-wallet/app';
import { makeLink } from '@grandmas-wallet/app/links';
import { Button, Card, Field, Fingerprint, HandOff, PageHead, type Step, Steps, TaskStatus, TextArea, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { RecipientCheck, RecipientEntry } from './parts.js';
import { HANDOVER_LINK } from './scan.js';
import { WithScan } from './Scanner.js';
import { type Session, type StoredRecipient, deviceAccount, deviceWords, keep, kept, recipientFingerprint, saveState, sealedContent, sealedOf, seedOf } from './session.js';

/**
 * A new device takes a wallet over with the recoverer's help (proposal section 11.1, steps 1 and 6): it makes
 * its own seed, sends the recoverer a sealed takeover message, and after the waiting period opens the
 * recoverer's hand-over.
 */
export const Takeover = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: (wallet: OwnerWallet) => void }) => {
  const [asked, setAsked] = useState(() => kept('takeover'));
  const [recipient, setRecipient] = useState<StoredRecipient | undefined>();
  const [matched, setMatched] = useState(false);
  const [pasted, setPasted] = useState('');
  const task = useTask();

  const ask = () =>
    task.run('ask', async (progress) => {
      if (recipient === undefined) return;
      progress('Writing this phone\'s viewing key to the backup stores');
      const { sealed, pending } = await startTakeover({ seed: seedOf(session, deviceWords()), stores: session.environment.stores, storeAt: session.storeAt, recovererPublicKey: hexToBin(recipient.publicKey) });
      const link = await makeLink(recipient.page, 'takeover', sealedContent(sealed));
      const made = { pending, recipient, link };
      keep('takeover', made);
      setAsked(made);
    });

  const takeIn = (text: string) =>
    task.run('handover', async (progress) => {
      if (asked === undefined) return;
      const sealed = await sealedOf(text, 'handover');
      if (sealed === undefined) throw new Error('This is not the link your recoverer sends after the waiting period. It contains "#handover=".');
      progress('Opening this phone\'s keys and checking the wallet\'s history on the chain');
      const account = await deviceAccount(session);
      const taken = await finishTakeover({ sealedHandOver: sealed, pending: asked.pending, seed: seedOf(session, deviceWords()), backend: account, chain: session.chain, save: saveState });
      keep('arrangement', taken.arrangement);
      keep('recipient', asked.recipient);
      keep('arrival', { from: 'takeover', missing: taken.missing });
      keep('takeover', undefined);
      keep('incoming', undefined);
      onDone(taken.wallet);
    });

  useEffect(() => {
    const incoming = kept('incoming');
    if (asked !== undefined && incoming?.kind === 'handover') void takeIn(incoming.text);
  }, [asked]);

  if (asked === undefined) {
    return (
      <div class="stack">
        <PageHead title="Take over your wallet">Your recoverer can move your wallet to this phone. It takes the waiting period you chose, and your old phone, if anyone has it, can refuse in that time.</PageHead>
        <Card title="Who is your recoverer?">
          {recipient === undefined ? (
            <RecipientEntry onRead={setRecipient} purpose="Ask them for it: by message, or by showing its QR code." />
          ) : (
            <RecipientCheck recipient={recipient} matched={matched} onMatched={setMatched} onClear={() => setRecipient(undefined)} />
          )}
          <TaskStatus task={task} name="ask" />
          <div class="actions">
            <Button task={task} name="ask" disabled={recipient === undefined || !matched} onClick={() => void ask()}>
              Make my request
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
      title: `Send this link to ${asked.recipient.name || 'your recoverer'}`,
      state: 'current',
      detail: (
        <div class="stack-s">
          <p>It is sealed: only your recoverer can open it. It does not say which wallet is yours; your recoverer decides that.</p>
          <HandOff text={asked.link} qrLabel="QR code of the request for your recoverer" copyLabel="Copy link" testId="takeover-link" />
        </div>
      ),
    },
    {
      title: 'Read them this fingerprint',
      state: 'current',
      detail: (
        <div class="stack-s">
          <Fingerprint value={asked.pending.fingerprint} />
          <p class="small muted">It is the fingerprint of this phone's new key. Your recoverer's page shows the same one for your request. They should not go on unless it matches and they are sure it is you.</p>
        </div>
      ),
    },
    { title: 'Your recoverer asks the network', state: 'later', detail: 'Then the waiting period runs. Everyone can see the request, and your old phone could refuse it.' },
    {
      title: 'Open the link your recoverer sends back',
      state: 'later',
      detail: (
        <div class="stack-s">
          <p>After the waiting period your recoverer completes the move and sends you a link. Open it on this phone, scan its code, or paste it here.</p>
          <Field label="The link from your recoverer" id="handover">
            <WithScan filter={HANDOVER_LINK} onScan={setPasted}>
              <TextArea id="handover" value={pasted} onInput={setPasted} placeholder="https://…#handover=…" />
            </WithScan>
          </Field>
          <TaskStatus task={task} name="handover" />
          <div>
            <Button task={task} name="handover" disabled={pasted.trim() === ''} onClick={() => void takeIn(pasted)}>
              Open the wallet
            </Button>
          </div>
        </div>
      ),
    },
  ];
  return (
    <div class="stack">
      <PageHead title="Take over your wallet">Your request is ready. Keep this page: its key is the one your wallet moves to. You can close it and come back.</PageHead>
      <Card>
        <Steps steps={steps} />
      </Card>
      <p class="small muted">
        Recoverer: {asked.recipient.name || 'unnamed'} · fingerprint {recipientFingerprint(asked.recipient)}
      </p>
    </div>
  );
};
