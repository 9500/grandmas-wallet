import { useState } from 'preact/hooks';

import { Button, Card, Choice, Notice, download, formatTime, shorten, useTask } from './components.js';

/**
 * Developer mode: the XO invitation behind each transaction this page sent, to be saved as a file.
 *
 * The page keeps a line for each transaction it sent, with the engine's handle to the invitation; the
 * invitation itself stays with the engine and is read when it is asked for. A file holds the invitation as
 * participants share it, in the engine's own serialization, and no key.
 */
export interface KeptInvitation {
  transactionId: string;
  invitationIdentifier: string;
  templateName: string;
  action: string;
  /** When it was sent, in seconds. */
  at: number;
}

const MOST = 200;

/** The page's list with one more transaction, newest first. */
export const withInvitation = (list: KeptInvitation[] | undefined, sent: Omit<KeptInvitation, 'at'>): KeptInvitation[] =>
  [
    { transactionId: sent.transactionId, invitationIdentifier: sent.invitationIdentifier, templateName: sent.templateName, action: sent.action, at: Math.floor(Date.now() / 1000) },
    ...(list ?? []).filter((entry) => entry.transactionId !== sent.transactionId),
  ].slice(0, MOST);

export const invitationFileName = (entry: { action: string; transactionId: string }): string => `invitation-${entry.action.replace(/[^a-z0-9]+/gi, '-')}-${entry.transactionId.slice(0, 8)}.json`;

export const Developer = ({
  on,
  onChange,
  invitations,
  read,
  device,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  invitations: KeptInvitation[];
  /** The invitation as text, from the engine open in this page. */
  read: (invitationIdentifier: string) => Promise<string | undefined>;
  /** What the page calls itself: "phone" in the wallet, "page" in the recoverer. */
  device: string;
}) => {
  const task = useTask();
  const [saved, setSaved] = useState<string | undefined>();
  return (
    <Card title="For developers">
      <div class="stack">
      <Choice type="checkbox" checked={on} onChange={onChange} title="Developer mode">
        Lists the XO invitation behind each transaction this {device} sent, to save as a file.
      </Choice>
      {on &&
        (invitations.length === 0 ? (
          <p class="empty">Nothing sent from this {device} yet.</p>
        ) : (
          <ul class="list" data-testid="invitations">
            {invitations.map((entry) => (
              <li class="list-item">
                <div>
                  <div>
                    <span class="mono">{entry.action}</span> <span class="small muted">· {entry.templateName}</span>
                  </div>
                  <div class="small muted">
                    {formatTime(entry.at)} · <span class="mono nowrap">{shorten(entry.transactionId, 6, 4)}</span>
                    {saved === entry.transactionId && <> · saved as {invitationFileName(entry)}</>}
                  </div>
                </div>
                <Button
                  small
                  kind="secondary"
                  task={task}
                  name={entry.transactionId}
                  onClick={() =>
                    void task.run(entry.transactionId, async () => {
                      const text = await read(entry.invitationIdentifier);
                      if (text === undefined) throw new Error('This invitation is no longer kept in this browser.');
                      download(invitationFileName(entry), `${text}\n`);
                      setSaved(entry.transactionId);
                    })
                  }
                >
                  Save
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {task.error !== undefined && <Notice tone="bad">{task.error.message}</Notice>}
      </div>
    </Card>
  );
};
