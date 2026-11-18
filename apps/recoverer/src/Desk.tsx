import { binToHex, hexToBin } from '@bitauth/libauth';
import { type FeeView, type RecovererView, type RequestTiming, RecovererWallet, acceptTakeover, completeTakeover, describeDelay, feeView, requestTiming, viewAsRecoverer } from '@grandmas-wallet/app';
import { makeLink } from '@grandmas-wallet/app/links';
import { keyFingerprint, recoveryKeyOf, undoHandOver } from '@grandmas-wallet/enrollment';
import { Amount, Button, Card, Field, Fingerprint, HandOff, KeyValues, Loading, More, Notice, PageHead, QrCode, Sat, Status, TaskStatus, TextInput, formatDuration, formatTime, lockingBytecodeOfAddress, plainError, shorten, useEvery, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { handOverNow, handleTakeovers, resumeDesk, useDesk } from './offered-session.js';
import { type Looked, type Session, credentialAccount, kept, modeOf, openWalletPage, recovererLink, saveWallet, wallets } from './session.js';
import { describeProblem } from './Wallets.js';

/**
 * One wallet the recoverer looks after (proposal sections 9.6 and 11.1): where its controller stands, the
 * fee coins, a saved takeover request, the request, the end of the waiting period, the completion and the
 * hand-over. The page's engine is this wallet's credential account; another wallet loads the page again.
 */
export const Desk = ({ session, identity, looked: first, toast }: { session: Session; identity: string; looked: Looked; toast: (text: string) => void }) => {
  const [looked, setLooked] = useState<Looked>(first);
  const [recoverer, setRecoverer] = useState<RecovererWallet | undefined>();
  const [opening, setOpening] = useState<string | undefined>('Opening this wallet\'s account');
  const [view, setView] = useState<RecovererView | undefined>();
  const [timing, setTiming] = useState<RequestTiming | undefined>();
  const [fees, setFees] = useState<FeeView | undefined>();
  const task = useTask();
  const { kit } = looked.kept;
  const update = (next: Looked) => {
    saveWallet(identity, next);
    setLooked(next);
  };

  // A lost phone's session this page offered before a reload is offered again, so that the hand-over reaches the
  // new phone there if it is still on it.
  useEffect(() => resumeDesk(session, { kind: 'lost phone', identity }), []);

  useEffect(() => {
    if (!('words' in kit.credential)) {
      setOpening('This kit says you hold your own key for this wallet; this page holds keys made from a credential only.');
      return;
    }
    credentialAccount(session, kit.credential.words)
      .then(async (account) => {
        const options = { backend: account, chain: session.chain, identity: hexToBin(identity) };
        // A recoverer the wallet does not name cannot act on it, and can still send its fee coins on.
        const named = (await viewAsRecoverer(session.chain, looked.kept)).standing.kind !== 'not named';
        return named ? RecovererWallet.open({ ...options, genesisTransactionId: kit.creationTransactionId }) : RecovererWallet.unnamed(options);
      })
      .then(
        (opened) => {
          setRecoverer(opened);
          setOpening(undefined);
        },
        (error: unknown) => setOpening(describeProblem(error) === (error as Error).message ? plainError(error) : describeProblem(error)),
      );
  }, []);

  useEvery(
    10_000,
    async () => {
      const current = wallets()[identity] ?? looked;
      const seen = await viewAsRecoverer(session.chain, current.kept);
      setView(seen);
      setTiming(seen.standing.kind === 'requested' ? await requestTiming(session.chain, hexToBin(identity), seen.history, session.environment.secondsPerBlock) : undefined);
      setFees(await feeView(session.chain, current.kept));
      // A completion that the chain no longer shows lost to the owner's cancellation, or its block was undone:
      // the kit is put back as it was, the takeover is saved again, and the hand-over link is withdrawn.
      const undone = seen.takenOver ? undefined : undoHandOver(current.kept, seen.history);
      if (undone !== undefined) {
        const { handOverLink: _withdrawn, ...rest } = current;
        update({ ...rest, kept: undone });
        return;
      }
      // After the completion, the hand-over is made as soon as the chain shows it, in a block or not.
      if (seen.takenOver && current.handOverLink === undefined && current.kept.pending !== undefined && task.busy === undefined) {
        await task.run('handover', async (progress) => {
          progress('Making the hand-over for the new phone');
          const handed = await completeTakeover({ kept: current.kept, chain: session.chain, recoveryKey: recoveryKeyOf(current.kept.kit), storeAt: session.storeAt, save: (next) => saveWallet(identity, { ...current, kept: next }) });
          const link = await makeLink(session.environment.walletUrl, 'handover', { sealed: binToHex(handed.sealed) });
          update({ ...current, kept: handed.kept, handOverLink: link });
          // Straight to the new phone, if it is on the session of the lost phone's code; its code is shown in any case.
          void handOverNow(binToHex(handed.sealed).slice(0, 32), handed.sealed).then((delivered) => {
            if (delivered) {
              update({ ...(wallets()[identity] ?? current), handOverDelivered: true });
              toast('The new phone has the wallet.');
            }
          });
          toast('The hand-over is ready.');
        });
      }
    },
    [recoverer],
  );

  const request = () =>
    task.run('request', async (progress) => {
      if (recoverer === undefined || looked.kept.pending === undefined) return;
      progress('Signing and sending the request');
      const proposed = looked.kept.pending.proposedKeyHash;
      const sent = await recoverer.request(hexToBin(proposed));
      update({ ...looked, requested: { proposedKeyHash: proposed, transactionId: sent.transactionId } });
      toast('The request is sent. The waiting period counts from the block that holds it.');
    });

  const complete = () =>
    task.run('complete', async (progress) => {
      if (recoverer === undefined) return;
      progress('Signing and sending the completion');
      await recoverer.complete();
      toast('The wallet is moved. The hand-over link follows in a moment.');
    });

  const state = view?.history.current.state;
  const standing = view?.standing;
  const mine = looked.requested !== undefined && standing?.kind === 'requested' && standing.proposedKeyHash === looked.requested.proposedKeyHash;
  const refused = looked.requested !== undefined && standing?.kind === 'quiet' && !view?.takenOver;
  const name = looked.label || 'this wallet';
  return (
    <div class="stack">
      <div>
        <button type="button" class="link" onClick={() => openWalletPage(undefined)}>
          ‹ All wallets
        </button>
      </div>
      <PageHead title={looked.label || 'Unnamed wallet'}>
        <span class="mono">{shorten(identity, 12, 8)}</span>
      </PageHead>
      {opening !== undefined && <Notice tone={task.error === undefined && /^Opening/.test(opening) ? 'wait' : 'warn'} busy={/^Opening/.test(opening)}>{/^Opening/.test(opening) ? `${opening}. The page checks the chain's block headers first.` : opening}</Notice>}
      <div class="grid two">
        <div class="stack">
          <Card title="Where the wallet stands">
            {standing === undefined ? (
              <Status tone="wait" title="Reading the chain" />
            ) : standing.kind === 'quiet' ? (
              <Status tone="good" title={view?.takenOver === true ? 'Moved to the new phone' : 'Nothing is asked'}>
                {view?.takenOver === true ? 'The new phone\'s key owns the wallet.' : refused ? 'The owner\'s phone refused your request. If the owner asked for it, they need to keep their old phone from refusing, or use it to move the wallet themselves.' : 'The owner\'s phone is in charge.'}
              </Status>
            ) : standing.kind === 'requested' ? (
              <Status tone="warn" title={mine ? 'Your request is waiting' : 'A request is waiting that this page did not send'}>
                <p>
                  To the key <span class="mono">{keyFingerprint(standing.proposedKeyHash)}</span>.{' '}
                  {timing === undefined
                    ? ''
                    : timing.eligibility.ready
                      ? 'The waiting period has passed.'
                      : timing.eligibility.waitingFor === 'confirmation'
                        ? 'The waiting period counts from the block that holds the request, so it starts with the next block. Only the chain can measure it: nobody can claim a time for a request that is not in a block.'
                        : `The waiting period ends in about ${formatDuration(timing.secondsLeft ?? 0)}${timing.endsAt === undefined ? '' : `, when the chain's clock passes ${formatTime(timing.endsAt)}`}.`}
                </p>
                <p>Until then the owner's phone can refuse it. You can close this page and come back to complete.</p>
                {!mine && <p>If you did not send it, your credential for this wallet may be in other hands. Tell the owner.</p>}
              </Status>
            ) : standing.kind === 'not named' ? (
              <Status title={looked.asNewRecoverer === true ? 'Waiting for the owner to name you' : 'The wallet no longer names you'}>
                {looked.asNewRecoverer === true ? 'Your receipt is prepared. Once the owner\'s phone makes the change, you are this wallet\'s recoverer.' : 'The owner chose another recoverer. You keep what you were given; your key no longer works on the wallet.'}
              </Status>
            ) : (
              <Status title="Closed">The owner closed this wallet.</Status>
            )}
            {state !== undefined && (
              <>
                <div class="actions" />
                <KeyValues
                  entries={[
                    ['Owner\'s key', <span class="mono">{keyFingerprint(state.ownerKeyHash)}</span>],
                    ['Waiting period', describeDelay(state.challengeDelay)],
                    ['Your key for it', <span class="mono">{keyFingerprint(binToHex(recoveryKeyOf(looked.kept.kit).keyHash))}</span>],
                    ['Phones it has had', String(view?.history.owners.length ?? 1)],
                  ]}
                />
              </>
            )}
            {standing?.kind === 'requested' && mine && (
              <div class="actions">
                <Button task={task} name="complete" disabled={recoverer === undefined || timing?.eligibility.ready !== true} onClick={() => void complete()}>
                  Complete the move
                </Button>
              </div>
            )}
            <TaskStatus task={task} name="complete" />
          </Card>

          {looked.kept.pending !== undefined && standing?.kind === 'quiet' && view?.takenOver !== true && (
            <Card title="A saved takeover request" tone="warn">
              <div class="stack-s">
                <p>The new phone's key:</p>
                <Fingerprint value={keyFingerprint(looked.kept.pending.proposedKeyHash)} />
                <p class="small muted">Before you go on, be sure that the person asking is {name === 'this wallet' ? 'the wallet\'s owner' : `the owner of ${name}`} and that their new phone shows this fingerprint. Your request is public; the owner's phone, if it still works, can refuse it during the waiting period.</p>
                {fees !== undefined && fees.holds < fees.request && (
                  <Notice tone="bad">
                    The fee address holds <Sat satoshis={fees.holds} />; a request costs <Sat satoshis={fees.request} />. Send coins to it first.
                  </Notice>
                )}
                <TaskStatus task={task} name="request" />
                <div class="actions">
                  <Button task={task} name="request" disabled={recoverer === undefined || (fees !== undefined && fees.holds < fees.request)} onClick={() => void request()}>
                    {refused ? 'Ask the network again' : 'Ask the network to move the wallet'}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {looked.handOverLink !== undefined && standing?.kind !== 'not named' && view?.takenOver === true && (
            <Card title={looked.handOverDelivered === true ? 'The new phone has the wallet' : 'Let the new phone scan this'} tone="good">
              <HandOff text={looked.handOverLink} qrLabel="QR code of the hand-over" copyLabel="Copy link" testId="handover-link">
                <p>{looked.handOverDelivered === true ? 'It reached the new phone over the connection. The code stays here in case it is needed again.' : 'It is sealed to the new phone: only it can open it. It tells the phone which wallet it now owns and how to find the coins.'}</p>
              </HandOff>
            </Card>
          )}
          {standing?.kind === 'quiet' && view?.takenOver !== true && looked.kept.pending === undefined && <LostPhone session={session} identity={identity} recoverer={recoverer} toast={toast} onTaken={() => setLooked(wallets()[identity] ?? looked)} />}
          <TaskStatus task={task} name="handover" />
        </div>
        <div class="stack">
          <FeeCard fees={fees} named={standing?.kind !== 'not named' || looked.asNewRecoverer === true} />
          <ReturnFees recoverer={recoverer} session={session} toast={toast} />
        </div>
      </div>
    </div>
  );
};

/**
 * The owner lost their phone (proposal section 11.1): the page shows a code; the new phone scans it and sends its
 * takeover request over the session; the page saves it for this wallet and asks the network to move the wallet to
 * the new phone at once. Whoever pressed the button has made sure who is asking. The waiting period then runs.
 */
const LostPhone = ({ session, identity, recoverer, toast, onTaken }: { session: Session; identity: string; recoverer: RecovererWallet | undefined; toast: (text: string) => void; onTaken: () => void }) => {
  const [showing, setShowing] = useState(() => kept('deskSession')?.for === identity);
  const bank = modeOf() === 'bank';
  const label = wallets()[identity]?.label;
  const owner = bank ? 'Customer' : label || 'The owner';
  const title = `${owner} lost their phone`;
  useEffect(() => {
    if (!showing) return;
    handleTakeovers(async (sealed) => {
      const current = wallets()[identity];
      if (current === undefined) throw new Error('This page no longer holds the wallet.');
      if (recoverer === undefined) throw new Error('The recoverer\'s page is still opening. Scan the code again in a moment.');
      const taken = await acceptTakeover({ sealed, privateKey: session.privateKey, kept: current.kept, chain: session.chain });
      saveWallet(identity, { ...current, kept: taken.kept });
      const sent = await recoverer.request(taken.proposedKeyHash);
      saveWallet(identity, { ...(wallets()[identity] ?? current), requested: { proposedKeyHash: binToHex(taken.proposedKeyHash), transactionId: sent.transactionId } });
      toast('The request is sent. The waiting period counts from the block that holds it.');
      onTaken();
    });
    return () => handleTakeovers(undefined);
  }, [showing, recoverer]);
  if (!showing) {
    return (
      <Card flat>
        <div class="row spread">
          <span class="small muted">If the owner lost their phone, their new phone scans a code here.</span>
          <Button kind="secondary" onClick={() => setShowing(true)}>
            {title}
          </Button>
        </div>
      </Card>
    );
  }
  return <LostPhoneCode session={session} identity={identity} onClose={() => setShowing(false)} />;
};

const LostPhoneCode = ({ session, identity, onClose }: { session: Session; identity: string; onClose: () => void }) => {
  const desk = useDesk(session, { kind: 'lost phone', identity });
  const [code, setCode] = useState<string | undefined>();
  useEffect(() => {
    void recovererLink(session, desk.uri).then(setCode);
  }, [desk.uri]);
  return (
    <Card title="A new phone for this wallet">
      <div class="stack">
        <p class="small muted">On the new phone they open the wallet, tap "I lost my phone" and scan this code. The page then asks the network to move the wallet to that phone.</p>
        {code === undefined ? (
          <Loading>Making the code…</Loading>
        ) : (
          <div data-testid="lost-phone-code" data-value={code} class="code-box">
            <QrCode text={code} label="Code for the new phone to scan" />
          </div>
        )}
        {desk.arrived?.kind === 'takeover' ? (
          desk.arrived.answered === 'refused' ? <Status tone="warn" title="The request was not taken" /> : <Status tone="good" title="The new phone's request has arrived" />
        ) : desk.status.state === 'connected' ? (
          <Status tone="good" title="A phone is connected">Keep this page open.</Status>
        ) : (
          <Status tone="wait" title="Waiting for the new phone to scan the code" />
        )}
        <div>
          <Button kind="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Card>
  );
};

/** The recoverer's fee coins: what the address holds, what a recovery needs (section 9.6). */
const FeeCard = ({ fees, named }: { fees: FeeView | undefined; named: boolean }) => {
  if (fees === undefined) return <Card title="Fee coins"><p class="muted">Reading…</p></Card>;
  const missing = fees.missing;
  // A recoverer the wallet no longer names has nothing to pay for; what the address holds is still its own.
  if (!named) {
    return (
      <Card title="Fee coins">
        <KeyValues entries={[['Holds', <Amount satoshis={fees.holds} exact />]]} />
        <p class="small muted">These coins are yours. You can send them elsewhere below.</p>
      </Card>
    );
  }
  return (
    <Card title="Fee coins" aside={missing === 0n ? <span class="pill good">Enough</span> : <span class="pill warn">Not enough</span>}>
      <KeyValues
        entries={[
          ['Holds', <Amount satoshis={fees.holds} exact />],
          ['A request', <Sat satoshis={fees.request} />],
          ['A completion', <Sat satoshis={fees.completion} />],
          ...(missing > 0n ? ([[<strong>Missing</strong>, <strong><Sat satoshis={missing} /></strong>]] as [preact.ComponentChildren, preact.ComponentChildren][]) : []),
        ]}
      />
      <More summary="The fee address">
        <HandOff text={fees.address} qrLabel="QR code of the fee address" copyLabel="Copy address" testId="fee-address" />
        <p class="small muted">Anyone can send coins here, from any wallet. They are yours and pay for nothing but a request and a completion.</p>
      </More>
    </Card>
  );
};

/** Sending the fee coins elsewhere: back to the recoverer's balance, or when the recoverer no longer serves the wallet. */
const ReturnFees = ({ recoverer, session, toast }: { recoverer: RecovererWallet | undefined; session: Session; toast: (text: string) => void }) => {
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const task = useTask();
  if (recoverer === undefined) return null;
  return (
    <Card flat>
      <More summary="Send the fee coins elsewhere">
        <p class="small muted">The coins are yours. Without fee coins you cannot act for this wallet.</p>
        <Field label="To" id="return-to" error={error}>
          <TextInput id="return-to" value={to} onInput={setTo} invalid={error !== undefined} />
        </Field>
        <TaskStatus task={task} name="return" />
        <div>
          <Button
            kind="secondary"
            task={task}
            name="return"
            disabled={to.trim() === ''}
            onClick={() =>
              void task.run('return', async () => {
                let locking: Uint8Array;
                try {
                  locking = lockingBytecodeOfAddress(to, session.network);
                  setError(undefined);
                } catch (problem) {
                  setError((problem as Error).message);
                  return;
                }
                const sent = await recoverer.returnFeeCoins(locking);
                toast(sent === undefined ? 'The fee address holds too little to send on.' : `Sent; the fee was ${sent.feeSatoshis} satoshis.`);
              })
            }
          >
            Send them
          </Button>
        </div>
      </More>
    </Card>
  );
};
