import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type CreationStep, type OwnerWallet, addressOf, creationFunding, describeDelay, enroll, kitTemplates, suggestedAllowance } from '@grandmas-wallet/app';
import { type ChallengeDelay, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { sealedOfLink } from '@grandmas-wallet/app/hand-off';
import { credentialKeys } from '@grandmas-wallet/enrollment';
import { Amount, Button, Card, Choice, HandOff, Loading, Notice, PageHead, Sat, type Step, Steps, TaskStatus, useEvery, useTask } from '@grandmas-wallet/ui';
import { useEffect, useRef, useState } from 'preact/hooks';

import { handToRecoverer } from './hand-to-recoverer.js';
import { DELAYS, DelayPicker, RecipientCheck, RecipientEntry } from './parts.js';
import { type Session, type Setup, type StoredRecipient, deviceWords, keep, kept, openWallet, recipientOf, seedOf, startCreationAgain } from './session.js';

/** Send the recoverer the kit (section 9.3) and remember what was sent. Recovery is on only when its receipt is found. */
export const sendKit = async (session: Session, wallet: OwnerWallet, setup: Setup): Promise<string> => {
  if (setup.credentialWords === undefined) throw new Error('This phone no longer holds the recoverer\'s credential. Choose a recoverer again under Recovery.');
  const arrangement = kept('arrangement');
  const sent = await enroll({
    wallet,
    seed: seedOf(session, deviceWords()),
    chain: session.chain,
    credential: { words: setup.credentialWords },
    recipient: recipientOf(setup.recipient),
    stores: session.environment.stores,
    storeAt: session.storeAt,
    madeAt: Math.floor(Date.now() / 1000),
    ...(arrangement === undefined ? {} : { arrangement }),
  });
  keep('arrangement', sent.arrangement);
  keep('recipient', setup.recipient);
  keep('kitLink', sent.link);
  // Straight to the recoverer's page when its code offered a session; the link stays the second way.
  handToRecoverer(setup.recipient, 'enroll', await sealedOfLink('enroll', sent.link));
  return sent.link;
};

export const Create = ({ session, onBack, onCreated }: { session: Session; onBack: () => void; onCreated: (wallet: OwnerWallet) => void }) => {
  const [setup, setSetup] = useState<Setup | undefined>(() => kept('setup'));
  if (setup === undefined) {
    return (
      <SetupForm
        session={session}
        onBack={onBack}
        onDone={(made) => {
          keep('setup', made);
          setSetup(made);
          window.scrollTo(0, 0);
        }}
      />
    );
  }
  return <Creating session={session} setup={setup} onCreated={onCreated} onAgain={() => setSetup(kept('setup'))} />;
};

/** Before anything is paid: who the recoverer is, how long the waiting period is, and whether to give an allowance. */
const SetupForm = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: (setup: Setup) => void }) => {
  const [recipient, setRecipient] = useState<StoredRecipient | undefined>();
  const [matched, setMatched] = useState(false);
  const [delay, setDelay] = useState<ChallengeDelay>(DELAYS[0]?.delay ?? { unit: 'time512', value: 1 });
  const [allowance, setAllowance] = useState(true);
  const proceed = () => {
    if (recipient === undefined) return;
    deviceWords();
    const credentialWords = generateBip39Mnemonic();
    const { recoveryKey } = credentialKeys(credentialWords, session.network, kitTemplates());
    onDone({ recipient, delay, allowance, credentialWords, recoveryKeyHash: binToHex(recoveryKey.keyHash) });
  };
  return (
    <div class="stack">
      <PageHead title="Make a new wallet">Three choices first. Nothing is paid until you have made them.</PageHead>
      <Card title="1. Your recoverer">
        <p class="muted">A person you trust, who keeps a kit that lets them move your wallet to a new phone. They can never spend from it, and they see what the wallet holds.</p>
        {recipient === undefined ? (
          <RecipientEntry onRead={setRecipient} purpose="It holds their name and the key your wallet seals their kit to." />
        ) : (
          <RecipientCheck
            recipient={recipient}
            matched={matched}
            onMatched={setMatched}
            onClear={() => {
              setRecipient(undefined);
              setMatched(false);
            }}
          />
        )}
      </Card>
      <Card title="2. The waiting period">
        <p class="muted">When your recoverer asks to move the wallet, everyone can see it, and this phone has this long to say no. Your recoverer cannot shorten it.</p>
        <DelayPicker value={delay} onChange={setDelay} name="delay" />
      </Card>
      <Card title="3. An allowance for your recoverer">
        <Choice type="checkbox" checked={allowance} onChange={setAllowance} title={<>Give your recoverer <Sat satoshis={suggestedAllowance()} /> for network fees</>}>
          A recovery costs your recoverer about 2,000 satoshis in fees. With an allowance they need not find Bitcoin Cash first. It becomes theirs and gives them no other power.
        </Choice>
      </Card>
      <div class="actions">
        <Button disabled={recipient === undefined || !matched} onClick={proceed}>
          Continue
        </Button>
        <Button kind="quiet" onClick={onBack}>
          Back
        </Button>
      </div>
      {recipient !== undefined && !matched && <p class="small muted">Tick "The fingerprints are the same" once you have compared them.</p>}
    </div>
  );
};

const STEP_ORDER: CreationStep[] = ['not funded', 'funded', 'prepared', 'created'];

/**
 * Funding, preparing and creating, each shown on its own and resumed after a reload. Each step goes on as soon
 * as the network has the transaction before it; none waits for a block (proposal section 7.9).
 */
const Creating = ({ session, setup, onCreated, onAgain }: { session: Session; setup: Setup; onCreated: (wallet: OwnerWallet) => void; onAgain: () => void }) => {
  const [wallet, setWallet] = useState<OwnerWallet | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [step, setStep] = useState<CreationStep | undefined>();
  const [funding, setFunding] = useState<{ address: string; received: bigint } | undefined>();
  const [lost, setLost] = useState(() => kept('lostCreation'));
  const previous = useRef<CreationStep | undefined>(undefined);
  const task = useTask();
  const needed = creationFunding(setup.allowance ? { allowanceSatoshis: suggestedAllowance() } : {});
  const name = setup.recipient.name || 'your recoverer';

  useEffect(() => {
    openWallet(session).then(setWallet, (error: Error) => setProblem(error.message));
  }, []);

  const options = () => {
    const allowance =
      setup.allowance && setup.credentialWords !== undefined
        ? { allowance: { feeLockingBytecode: p2pkhLockingBytecode(credentialKeys(setup.credentialWords, session.network, kitTemplates()).feeKey.keyHash), satoshis: suggestedAllowance() } }
        : {};
    return { recovererKeyHash: hexToBin(setup.recoveryKeyHash), challengeDelay: setup.delay, ...allowance };
  };

  const finish = async (opened: OwnerWallet) => {
    await task.run('kit', async (progress) => {
      progress('Writing this phone\'s viewing key to the backup stores and sealing the kit to your recoverer');
      await sendKit(session, opened, setup);
      onCreated(opened);
    });
  };

  useEvery(
    5_000,
    async () => {
      if (wallet === undefined || task.busy !== undefined) return;
      const address = await wallet.fundingAddress();
      const coins = await session.chain.listUnspent(address);
      // Coins at addresses given out before the wallet had to be made again count too: the new wallet is made from them.
      const voided = wallet.voided.length > 0 ? (await wallet.balance()).voided : 0n;
      setFunding({
        address: addressOf(address, session.environment.network === 'mainnet' ? 'mainnet' : 'chipnet'),
        received: coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n) + voided,
      });
      const now = await wallet.creationStep();
      // The wallet was created and the network no longer has its creation: it is made again.
      if (previous.current === 'created' && now !== 'created') {
        startCreationAgain(session);
        setLost(kept('lostCreation'));
        onAgain();
      }
      previous.current = now;
      setStep(now);
      if (now === 'created' && task.error === undefined) await finish(wallet);
    },
    [wallet, task.busy],
  );

  if (problem !== undefined) {
    return (
      <Card title="This phone's keys could not be opened" tone="bad">
        <p>{problem}</p>
        <div class="actions">
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </Card>
    );
  }
  if (wallet === undefined || step === undefined) return <Loading>Opening this phone's keys. The first time takes a little while: the page checks the chain's block headers.</Loading>;

  const at = STEP_ORDER.indexOf(step);
  const state = (index: number): Step['state'] => (index < at ? 'done' : index === at ? 'current' : 'later');
  const short = funding !== undefined && funding.received < needed;
  const steps: Step[] = [
    {
      title: step === 'not funded' ? 'Add the first coins' : 'First coins received',
      state: at === 0 ? 'current' : 'done',
      detail:
        at === 0 ? (
          <div class="stack-s">
            <p>
              Send at least <Amount satoshis={needed} exact /> to this address. More is fine: what is left over is yours to use.
            </p>
            {funding !== undefined && <HandOff text={funding.address} qrLabel="QR code of the address for the first coins" copyLabel="Copy address" testId="funding-address" />}
            <p class="small muted">This address is only for the first coins and is not recoverable. Once the wallet exists, you receive at other addresses.</p>
            {funding !== undefined && funding.received > 0n && short && (
              <Notice tone="warn">
                <Amount satoshis={funding.received} exact /> has arrived; <Sat satoshis={needed - funding.received} /> more is needed.
              </Notice>
            )}
          </div>
        ) : funding !== undefined && funding.received > 0n ? (
          <>
            <Amount satoshis={funding.received} exact /> arrived.
          </>
        ) : undefined,
    },
    {
      title: 'Prepare',
      state: state(2) === 'done' ? 'done' : at === 1 ? 'current' : 'later',
      detail: 'The wallet pays itself once, to make the coin its identity is named after.',
    },
    {
      title: 'Create',
      state: at >= 3 ? 'done' : at === 1 || at === 2 ? 'current' : 'later',
      detail: (
        <>
          One transaction creates the wallet's controller, which names {name} and a waiting period of {describeDelay(setup.delay)}; it puts a coin aside for cancelling{setup.allowance ? ', gives the allowance' : ''}, and moves the rest into the wallet.
          {(at === 1 || at === 2) && (
            <div class="actions">
              <Button task={task} name="create" disabled={short} onClick={() => void task.run('create', async (progress) => {
                progress('Creating the wallet');
                setStep(await wallet.create(options()));
              })}>
                {at === 2 ? 'Continue creating' : lost !== undefined ? 'Make the wallet again' : 'Create the wallet'}
              </Button>
            </div>
          )}
          <TaskStatus task={task} name="create" />
        </>
      ),
    },
    {
      title: `Send the recovery kit to ${name}`,
      state: step === 'created' ? 'current' : 'later',
      detail: (
        <>
          The kit is sealed so that only {name} can open it.{' '}
          {setup.recipient.session === undefined ? 'You send it as a link.' : `It goes straight to ${name}'s page if it is still open; otherwise you send it as a link.`}
          <TaskStatus task={task} name="kit" />
          {task.error?.name === 'kit' && (
            <div class="actions">
              <Button onClick={() => void finish(wallet)}>Try again</Button>
            </div>
          )}
        </>
      ),
    },
    { title: `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} confirms`, state: 'later', detail: 'Recovery is on only once they have checked the kit and left their receipt. Coins received before that are not yet recoverable.' },
  ];
  return (
    <div class="stack">
      <PageHead title="Making your wallet">Each step is kept on this phone. If the page closes, it continues from the step it reached.</PageHead>
      {lost !== undefined && (
        <Card title="Your wallet has to be made again" tone="warn">
          <div class="stack-s">
            <p>The network no longer has a payment that made your wallet: it was replaced by another, perhaps by whoever sent the first coins, or the block that held it was undone. No coin that reached your addresses is lost. This phone still holds their keys and moves them into the new wallet.</p>
            <p>Payments this phone made from the wallet's first coins may have been undone with it. Look at them under Recent, and make them again if they are still needed.</p>
            <p>Once the wallet is made again, send {name} the new recovery kit: the one they have is for the wallet that no longer exists, so recovery is off until they confirm the new one. Write your own backup down again too.</p>
          </div>
        </Card>
      )}
      <Card>
        <Steps steps={steps} />
      </Card>
    </div>
  );
};
