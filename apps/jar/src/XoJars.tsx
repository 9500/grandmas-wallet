import { type JsonValue, templateContentHash } from '@grandmas-wallet/archive';
import { type ActionDetails, type RequestStage, type XoAdvertisement, DappRequests } from '@grandmas-wallet/connect';
import type { DappLink } from '@grandmas-wallet/connect/wizard';
import { savingsJarTemplate, savingsJarTemplateIdentifier } from '@grandmas-wallet/savings-jar';
import { type Environment, Button, useTask } from '@grandmas-wallet/ui';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { type JarRow, JarForm, JarList } from './parts.js';

/**
 * Savings jars for a wallet that speaks XO requests. The page holds no keys
 * and builds no transactions: it presents its template and asks for the
 * template's actions, and the wallet does the rest.
 */

const TEMPLATE = { identifier: savingsJarTemplateIdentifier, contentHash: templateContentHash(savingsJarTemplate as unknown as JsonValue) };
/** A jar has to pay the fee for emptying it from what it holds. */
const SMALLEST = 1_720n;

const STAGES: Record<RequestStage, string> = {
  sent: 'Asking your wallet',
  accepted: 'Waiting for you to approve in your wallet',
  approved: 'Approved; your wallet is saving the jar\'s record',
  recorded: 'Your wallet is signing',
  'on-network': 'Sent to the network',
};

/** Whether a wallet's XO offer is one this application can work with. */
export const xoProblem = (offered: XoAdvertisement, network: string): string | undefined => {
  if (offered.network !== network) return `The wallet is on ${offered.network}; this application is on ${network}.`;
  if (!offered.bindings.includes('identity')) return 'The wallet has no identity to bind a savings jar to.';
  return undefined;
};

export const XoJars = ({ environment, link, offered, peerName, onDisconnect }: { environment: Environment; link: DappLink; offered: XoAdvertisement; peerName: string; onDisconnect: () => void }) => {
  const task = useTask();
  const requests = useMemo(() => new DappRequests(), []);
  const [jars, setJars] = useState<JarRow[] | undefined>();
  const [last, setLast] = useState<string | undefined>();

  /** An action of this application's template. The template itself goes along unless the wallet said it has it. */
  const ask = (details: Pick<ActionDetails, 'templateAction' | 'variables'> & Partial<ActionDetails>, progress: (step: string) => void) => {
    const known = offered.templates.some((template) => template.identifier === TEMPLATE.identifier && template.contentHash === TEMPLATE.contentHash);
    return requests.request({ template: TEMPLATE, ...(known ? {} : { definition: savingsJarTemplate }), role: 'saver', ...details }, (stage) => progress(STAGES[stage]));
  };

  const list = async () => {
    const positions = await requests.positions(TEMPLATE.identifier);
    setJars(
      positions
        .map((jar) => ({ id: jar.position, label: jar.label === '' ? 'Savings jar' : jar.label, unlockTime: Number(jar.variables['unlockTime'] ?? 0), satoshis: BigInt(jar.satoshis) }))
        .sort((a, b) => a.unlockTime - b.unlockTime),
    );
  };

  useEffect(() => {
    requests.attach(link.channel);
    void list().catch(() => setJars([]));
    return () => requests.detach();
  }, [link]);

  const open = async (satoshis: bigint, unlockTime: number, label: string, progress: (step: string) => void) => {
    if (satoshis < SMALLEST) throw new Error(`A jar needs at least ${SMALLEST} satoshis, so that it can pay the network fee when it is emptied.`);
    const result = await ask(
      { templateAction: 'deposit', variables: { unlockTime, savedSatoshis: satoshis.toString() }, bindings: { identity: 'identity' }, label },
      progress,
    );
    setLast(String(result['transactionId'] ?? ''));
    await list();
  };

  const empty = (jar: JarRow) =>
    task.run(`empty-${jar.id}`, async (progress) => {
      // The wallet knows the jar's own values; the application names the jar and the action.
      const result = await ask({ templateAction: 'withdraw', variables: {}, position: jar.id }, progress);
      setLast(String(result['transactionId'] ?? ''));
      await list();
    });

  return (
    <>
      <JarList jars={jars} task={task} peerName={peerName} note="Each jar belongs to your wallet and moves with it if you ever change devices." onEmpty={(jar) => void empty(jar)}>
        <p>
          <Button kind="quiet" onClick={() => void list()}>
            Refresh
          </Button>{' '}
          <Button kind="quiet" onClick={onDisconnect}>
            Disconnect
          </Button>
        </p>
      </JarList>
      <JarForm
        task={task}
        environment={environment}
        smallest={SMALLEST}
        last={last}
        footnote="Your wallet shows what will happen, in the words of this application's template and in its own figures, and asks you to approve before anything is signed."
        onOpen={open}
      />
    </>
  );
};
