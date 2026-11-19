import { hexToBin } from '@bitauth/libauth';
import { type OwnerWallet, type OwnerWalletState, describeDelay, finishSetUp, firstAddressFor, requestSetUp } from '@grandmas-wallet/app';
import type { Created } from '@grandmas-wallet/connect/recoverer';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { Button, Info, Spinner, formatBch, formatSatoshis, plainError } from '@grandmas-wallet/ui';
import { useEffect, useRef, useState } from 'preact/hooks';

import { askToSetUp, leaveRecoverer, meetRecoverer } from './hand-to-recoverer.js';
import { ScanCode } from './ScanCode.js';
import { type Session, type StoredRecipient, type StoredSetUp, deviceAccount, deviceWords, keep, kept, openWallet, saveState, seedOf } from './session.js';

/**
 * Setting the wallet up with the recoverer (proposal section 7.9): the phone scans the recoverer's code, makes its
 * keys and asks over the session the code offers; the recoverer creates the wallet from its own coins; the phone
 * checks the creation and opens its wallet. Three screens: the scan, "Setting up…", and "Your wallet is ready".
 * Everything is kept on the phone as it happens, so that a reload goes on where it stopped with the same request.
 */
export const SetUp = ({ session, kind, onBack, onDone }: { session: Session; kind: 'bank' | 'friend'; onBack: () => void; onDone: (wallet?: OwnerWallet) => void }) => {
  const [setUp, setSetUp] = useState<StoredSetUp>(() => kept('setUp') ?? { kind });
  const store = (next: StoredSetUp) => {
    keep('setUp', next);
    setSetUp(next);
  };
  const wallet = useRef<OwnerWallet | undefined>(undefined);
  if (setUp.recipient === undefined) {
    return (
      <ScanCode
        title={setUp.kind === 'bank' ? 'Scan your bank\'s code' : 'Scan the code on their screen'}
        onBack={() => {
          keep('setUp', undefined);
          onBack();
        }}
        onRead={(recipient) => store({ ...setUp, recipient })}
      />
    );
  }
  if (setUp.done !== undefined) {
    // After a reload on this screen the wallet is opened from what the phone kept.
    // A wallet that does not open here is opened by the wallet's own screen, which says what is wrong.
    const open = () => (wallet.current === undefined ? void openWallet(session).then(onDone, () => onDone()) : onDone(wallet.current));
    return <Ready name={setUp.recipient.name} startingSatoshis={BigInt(setUp.done.startingSatoshis)} onOpen={open} />;
  }
  return (
    <SettingUp
      session={session}
      setUp={setUp}
      store={store}
      onOpened={(opened, startingSatoshis) => {
        wallet.current = opened;
        store({ ...setUp, done: { startingSatoshis: startingSatoshis.toString() } });
      }}
      onAgain={() => {
        leaveRecoverer();
        store({ kind: setUp.kind });
      }}
      onBack={onBack}
    />
  );
};

/** "Setting up…": meeting the recoverer's page, asking, and opening the wallet that comes back. */
const SettingUp = ({ session, setUp, store, onOpened, onAgain, onBack }: { session: Session; setUp: StoredSetUp; store: (next: StoredSetUp) => void; onOpened: (wallet: OwnerWallet, startingSatoshis: bigint) => void; onAgain: () => void; onBack: () => void }) => {
  const recipient = setUp.recipient as StoredRecipient;
  const name = recipient.name || (setUp.kind === 'bank' ? 'Your bank' : 'Your helper');
  const [stage, setStage] = useState<'meeting' | 'asking' | 'waiting' | 'opening'>('meeting');
  const [problem, setProblem] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    setProblem(undefined);
    const run = async () => {
      // The phone's keys are opened meanwhile: the engine checks the chain's block headers first.
      const account = deviceAccount(session);
      setStage('meeting');
      const said = await meetRecoverer(recipient);
      if (said.offer === undefined) throw new Error(`${name}'s code does not set wallets up. Ask them for the code that does.`);
      const seed = seedOf(session, deviceWords());
      let pending = setUp.pending;
      if (pending === undefined) {
        setStage('asking');
        pending = await requestSetUp({
          seed,
          stores: session.environment.stores,
          storeAt: session.storeAt,
          recovererPublicKey: hexToBin(recipient.publicKey),
          challengeDelay: said.offer.challengeDelay,
          firstAddress: firstAddressFor(kept('state')),
        });
        // Kept before it is sent: after a reload the same request goes again.
        store({ ...setUp, offer: said.offer, pending });
      }
      if (stopped) return;
      setStage('asking');
      const created: Created = await askToSetUp(recipient, pending, () => setStage('waiting'));
      if (stopped) return;
      setStage('opening');
      const opened = await finishSetUp({ answer: created, pending, seed, backend: await account, chain: session.chain, ...(kept('state') === undefined ? {} : { state: kept('state') as OwnerWalletState }), save: saveState });
      keep('arrangement', opened.arrangement);
      keep('recipient', recipient);
      keep('lostSetUp', undefined);
      leaveRecoverer(recipient.session);
      onOpened(opened.wallet, opened.startingSatoshis);
    };
    run().catch((error: unknown) => {
      if (!stopped) setProblem(plainError(error));
    });
    return () => {
      stopped = true;
    };
  }, [attempt]);
  return <SettingUpView name={name} kind={setUp.kind} stage={stage} challengeDelay={setUp.offer?.challengeDelay} problem={problem} onRetry={() => setAttempt(attempt + 1)} onAgain={onAgain} onBack={onBack} />;
};

/** What "Setting up…" shows, and a refusal or a page that did not answer, with the way on. */
export const SettingUpView = ({
  name,
  kind,
  stage,
  challengeDelay,
  problem,
  onRetry,
  onAgain,
  onBack,
}: {
  name: string;
  kind: 'bank' | 'friend';
  stage: string;
  challengeDelay?: ChallengeDelay | undefined;
  problem?: string | undefined;
  onRetry: () => void;
  onAgain: () => void;
  /** The way back to the first screen. The request is kept: the recoverer may already be making the wallet for it. */
  onBack?: (() => void) | undefined;
}) => {
  if (problem !== undefined) {
    return (
      <div class="stack set-up">
        <div class="set-up-head">
          <h1>Not set up</h1>
          <p class="set-up-problem" data-testid="set-up-problem">{problem}</p>
        </div>
        <div class="set-up-actions">
          <Button block onClick={onRetry}>
            Try again
          </Button>
          <Button block kind="quiet" onClick={onAgain}>
            Scan again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div class="stack set-up" data-testid="setting-up" data-stage={stage}>
      {onBack !== undefined && (
        <button type="button" class="link" onClick={onBack}>
          ‹ Back
        </button>
      )}
      <div class="set-up-head">
        <div class="set-up-spinner">
          <Spinner />
        </div>
        <h1>Setting up…</h1>
        <p class="muted">{stage === 'waiting' && kind === 'friend' ? `Waiting for ${name} to say yes` : `With ${name}`}</p>
      </div>
      {challengeDelay !== undefined && (
        <p class="small muted center">
          Waiting period {describeDelay(challengeDelay)}{' '}
          <Info label="What the waiting period is">If you lose this phone, they can move your wallet to a new one. They have to ask in public first, and for this long this phone can say no. They can never spend your coins.</Info>
        </p>
      )}
    </div>
  );
};

/** "Your wallet is ready": the balance and who protects it, and the way in. */
export const Ready = ({ name, startingSatoshis, onOpen }: { name: string; startingSatoshis: bigint; onOpen: () => void }) => (
  <div class="stack set-up" data-testid="wallet-ready">
    <div class="set-up-head">
      <h1>Your wallet is ready</h1>
    </div>
    <div class="balance set-up-balance">
      <span class="balance-main">
        {formatBch(startingSatoshis)}
        <span class="unit">BCH</span>
      </span>
      <span class="balance-sub">{formatSatoshis(startingSatoshis)} satoshis</span>
    </div>
    <p class="set-up-protected">
      Protected by <strong>{name || 'your recoverer'}</strong>{' '}
      <Info label="What protected means">If you lose this phone, they can move your wallet to a new one after a waiting period, during which this phone can say no. They can see what the wallet holds and can never spend from it.</Info>
    </p>
    <div class="set-up-actions">
      <Button block onClick={onOpen}>
        Open my wallet
      </Button>
    </div>
  </div>
);
