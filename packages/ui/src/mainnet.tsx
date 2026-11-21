import { render } from 'preact';

/*
 * The warning every page shows when its configuration runs it on mainnet: a band that stays in view, and a full
 * statement the user confirms once in each browser before the page does anything. Chipnet pages show neither.
 */

/** The short text of the band. */
export const MAINNET_BAND = 'Mainnet: not audited, coins can be lost';

/** The full statement, as it is shown. */
export const MAINNET_STATEMENT = {
  title: 'This page uses real Bitcoin Cash',
  lead: 'It runs on the main network of Bitcoin Cash, where coins have real value.',
  points: [
    'Mainnet is enabled here only to meet the requirements of BCH Blaze.',
    'Nothing here has been audited.',
    'Coins can be lost.',
    'This project does not recommend enabling it.',
  ],
  confirm: 'I understand that coins can be lost',
  once: 'Asked once in this browser.',
} as const;

/** Where a browser keeps that the statement was confirmed. A new wording gets a new value and is asked again. */
export const MAINNET_CONFIRMED_KEY = 'grandmas-wallet:mainnet-statement';
const CONFIRMED_VALUE = '1';

interface Marks {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
}

let mainnetPage = false;

/** Whether this page was configured for mainnet: its frame shows the band, on every screen. */
export const onMainnet = (): boolean => mainnetPage;

/**
 * Wait until the statement is confirmed: at once if this browser confirmed it before, otherwise when `ask` resolves,
 * which is then kept. A browser that keeps nothing is asked each time.
 */
export const mainnetGate = async (marks: Marks | undefined, ask: () => Promise<void>): Promise<void> => {
  mainnetPage = true;
  let confirmed = false;
  try {
    confirmed = marks?.getItem(MAINNET_CONFIRMED_KEY) === CONFIRMED_VALUE;
  } catch {
    // nothing kept
  }
  if (confirmed) return;
  await ask();
  try {
    marks?.setItem(MAINNET_CONFIRMED_KEY, CONFIRMED_VALUE);
  } catch {
    // asked again next time
  }
};

export const MainnetBand = ({ onOpen }: { onOpen?: () => void }) => (
  <button type="button" class="mainnet-band" onClick={onOpen} title="Read the full statement" aria-label={`${MAINNET_BAND}. Read the full statement.`}>
    <span class="mainnet-band-mark" aria-hidden="true">!</span>
    <span class="mainnet-band-text">{MAINNET_BAND}</span>
  </button>
);

const Statement = ({ onConfirm, onClose }: { onConfirm?: () => void; onClose?: () => void }) => (
  <div class="mainnet-gate" role="dialog" aria-modal="true" aria-labelledby="mainnet-title" tabIndex={-1}>
    <div class="mainnet-band static" aria-hidden="true">
      <span class="mainnet-band-mark">!</span>
      <span class="mainnet-band-text">{MAINNET_BAND}</span>
    </div>
    <div class="mainnet-statement">
      <h1 id="mainnet-title">{MAINNET_STATEMENT.title}</h1>
      <p>{MAINNET_STATEMENT.lead}</p>
      <ul>
        {MAINNET_STATEMENT.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {onConfirm !== undefined ? (
        <>
          <button type="button" class="block" onClick={onConfirm}>
            {MAINNET_STATEMENT.confirm}
          </button>
          <p class="small muted">{MAINNET_STATEMENT.once}</p>
        </>
      ) : (
        <button type="button" class="secondary block" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  </div>
);

/** Show the statement over the page; resolves when it is confirmed, or closed where it was confirmed before. */
const showStatement = (confirming: boolean): Promise<void> =>
  new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.append(host);
    const done = () => {
      render(null, host);
      host.remove();
      resolve();
    };
    render(confirming ? <Statement onConfirm={done} /> : <Statement onClose={done} />, host);
    host.querySelector<HTMLElement>('.mainnet-gate')?.focus();
  });

/** Before a page configured for mainnet does anything: the statement, confirmed once in this browser. */
export const confirmMainnet = (): Promise<void> => {
  let marks: Marks | undefined;
  try {
    marks = window.localStorage;
  } catch {
    marks = undefined;
  }
  return mainnetGate(marks, () => showStatement(true));
};

/** The statement again, from the band. */
export const showMainnetStatement = (): void => void showStatement(false);
