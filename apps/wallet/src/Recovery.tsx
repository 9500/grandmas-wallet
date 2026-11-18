import { generateBip39Mnemonic } from '@bitauth/libauth';
import { type NewSeedPreparation, describeDelay, enroll, makeUserBackup, sendUpdate, userBackupText } from '@grandmas-wallet/app';
import { makeLink, readLink } from '@grandmas-wallet/app/links';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { sealedOfLink } from '@grandmas-wallet/app/hand-off';
import { Button, Card, Choice, Field, Fingerprint, HandOff, Info, KeyValues, LinkRow, Notice, PageHead, Segmented, TaskStatus, TextArea, CopyButton, download, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import type { Owner } from './OwnerApp.js';
import { DELAYS, DelayPicker, RecipientCheck, RecipientEntry, Waiting, sameDelay } from './parts.js';
import { ProtectionStatus } from './Protection.js';
import { type StoredRecipient, deviceWords, keep, kept, recipientFingerprint, recipientOf, sealedContent } from './session.js';
import { handToRecoverer } from './hand-to-recoverer.js';
import { PREPARE_LINK } from './scan.js';
import { WithScan } from './Scanner.js';
import { SealedHandOff } from './SealedHandOff.js';

type View = 'main' | 'move' | 'recoverer' | 'delay' | 'backup';

/** Recovery and everything rarer: the recoverer, the waiting period, a new phone, the user's own backup. */
export const Recovery = ({ owner }: { owner: Owner }) => {
  const [auto, setAutoState] = useState(() => kept('autoCancel') === true);
  const setAuto = (value: boolean) => {
    keep('autoCancel', value);
    setAutoState(value);
  };
  const [view, setView] = useState<View>(() => (kept('incoming')?.kind === 'prepare' || kept('moveOut') !== undefined ? 'move' : kept('incoming')?.kind === 'recoverer' ? 'recoverer' : 'main'));
  const back = () => setView('main');
  if (view === 'move') return <MoveOut owner={owner} onBack={back} />;
  if (view === 'recoverer') return <NewRecoverer owner={owner} onBack={back} />;
  if (view === 'delay') return <NewDelay owner={owner} onBack={back} />;
  if (view === 'backup') return <Backup owner={owner} onBack={back} />;
  const recipient = kept('recipient');
  const history = owner.watch.history;
  const announced = kept('arrangement')?.change;
  // A change that has been made is in effect; it is only followed until a block holds it.
  const pending = announced?.made === undefined ? announced : undefined;
  return (
    <div class="stack">
      <PageHead title="Recovery" />
      <div class="grid two">
        <div class="stack">
          <Card>
            <ProtectionStatus owner={owner} />
            <div class="actions" />
            <KeyValues
              entries={[
                ['Recoverer', recipient === undefined ? <span class="muted">not known on this phone</span> : <span>{recipient.name || 'unnamed'} <span class="muted small mono">{recipientFingerprint(recipient)}</span></span>],
                ['Waiting period', history === undefined ? '…' : describeDelay(history.current.state.challengeDelay)],
                ['Watching', 'While this page is open'],
              ]}
            />
            <p class="small muted">This page checks the wallet every 15 seconds while it is open. A phone with the page closed, or switched off, does not watch; keep it open, or open it at least once within every waiting period.</p>
          </Card>
          {pending !== undefined && (
            <Card title={pending.kind === 'new seed' ? 'Moving to a new phone' : pending.kind === 'new recoverer' ? 'Changing your recoverer' : 'Changing the waiting period'} tone="warn">
              <ChangeState owner={owner} />
              <div class="actions">
                <Button kind="secondary" onClick={() => setView(pending.kind === 'new seed' ? 'move' : pending.kind === 'new recoverer' ? 'recoverer' : 'delay')}>
                  Show the links again
                </Button>
              </div>
            </Card>
          )}
          <Card>
            <Choice type="checkbox" checked={auto} onChange={(value) => { setAuto(value); owner.toast(value ? 'Requests are refused without asking while this page is open.' : 'You are asked before a request is refused.'); }} title="Refuse requests without asking">
              While this page is open, a request to a key this phone does not hold is refused at once. Takes effect when the page is opened again.
            </Choice>
          </Card>
        </div>
        <div class="stack">
          <Card title="Changes">
            <LinkRow label="Move to a new phone" hint="Your old phone hands the wallet over, with no waiting period." onClick={() => setView('move')} />
            <LinkRow label="Change your recoverer" hint="Another person, or the same with a new key." onClick={() => setView('recoverer')} />
            <LinkRow label="Change the waiting period" hint={history === undefined ? undefined : `Now ${describeDelay(history.current.state.challengeDelay)}.`} onClick={() => setView('delay')} />
            <LinkRow label="Your own backup" hint="Twelve words and the wallet's identity, kept by you." onClick={() => setView('backup')} />
            <LinkRow label="Technical details" hint="Identity, keys, servers. Erase this phone." onClick={() => owner.navigate('details')} />
          </Card>
        </div>
      </div>
    </div>
  );
};

/** Where an announced change stands: waiting for the recoverer's prepared receipt, or a problem. */
const ChangeState = ({ owner }: { owner: Owner }) => {
  const { change } = owner;
  if (change.problem !== undefined) return <Notice tone="bad">{change.problem}</Notice>;
  return (
    <Waiting>
      Waiting for your recoverer's receipt for this change. As soon as it is on the backup stores, this phone makes the change; keep the page open or come back to it.
    </Waiting>
  );
};

const Back = ({ onBack }: { onBack: () => void }) => (
  <div>
    <button type="button" class="link" onClick={onBack}>
      ‹ Recovery
    </button>
  </div>
);

const noRecipient = 'This phone does not know your recoverer\'s key, so it cannot send them anything. Change your recoverer (it can be the same person) to set this up again.';

/** The old phone's side of a move to a new seed (section 9.7): announce to the recoverer, hand over directly, then make the change. */
const MoveOut = ({ owner, onBack }: { owner: Owner; onBack: () => void }) => {
  const [moveOut, setMoveOut] = useState(() => kept('moveOut'));
  const [preparation, setPreparation] = useState<NewSeedPreparation | undefined>();
  const [matched, setMatched] = useState(false);
  const [pasted, setPasted] = useState('');
  const task = useTask();
  const readPreparation = (text: string) =>
    task.run('read', async () => {
      const read = await readLink<NewSeedPreparation>(text, 'prepare');
      if (read === undefined || typeof read.proposedKeyHash !== 'string') throw new Error('This is not the link the new phone shows. It contains "#prepare=".');
      keep('incoming', undefined);
      setPreparation(read);
    });
  useEffect(() => {
    const incoming = kept('incoming');
    if (moveOut === undefined && incoming?.kind === 'prepare') void readPreparation(incoming.text);
  }, []);
  const handOver = () =>
    task.run('hand', async (progress) => {
      const recipient = kept('recipient');
      const arrangement = kept('arrangement');
      if (recipient === undefined || arrangement === undefined || preparation === undefined) throw new Error(noRecipient);
      progress('Sealing the update for your recoverer');
      const sent = await sendUpdate({ wallet: owner.wallet, seed: owner.seed, chain: owner.session.chain, arrangement, recipient: recipientOf(recipient), newSeed: preparation });
      if (sent.handOver === undefined) throw new Error('The move made no hand-over for the new phone.');
      const made = {
        updateLink: await makeLink(recipient.page, 'update', sealedContent(sent.sealed)),
        moveLink: await makeLink(owner.session.environment.walletUrl, 'move', { ...sent.handOver, recipient }),
        fingerprint: preparation.fingerprint,
      };
      keep('arrangement', sent.arrangement);
      keep('moveOut', made);
      setMoveOut(made);
    });

  if (moveOut !== undefined) {
    const name = kept('recipient')?.name || 'your recoverer';
    return (
      <div class="stack">
        <Back onBack={onBack} />
        <PageHead title="Move to a new phone">Two links: one for your recoverer, one for your new phone. Then this phone hands the wallet over.</PageHead>
        <div class="grid halves">
          <Card title={`1. Send this to ${name}`}>
            <HandOff text={moveOut.updateLink} qrLabel="QR code of the update for your recoverer" copyLabel="Copy link" testId="update-link">
              <p class="small muted">It tells them about the new phone, so that recovery stays on after the move. Only they can open it.</p>
            </HandOff>
          </Card>
          <Card title="2. Open this on the new phone">
            <HandOff text={moveOut.moveLink} qrLabel="QR code of the link for your new phone" copyLabel="Copy link" testId="move-link">
              <p class="small muted">It tells the new phone which wallet it is getting. Whoever has it can see what the wallet holds: send it only to yourself.</p>
            </HandOff>
          </Card>
        </div>
        <Card title="3. The hand-over">
          <p>
            New phone: <span class="mono">{moveOut.fingerprint}</span>
          </p>
          {kept('arrangement')?.change?.kind === 'new seed' && kept('arrangement')?.change?.made === undefined ? <ChangeState owner={owner} /> : <Notice tone="good">The wallet has been handed over.</Notice>}
          <p class="small muted">There is no waiting period: the new phone owns the wallet as soon as the network has the change. This phone then stops giving out addresses.</p>
          <div class="actions">
            <Button
              kind="quiet"
              onClick={() => {
                const arrangement = kept('arrangement');
                if (arrangement?.change !== undefined) {
                  const { change: _stopped, ...rest } = arrangement;
                  keep('arrangement', rest);
                }
                keep('moveOut', undefined);
                setMoveOut(undefined);
              }}
            >
              Stop the move
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div class="stack">
      <Back onBack={onBack} />
      <PageHead title="Move to a new phone">For when this phone still works. It hands the wallet over at once, without a waiting period.</PageHead>
      <Card>
        {preparation === undefined ? (
          <div class="stack-s">
            <p>On the new phone, open this wallet's page and choose "Move from my other phone". It shows a link. Open that link on this phone, or paste it here.</p>
            <Field label="The new phone's link" id="prepare" error={task.error?.name === 'read' ? task.error.message : undefined}>
              <WithScan filter={PREPARE_LINK} onScan={setPasted}>
                <TextArea id="prepare" value={pasted} onInput={setPasted} placeholder="https://…#prepare=…" />
              </WithScan>
            </Field>
            <div>
              <Button task={task} name="read" disabled={pasted.trim() === ''} onClick={() => void readPreparation(pasted)}>
                Use this link
              </Button>
            </div>
          </div>
        ) : (
          <div class="stack-s">
            <p>The new phone's key has this fingerprint. Check that the new phone shows the same.</p>
            <Fingerprint value={preparation.fingerprint} />
            <Choice type="checkbox" checked={matched} onChange={setMatched} title="The new phone shows the same fingerprint" />
            <TaskStatus task={task} name="hand" />
            <div class="actions">
              <Button task={task} name="hand" disabled={!matched} onClick={() => void handOver()}>
                Continue
              </Button>
              <Button kind="quiet" onClick={() => setPreparation(undefined)}>
                Use another link
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

/** A new recoverer (section 9.7): a new credential and a complete kit; the change is made after its prepared receipt. */
const NewRecoverer = ({ owner, onBack }: { owner: Owner; onBack: () => void }) => {
  const [pending, setPending] = useState(() => kept('newRecoverer'));
  const [recipient, setRecipient] = useState<StoredRecipient | undefined>();
  const [matched, setMatched] = useState(false);
  const task = useTask();
  const start = () =>
    task.run('start', async (progress) => {
      const arrangement = kept('arrangement');
      if (recipient === undefined) return;
      if (arrangement === undefined) throw new Error('This phone keeps no record of the wallet\'s backup archive. Make a new wallet, or move to a new phone, to set one up.');
      progress('Making a new credential and sealing the kit to the new recoverer');
      const credentialWords = generateBip39Mnemonic();
      const sent = await enroll({
        wallet: owner.wallet,
        seed: owner.seed,
        chain: owner.session.chain,
        credential: { words: credentialWords },
        recipient: recipientOf(recipient),
        stores: owner.session.environment.stores,
        storeAt: owner.session.storeAt,
        arrangement,
        newRecoverer: {},
        madeAt: Math.floor(Date.now() / 1000),
      });
      const made = { recipient, credentialWords, link: sent.link };
      keep('arrangement', sent.arrangement);
      keep('newRecoverer', made);
      // Straight to the new recoverer's page when its code offered a session; the link stays the second way.
      handToRecoverer(recipient, 'enroll', await sealedOfLink('enroll', sent.link), 'new recoverer');
      setPending(made);
      deviceWords();
    });
  if (pending !== undefined) {
    const changing = kept('arrangement')?.change?.kind === 'new recoverer' && kept('arrangement')?.change?.made === undefined;
    const name = pending.recipient.name || 'the new recoverer';
    return (
      <div class="stack">
        <Back onBack={onBack} />
        <PageHead title="Change your recoverer">{changing ? `Waiting for ${name}.` : `${name} is your recoverer now.`}</PageHead>
        <Card title={`1. Send this to ${name}`}>
          <SealedHandOff kind="enroll" slot="new recoverer" name={name}>
            <HandOff text={pending.link} qrLabel="QR code of the kit for the new recoverer" copyLabel="Copy link" testId="new-recoverer-link">
              <p class="small muted">A complete kit, sealed so that only {name} can open it. They check it and leave a receipt.</p>
            </HandOff>
          </SealedHandOff>
        </Card>
        <Card title="2. The change">
          {changing ? <ChangeState owner={owner} /> : <Notice tone="good">The wallet names {name} as its recoverer.</Notice>}
          <p class="small muted">
            What this means for the earlier recoverer{' '}
            <Info label="About the earlier recoverer">The earlier recoverer's key stops working on the wallet. They keep what they were given and can go on seeing the addresses they know; to end that, also move to a new phone afterwards.</Info>
          </p>
          <div class="actions">
            {changing && (
              <Button
                kind="quiet"
                onClick={() => {
                  const arrangement = kept('arrangement');
                  if (arrangement?.change !== undefined) {
                    const { change: _stopped, ...rest } = arrangement;
                    keep('arrangement', rest);
                  }
                  keep('newRecoverer', undefined);
                  setPending(undefined);
                }}
              >
                Stop the change
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div class="stack">
      <Back onBack={onBack} />
      <PageHead title="Change your recoverer">The new recoverer gets a complete kit and a key of their own. The wallet switches to them once they have confirmed it.</PageHead>
      <Card>
        {recipient === undefined ? (
          <RecipientEntry onRead={setRecipient} purpose="Ask the new recoverer for theirs." />
        ) : (
          <RecipientCheck recipient={recipient} matched={matched} onMatched={setMatched} onClear={() => setRecipient(undefined)} />
        )}
        <TaskStatus task={task} name="start" />
        <div class="actions">
          <Button task={task} name="start" disabled={recipient === undefined || !matched} onClick={() => void start()}>
            Send them a kit
          </Button>
        </div>
      </Card>
    </div>
  );
};

/** A new waiting period: announced to the recoverer, made after its prepared receipt. */
const NewDelay = ({ owner, onBack }: { owner: Owner; onBack: () => void }) => {
  const current = owner.watch.history?.current.state.challengeDelay;
  const [pending, setPending] = useState(() => kept('newDelay'));
  const [delay, setDelay] = useState<ChallengeDelay>(() => DELAYS.find((entry) => current === undefined || !sameDelay(entry.delay, current))?.delay ?? { unit: 'time512', value: 7 });
  const task = useTask();
  const announce = () =>
    task.run('announce', async () => {
      const recipient = kept('recipient');
      const arrangement = kept('arrangement');
      if (recipient === undefined || arrangement === undefined) throw new Error(noRecipient);
      const sent = await sendUpdate({ wallet: owner.wallet, seed: owner.seed, chain: owner.session.chain, arrangement, recipient: recipientOf(recipient), challengeDelay: delay });
      const made = { delay, link: await makeLink(recipient.page, 'update', sealedContent(sent.sealed)) };
      keep('arrangement', sent.arrangement);
      keep('newDelay', made);
      setPending(made);
    });
  return (
    <div class="stack">
      <Back onBack={onBack} />
      <PageHead title="Change the waiting period">{current === undefined ? '' : `Now ${describeDelay(current)}.`}</PageHead>
      {pending !== undefined ? (
        <Card title={`To ${describeDelay(pending.delay)}`}>
          <HandOff text={pending.link} qrLabel="QR code of the update for your recoverer" copyLabel="Copy link" testId="delay-link">
            <p>Send this link to {kept('recipient')?.name || 'your recoverer'}. Once they have taken it in, this phone makes the change.</p>
          </HandOff>
          <div class="actions">{kept('arrangement')?.change?.kind === 'waiting period' && kept('arrangement')?.change?.made === undefined ? <ChangeState owner={owner} /> : <Notice tone="good">The waiting period is changed.</Notice>}</div>
        </Card>
      ) : (
        <Card>
          <DelayPicker value={delay} onChange={setDelay} name="new-delay" />
          <TaskStatus task={task} name="announce" />
          <div class="actions">
            <Button task={task} name="announce" disabled={current !== undefined && sameDelay(current, delay)} onClick={() => void announce()}>
              Tell my recoverer
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

/** The backup the user keeps (section 18.1): the least, or complete. */
const Backup = ({ owner, onBack }: { owner: Owner; onBack: () => void }) => {
  const [kind, setKind] = useState<'least' | 'complete'>('least');
  const [text, setText] = useState<string | undefined>();
  const task = useTask();
  const show = (complete: boolean) =>
    task.run('show', async () => {
      const arrangement = kept('arrangement');
      const backup = await makeUserBackup({ words: deviceWords(), wallet: owner.wallet, network: owner.session.network, chain: owner.session.chain, ...(arrangement === undefined ? {} : { arrangement }), complete });
      setText(userBackupText(backup));
    });
  const earlier = owner.wallet.stored.earlierSeeds?.length ?? 0;
  return (
    <div class="stack">
      <Back onBack={onBack} />
      <PageHead title="Your own backup">You do not need one: your recoverer can always help. With one, you can open the wallet again on any phone, at once.</PageHead>
      <div class="grid two">
        <Card>
          <div class="stack">
            <Segmented
              label="Kind of backup"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setText(undefined);
              }}
              options={[
                { value: 'least', label: 'To write down' },
                { value: 'complete', label: 'Complete' },
              ]}
            />
            <p class="muted">
              {kind === 'least'
                ? 'Four lines: the network, the address scheme, the wallet\'s identity and the twelve words. Enough to open the wallet again and find its coins.'
                : `Adds one long line for copying, not writing: the viewing keys of earlier phones${earlier > 0 ? ` (this wallet had ${earlier})` : ''} and where the backup stores are.`}
            </p>
            {text === undefined ? (
              <div>
                <Button task={task} name="show" onClick={() => void show(kind === 'complete')}>
                  Show the backup
                </Button>
              </div>
            ) : (
              <>
                <div class="value">
                  <div class="value-text backup-text" data-testid="backup-text" data-value={text}>
                    {text
                      .trimEnd()
                      .split('\n')
                      .map((line) => (line.startsWith('more: ') ? <div class="muted">more: … one line of {line.length.toLocaleString('en-US')} characters, included when you copy or save</div> : <div>{line}</div>))}
                  </div>
                  <div class="row">
                    <CopyButton text={text} small label="Copy" />
                  </div>
                </div>
                <div class="row">
                  <Button kind="secondary" small onClick={() => download('grandmas-wallet-backup.txt', text)}>
                    Save as a file
                  </Button>
                  <Button kind="quiet" small onClick={() => setText(undefined)}>
                    Hide
                  </Button>
                </div>
              </>
            )}
            <TaskStatus task={task} name="show" />
          </div>
        </Card>
        <Card flat>
          <div class="stack-s">
            <h3>Before you keep it</h3>
            <ul class="muted">
              <li>Whoever has it has the wallet at once. The waiting period does not protect against them.</li>
              <li>The words alone restore nothing, here or in another wallet. The identity belongs with them.</li>
              <li>It goes out of date when the wallet moves to a new phone. Make a new one then.</li>
              {kind === 'least' && earlier > 0 && <li>This wallet has had earlier phones. Payments that still arrive at their addresses are not found from these four lines; the complete backup covers them.</li>}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
};
