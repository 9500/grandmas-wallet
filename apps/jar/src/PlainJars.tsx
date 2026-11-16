import { binToHex, hash160 } from '@bitauth/libauth';
import type { DappLink } from '@grandmas-wallet/connect/wizard';
import { type ChainConnection, type Environment, Amount, Button, Card, Spinner, Vault, connectChain, useEvery, useTask } from '@grandmas-wallet/ui';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type JarRow, JarForm, JarList } from './parts.js';
import {
  type PlainChain,
  type PlainJar,
  type Scan,
  type WalletPaths,
  SMALLEST_JAR,
  checkAndSend,
  findUnlockTimes,
  jarKey,
  loadJar,
  networkOf,
  prepareDeposit,
  prepareWithdrawal,
  scanWallet,
} from './plain.js';

/**
 * Savings jars for an ordinary wallet. The wallet shared its public keys and
 * signs; this page finds the coins, builds each transaction, checks what the
 * wallet signed and sends it.
 */

const vault = new Vault('jar-plain');

/** What this browser remembers about a wallet's jars: when each unlocks and what the user called it. */
type Known = Record<string, string>;

const chainOf = (connection: ChainConnection): PlainChain => ({
  getTransaction: connection.chain.getTransaction,
  getHistory: connection.chain.getHistory,
  listUnspent: connection.chain.listUnspent,
  broadcast: connection.broadcast,
});

export const PlainJars = ({ environment, link, paths, peerName, onDisconnect }: { environment: Environment; link: DappLink; paths: WalletPaths; peerName: string; onDisconnect: () => void }) => {
  const task = useTask();
  const chain = useRef<PlainChain | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>();
  const [scan, setScan] = useState<Scan | undefined>();
  const [jars, setJars] = useState<PlainJar[] | undefined>();
  const [last, setLast] = useState<string | undefined>();
  /**
   * Coins this page has just spent. A server that has not yet heard of a transaction still lists what it
   * spent, so those are left out until the page is loaded again.
   */
  const spent = useRef(new Set<string>());
  const unspent = <T extends { transactionId: string; index: number }>(outputs: T[]): T[] => outputs.filter((output) => !spent.current.has(`${output.transactionId}:${output.index}`));
  // Jars are remembered per wallet, by the key they are locked to.
  const walletName = `jars/${binToHex(hash160(jarKey(paths)))}`;
  const known = (): Known => vault.get<Known>(walletName) ?? {};
  const remember = (unlockTime: number, label: string): void => vault.set(walletName, { ...known(), [String(unlockTime)]: label });

  const jarNow = async (server: PlainChain, unlockTime: number): Promise<PlainJar> => {
    const jar = await loadJar(server, paths, unlockTime);
    const outputs = unspent(jar.outputs);
    return { ...jar, outputs, held: outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) };
  };

  const refresh = async (search = false): Promise<Scan> => {
    const server = chain.current;
    if (server === undefined) throw new Error('The network could not be reached yet.');
    const scanned = await scanWallet(server, paths);
    const coins = unspent(scanned.coins);
    const found: Scan = { ...scanned, coins, balance: coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n) };
    if (search) {
      // Jars opened from another browser are found by the notes their deposits carry.
      for (const unlockTime of await findUnlockTimes(server, paths, found.history)) {
        if (known()[String(unlockTime)] === undefined) remember(unlockTime, 'Savings jar');
      }
      vault.set(`${walletName}/searched`, true);
    }
    const loaded = await Promise.all(Object.keys(known()).map((unlockTime) => jarNow(server, Number(unlockTime))));
    setScan(found);
    setJars(loaded.filter((jar) => jar.held > 0n).sort((a, b) => a.unlockTime - b.unlockTime));
    return found;
  };

  useEffect(() => {
    const wanted = environment.network === 'mainnet' ? 'mainnet' : 'testnet';
    if (networkOf(paths) !== wanted) {
      setProblem(`The wallet is on ${networkOf(paths) === 'mainnet' ? 'the main network' : 'a test network'}; this application is on ${environment.network}. Switch the wallet's network and connect again.`);
      return;
    }
    connectChain(environment.chain, environment.secondsPerBlock)
      .then((connection) => {
        chain.current = chainOf(connection);
        // The first time a wallet connects in this browser, its history is searched for jars it already has.
        return refresh(vault.get<boolean>(`${walletName}/searched`) !== true);
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);
  useEvery(30_000, async () => {
    if (chain.current !== undefined && task.busy === undefined) await refresh();
  });

  const signAndSend = async (prepared: ReturnType<typeof prepareDeposit>, progress: (step: string) => void): Promise<string> => {
    const server = chain.current;
    if (server === undefined) throw new Error('The network could not be reached yet.');
    progress('Waiting for you to approve in your wallet');
    const signed = await link.sign(prepared.request);
    progress('Checking what the wallet signed, and sending it');
    const transactionId = await checkAndSend(server, prepared, signed);
    for (const input of prepared.transaction.inputs) spent.current.add(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    setLast(transactionId);
    return transactionId;
  };

  const open = async (satoshis: bigint, unlockTime: number, label: string, progress: (step: string) => void) => {
    progress('Looking at your wallet\'s coins');
    const prepared = prepareDeposit(paths, await refresh(), satoshis, unlockTime, label);
    // Remembered before anything is signed, so that a jar is never paid into and then forgotten.
    remember(unlockTime, label);
    await signAndSend(prepared, progress);
    await refresh();
  };

  const empty = (row: JarRow) =>
    task.run(`empty-${row.id}`, async (progress) => {
      const server = chain.current;
      if (server === undefined) throw new Error('The network could not be reached yet.');
      const found = await refresh();
      const jar = await jarNow(server, Number(row.id));
      await signAndSend(prepareWithdrawal(paths, found, jar, row.label), progress);
      await refresh();
    });

  if (problem !== undefined) {
    return (
      <Card tone="warn">
        <h2>This wallet cannot be used here yet</h2>
        <p>{problem}</p>
        <Button kind="secondary" onClick={onDisconnect}>
          Disconnect
        </Button>
      </Card>
    );
  }

  const rows: JarRow[] | undefined = jars?.map((jar) => ({ id: String(jar.unlockTime), label: known()[String(jar.unlockTime)] ?? 'Savings jar', unlockTime: jar.unlockTime, satoshis: jar.held }));
  return (
    <>
      <JarList jars={rows} task={task} peerName={peerName} note="Each jar is locked to a key of your wallet. Only your wallet can empty it, and only after its date." onEmpty={(jar) => void empty(jar)}>
        <p class="small muted">
          {scan === undefined ? (
            <>
              <Spinner /> Reading your wallet's coins…
            </>
          ) : (
            <>
              Your wallet holds <Amount satoshis={scan.balance} /> in ordinary coins.
            </>
          )}
        </p>
        <p>
          <Button task={task} name="search" kind="quiet" onClick={() => void task.run('search', async () => void (await refresh(true)))}>
            Look for jars opened elsewhere
          </Button>{' '}
          <Button kind="quiet" onClick={onDisconnect}>
            Disconnect
          </Button>
        </p>
      </JarList>
      <JarForm
        task={task}
        environment={environment}
        smallest={SMALLEST_JAR}
        last={last}
        footnote="This page builds the transaction; your wallet shows it and asks you to approve before signing. The page then checks the signed transaction and sends it."
        onOpen={open}
      />
    </>
  );
};
