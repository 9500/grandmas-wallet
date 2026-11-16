import { type OwnerWallet, type TakeoverRecord, OwnerWallet as Wallet } from '@grandmas-wallet/app';
import { Card, Spinner } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { Funding } from './Funding.js';
import { type Session, storedTakeover, storedWallet, walletDependencies } from './session.js';
import { Takeover } from './Takeover.js';
import { WalletScreen } from './WalletScreen.js';
import { Welcome } from './Welcome.js';

type Stage =
  | { at: 'opening' }
  | { at: 'failed'; problem: string }
  | { at: 'welcome' }
  | { at: 'funding' }
  | { at: 'takeover'; takeover: TakeoverRecord }
  | { at: 'wallet'; wallet: OwnerWallet; arrived?: boolean };

/** Which screen the device is at follows from what it holds. */
export const App = ({ session }: { session: Session }) => {
  const [stage, setStage] = useState<Stage>({ at: 'opening' });

  const decide = async () => {
    const record = storedWallet(session);
    let takeover = storedTakeover(session);
    // A new link from the recoverer replaces a takeover that was set up from an earlier one.
    if (record === undefined && takeover !== undefined && session.incoming?.kind === 'restore') {
      session.vault.remove('takeover');
      takeover = undefined;
    }
    if (record !== undefined) {
      setStage({ at: 'wallet', wallet: await Wallet.open(walletDependencies(session), record) });
    } else if (takeover !== undefined) {
      setStage({ at: 'takeover', takeover });
    } else if (session.account !== undefined && session.vault.get<string>('intent') === 'create') {
      setStage({ at: 'funding' });
    } else {
      setStage({ at: 'welcome' });
    }
  };

  useEffect(() => {
    decide().catch((error: Error) => setStage({ at: 'failed', problem: error.message }));
  }, []);

  switch (stage.at) {
    case 'opening':
      return (
        <Card>
          <p>
            <Spinner /> Reading the wallet from the network…
          </p>
        </Card>
      );
    case 'failed':
      return (
        <Card tone="danger">
          <h2>The wallet could not be read</h2>
          <p>{stage.problem}</p>
          <p>
            <button type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </p>
        </Card>
      );
    case 'welcome':
      return <Welcome session={session} onCreate={() => setStage({ at: 'funding' })} onTakeover={(takeover) => setStage({ at: 'takeover', takeover })} />;
    case 'funding':
      return <Funding session={session} onCreated={(wallet) => setStage({ at: 'wallet', wallet })} />;
    case 'takeover':
      return <Takeover session={session} takeover={stage.takeover} onDone={(wallet) => setStage({ at: 'wallet', wallet, arrived: true })} />;
    case 'wallet':
      return <WalletScreen session={session} wallet={stage.wallet} arrived={stage.arrived === true} />;
  }
};
