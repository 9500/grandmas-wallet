import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { Environment } from './environment.js';

/** The frame every page shares: the test-network notice, the title, and who the page is for. */
export const Page = ({ title, role, environment, children }: { title: string; role: string; environment?: Environment | undefined; children: ComponentChildren }) => (
  <>
    <div class="test-banner" role="note">
      Demonstration on a test network{environment === undefined ? '' : ` (${environment.network})`}. The coins here have no value. Do not use real funds.
    </div>
    <div class="shell">
      <header class="masthead">
        <h1>{title}</h1>
        <span class="role">{role}</span>
      </header>
      <main>{children}</main>
    </div>
  </>
);

export const Card = ({ tone, children }: { tone?: 'success' | 'warn' | 'danger' | undefined; children: ComponentChildren }) => (
  <section class={`card ${tone ?? ''}`}>{children}</section>
);

export const Spinner = () => <span class="spinner" aria-hidden="true" />;

/** Running one thing at a time, with its progress and its failure shown next to the button that started it. */
export const useTask = () => {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [step, setStep] = useState<string | undefined>();
  const run = useCallback(async <T,>(name: string, work: (progress: (step: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(name);
    setError(undefined);
    setStep(undefined);
    try {
      return await work(setStep);
    } catch (problem) {
      console.error(problem, (problem as { cause?: unknown }).cause ?? '', ((problem as { cause?: { detail?: unknown } }).cause?.detail ?? (problem as { detail?: unknown }).detail) ?? '');
      setError((problem as Error).message || String(problem));
      return undefined;
    } finally {
      setBusy(undefined);
      setStep(undefined);
    }
  }, []);
  return { busy, error, step, run, clearError: () => setError(undefined) };
};

export type Task = ReturnType<typeof useTask>;

export const TaskStatus = ({ task }: { task: Task }) => (
  <>
    {task.busy !== undefined && (
      <p class="notice wait" role="status">
        <Spinner /> {task.step ?? 'Working'}…
      </p>
    )}
    {task.error !== undefined && (
      <p class="notice error" role="alert">
        {task.error}
      </p>
    )}
  </>
);

export const Button = ({
  task,
  name,
  onClick,
  children,
  kind,
  disabled,
}: {
  task?: Task;
  /** The name under which the task runs; the button shows as busy while it does. */
  name?: string;
  onClick: () => void;
  children: ComponentChildren;
  kind?: 'secondary' | 'danger' | 'quiet';
  disabled?: boolean;
}) => (
  <button type="button" class={kind ?? ''} disabled={disabled === true || task?.busy !== undefined} onClick={onClick}>
    {task?.busy !== undefined && task.busy === name ? <Spinner /> : null} {children}
  </button>
);

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) => (
  <div class="field">
    <label>
      {label}
      {children}
    </label>
    {hint !== undefined && <div class="hint">{hint}</div>}
  </div>
);

export const TextInput = ({ value, onInput, placeholder, numeric }: { value: string; onInput: (value: string) => void; placeholder?: string; numeric?: boolean }) => (
  <input
    type="text"
    inputMode={numeric === true ? 'numeric' : 'text'}
    value={value}
    placeholder={placeholder ?? ''}
    autocomplete="off"
    spellcheck={false}
    onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
  />
);

export const TextArea = ({ value, onInput, placeholder }: { value: string; onInput: (value: string) => void; placeholder?: string }) => (
  <textarea value={value} placeholder={placeholder ?? ''} spellcheck={false} onInput={(event) => onInput((event.currentTarget as HTMLTextAreaElement).value)} />
);

/** Something to hand to someone else: shown shortened, with a button to copy it and optionally one to open it. */
export const CopyBox = ({ text, open, openLabel }: { text: string; open?: boolean; openLabel?: string }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <div class="copybox">
      <code>{text.length > 220 ? `${text.slice(0, 160)}…${text.slice(-40)}` : text}</code>
      <div class="row">
        <button type="button" class="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {open === true && (
          <a class="button secondary" href={text} target="_blank" rel="noopener">
            {openLabel ?? 'Open'}
          </a>
        )}
      </div>
    </div>
  );
};

export const formatSatoshis = (amount: bigint): string => amount.toLocaleString('en-US');

export const Amount = ({ satoshis }: { satoshis: bigint }) => (
  <span>
    {formatSatoshis(satoshis)} <span class="muted">sat</span>
  </span>
);

export const shorten = (text: string, head = 8, tail = 6): string => (text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`);

export const TransactionLink = ({ environment, transactionId }: { environment: Environment; transactionId: string }) => (
  <a class="mono" href={`${environment.explorer}${transactionId}`} target="_blank" rel="noopener">
    {shorten(transactionId)}
  </a>
);

export const formatTime = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDuration = (seconds: number): string => {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
};

/** Run something now and again at an interval while the component is shown. */
export const useEvery = (milliseconds: number, work: () => void | Promise<void>, dependencies: unknown[] = []): void => {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped) void Promise.resolve(latest.current()).catch((problem) => console.warn(problem));
    };
    tick();
    const timer = setInterval(tick, milliseconds);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, dependencies);
};

/** Technical details, folded away. */
export const Inspector = ({ title, entries, children }: { title?: string; entries: [string, ComponentChildren][]; children?: ComponentChildren }) => (
  <details class="inspector">
    <summary>{title ?? 'Technical details'}</summary>
    <dl>
      {entries.map(([name, value]) => (
        <>
          <dt>{name}</dt>
          <dd class="mono">{value}</dd>
        </>
      ))}
    </dl>
    {children}
  </details>
);

/** Offer a file for saving. */
export const download = (filename: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
