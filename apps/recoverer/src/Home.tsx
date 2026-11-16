import { binToHex } from '@bitauth/libauth';
import { type EnrolledWallet, RecoveryDesk, describeDelay, makeLink } from '@grandmas-wallet/app';
import { HttpStore, type SignedMessage } from '@grandmas-wallet/archive';
import { type VerifiedEnrollment, acknowledgeEnrollment, envelopeFromLink, openPackage, recipientKeyFingerprint } from '@grandmas-wallet/enrollment';
import { Button, Card, CopyBox, Field, TaskStatus, TextArea, TextInput, formatTime, shorten, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Session, enrolledWallets, goTo, identityOf, saveEnrolled, takeIncoming } from './session.js';

/** The recoverer's front page: its setup link, new packages, and the wallets it looks after. */
export const Home = ({ session }: { session: Session }) => {
  const { environment, keys } = session;
  const task = useTask();
  const [name, setName] = useState(session.name);
  const [setupLink, setSetupLink] = useState('');
  const [link, setLink] = useState(session.incoming?.kind === 'enroll' ? session.incoming.text : '');
  const [opened, setOpened] = useState<{ signed: SignedMessage; verified: VerifiedEnrollment } | undefined>();
  const [customer, setCustomer] = useState('');
  const [wallets, setWallets] = useState<EnrolledWallet[]>(enrolledWallets(session));

  useEffect(() => {
    session.vault.set('name', name);
    void makeLink(environment.walletUrl, 'recoverer', { name, publicKey: binToHex(keys.publicKey), page: environment.recovererUrl }).then(setSetupLink);
  }, [name]);

  const open = (text: string) =>
    task.run('open', async (progress) => {
      progress('Opening the package and checking it against the network');
      let signed: SignedMessage;
      try {
        signed = await openPackage(envelopeFromLink(text), keys.privateKey);
      } catch {
        throw new Error('This package cannot be opened here. It was made for a different recoverer, or the link is incomplete.');
      }
      setOpened({ signed, verified: await RecoveryDesk.inspect(signed, session.chain, environment.network) });
    });
  useEffect(() => {
    if (link !== '') void open(link);
  }, []);

  const keep = () =>
    task.run('keep', async (progress) => {
      if (opened === undefined) return;
      const { enrollment } = opened.verified;
      const enrolled: EnrolledWallet = {
        signed: opened.signed,
        importedAt: Math.floor(Date.now() / 1000),
        acknowledged: false,
        customer: customer.trim() === '' ? 'Customer' : customer.trim(),
        activity: [],
      };
      saveEnrolled(session, enrolled);
      progress('Telling the owner\'s wallet the package arrived');
      await acknowledgeEnrollment(opened.signed, enrollment.archive.stores.map((url) => new HttpStore(url)));
      enrolled.acknowledged = true;
      saveEnrolled(session, enrolled);
      takeIncoming(session);
      setOpened(undefined);
      setLink('');
      setCustomer('');
      setWallets(enrolledWallets(session));
    });

  const problems = opened === undefined ? [] : [...opened.verified.differences, ...(opened.verified.credentialAuthorized ? [] : ['The credential in the package is not the wallet\'s recoverer.'])];
  return (
    <>
      <Card>
        <h2>Your setup link</h2>
        <p>Give this link to someone who wants you as their recoverer. Their wallet uses it to make a package only you can open.</p>
        <Field label="Name shown to them">
          <TextInput value={name} onInput={setName} />
        </Field>
        {setupLink !== '' && <CopyBox text={setupLink} open openLabel="Open the wallet page" />}
        <p class="small muted">
          Key fingerprint: <span class="mono">{recipientKeyFingerprint(keys.publicKey)}</span>. Read it to them by phone or in person, so they can check it.
        </p>
      </Card>

      <Card>
        <h2>Add a wallet</h2>
        {opened === undefined ? (
          <>
            <p>Open the link a wallet's owner sent you, or paste it here.</p>
            <Field label="Package link">
              <TextArea value={link} onInput={setLink} placeholder="https://…#enroll=…" />
            </Field>
            <Button task={task} name="open" kind="secondary" onClick={() => void open(link)} disabled={link.trim() === ''}>
              Open the package
            </Button>
          </>
        ) : (
          <>
            <p class={`notice ${problems.length === 0 ? 'ok' : 'error'}`}>
              {problems.length === 0 ? 'The package matches the wallet on the network.' : problems.join(' ')}
            </p>
            <dl class="small">
              <dt class="muted">Wallet</dt>
              <dd class="mono">{opened.verified.enrollment.identity}</dd>
              <dt class="muted">Waiting period before a move completes</dt>
              <dd>{describeDelay(opened.verified.enrollment.policy.challengeDelay)}</dd>
              <dt class="muted">Signed by</dt>
              <dd>{opened.verified.signedBy === 'current-owner' ? 'the wallet\'s current owner' : 'an earlier owner of the wallet'}</dd>
              <dt class="muted">Records kept at</dt>
              <dd>{opened.verified.enrollment.archive.stores.join(', ')}</dd>
            </dl>
            <Field label="Whose wallet is this?" hint="For your own list. It is not sent anywhere.">
              <TextInput value={customer} onInput={setCustomer} placeholder="Grandma Ana" />
            </Field>
            <div class="row">
              <Button task={task} name="keep" onClick={() => void keep()} disabled={problems.length > 0}>
                Keep it and confirm to the owner
              </Button>
              <Button
                kind="secondary"
                onClick={() => {
                  setOpened(undefined);
                  takeIncoming(session);
                }}
              >
                Discard
              </Button>
            </div>
          </>
        )}
        <TaskStatus task={task} />
      </Card>

      <Card>
        <h2>Wallets you look after</h2>
        {wallets.length === 0 ? (
          <p class="muted">None yet.</p>
        ) : (
          <ul class="list">
            {wallets.map((enrolled) => (
              <li>
                <div class="row spread">
                  <div>
                    <strong>{enrolled.customer}</strong>
                    <div class="small muted">
                      <span class="mono">{shorten(identityOf(enrolled))}</span> · added {formatTime(enrolled.importedAt)}
                      {enrolled.acknowledged ? '' : ' · not yet confirmed to the owner'}
                    </div>
                  </div>
                  <Button kind="secondary" onClick={() => goTo(identityOf(enrolled))}>
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
};
