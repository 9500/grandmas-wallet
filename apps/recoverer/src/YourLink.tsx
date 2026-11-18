import { Card, Field, Fingerprint, Loading, PageHead, QrCode, Status, TextInput, Value } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type DeskState, useDesk } from './offered-session.js';
import { type Session, fingerprintOf, keep, kept, recovererLink } from './session.js';

/** How long the page waits for its session before the code carries the plain link. */
const SESSION_WITHIN_MS = 6_000;

/** What the session offered with the code is doing, in one line. */
const SessionLine = ({ desk }: { desk: DeskState }) => {
  if (desk.arrived !== undefined) {
    const what = desk.arrived.kind === 'enroll' ? 'The kit' : 'The request';
    if (desk.arrived.answered === 'received') return <Status tone="good" title={`${what} has arrived`}>It is shown at the top of this page.</Status>;
    return <Status tone={desk.arrived.answered === 'kept' ? 'good' : 'warn'} title={desk.arrived.answered === 'kept' ? `${what} is kept` : `${what} was not kept`}>Their wallet has been told. For another phone, the code changes in a moment.</Status>;
  }
  if (desk.status.state === 'connected') {
    return (
      <Status tone="good" title="A phone is connected">
        Keep this page open: their wallet sends your kit straight here as soon as it is made.
      </Status>
    );
  }
  return (
    <Status tone="wait" title="Waiting for their phone">
      Once it has scanned the code, keep this page open until the kit arrives.
    </Status>
  );
};

/**
 * The recoverer's link: its name, its page and its encryption key, for an owner's wallet to take in. The QR
 * code also offers a session for as long as this page is open, so that the wallet can send the kit straight
 * back; the link, sent as a message, is the second way, and works at any time.
 */
export const YourLink = ({ session }: { session: Session }) => {
  const [name, setName] = useState(() => kept('name') ?? '');
  const [link, setLink] = useState<string | undefined>();
  const [code, setCode] = useState<string | undefined>();
  const [late, setLate] = useState(false);
  const desk = useDesk(session);
  const reachable = desk.status.state === 'waiting' || desk.status.state === 'connected';
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), SESSION_WITHIN_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    keep('name', name.trim());
    void recovererLink(session).then(setLink);
    void recovererLink(session, desk.uri).then(setCode);
  }, [name, desk.uri]);
  // Until the session is reachable the code waits a moment; a page that cannot reach it shows the plain link.
  const shown = reachable ? code : late ? link : undefined;
  return (
    <div class="stack">
      <PageHead title="Your link">The person whose wallet you will look after scans this code with their phone, or opens the link in their wallet. It holds your name and the key their wallet seals your kit to. It is not secret.</PageHead>
      <div class="grid two">
        <Card>
          <Field label="Your name, as their wallet shows it" id="name">
            <TextInput id="name" value={name} onInput={setName} placeholder="For example: Anna" />
          </Field>
          {link === undefined || shown === undefined ? (
            <Loading>Making the code…</Loading>
          ) : (
            <div class="stack">
              <div class="handoff with-qr">
                <div data-testid="recoverer-code" data-value={shown}>
                  <QrCode text={shown} label="QR code of your recoverer link" />
                </div>
                {reachable ? (
                  <SessionLine desk={desk} />
                ) : (
                  <Status tone="warn" title="Only the link">
                    This page cannot open a connection just now. Their wallet gives them your kit as a link, which they send you.
                  </Status>
                )}
              </div>
              <div class="stack-s">
                <p class="small muted">Or send them this link as a message. It works at any time, with this page closed: their wallet then gives them your kit as a link, which you open on this page.</p>
                <Value text={link} clamp copyLabel="Copy link" testId="recoverer-link" />
              </div>
            </div>
          )}
        </Card>
        <Card title="Compare the fingerprint">
          <p class="muted">Their wallet shows this fingerprint when it reads your code or your link. Read it to them over the phone or in person. If theirs is different, the code or the link was changed on the way.</p>
          <div class="value">
            <Fingerprint value={fingerprintOf(session)} />
          </div>
          <p class="small muted">The key was made in this browser the first time the page was opened, and stays here. Erasing the browser's data for this page loses it, and with it every kit sent to you.</p>
        </Card>
      </div>
    </div>
  );
};
