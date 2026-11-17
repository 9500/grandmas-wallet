import { cancellationCost, describeDelay } from '@grandmas-wallet/app';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Amount, Button, Card, HandOff, Notice, Sat, Status, TaskStatus, useTask } from '@grandmas-wallet/ui';

import { type Owner, isChainGap } from './OwnerApp.js';
import { WaitEnds, Waiting } from './parts.js';
import { kept } from './session.js';

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
        : owner.canCancel === false
          ? 'This phone cannot refuse a request'
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
      <HandOff text={link} qrLabel="QR code of the recovery kit link" copyLabel="Copy link" testId="kit-link">
        <p>Send this link to {name}, by message or by letting them scan the code. Only they can open it.</p>
      </HandOff>
      <div class="actions">
        <Waiting session={owner.session}>
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
            'The waiting period starts when the request is in a block.'
          ) : (
            <>
              You can refuse it until the waiting period ends. <WaitEnds endsAt={timing.endsAt} secondsLeft={timing.secondsLeft} />
            </>
          )}
        </p>
        {missed !== undefined && <Notice tone="warn">{missed}</Notice>}
        {owner.canCancel === false ? (
          <Notice tone="bad">This phone holds no coin for cancelling, so it cannot refuse. Receive some coins and put one aside under Recovery, or ask someone to send a little to this wallet now.</Notice>
        ) : (
          <>
            <div class="actions">
              <Button kind="danger" task={task} name="refuse" onClick={() => void refuse()}>
                Refuse the request
              </Button>
            </div>
            <p class="small muted">
              Refusing costs <Sat satoshis={cancellationCost()} /> in fees, paid by the coin kept for that. Afterwards, consider replacing your recoverer: their key may be in other hands.
            </p>
          </>
        )}
        <TaskStatus task={task} name="refuse" />
      </div>
    </Card>
  );
};

/** The coin kept for cancelling, and putting one aside when it is missing. */
export const CancelCoin = ({ owner, bare }: { owner: Owner; bare?: boolean }) => {
  const task = useTask();
  const { balance, canCancel } = owner;
  if (balance === undefined || canCancel === undefined) return null;
  return (
    <div class="stack-s">
      {bare === true ? null : canCancel ? (
        <Status tone="good" title="Coin for cancelling: kept">
          <Amount satoshis={balance.cancelling} exact /> is kept apart to pay for refusing a request. Payments leave it alone.
        </Status>
      ) : (
        <Status tone="warn" title="No coin for cancelling">
          Without it this phone cannot refuse a recovery request. Putting one aside moves <Sat satoshis={cancellationCost()} /> to an address of its own, plus the fee of that payment.
        </Status>
      )}
      {!canCancel && (
        <div>
          <Button
            task={task}
            name="aside"
            disabled={balance.recoverable < cancellationCost() + 1_000n}
            onClick={() =>
              void task.run('aside', async () => {
                const sent = await owner.wallet.setAsideCancellingCoin();
                if (sent !== undefined) owner.sent('Put a coin aside for cancelling', sent);
              })
            }
          >
            Put a coin aside
          </Button>
          {balance.recoverable < cancellationCost() + 1_000n && <p class="small muted">The wallet holds too little for this. Receive some coins first.</p>}
        </div>
      )}
      <TaskStatus task={task} name="aside" />
    </div>
  );
};
