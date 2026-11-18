import { cancellationCost, describeDelay } from '@grandmas-wallet/app';
import { ADDRESS_KIND } from '@grandmas-wallet/core';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Button, Card, HandOff, Loading, Notice, Sat, Status, TaskStatus, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Owner, isChainGap } from './OwnerApp.js';
import { WaitEnds, Waiting } from './parts.js';
import { SealedHandOff } from './SealedHandOff.js';
import { keep, kept } from './session.js';

const recovererName = (): string => kept('recipient')?.name || 'your recoverer';

/**
 * What the wallet may say about its protection (proposal sections 17 and 19): one calm line when all is
 * well, and otherwise what is missing. A statement about the servers alone is shown apart, in a smaller line.
 */
export const ProtectionStatus = ({ owner, compact }: { owner: Owner; compact?: boolean }) => {
  const { protection, history } = owner.watch;
  if (protection === undefined) return <Status tone="wait" title="Checking the wallet's protection" />;
  const main = protection.gaps.filter((gap) => !isChainGap(gap));
  const chain = protection.gaps.filter(isChainGap);
  const delay = history === undefined ? undefined : describeDelay(history.current.state.challengeDelay);
  const alarm = owner.watch.status?.kind === 'recovery-requested';
  const title = alarm
    ? 'Someone asked to move your wallet'
    : main.length === 0
      ? 'Protected'
      : owner.wallet.recovery === 'off'
        ? 'Recovery is not on yet'
        : 'Protection is incomplete';
  return (
    <Status tone={alarm ? 'bad' : main.length === 0 ? 'good' : 'warn'} title={title}>
      {main.length === 0 ? (
        <p>
          Recovery is on with {recovererName()}, and this phone can refuse a request it did not make{delay === undefined || compact === true ? '' : ` within the waiting period of ${delay}`}.
        </p>
      ) : (
        <ul>
          {main.map((gap) => (
            <li>{gap}</li>
          ))}
        </ul>
      )}
      {chain.length > 0 && <p class="small">{chain.join(' ')}</p>}
      {owner.wallet.recovery === 'off' && owner.recovery !== undefined && owner.recovery.reasons.length > 0 && compact !== true && (
        <p class="small">Why: {owner.recovery.reasons.join(' ')}</p>
      )}
    </Status>
  );
};

/** The kit link, until the recoverer's receipt is found (section 9.3: "kit sent" is not "confirmed"). */
export const KitCard = ({ owner }: { owner: Owner }) => {
  const link = kept('kitLink');
  if (link === undefined || owner.wallet.recovery === 'on') return null;
  const name = recovererName();
  return (
    <Card title={`Send the recovery kit to ${name}`} tone="warn" cls="o3">
      <SealedHandOff kind="enroll" name={name}>
        <HandOff text={link} qrLabel="QR code of the recovery kit link" copyLabel="Copy link" testId="kit-link">
          <p>Send this link to {name}, by message or by letting them scan the code. Only they can open it.</p>
        </HandOff>
      </SealedHandOff>
      <div class="actions">
        <Waiting>
          Waiting for {name} to check the kit and leave a receipt. Until then recovery is not on: coins you receive are not yet recoverable.
        </Waiting>
      </div>
    </Card>
  );
};

/** A request this phone did not make: who it names, how long it can still be refused, and the button that refuses it. */
export const Alarm = ({ owner }: { owner: Owner }) => {
  const task = useTask();
  const { status, timing, protection } = owner.watch;
  if (status?.kind !== 'recovery-requested') return null;
  const missed = protection?.gaps.find((gap) => /was not running/.test(gap));
  const refuse = () =>
    task.run('refuse', async (progress) => {
      progress('Refusing the request');
      const sent = await owner.wallet.cancel();
      owner.sent('Refused a recovery request', sent);
      owner.toast('The request is refused.');
      await owner.watch.check();
    });
  return (
    <Card title="Someone asked to move your wallet" tone="bad">
      <div class="stack-s">
        <p>
          Your recoverer's key has asked the network to give this wallet to a key this phone does not hold. If this was not you, refuse it now. If it goes through, the new key owns the wallet.
        </p>
        <p class="small">
          The request names a key with fingerprint <strong class="mono">{keyFingerprint(status.proposedOwnerKeyHash)}</strong>. If you asked your recoverer to move the wallet to a new phone, that phone shows the same fingerprint.
          {status.confirmed ? '' : ' The request is not in a block yet.'}
        </p>
        <p>
          {timing === undefined ? (
            'Working out when the waiting period ends…'
          ) : timing.eligibility.ready ? (
            <strong>The waiting period has passed. The request can be completed at any moment: refuse it now if it is not yours.</strong>
          ) : timing.eligibility.waitingFor === 'confirmation' ? (
            'You can refuse it now. The waiting period counts from the block that holds the request, so it starts with the next block.'
          ) : (
            <>
              You can refuse it until the waiting period ends. <WaitEnds endsAt={timing.endsAt} secondsLeft={timing.secondsLeft} />
            </>
          )}
        </p>
        {missed !== undefined && <Notice tone="warn">{missed}</Notice>}
        {owner.canCancel === false ? (
          <FeeNeeded owner={owner} />
        ) : (
          <>
            <div class="actions">
              <Button kind="danger" task={task} name="refuse" onClick={() => void refuse()}>
                Refuse the request
              </Button>
            </div>
            <p class="small muted">
              Refusing costs about <Sat satoshis={cancellationCost()} /> in network fees, paid from the wallet's coins. Afterwards, consider replacing your recoverer: their key may be in other hands.
            </p>
          </>
        )}
        <TaskStatus task={task} name="refuse" />
      </div>
    </Card>
  );
};

/**
 * Only on the alarm, and only when the wallet's coins do not cover the fee of refusing (it holds tokens and
 * next to no Bitcoin Cash): how much is needed, and an address to receive it at. The button to refuse
 * appears as soon as it has arrived.
 */
const FeeNeeded = ({ owner }: { owner: Owner }) => {
  const [entry, setEntry] = useState(() => kept('receive'));
  useEffect(() => {
    if (entry !== undefined) return;
    owner.wallet.receiveAddress().then(
      ({ address, again }) => {
        const next = { number: address.number, again };
        keep('receive', next);
        setEntry(next);
      },
      () => undefined,
    );
  }, []);
  const address = entry === undefined ? undefined : owner.wallet.address(ADDRESS_KIND.givenOut, entry.number).address;
  return (
    <div class="stack-s" data-testid="fee-needed">
      <Notice tone="bad">
        Refusing needs a little Bitcoin Cash for the network fee, at least <Sat satoshis={cancellationCost()} />, and this wallet holds less than that. Have some sent to this address; the button to refuse appears as soon as it arrives.
      </Notice>
      {address === undefined ? <Loading>Making an address…</Loading> : <HandOff text={address} qrLabel="QR code of the address" copyLabel="Copy address" testId="fee-address" />}
    </div>
  );
};
