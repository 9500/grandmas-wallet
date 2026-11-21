import { type SetUpRecord, creationCost, describeDelay } from '@grandmas-wallet/app';
import { Amount, Button, Card, Field, Loading, More, Notice, PageHead, QrCode, Status, TextInput, Value, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { FundsCard, useBalance, useFunds } from './Funds.js';
import { type DeskState, setNextLabel, setUpDesk, setUpRecords, useChanges, useDesk } from './offered-session.js';
import { type Session, kept, modeOf, recovererLink, settingsOf } from './session.js';

/** How long the page waits for its session before it says that the code cannot reach a phone just now. */
const SESSION_WITHIN_MS = 8_000;

/**
 * The code a phone scans to have its wallet set up: a bank's "New customer", a friend's "Help someone set up". The
 * phone asks over the session the code offers; a bank's page creates the wallet at once, a friend's page asks
 * "Set up …'s wallet?" and creates it on one tap. Then the code offers a new session for the next phone.
 */
export const NewWallet = ({ session, onDone }: { session: Session; onDone: () => void }) => {
  const bank = modeOf() === 'bank';
  const [label, setLabel] = useState('');
  const [shown, setShown] = useState(bank);
  const { funds, problem } = useFunds(session);
  const balance = useBalance(funds);
  const each = creationCost(BigInt(settingsOf().startingSatoshis));
  // The code is offered once the balance covers a new wallet: a phone that scans it is answered with a transaction
  // this page pays for. A phone that is on the code's session already is answered whatever the balance says.
  const [covered, setCovered] = useState(() => kept('deskSession')?.walletPublicKey !== undefined);
  useEffect(() => {
    if (!covered && balance !== undefined && balance >= each) setCovered(true);
  }, [balance, each]);
  if (!covered) {
    return (
      <div class="stack">
        <PageHead title={bank ? 'New customer' : 'Help someone set up'}>{bank ? 'A customer\'s wallet is created from your balance when their phone scans your code.' : 'Their wallet is made from your balance when their phone scans your code and you say yes.'}</PageHead>
        <div class="grid two">
          <Card title="Add coins to your balance first">
            {balance === undefined ? (
              <p class="muted">The code is shown once this page has read your balance.</p>
            ) : (
              <div class="stack-s" data-testid="add-coins-first">
                <Status tone="warn" title={<>Your balance holds <Amount satoshis={balance} exact /></>}>
                  A new wallet takes about <Amount satoshis={each} exact />: the <Amount satoshis={BigInt(settingsOf().startingSatoshis)} exact /> its owner starts with, and the network's fees.
                </Status>
                <p class="small muted">Send coins to the address of your balance. The code is shown here as soon as they arrive; a phone that scanned it before would be left waiting.</p>
              </div>
            )}
          </Card>
          <FundsCard session={session} funds={funds} problem={problem} />
        </div>
      </div>
    );
  }
  if (!shown) {
    return (
      <div class="stack">
        <PageHead title="Help someone set up">Their phone scans your code and asks you for a wallet. You say yes here, and the wallet is made from your coins.</PageHead>
        <Card>
          <Field label="Who are you helping?" id="label" hint="Your own name for their wallet. Only you see it.">
            <TextInput id="label" value={label} onInput={setLabel} placeholder="For example: Grandma" />
          </Field>
          <div class="actions">
            <Button
              onClick={() => {
                setNextLabel(label);
                setShown(true);
              }}
            >
              Show the code
            </Button>
          </div>
        </Card>
        <FundsCard session={session} funds={funds} problem={problem} />
      </div>
    );
  }
  // The next phone's code is offered on the same terms as the first.
  return <CodeScreen session={session} bank={bank} label={label} onDone={onDone} onNext={() => balance !== undefined && balance < each && setCovered(false)} />;
};

const CodeScreen = ({ session, bank, label, onDone, onNext }: { session: Session; bank: boolean; label: string; onDone: () => void; onNext: () => void }) => {
  const desk = useDesk(session, { kind: 'set up' });
  useChanges();
  const [code, setCode] = useState<string | undefined>();
  const [late, setLate] = useState(false);
  const [customer, setCustomer] = useState(label);
  const { funds, problem } = useFunds(session);
  const settings = settingsOf();
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), SESSION_WITHIN_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    void recovererLink(session, desk.uri).then(setCode);
  }, [desk.uri]);
  useEffect(() => setNextLabel(customer), [customer]);
  const record = desk.setUp === undefined ? undefined : setUpRecords.get(desk.setUp);
  const reachable = desk.status.state === 'waiting' || desk.status.state === 'connected';
  const served = record !== undefined && (record.answer !== undefined || record.refused !== undefined);
  // A code a phone joined answers that phone only. If the phone left without asking, or its set-up failed, the
  // recoverer makes a new code; a set-up under way keeps its code. The request's record stays either way.
  const joinedOnly = record === undefined ? kept('deskSession')?.walletPublicKey !== undefined : record.problem !== undefined;
  return (
    <div class="stack">
      <PageHead title={bank ? 'New customer' : label === '' ? 'Set up their wallet' : `Set up ${label}'s wallet`}>
        {bank ? 'The customer opens the wallet, taps "I have a code from my bank" and scans this code. Their wallet is set up at once.' : 'On their phone they open the wallet, tap "Someone I trust is setting it up" and scan this code.'}
      </PageHead>
      <div class="grid two">
        <Card>
          {bank && (
            <Field label="Customer" id="customer" hint="Your own name or number for their wallet. Only you see it.">
              <TextInput id="customer" value={customer} onInput={setCustomer} placeholder="For example: 1042" />
            </Field>
          )}
          {code === undefined ? (
            <Loading>Making the code…</Loading>
          ) : (
            <div class="handoff">
              <div data-testid="recoverer-code" data-value={code} class="code-box">
                <QrCode text={code} label={bank ? 'Activation code for a new customer' : 'Code for their phone to scan'} />
              </div>
              {record === undefined ? (
                <SessionLine desk={desk} reachable={reachable} late={late} />
              ) : (
                <SetUpLine session={session} record={record} bank={bank} />
              )}
              <More summary="The code as text">
                <Value text={code} clamp copyLabel="Copy" />
                <p class="small muted">For a phone without a camera: it can paste this under "No camera?".</p>
              </More>
            </div>
          )}
          <p class="small muted">
            New wallets get <Amount satoshis={BigInt(settings.startingSatoshis)} exact /> and a waiting period of {describeDelay(settings.challengeDelay)}. Change these in the settings.
          </p>
          <div class="actions">
            {served && <Button kind="secondary" onClick={() => { desk.renew(); onNext(); }}>Next {bank ? 'customer' : 'phone'}</Button>}
            {!served && joinedOnly && <Button kind="secondary" onClick={() => { desk.renew(); onNext(); }}>New code</Button>}
            <Button kind="quiet" onClick={onDone}>
              Done
            </Button>
          </div>
        </Card>
        <FundsCard session={session} funds={funds} problem={problem} />
      </div>
    </div>
  );
};

/** What the session offered with the code is doing, in one line. */
const SessionLine = ({ desk, reachable, late }: { desk: DeskState; reachable: boolean; late: boolean }) => {
  if (!reachable && late) {
    return (
      <Status tone="warn" title="The code cannot reach a phone just now">
        This page cannot open a connection. Check the network.
      </Status>
    );
  }
  if (desk.status.state === 'connected') return <Status tone="good" title="A phone is connected">Keep this page open.</Status>;
  return <Status tone="wait" title="Waiting for their phone to scan the code" />;
};

/** Where the request of the phone on the session stands. A friend says yes here. */
const SetUpLine = ({ session, record, bank }: { session: Session; record: SetUpRecord; bank: boolean }) => {
  const task = useTask();
  const name = record.label || (bank ? 'the customer' : 'this person');
  const amount = BigInt(settingsOf().startingSatoshis);
  if (record.answer !== undefined) {
    return (
      <Status tone="good" title={`${capital(name)}'s wallet is set up`}>
        Their phone shows it now, with <Amount satoshis={amount} exact />. You find it under {bank ? 'Customers' : 'People you help'}.
      </Status>
    );
  }
  if (record.refused !== undefined) return <Status tone="warn" title="Not set up">{record.refused}</Status>;
  if (!record.approved) {
    return (
      <div class="stack-s" data-testid="set-up-confirm">
        <Status tone="wait" title={<>Set up {name}'s wallet with <Amount satoshis={amount} exact />?</>}>
          It is paid from your balance. Their phone is waiting.
        </Status>
        <div class="actions">
          <Button task={task} name="approve" onClick={() => void task.run('approve', () => setUpDesk(session).approve(record.requestId))}>
            Set it up
          </Button>
          <Button kind="quiet" onClick={() => void setUpDesk(session).decline(record.requestId)}>
            No
          </Button>
        </div>
      </div>
    );
  }
  if (record.problem !== undefined) {
    return (
      <div class="stack-s">
        <Notice tone="bad">{record.problem}</Notice>
        <p class="small muted">Their phone was told. When they try again, the wallet is set up if it can be.</p>
      </div>
    );
  }
  return <Notice tone="wait" busy>Setting up {name}'s wallet…</Notice>;
};

const capital = (text: string): string => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
