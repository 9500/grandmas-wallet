import { describeDelay } from '@grandmas-wallet/app';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { Button, Choice, Field, Fingerprint, Notice, Sat, TextArea, formatDuration, formatTime, shorten, useTask } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { joinRecoverer, leaveRecoverer } from './hand-to-recoverer.js';
import { RECOVERER_LINK } from './scan.js';
import { WithScan } from './Scanner.js';
import { type Activity, type StoredRecipient, keep, kept, readRecipientLink, recipientFingerprint } from './session.js';

/** Waiting periods to choose from. Counted in time, by the chain's clock, in steps of 512 seconds. */
export const DELAYS: { delay: ChallengeDelay; hint: string }[] = [
  { delay: { unit: 'time512', value: 1 }, hint: 'For trying the wallet out. Too short to rely on.' },
  { delay: { unit: 'time512', value: 7 }, hint: 'Enough if this phone is nearly always on and online.' },
  { delay: { unit: 'time512', value: 169 }, hint: 'A day to notice and say no.' },
  { delay: { unit: 'time512', value: 1182 }, hint: 'A week. Safer, and a lost phone takes a week to replace.' },
];

export const sameDelay = (a: ChallengeDelay, b: ChallengeDelay): boolean => a.unit === b.unit && a.value === b.value;

export const DelayPicker = ({ value, onChange, name }: { value: ChallengeDelay; onChange: (delay: ChallengeDelay) => void; name: string }) => (
  <div role="radiogroup">
    {DELAYS.map(({ delay, hint }) => (
      <Choice type="radio" name={name} checked={sameDelay(delay, value)} onChange={() => onChange(delay)} title={describeDelay(delay)}>
        {hint}
      </Choice>
    ))}
  </div>
);

/**
 * Taking in a recoverer's link: from the page's address when the page was opened with one, scanned, or pasted.
 * When it came from the code on the recoverer's page, it names a session too, which is joined at once: the
 * recoverer's page then shows that a phone is connected, and what is sealed for it can go there directly.
 */
export const RecipientEntry = ({ onRead, purpose }: { onRead: (recipient: StoredRecipient) => void; purpose: string }) => {
  const [text, setText] = useState('');
  const task = useTask();
  const use = (recipient: StoredRecipient): void => {
    joinRecoverer(recipient);
    onRead(recipient);
  };
  useEffect(() => {
    const incoming = kept('incoming');
    if (incoming?.kind !== 'recoverer') return;
    void task.run('read', async () => {
      const recipient = await readRecipientLink(incoming.text);
      keep('incoming', undefined);
      use(recipient);
    });
  }, []);
  return (
    <div>
      <Field label="Your recoverer's link" id="recipient-link" hint={`Your recoverer's page shows this link under "Your link". Scan its code, open the link on this phone, or paste it here. ${purpose}`} error={task.error?.message}>
        <WithScan filter={RECOVERER_LINK} onScan={setText}>
          <TextArea id="recipient-link" value={text} onInput={setText} placeholder="https://…#recoverer=…" invalid={task.error !== undefined} />
        </WithScan>
      </Field>
      <Button task={task} name="read" disabled={text.trim() === ''} onClick={() => void task.run('read', async () => use(await readRecipientLink(text)))}>
        Use this link
      </Button>
    </div>
  );
};

/** The recoverer's fingerprint, to be compared over another channel before anything is sealed to its key. */
export const RecipientCheck = ({ recipient, matched, onMatched, onClear }: { recipient: StoredRecipient; matched: boolean; onMatched: (matched: boolean) => void; onClear?: () => void }) => (
  <div class="stack-s">
    <p>
      <strong>{recipient.name || 'Your recoverer'}</strong> <span class="muted small">· {new URL(recipient.page).host}</span>
    </p>
    <div class="value">
      <div class="small muted">Fingerprint of their key</div>
      <Fingerprint value={recipientFingerprint(recipient)} />
    </div>
    <p class="small muted">Ask your recoverer to read out the fingerprint their page shows, by phone or in person. If it is different, someone may have changed the link: do not go on.</p>
    <Choice type="checkbox" checked={matched} onChange={onMatched} title="The fingerprints are the same" />
    {onClear !== undefined && (
      <Button
        kind="link"
        onClick={() => {
          leaveRecoverer(recipient.session);
          onClear();
        }}
      >
        Use another link
      </Button>
    )}
  </div>
);

/** What waiting looks like: what is awaited, and that the page may be closed meanwhile. */
export const Waiting = ({ children }: { children: ComponentChildren }) => (
  <Notice tone="wait" busy>
    <div>{children}</div>
    <div class="small muted">You can close this page; it carries on from here when you open it again.</div>
  </Notice>
);

/** When a waiting period ends, in words. */
export const WaitEnds = ({ endsAt, secondsLeft }: { endsAt?: number | undefined; secondsLeft?: number | undefined }) => {
  if (secondsLeft === undefined || secondsLeft <= 0) return <>The waiting period has passed.</>;
  return (
    <>
      It ends in about {formatDuration(secondsLeft)}
      {endsAt !== undefined && <>, when the chain's clock passes {formatTime(endsAt)}</>}. The chain's clock runs a little behind the real one.
    </>
  );
};

/**
 * What this phone sent, newest first. Where the site names a block explorer, each transaction leads to it.
 */
export const ActivityList = ({ items, limit, explorer }: { items: Activity[]; limit?: number; explorer?: string }) => {
  const shown = items.slice(0, limit ?? items.length);
  if (shown.length === 0) return <p class="empty">Nothing sent from this phone yet.</p>;
  return (
    <ul class="list">
      {shown.map((item) => (
        <li class="list-item">
          <div>
            <div>{item.what}</div>
            <div class="small muted">
              {formatTime(item.at)} ·{' '}
              {explorer === undefined || explorer === '' ? (
                <span class="mono nowrap">{shorten(item.transactionId, 6, 4)}</span>
              ) : (
                <a class="mono nowrap" href={`${explorer}${item.transactionId}`} target="_blank" rel="noopener noreferrer" title="See this transaction in a block explorer">
                  {shorten(item.transactionId, 6, 4)}
                </a>
              )}
            </div>
          </div>
          <div class="small muted nowrap" title={`${item.bytes} bytes`}>
            fee <Sat satoshis={BigInt(item.fee)} />
          </div>
        </li>
      ))}
    </ul>
  );
};
