import { type OwnerWallet, readUserBackup, restoreFromBackup } from '@grandmas-wallet/app';
import { Button, Card, Field, Notice, PageHead, TextArea, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { Erase } from './Details.js';
import { type Session, deviceAccount, keep, kept, saveState } from './session.js';

/** Open the wallet again from the backup the user kept (proposal section 18.1). */
export const Restore = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: (wallet: OwnerWallet) => void }) => {
  const [text, setText] = useState('');
  const [holdsKeys, setHoldsKeys] = useState(false);
  const task = useTask();
  const restore = () =>
    task.run('restore', async (progress) => {
      const backup = readUserBackup(text);
      const earlier = kept('words');
      if (earlier !== undefined && earlier !== backup.words) {
        setHoldsKeys(true);
        throw new Error('This phone already holds keys of its own from an earlier start. Restore on a phone that keeps nothing, or erase this one first.');
      }
      if ((backup.network === 'mainnet') !== (session.network === 'mainnet')) throw new Error(`This backup is for ${backup.network}; this page runs on ${session.environment.network}.`);
      keep('words', backup.words);
      try {
        progress('Opening the keys of these words and reading the wallet from the chain');
        const account = await deviceAccount(session);
        const restored = await restoreFromBackup({ backup, backend: () => account, chain: session.chain, save: saveState });
        const [archive, ...earlierArchives] = backup.archives ?? [];
        if (archive !== undefined) keep('arrangement', { archive, earlierArchives, earlierViewingKeyRecords: [...(backup.earlierViewingKeyRecords ?? [])].reverse() });
        keep('arrival', { from: 'restore', missing: restored.notCovered });
        onDone(restored.wallet);
      } catch (error) {
        if (earlier === undefined) keep('words', undefined);
        throw error;
      }
    });
  return (
    <div class="stack">
      <PageHead title="Restore from your backup">With the twelve words and the wallet's identity, this phone is the same owner. No waiting period and no recoverer are involved.</PageHead>
      <Card>
        <Field label="Your backup" id="backup" hint="Paste the text you kept, or type it in: the lines with network, address scheme, identity and words. Upper or lower case does not matter." error={task.error?.message}>
          <TextArea id="backup" rows={7} value={text} onInput={setText} placeholder={'network: testnet\naddress scheme: 1\nidentity: …\nwords: …'} invalid={task.error !== undefined} />
        </Field>
        {task.busy === 'restore' && task.step !== undefined && <Notice tone="wait" busy>{task.step}</Notice>}
        <div class="actions">
          <Button task={task} name="restore" disabled={text.trim() === ''} onClick={() => void restore()}>
            Restore
          </Button>
          <Button kind="quiet" onClick={onBack}>
            Back
          </Button>
        </div>
        <p class="small muted">The words alone restore nothing, here or in another wallet. A backup made before the wallet moved to a new phone is out of date; the page says so.</p>
      </Card>
      {holdsKeys && <Erase />}
    </div>
  );
};
