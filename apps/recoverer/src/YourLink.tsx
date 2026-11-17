import { Card, Field, Fingerprint, HandOff, Loading, PageHead, TextInput } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Session, fingerprintOf, keep, kept, recovererLink } from './session.js';

/** The recoverer's link: its name, its page and its encryption key, for an owner's wallet to take in. */
export const YourLink = ({ session }: { session: Session }) => {
  const [name, setName] = useState(() => kept('name') ?? '');
  const [link, setLink] = useState<string | undefined>();
  useEffect(() => {
    keep('name', name.trim());
    void recovererLink(session).then(setLink);
  }, [name]);
  return (
    <div class="stack">
      <PageHead title="Your link">The person whose wallet you will look after opens this link in their wallet. It holds your name and the key their wallet seals your kit to. It is not secret.</PageHead>
      <div class="grid two">
        <Card>
          <Field label="Your name, as their wallet shows it" id="name">
            <TextInput id="name" value={name} onInput={setName} placeholder="For example: Anna" />
          </Field>
          {link === undefined ? <Loading>Making the link…</Loading> : <HandOff text={link} qrLabel="QR code of your recoverer link" copyLabel="Copy link" testId="recoverer-link" />}
        </Card>
        <Card title="Compare the fingerprint">
          <p class="muted">Their wallet shows this fingerprint when it reads your link. Read it to them over the phone or in person. If theirs is different, the link was changed on the way.</p>
          <div class="value">
            <Fingerprint value={fingerprintOf(session)} />
          </div>
          <p class="small muted">The key was made in this browser the first time the page was opened, and stays here. Erasing the browser's data for this page loses it, and with it every kit sent to you.</p>
        </Card>
      </div>
    </div>
  );
};
