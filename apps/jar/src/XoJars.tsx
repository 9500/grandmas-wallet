import { type RequestStage, DappRequests } from '@grandmas-wallet/connect';
import type { DappLink } from '@grandmas-wallet/connect/wizard';
import { savingsJarTemplateIdentifier } from '@grandmas-wallet/templates';
import { type Environment, Button, useTask } from '@grandmas-wallet/ui';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { type JarRow, JarForm, JarList } from './parts.js';

/**
 * Savings jars for a wallet that speaks XO requests. The page holds no keys
 * and builds no transactions; it says what the user chose and the wallet
 * does the rest.
 */

const STAGES: Record<RequestStage, string> = {
  sent: 'Asking your wallet',
  accepted: 'Waiting for you to approve in your wallet',
  approved: 'Approved; your wallet is saving the jar\'s record',
  recorded: 'Your wallet is signing',
  'on-network': 'Sent to the network',
};

interface Listed {
  positionId: string;
  label: string;
  unlockTime: number;
  satoshis: string;
}

export const XoJars = ({ environment, link, peerName, onDisconnect }: { environment: Environment; link: DappLink; peerName: string; onDisconnect: () => void }) => {
  const task = useTask();
  const requests = useMemo(() => new DappRequests(), []);
  const [jars, setJars] = useState<JarRow[] | undefined>();
  const [last, setLast] = useState<string | undefined>();

  const list = async () => {
    const result = await requests.request(savingsJarTemplateIdentifier, 'list', {});
    const positions = Array.isArray(result['positions']) ? (result['positions'] as Listed[]) : [];
    setJars(positions.map((jar) => ({ id: jar.positionId, label: jar.label, unlockTime: jar.unlockTime, satoshis: BigInt(jar.satoshis) })));
  };

  useEffect(() => {
    requests.attach(link.channel);
    void list().catch(() => undefined);
    return () => requests.detach();
  }, [link]);

  const open = async (satoshis: bigint, unlockTime: number, label: string, progress: (step: string) => void) => {
    const result = await requests.request(savingsJarTemplateIdentifier, 'open', { satoshis: satoshis.toString(), unlockTime, label }, (stage) => progress(STAGES[stage]));
    setLast(String(result['transactionId'] ?? ''));
    await list();
  };

  const empty = (jar: JarRow) =>
    task.run(`empty-${jar.id}`, async (progress) => {
      const result = await requests.request(savingsJarTemplateIdentifier, 'empty', { positionId: jar.id }, (stage) => progress(STAGES[stage]));
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
        smallest={1_720n}
        last={last}
        footnote="Your wallet shows what will happen and asks you to approve before anything is signed."
        onOpen={open}
      />
    </>
  );
};
