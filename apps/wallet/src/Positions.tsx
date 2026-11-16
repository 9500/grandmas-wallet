import { type ActionPreview, type ApplicationAction, type OwnerWallet, type PositionView, type WalletView, NotYetValidError } from '@grandmas-wallet/app';
import { Amount, Button, Card, TaskStatus, TransactionLink, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { ActionView, TemplateValue } from './ActionView.js';
import type { Session } from './session.js';

/**
 * What the wallet holds under applications' templates. Each position shows
 * what its template says about it and offers the actions the template
 * allows, so that it can be operated here even when the application that
 * made it is gone.
 */
export const Positions = ({ session, wallet, view, onChanged }: { session: Session; wallet: OwnerWallet; view: WalletView; onChanged: () => Promise<void> }) => {
  const task = useTask();
  const [chosen, setChosen] = useState<{ request: ApplicationAction; preview: ActionPreview } | undefined>();
  const [last, setLast] = useState<string | undefined>();
  const positions = view.positions.filter((position) => position.status !== 'closed' && (position.status === 'open' || position.held > 0n));
  if (positions.length === 0) return null;

  const choose = (position: PositionView, action: PositionView['actions'][number]) =>
    task.run(`look-${position.position.positionId}-${action.action}`, async () => {
      const template = position.position.template?.identifier;
      if (template === undefined) throw new Error('This position has no template.');
      const request: ApplicationAction = { template, action: action.action, role: action.role, variables: {}, positionId: position.position.positionId };
      setChosen({ request, preview: await wallet.previewAction(request) });
    });

  const confirm = () =>
    task.run('confirm', async (progress) => {
      if (chosen === undefined) return;
      progress('Signing and sending');
      try {
        const sent = await wallet.runAction(chosen.request);
        setLast(sent.transactionId);
      } catch (error) {
        if (error instanceof NotYetValidError) throw new Error('The network\'s clock runs a few minutes behind. Please try again in a little while.', { cause: error });
        throw error;
      }
      setChosen(undefined);
      await onChanged();
    });

  return (
    <Card>
      <h2>Held with applications</h2>
      <p class="small muted">Money this wallet has put under an application's rules. It stays yours and moves with the wallet to a new device.</p>
      <ul class="list">
        {positions.map((position) => (
          <li>
            <div class="row spread">
              <div>
                <strong>{position.position.label ?? 'Position'}</strong> · <Amount satoshis={position.held} />
                <div class="small muted">
                  {position.templateName ?? 'An application this device has no template for'}
                  {position.details
                    .filter((detail) => !(detail.type === 'token_category' && detail.value === view.identity))
                    .map((detail) => (
                      <>
                        {' · '}
                        {detail.name}: <TemplateValue type={detail.type} value={detail.value} identity={view.identity} />
                      </>
                    ))}
                </div>
              </div>
              <div class="row">
                {position.held > 0n &&
                  position.actions.map((action) => (
                    <Button task={task} name={`look-${position.position.positionId}-${action.action}`} kind="secondary" onClick={() => void choose(position, action)}>
                      {action.name}
                    </Button>
                  ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {chosen !== undefined && (
        <div class="notice">
          <ActionView preview={chosen.preview} identity={view.identity} />
          <div class="row">
            <Button task={task} name="confirm" onClick={() => void confirm()}>
              Confirm
            </Button>
            <Button kind="secondary" onClick={() => setChosen(undefined)}>
              Not now
            </Button>
          </div>
        </div>
      )}
      <TaskStatus task={task} />
      {last !== undefined && task.busy === undefined && task.error === undefined && chosen === undefined && (
        <p class="notice ok">
          Done. <TransactionLink environment={session.environment} transactionId={last} />
        </p>
      )}
    </Card>
  );
};
