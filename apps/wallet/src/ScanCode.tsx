import { Button, Field, More, TextArea, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { RECOVERER_LINK } from './scan.js';
import { ScanDialog } from './Scanner.js';
import { type StoredRecipient, keep, kept, readRecipientLink } from './session.js';

/**
 * Scanning the recoverer's code: the scanner opens at once. A phone without a camera, or a test, can paste the code's
 * text instead. A code the page was opened with is taken as if scanned.
 */
export const ScanCode = ({ title, onRead, onBack }: { title: string; onRead: (recipient: StoredRecipient) => void; onBack: () => void }) => {
  const [open, setOpen] = useState(() => kept('incoming')?.kind !== 'recoverer');
  const [text, setText] = useState('');
  const task = useTask();
  const use = (value: string) => void task.run('read', async () => onRead(await readRecipientLink(value)));
  useEffect(() => {
    const incoming = kept('incoming');
    if (incoming?.kind !== 'recoverer') return;
    keep('incoming', undefined);
    use(incoming.text);
  }, []);
  return (
    <div class="stack set-up">
      <div class="set-up-head">
        <h1>{title}</h1>
      </div>
      <div class="set-up-actions">
        <Button block onClick={() => setOpen(true)}>
          Scan the code
        </Button>
        <Button block kind="quiet" onClick={onBack}>
          Back
        </Button>
      </div>
      {task.error !== undefined && <p class="small set-up-problem">{task.error.message}</p>}
      <More summary="No camera?">
        <Field label="The code's text" id="code-text">
          <TextArea id="code-text" value={text} onInput={setText} placeholder="https://…#recoverer=…" />
        </Field>
        <Button kind="secondary" task={task} name="read" disabled={text.trim() === ''} onClick={() => use(text)}>
          Use it
        </Button>
      </More>
      {open && <ScanDialog filter={RECOVERER_LINK} onScan={use} onClose={() => setOpen(false)} />}
    </div>
  );
};
