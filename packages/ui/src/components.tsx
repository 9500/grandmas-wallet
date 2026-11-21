import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';

import type { Environment } from './environment.js';
import { MainnetBand, onMainnet, showMainnetStatement } from './mainnet.js';
import { NetworkChip } from './network-choice.js';
import { tabWork } from './tab-work.js';

/*
 * The parts both pages are built from. Wording on them is the pages' own; these only give it a shape.
 */

// ------------------------------------------------------------------ icons (stroked, 24 px grid)

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  receive: 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14',
  send: 'M12 20V8m0 0-5 5m5-5 5 5M5 4h14',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-5',
  details: 'M4 6h16M4 12h16M4 18h10',
  wallets: 'M4 7h16v12H4zM4 7l2-3h12l2 3M15 13h2',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H4V18l6.5-6.5M15.5 7.5h.01',
  apps: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
} as const;

export type IconName = keyof typeof ICONS;

export const Icon = ({ name }: { name: IconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

// ------------------------------------------------------------------ routes

/** Navigation by the page's path, so that the browser's back button works. The part after `#` is left to links. */
export const useRoute = <Route extends string>(routes: readonly Route[], fallback: Route): [Route, (route: Route) => void] => {
  const read = (): Route => {
    const name = window.location.pathname.replace(/^\/+|\/+$/g, '') as Route;
    return routes.includes(name) ? name : fallback;
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((next: Route) => {
    const path = next === fallback ? '/' : `/${next}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);
  return [route, navigate];
};

// ------------------------------------------------------------------ the frame

export interface NavItem<Route extends string = string> {
  route: Route;
  label: string;
  icon: IconName;
  /** Shown in the side rail on wide screens only. */
  sideOnly?: boolean;
  /** Something wants attention there. */
  flag?: boolean;
}

/**
 * The page's frame. With navigation: a bar at the bottom on phones and a rail at the side on wide screens.
 * Without: a single narrow column, for the steps before there is a wallet.
 */
export const Frame = <Route extends string>({
  brand,
  role,
  environment,
  nav,
  current,
  onNavigate,
  networkChoice,
  children,
}: {
  brand: string;
  role: string;
  environment?: Environment | undefined;
  /** The network label opens the choice of network, where the deployment offers one. */
  networkChoice?: boolean;
  nav?: NavItem<Route>[];
  current?: Route;
  onNavigate?: (route: Route) => void;
  children: ComponentChildren;
}) => {
  const chip = environment === undefined ? null : <NetworkChip environment={environment} choosable={networkChoice === true} />;
  const mark = <span class="brand-mark" aria-hidden="true">{brand.slice(0, 1)}</span>;
  const brandBlock = (
    <div class="brand">
      {mark}
      <span>
        <span class="brand-name">{brand}</span>
        <span class="brand-role">{role}</span>
      </span>
    </div>
  );
  // On mainnet, the band stays in view on every screen, also before the configuration is handed to the frame.
  const mainnet = environment?.network === 'mainnet' || onMainnet();
  return (
    <>
    {mainnet && <MainnetBand onOpen={showMainnetStatement} />}
    <div class={`app ${nav === undefined ? 'narrow' : 'with-nav'}${mainnet ? ' mainnet' : ''}`}>
      <header class="topbar">
        {brandBlock}
        {chip}
      </header>
      {nav !== undefined && (
        <div class="rail">
          {brandBlock}
          <nav class="nav" aria-label="Sections">
            {nav.map((item) => (
              <a
                key={item.route}
                href={`/${item.route}`}
                class={item.sideOnly === true ? 'side-only' : ''}
                aria-current={item.route === current ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate?.(item.route);
                }}
              >
                <Icon name={item.icon} />
                <span>
                  {item.label}
                  {item.flag === true && <span class="visually-flag" aria-label="needs attention"> •</span>}
                </span>
              </a>
            ))}
          </nav>
          <div class="rail-foot">{chip}</div>
        </div>
      )}
      <main class="content">{children}</main>
    </div>
    </>
  );
};

export const PageHead = ({ title, children }: { title: string; children?: ComponentChildren }) => (
  <div class="page-head">
    <h1>{title}</h1>
    {children !== undefined && <p>{children}</p>}
  </div>
);

export type Tone = 'good' | 'warn' | 'bad' | 'wait';

export const Card = ({ title, aside, tone, flat, children, id, cls }: { title?: string; aside?: ComponentChildren; tone?: Tone | undefined; flat?: boolean; children: ComponentChildren; id?: string; cls?: string }) => (
  <section class={['card', tone ?? '', flat === true ? 'flat' : '', cls ?? ''].join(' ').replace(/\s+/g, ' ').trim()} id={id}>
    {title !== undefined &&
      (aside === undefined ? (
        <h2>{title}</h2>
      ) : (
        <div class="card-head">
          <h2>{title}</h2>
          {aside}
        </div>
      ))}
    {children}
  </section>
);

export const Spinner = () => <span class="spinner" aria-hidden="true" />;

export const Loading = ({ children }: { children: ComponentChildren }) => (
  <div class="loading" role="status">
    <Spinner />
    <div>{children}</div>
  </div>
);

/** One line of state with a coloured dot, and what it means underneath. */
export const Status = ({ tone, title, children }: { tone?: Tone | undefined; title: ComponentChildren; children?: ComponentChildren }) => (
  <div class={`status ${tone ?? ''}`}>
    <span class="status-dot" aria-hidden="true" />
    <div>
      <div class="status-title">{title}</div>
      {children !== undefined && <div class="status-body">{children}</div>}
    </div>
  </div>
);

export const Notice = ({ tone, busy, children }: { tone?: Tone | undefined; busy?: boolean; children: ComponentChildren }) => (
  <div class={`notice ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : undefined}>
    {busy === true && <Spinner />}
    <div>{children}</div>
  </div>
);

export const Pill = ({ tone, children }: { tone?: Tone | 'accent' | undefined; children: ComponentChildren }) => <span class={`pill ${tone ?? ''}`}>{children}</span>;

export interface Step {
  title: string;
  detail?: ComponentChildren;
  state: 'done' | 'current' | 'later';
}

export const Steps = ({ steps }: { steps: Step[] }) => (
  <ol class="steps">
    {steps.map((step) => (
      <li class={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
        <div class="step-title">{step.title}</div>
        {step.detail !== undefined && <div class="step-detail">{step.detail}</div>}
      </li>
    ))}
  </ol>
);

// ------------------------------------------------------------------ work in progress, and its failure next to it

/** Running one thing at a time, with its progress and its failure shown next to the button that started it. */
export const useTask = () => {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<{ name: string; message: string } | undefined>();
  const [step, setStep] = useState<string | undefined>();
  const run = useCallback(async <T,>(name: string, work: (progress: (step: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(name);
    setError(undefined);
    setStep(undefined);
    // A newer tab of the page waits for this to end before it takes over (tab.tsx).
    tabWork.begin();
    try {
      return await work(setStep);
    } catch (problem) {
      console.error(problem);
      setError({ name, message: plainError(problem) });
      return undefined;
    } finally {
      tabWork.end();
      setBusy(undefined);
      setStep(undefined);
    }
  }, []);
  return { busy, error, step, run, clearError: () => setError(undefined) };
};

export type Task = ReturnType<typeof useTask>;

/** An error in words a person can act on. Long technical tails are cut. */
export const plainError = (problem: unknown): string => {
  const message = problem instanceof Error ? problem.message : String(problem);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return 'A server could not be reached. Check the connection and try again.';
  if (/non-?BIP68-final/i.test(message)) return 'The network does not accept this yet: the waiting period has not passed by the chain\'s clock.';
  if (/^Insufficient funds/.test(message)) return `Not enough coins for this and its fee. ${message.replace(/^Insufficient funds: /, '')}`;
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
};

/** What a task is doing, or why it failed, shown where it was started. */
export const TaskStatus = ({ task, name }: { task: Task; name?: string }) => {
  const mine = (candidate: string | undefined) => name === undefined || candidate === name;
  return (
    <>
      {task.busy !== undefined && mine(task.busy) && task.step !== undefined && (
        <Notice tone="wait" busy>
          {task.step}
        </Notice>
      )}
      {task.error !== undefined && mine(task.error.name) && <Notice tone="bad">{task.error.message}</Notice>}
    </>
  );
};

export const Button = ({
  task,
  name,
  onClick,
  children,
  kind,
  disabled,
  block,
  small,
  type,
}: {
  task?: Task;
  /** The name under which the task runs; the button shows as busy while it does. */
  name?: string;
  onClick?: () => void;
  children: ComponentChildren;
  kind?: 'secondary' | 'danger' | 'quiet' | 'link';
  disabled?: boolean;
  block?: boolean;
  small?: boolean;
  type?: 'button' | 'submit';
}) => (
  <button
    type={type ?? 'button'}
    class={[kind ?? '', block === true ? 'block' : '', small === true ? 'small' : ''].join(' ').trim()}
    disabled={disabled === true || task?.busy !== undefined}
    aria-busy={task?.busy !== undefined && task.busy === name}
    onClick={onClick}
  >
    {task?.busy !== undefined && task.busy === name ? <Spinner /> : null}
    {children}
  </button>
);

// ------------------------------------------------------------------ forms

export const Field = ({ label, hint, error, children, id }: { label: string; hint?: ComponentChildren; error?: string | undefined; children: ComponentChildren; id?: string }) => (
  <div class="field">
    <label for={id}>{label}</label>
    {children}
    {error !== undefined && error !== '' ? <div class="field-error">{error}</div> : hint !== undefined && <div class="hint">{hint}</div>}
  </div>
);

export const TextInput = ({
  value,
  onInput,
  placeholder,
  numeric,
  id,
  invalid,
  label,
}: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  id?: string;
  invalid?: boolean;
  label?: string;
}) => (
  <input
    id={id}
    type="text"
    inputMode={numeric === true ? 'decimal' : 'text'}
    value={value}
    placeholder={placeholder ?? ''}
    autocomplete="off"
    autocapitalize="off"
    spellcheck={false}
    aria-invalid={invalid === true}
    aria-label={label}
    onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
  />
);

export const TextArea = ({ value, onInput, placeholder, id, invalid, rows }: { value: string; onInput: (value: string) => void; placeholder?: string; id?: string; invalid?: boolean; rows?: number }) => (
  <textarea
    id={id}
    value={value}
    rows={rows ?? 3}
    placeholder={placeholder ?? ''}
    spellcheck={false}
    autocapitalize="off"
    aria-invalid={invalid === true}
    onInput={(event) => onInput((event.currentTarget as HTMLTextAreaElement).value)}
  />
);

/** A radio button or checkbox with its words beside it, the whole row being the target. */
export const Choice = ({
  type,
  name,
  checked,
  onChange,
  title,
  children,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ComponentChildren;
  children?: ComponentChildren;
}) => (
  <label class="choice">
    <input type={type} name={name} checked={checked} onChange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)} />
    <span class="choice-text">
      <span>{title}</span>
      {children !== undefined && <small>{children}</small>}
    </span>
  </label>
);

// ------------------------------------------------------------------ values to hand to someone else

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const CopyButton = ({ text, label, small }: { text: string; label?: string; small?: boolean }) => {
  const [copied, setCopied] = useState<boolean | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      class={`secondary${small === true ? ' small' : ''}`}
      onClick={async () => {
        setCopied(await copyText(text));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(undefined), 2_000);
      }}
    >
      {copied === true ? 'Copied' : copied === false ? 'Select and copy by hand' : (label ?? 'Copy')}
    </button>
  );
};

/**
 * A long value (address, identifier, link): wrapped, or shortened to three lines, with a button to copy it
 * whole and, for a link, one to open it.
 */
export const Value = ({ text, clamp, copyLabel, open, testId }: { text: string; clamp?: boolean; copyLabel?: string; open?: string; testId?: string }) => (
  <div class="value">
    <div class={`value-text${clamp === true ? ' clamp' : ''}`} data-testid={testId} data-value={text}>
      {text}
    </div>
    <div class="row">
      <CopyButton text={text} small {...(copyLabel === undefined ? {} : { label: copyLabel })} />
      {open !== undefined && (
        <a class="button quiet small" href={text} target="_blank" rel="noopener">
          {open}
        </a>
      )}
    </div>
  </div>
);

/** A QR code, drawn as one path. Text of capital letters, digits and a few signs makes a smaller code. */
export const QrCode = ({ text, label }: { text: string; label: string }) => {
  const path = useMemo(() => {
    const code = qrcode(0, text.length > 600 ? 'L' : 'M');
    code.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? 'Alphanumeric' : 'Byte');
    try {
      code.make();
    } catch {
      // More than the largest code holds.
      return undefined;
    }
    const count = code.getModuleCount();
    let drawn = '';
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) drawn += `M${column + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { drawn, extent: count + 8, count };
  }, [text]);
  if (path === undefined) return <p class="small muted qr-none">Too long for a QR code. Copy the link and send it as a message.</p>;
  return (
    <div class="qr-wrap">
      {/* A code with many squares is drawn larger, three points to a square where the screen has the room, so that a camera can tell them apart. */}
      <svg class={`qr${text.length > 1_000 ? ' dense' : ''}`} style={path.count > 100 ? { maxWidth: `${path.extent * 3}px` } : undefined} role="img" aria-label={label} viewBox={`0 0 ${path.extent} ${path.extent}`} shape-rendering="crispEdges">
        <rect width={path.extent} height={path.extent} fill="#fff" />
        <path d={path.drawn} fill="#000" />
      </svg>
    </div>
  );
};

/** Something to give another device: a QR code beside it on wide screens, above it on phones. */
export const HandOff = ({ text, qrLabel, copyLabel, testId, children }: { text: string; qrLabel?: string; copyLabel?: string; testId?: string; children?: ComponentChildren }) => (
  <div class={`handoff${qrLabel === undefined ? '' : ' with-qr'}`}>
    {qrLabel !== undefined && <QrCode text={text} label={qrLabel} />}
    <div class="stack-s">
      {children}
      <Value text={text} clamp {...(copyLabel === undefined ? {} : { copyLabel })} {...(testId === undefined ? {} : { testId })} />
    </div>
  </div>
);

/** Choices of one kind, side by side. */
export const Segmented = <Value extends string>({ value, options, onChange, label }: { value: Value; options: { value: Value; label: string }[]; onChange: (value: Value) => void; label: string }) => (
  <div class="seg" role="group" aria-label={label}>
    {options.map((option) => (
      <button type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
        {option.label}
      </button>
    ))}
  </div>
);

export const Fingerprint = ({ value }: { value: string }) => <div class="fingerprint">{value}</div>;

// ------------------------------------------------------------------ amounts and time

const SATOSHIS = 100_000_000n;

/** An amount in BCH, exact, without trailing zeros beyond two places. */
export const formatBch = (satoshis: bigint): string => {
  const negative = satoshis < 0n;
  const value = negative ? -satoshis : satoshis;
  const whole = value / SATOSHIS;
  const fraction = (value % SATOSHIS).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole.toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
};

export const formatSatoshis = (amount: bigint): string => amount.toLocaleString('en-US');

/** An amount as BCH, with the satoshis beside it when `exact`. */
export const Amount = ({ satoshis, exact }: { satoshis: bigint; exact?: boolean }) => (
  <span class="amount">
    {formatBch(satoshis)} BCH{exact === true && <span class="sat"> · {formatSatoshis(satoshis)} sat</span>}
  </span>
);

export const Sat = ({ satoshis }: { satoshis: bigint }) => <span class="amount">{formatSatoshis(satoshis)} sat</span>;

/** Read an amount typed in BCH. Returns satoshis, or a reason. */
export const parseBch = (text: string): bigint | string => {
  const cleaned = text.trim().replace(/,/g, '').replace(/\s/g, '');
  if (cleaned === '') return 'Enter an amount.';
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null) return 'Enter the amount as a number, for example 0.0005.';
  const fraction = match[2] ?? '';
  if (fraction.length > 8) return 'An amount has at most eight decimal places.';
  const satoshis = BigInt(match[1] === '' ? '0' : (match[1] as string)) * SATOSHIS + BigInt(fraction.padEnd(8, '0') || '0');
  if (satoshis <= 0n) return 'Enter an amount above zero.';
  return satoshis;
};

export const shorten = (text: string, head = 10, tail = 8): string => (text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`);

export const formatTime = (unixSeconds: number): string => new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDuration = (seconds: number): string => {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
};

// ------------------------------------------------------------------ smaller things

/** Run something now and again at an interval while the component is shown. */
export const useEvery = (milliseconds: number, work: () => void | Promise<void>, dependencies: unknown[] = []): void => {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    let stopped = false;
    let running = false;
    const tick = () => {
      if (stopped || running) return;
      running = true;
      void Promise.resolve(latest.current())
        .catch((problem) => console.warn(problem))
        .finally(() => {
          running = false;
        });
    };
    tick();
    const timer = setInterval(tick, milliseconds);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, dependencies);
};

/** Label and value pairs. */
export const KeyValues = ({ entries, wide }: { entries: [ComponentChildren, ComponentChildren][]; wide?: boolean }) => (
  <dl class={`kv${wide === true ? ' wide' : ''}`}>
    {entries.map(([name, value]) => (
      <div>
        <dt>{name}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
);

/** Something folded away, one step further. */
export const More = ({ summary, children, open }: { summary: string; children: ComponentChildren; open?: boolean }) => (
  <details class="more" open={open}>
    <summary>{summary}</summary>
    <div class="stack">{children}</div>
  </details>
);

/** A row that leads somewhere, with a short explanation under its label. */
export const LinkRow = ({ label, hint, onClick, aside }: { label: string; hint?: ComponentChildren; onClick: () => void; aside?: ComponentChildren }) => (
  <button type="button" class="linkrow" onClick={onClick}>
    <span class="linkrow-text">
      {label}
      {hint !== undefined && <small>{hint}</small>}
    </span>
    {aside}
  </button>
);

/** A short message that goes away by itself. */
export const useToast = (): [JSX.Element | null, (text: string) => void] => {
  const [text, setText] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(undefined), 3_500);
  }, []);
  return [
    text === undefined ? null : (
      <div class="toast" role="status">
        {text}
      </div>
    ),
    show,
  ];
};

/** Offer a text file for saving. */
export const download = (filename: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** A value kept in the page's storage, read once and written on every change. */
export const useStored = <T,>(vault: { get<V>(name: string): V | undefined; set(name: string, value: unknown): void; remove(name: string): void }, name: string): [T | undefined, (value: T | undefined) => void] => {
  const [value, setValue] = useState<T | undefined>(() => vault.get<T>(name));
  const set = useCallback((next: T | undefined) => {
    if (next === undefined) vault.remove(name);
    else vault.set(name, next);
    setValue(next);
  }, []);
  return [value, set];
};

/**
 * For an application's page: offer the page's template to a wallet that reports nothing because it has never
 * used the page. The user decides in the wallet; the page waits, and says how it went.
 *
 * @param offer - resolves to whether the wallet trusts the template now; rejects with the wallet's reason
 */
export const TemplateOffer = ({ label, offer, onTrusted }: { label: string; offer: () => Promise<boolean>; onTrusted: () => void }) => {
  const [state, setState] = useState<{ at: 'idle' } | { at: 'waiting' } | { at: 'declined' } | { at: 'failed'; reason: string }>({ at: 'idle' });
  const ask = (): void => {
    setState({ at: 'waiting' });
    offer().then(
      (trusted) => {
        setState(trusted ? { at: 'idle' } : { at: 'declined' });
        if (trusted) onTrusted();
      },
      (error: unknown) => setState({ at: 'failed', reason: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <div class="stack-s template-offer" data-testid="template-offer">
      {state.at === 'waiting' ? (
        <p class="muted">
          <Spinner /> Your wallet shows this page's template under Apps. Trust it there to go on.
        </p>
      ) : (
        <div>
          <Button kind="secondary" onClick={ask}>
            {label}
          </Button>
        </div>
      )}
      {state.at === 'declined' && <p class="small muted">Declined in the wallet. Nothing was shared.</p>}
      {state.at === 'failed' && <Notice tone="warn">{state.reason}</Notice>}
    </div>
  );
};
