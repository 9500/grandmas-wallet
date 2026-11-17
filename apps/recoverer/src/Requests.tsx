import { hexToBin } from '@bitauth/libauth';
import { acceptTakeover } from '@grandmas-wallet/app';
import { Button, Card, Choice, Fingerprint, PageHead, TaskStatus, formatTime, shorten, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type InboxEntry, type Session, keep, kept, openWalletPage, saveWallet, wallets } from './session.js';

/**
 * Takeover requests (proposal section 11.1, steps 1 and 2). A request does not name the wallet it is for:
 * the recoverer chooses it, after making sure who is asking and comparing the fingerprint.
 */
export const Requests = ({ session, onChanged, toast }: { session: Session; onChanged: () => void; toast: (text: string) => void }) => {
  const inbox = kept('inbox') ?? [];
  const open = inbox.filter((entry) => entry.assignedTo === undefined);
  const done = inbox.filter((entry) => entry.assignedTo !== undefined);
  return (
    <div class="stack">
      <PageHead title="Takeover requests">When someone loses their phone, their new phone sends you a request as a link. Open it on this page and it appears here.</PageHead>
      {open.length === 0 ? (
        <Card>
          <p class="empty">No request is waiting.</p>
        </Card>
      ) : (
        open.map((entry) => <Assign session={session} entry={entry} onChanged={onChanged} toast={toast} />)
      )}
      {done.length > 0 && (
        <Card title="Requests you have assigned">
          <ul class="list">
            {done.map((entry) => {
              const looked = entry.assignedTo === undefined ? undefined : wallets()[entry.assignedTo];
              return (
                <li class="list-item">
                  <div>
                    <div class="mono">{entry.fingerprint}</div>
                    <div class="small muted">
                      {formatTime(entry.receivedAt)} · for {looked?.label || shorten(entry.assignedTo ?? '', 6, 4)}
                    </div>
                  </div>
                  <Button small kind="secondary" onClick={() => openWalletPage(entry.assignedTo)}>
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
};

const Assign = ({ session, entry, onChanged, toast }: { session: Session; entry: InboxEntry; onChanged: () => void; toast: (text: string) => void }) => {
  const all = Object.entries(wallets()).filter(([, looked]) => looked.asNewRecoverer !== true || looked.kept.pending === undefined);
  const [choice, setChoice] = useState<string | undefined>(all.length === 1 ? all[0]?.[0] : undefined);
  const [sure, setSure] = useState(false);
  const task = useTask();
  const assign = () =>
    task.run('assign', async () => {
      const looked = choice === undefined ? undefined : wallets()[choice];
      if (looked === undefined || choice === undefined) return;
      const taken = await acceptTakeover({ sealed: hexToBin(entry.sealed), privateKey: session.privateKey, kept: looked.kept, chain: session.chain });
      saveWallet(choice, { ...looked, kept: taken.kept });
      keep('inbox', (kept('inbox') ?? []).map((other) => (other.messageHash === entry.messageHash ? { ...other, assignedTo: choice } : other)));
      toast(`The request is saved for ${looked.label || 'that wallet'}.`);
      openWalletPage(choice);
      onChanged();
    });
  return (
    <Card title="A request to take over a wallet">
      <div class="stack">
        <div class="value">
          <div class="small muted">Fingerprint of the new phone's key</div>
          <Fingerprint value={entry.fingerprint} />
          <div class="small muted">Received {formatTime(entry.receivedAt)}</div>
        </div>
        <div>
          <p class="field-label">Which wallet is it for?</p>
          {all.length === 0 ? (
            <p class="muted">You look after no wallet yet.</p>
          ) : (
            all.map(([identity, looked]) => (
              <Choice type="radio" name={`for-${entry.messageHash}`} checked={choice === identity} onChange={() => setChoice(identity)} title={looked.label || 'Unnamed wallet'}>
                {shorten(identity, 10, 6)}
              </Choice>
            ))
          )}
        </div>
        <Choice type="checkbox" checked={sure} onChange={setSure} title="I have made sure who is asking">
          I spoke with the wallet's owner, in person or by a call I trust, and their new phone shows this same fingerprint. If you are not sure, do nothing: a request you make can move the wallet to whoever sent this.
        </Choice>
        <TaskStatus task={task} name="assign" />
        <div class="actions">
          <Button task={task} name="assign" disabled={choice === undefined || !sure} onClick={() => void assign()}>
            Save it for this wallet
          </Button>
          <Button
            kind="quiet"
            onClick={() => {
              keep('inbox', (kept('inbox') ?? []).filter((other) => other.messageHash !== entry.messageHash));
              onChanged();
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
};
