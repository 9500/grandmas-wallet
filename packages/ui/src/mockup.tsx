import { useState } from 'preact/hooks';

import { Button, Notice, plainError } from './components.js';
import type { Environment } from './environment.js';
import { MOCKUP } from './network.js';

/*
 * The mockup: a chain of the deployment's own, on which everything works as on chipnet, with two differences a
 * page offers where they matter. Coins are free: the mockup's service pays an address that asks. And nobody has
 * to wait: the service moves the chain's clock on when asked. See docs/mockup.md.
 */

/** Whether the page runs on the mockup and knows its service. */
export const onMockup = (environment: Pick<Environment, 'network' | 'mockupService'>): boolean => environment.network === MOCKUP && typeof environment.mockupService === 'string' && environment.mockupService !== '';

const ask = async <Answer,>(environment: Pick<Environment, 'mockupService'>, path: string, body: Record<string, unknown>): Promise<Answer> => {
  let response: Response;
  try {
    response = await fetch(`${(environment.mockupService ?? '').replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('The mockup\'s service could not be reached. Try again in a moment.');
  }
  const answer = (await response.json().catch(() => ({}))) as Answer & { error?: unknown };
  if (!response.ok) throw new Error(typeof answer.error === 'string' ? answer.error : 'The mockup\'s service refused the request.');
  return answer;
};

/** Ask the mockup's service to pay an address. Resolves with the payment's transaction. */
export const playCoins = async (environment: Pick<Environment, 'mockupService'>, address: string, satoshis: bigint): Promise<string> =>
  (await ask<{ transactionId: string }>(environment, '/coins', { address, satoshis: Number(satoshis) })).transactionId;

/** Ask the mockup's service to move the chain's clock on, for everyone on the mockup. */
export const letTimePass = async (environment: Pick<Environment, 'mockupService'>, seconds: number): Promise<void> => {
  await ask(environment, '/skip', { seconds: Math.max(1, Math.ceil(seconds)) });
};

/**
 * On the mockup, a button that has play coins sent to an address; nothing elsewhere.
 * @param address - where they go; the button waits while it is not known yet
 */
export const PlayCoins = ({ environment, address, satoshis, label, onPaid }: { environment: Environment; address: string | undefined; satoshis: bigint; label?: string; onPaid?: () => void }) => {
  const [state, setState] = useState<{ busy?: boolean; problem?: string; paid?: boolean }>({});
  if (!onMockup(environment)) return null;
  return (
    <div class="stack-s mockup-help" data-testid="play-coins">
      <div>
        <Button
          kind="secondary"
          disabled={address === undefined || state.busy === true}
          onClick={() => {
            if (address === undefined) return;
            setState({ busy: true });
            playCoins(environment, address, satoshis).then(
              () => {
                setState({ paid: true });
                onPaid?.();
              },
              (error: unknown) => setState({ problem: plainError(error) }),
            );
          }}
        >
          {state.busy === true ? 'Asking for play coins…' : (label ?? 'Get play coins')}
        </Button>
      </div>
      {state.paid === true && <span class="small muted">Sent. They show here in a few seconds.</span>}
      {state.problem !== undefined && <Notice tone="bad">{state.problem}</Notice>}
      <span class="small muted">Mockup only: its coins are free and have no value.</span>
    </div>
  );
};

/**
 * On the mockup, a button that moves the chain's clock on by what is still to wait; nothing elsewhere.
 * @param seconds - how far the clock has to move for the wait to be over
 */
export const LetTimePass = ({ environment, seconds, label, onPassed }: { environment: Environment; seconds: number; label?: string; onPassed?: () => void }) => {
  const [state, setState] = useState<{ busy?: boolean; problem?: string }>({});
  if (!onMockup(environment)) return null;
  return (
    <div class="stack-s mockup-help" data-testid="let-time-pass">
      <div>
        <Button
          kind="secondary"
          disabled={state.busy === true}
          onClick={() => {
            setState({ busy: true });
            letTimePass(environment, seconds).then(
              () => {
                setState({});
                onPassed?.();
              },
              (error: unknown) => setState({ problem: plainError(error) }),
            );
          }}
        >
          {state.busy === true ? 'Moving the chain\'s clock on…' : (label ?? 'Let the waiting period pass')}
        </Button>
      </div>
      {state.problem !== undefined && <Notice tone="bad">{state.problem}</Notice>}
      <span class="small muted">Mockup only: the chain's clock moves on for everyone on it. On chipnet and mainnet the wait takes its real time.</span>
    </div>
  );
};
