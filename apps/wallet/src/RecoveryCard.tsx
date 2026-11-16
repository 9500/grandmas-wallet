import { type OwnerWallet, type WalletView, describeDelay, readLink } from '@grandmas-wallet/app';
import { recipientKeyFingerprint } from '@grandmas-wallet/enrollment';
import { Button, Card, CopyBox, Field, TaskStatus, TextArea, formatTime, useEvery, useTask } from '@grandmas-wallet/ui';
import { hexToBin } from '@bitauth/libauth';
import { useEffect, useState } from 'preact/hooks';

import { type Session, takeIncoming } from './session.js';

/** What a recoverer hands out so that wallets can seal packages to it. */
export interface RecovererCard {
  name: string;
  /** Encryption public key, hex. */
  publicKey: string;
  /** Where the recoverer receives packages. */
  page: string;
}

/** Where the wallet stands with its recoverer, and the steps to get recovery set up. */
export const RecoveryCard = ({ session, wallet, view, onChanged }: { session: Session; wallet: OwnerWallet; view: WalletView; onChanged: () => void }) => {
  const task = useTask();
  const { record } = wallet;
  const [code, setCode] = useState(session.incoming?.kind === 'recoverer' ? session.incoming.text : '');
  const [card, setCard] = useState<RecovererCard | undefined>();
  const delay = describeDelay(view.challengeDelay);

  const read = (text: string) =>
    task.run('read', async () => {
      const found = await readLink<RecovererCard>(text, 'recoverer');
      if (found === undefined || typeof found.publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(found.publicKey)) {
        throw new Error('That is not a setup link from a recoverer.');
      }
      setCard(found);
    });
  useEffect(() => {
    if (code !== '' && record.awaitingEnrollment !== undefined) void read(code);
  }, []);

  const enroll = () =>
    task.run('enroll', async (progress) => {
      if (card === undefined) return;
      progress('Making the package');
      await wallet.enroll({ publicKey: hexToBin(card.publicKey), name: card.name, page: card.page });
      takeIncoming(session);
      onChanged();
    });

  useEvery(10_000, async () => {
    if (record.enrollment !== undefined && record.enrollment.confirmedAt === undefined && (await wallet.checkEnrollment())) onChanged();
  });

  if (record.takenOver !== undefined) {
    return (
      <Card tone="success">
        <h2>Recovery is on</h2>
        <p>
          This wallet was moved to this device on {formatTime(record.takenOver.at)}. The same recoverer can move it again if this device is lost, after a
          waiting period of {delay}.
        </p>
      </Card>
    );
  }

  if (record.enrollment?.confirmedAt !== undefined) {
    return (
      <Card tone="success">
        <h2>Recovery is on</h2>
        <p>
          <strong>{record.enrollment.recoverer}</strong> confirmed receiving your package on {formatTime(record.enrollment.confirmedAt)}. If you lose this
          device, they can move the wallet to a new one. It takes {delay}, and you can cancel during that time.
        </p>
      </Card>
    );
  }

  if (record.enrollment !== undefined) {
    return (
      <Card tone="warn">
        <h2>Recovery: waiting for your recoverer</h2>
        <p>
          Send this link to <strong>{record.enrollment.recoverer}</strong>. Only they can open it. This page shows when they have confirmed.
        </p>
        <CopyBox text={record.enrollment.link} open openLabel="Open the recoverer's page" />
        <p class="small muted">Sealed to the key with fingerprint {record.enrollment.fingerprint}.</p>
      </Card>
    );
  }

  return (
    <Card tone="warn">
      <h2>Recovery is not set up yet</h2>
      <p>
        If this device is lost now, the wallet is lost with it. Ask your recoverer for their <strong>setup link</strong> and open it here, or paste it below.
      </p>
      {card === undefined ? (
        <>
          <Field label="Setup link from your recoverer">
            <TextArea value={code} onInput={setCode} placeholder="https://…#recoverer=…" />
          </Field>
          <Button task={task} name="read" kind="secondary" onClick={() => void read(code)} disabled={code.trim() === ''}>
            Continue
          </Button>
        </>
      ) : (
        <>
          <p class="notice">
            Recoverer: <strong>{card.name}</strong>
            <br />
            Key fingerprint: <span class="mono">{recipientKeyFingerprint(hexToBin(card.publicKey))}</span>
            <br />
            <span class="small muted">Check the fingerprint with your recoverer by phone or in person before going on.</span>
          </p>
          <div class="row">
            <Button task={task} name="enroll" onClick={() => void enroll()}>
              Make the package for {card.name}
            </Button>
            <Button kind="secondary" onClick={() => setCard(undefined)}>
              Use a different link
            </Button>
          </div>
        </>
      )}
      <TaskStatus task={task} />
    </Card>
  );
};
