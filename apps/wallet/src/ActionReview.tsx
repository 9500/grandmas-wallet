import type { ActionPreview, MovedOutput, TemplateSummary } from '@grandmas-wallet/app';
import { InsufficientFundsError } from '@grandmas-wallet/core';
import { Amount, Icon, Info, KeyValues, More, Notice, Sat, Status, formatBch, formatSatoshis, formatTime, plainError, shorten } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useContext, useState } from 'preact/hooks';

import { TokenNamesContext, amountText, rawUnits } from './token-words.js';

/**
 * What the user sees before deciding on an action of an application's template. At the top, a picture of the
 * action drawn from the wallet's own figures: the wallet on one side, the application on the other as its
 * template names it, and what goes each way; under it, by how much the wallet goes up or down. Then whatever
 * asks for care, always in view; the action in the template's words; and, folded, the wallet's own figures in
 * full and the template. Nothing here knows any application: every name comes from the template.
 */

/** A long hexadecimal value, shortened; a tap shows it whole. */
export const Hex = ({ value, head = 8, tail = 6 }: { value: string; head?: number; tail?: number }) => {
  const [whole, setWhole] = useState(false);
  if (value.length <= head + tail + 1) return <span class="mono">{value}</span>;
  return (
    <button type="button" class={`hex${whole ? ' whole' : ''}`} title={whole ? 'Show shortened' : value} aria-label={whole ? undefined : `${value}, shortened. Show in full.`} onClick={() => setWhole(!whole)}>
      {whole ? value : shorten(value, head, tail)}
    </button>
  );
};

/** A heading inside a card, small and quiet, with what it means behind a "?" or under it. */
export const Part = ({ title, note, info, children, cls }: { title: string; note?: ComponentChildren; info?: ComponentChildren; children: ComponentChildren; cls?: string }) => (
  <section class={`part${cls === undefined ? '' : ` ${cls}`}`}>
    <h3 class="part-title">
      {title}
      {info !== undefined && (
        <>
          {' '}
          <Info label={`About "${title}"`}>{info}</Info>
        </>
      )}
    </h3>
    {note !== undefined && <p class="small muted part-note">{note}</p>}
    {children}
  </section>
);

const RULES: Record<1 | 2 | 3 | 'names', string> = {
  1: 'Rule 1: authority is a token',
  2: 'Rule 2: the wallet\'s parts are the wallet\'s business',
  3: 'Rule 3: the token leads to the position',
  names: 'The names it gives tokens',
};

/** What the wallet can say about a template: verified, not verified, or a violation found. */
export const Statement = ({ verdict, subject }: { verdict: TemplateSummary['verdict']; subject?: string }) => {
  const prefix = subject === undefined ? '' : `${subject} `;
  if (verdict.statement === 'verified') {
    return (
      <Status tone="good" title={subject === undefined ? 'Verified' : `${prefix}verified`}>
        <p>{verdict.basis}</p>
      </Status>
    );
  }
  if (verdict.statement === 'not verified') {
    return (
      <Status tone={subject === undefined ? undefined : 'warn'} title={subject === undefined ? 'Not verified' : `${prefix}not verified`}>
        {verdict.reasons.map((reason) => (
          <p>{reason}</p>
        ))}
      </Status>
    );
  }
  return (
    <Status tone="bad" title={`${verdict.violations.length === 1 ? 'A violation found' : `${verdict.violations.length} violations found`}${subject === undefined ? '' : ` in the ${subject.toLowerCase()}`}`}>
      <ul class="violations">
        {verdict.violations.map((violation) => (
          <li>
            <div class="violation-rule">{RULES[violation.rule]}</div>
            <div class="violation-what">{violation.what}</div>
            <div>{violation.consequence}</div>
          </li>
        ))}
      </ul>
    </Status>
  );
};

/** A template: its own name and description, what the wallet can say about it, and what it can ask for. */
export const TemplateView = ({ summary, showActions, standing = true }: { summary: TemplateSummary; showActions?: boolean; standing?: boolean }) => (
  <div class="stack-s">
    <div>
      <div class="template-name">{summary.name}</div>
      {summary.description !== '' && <p class="template-description">{summary.description}</p>}
    </div>
    {standing && <Statement verdict={summary.verdict} />}
    {showActions === true && summary.actions.length > 0 && (
      <More summary={summary.actions.length === 1 ? 'The one action it has' : `The ${summary.actions.length} actions it has`}>
        <ul class="list">
          {summary.actions.map((action) => (
            <li>
              <div>{action.name}</div>
              {action.description !== '' && <div class="small muted">{action.description}</div>}
            </li>
          ))}
        </ul>
      </More>
    )}
    <More summary="Technical details">
      <KeyValues
        wide
        entries={[
          ['Identifier', <span class="mono">{summary.identifier}</span>],
          ['Content hash', <span class="mono">{summary.contentHash}</span>],
          ['Recovery declaration', summary.declaration === undefined ? <span class="muted">none</span> : <span class="mono">{summary.declaration}</span>],
        ]}
      />
    </More>
  </div>
);

/** The action as the template puts it: its name, what it does, and the values chosen for it. */
export const TheirWords = ({ words }: { words: ActionPreview['words'] }) => (
  <Part title="In the template's words" info="Written by whoever made the template. The wallet cannot tell whether they are true; the figures above are its own." cls="their-words">
    <div class="quote">
      <div class="quote-title">{words.action.name}</div>
      {words.action.description !== '' && <p>{words.action.description}</p>}
      {words.outcome !== '' && words.outcome !== words.action.description && <p>{words.outcome}</p>}
      {words.values.length > 0 && (
        <KeyValues
          entries={words.values.map((value) => [
            <>
              {value.name}
              {value.description !== '' && <small>{value.description}</small>}
            </>,
            /^[0-9a-f]{24,}$/i.test(value.value) ? <Hex value={value.value} /> : <span class="word-value">{value.value}</span>,
          ])}
        />
      )}
    </div>
  </Part>
);

/** A token that moves, in words: named where a template the user trusts names it. */
export const TokenWords = ({ token }: { token: NonNullable<MovedOutput['token']> }) => {
  const names = useContext(TokenNamesContext);
  const fungible = token.amount > 0n ? names.fungible(token.category) : undefined;
  const amount = fungible?.named?.decimals === undefined ? rawUnits(token.amount) : `${amountText(token.amount, fungible)} (${rawUnits(token.amount)})`;
  const nft = token.nft === undefined ? undefined : names.nft(token.category)?.named?.name;
  return (
    <span class="token-words">
      {token.nft === undefined ? `${amount} of token ` : `${nft === undefined ? '' : `"${nft}", `}${token.nft.capability === 'none' ? 'NFT' : `NFT (${token.nft.capability})`} of token `}
      <Hex value={token.category} />
      {token.nft !== undefined && token.nft.commitment !== '' && (
        <>
          {' '}
          with <Hex value={token.nft.commitment} head={6} tail={4} />
        </>
      )}
      {token.nft !== undefined && token.amount > 0n && `, and ${amount}`}
    </span>
  );
};

const KINDS: Record<string, string> = {
  receive: 'to a receiving address',
  change: 'to a change address',
  return: 'back where it came from',
  lasting: 'to a vault address, for a later payout',
  'left over': 'what is left over, as change',
  'token change': 'tokens left over, as change',
};

/** A value of a template's variable, shown by the template's type for it: satoshis as an amount, numbers grouped, bytes shortened. */
export const TypedValue = ({ type, value }: { type: string; value: string }) => {
  if (/^-?\d+$/.test(value)) {
    if (type === 'satoshis') return <Amount satoshis={BigInt(value)} exact />;
    if (type === 'token_amount') return <span class="word-value">{BigInt(value).toLocaleString('en-US')} units</span>;
    if (type === 'integer' || type === 'bigint') return <span class="word-value">{BigInt(value).toLocaleString('en-US')}</span>;
  }
  return /^[0-9a-f]{24,}$/i.test(value) ? <Hex value={value} /> : <span class="word-value">{value}</span>;
};

/** The earliest time the network accepts a transaction: a Unix time from 500,000,000, else a block height. */
export const earliest = (notBefore: number): string => (notBefore >= 500_000_000 ? formatTime(notBefore) : `block ${notBefore.toLocaleString('en-US')}`);

const Moved = ({ output, label }: { output: MovedOutput; label: ComponentChildren }) => (
  <li class="moved">
    <div class="moved-head">
      <span>{label}</span>
      <Amount satoshis={output.satoshis} exact />
    </div>
    {output.token !== undefined && (
      <div class="small muted">
        Carries the <TokenWords token={output.token} />
      </div>
    )}
  </li>
);

// ------------------------------------------------------------------ the picture and the headline

type Moving = NonNullable<MovedOutput['token']>;

/** What moves one way between the wallet and the application. */
interface Way {
  satoshis: bigint;
  /** Fungible tokens, by category, without a sign. */
  fungible: { category: string; amount: bigint }[];
  nfts: Moving[];
}

const sameNft = (one: Moving, other: Moving): boolean => one.category === other.category && one.nft?.capability === other.nft?.capability && one.nft?.commitment === other.nft?.commitment;

/** NFTs in the first list that the second does not have, each counted once. */
const without = (from: Moving[], taken: Moving[]): Moving[] => {
  const left = [...taken];
  return from.filter((token) => {
    const index = left.findIndex((other) => sameNft(token, other));
    if (index === -1) return true;
    left.splice(index, 1);
    return false;
  });
};

/** What goes from the wallet to the application and back, from the wallet's own figures. The fee goes to neither. */
export const ways = (figures: ActionPreview['figures']): { out: Way; back: Way } => {
  const into = figures.intoApplicationSatoshis;
  const nftsOf = (outputs: MovedOutput[]): Moving[] => outputs.flatMap((output) => (output.token?.nft === undefined ? [] : [output.token]));
  const spent = nftsOf(figures.tokensSpent);
  const arriving = nftsOf(figures.toWallet);
  return {
    out: { satoshis: into > 0n ? into : 0n, fungible: figures.tokensNet.filter((entry) => entry.amount < 0n).map((entry) => ({ category: entry.category, amount: -entry.amount })), nfts: without(spent, arriving) },
    back: { satoshis: into < 0n ? -into : 0n, fungible: figures.tokensNet.filter((entry) => entry.amount > 0n), nfts: without(arriving, spent) },
  };
};

const empty = (way: Way): boolean => way.satoshis === 0n && way.fungible.length === 0 && way.nfts.length === 0;

/** A token as a small chip: its amount in its decimals where a template the user trusts names it, else raw units, with its category. */
const TokenChip = ({ category, amount, nft, sign }: { category: string; amount?: bigint; nft?: Moving['nft']; sign?: '+' | '−' }) => {
  const names = useContext(TokenNamesContext);
  const fungible = amount === undefined ? undefined : names.fungible(category);
  const nftName = nft === undefined ? undefined : names.nft(category)?.named?.name;
  const named = fungible?.named?.symbol !== undefined && fungible.named.decimals !== undefined;
  return (
    <span class={`chip${nft === undefined ? '' : ' nft'}`}>
      <span class="chip-dot" aria-hidden="true" />
      <span class="chip-text">
        {sign}
        {nft === undefined ? amountText(amount ?? 0n, fungible) : (nftName ?? (nft.capability === 'none' ? 'NFT' : `NFT (${nft.capability})`))}
      </span>
      {(nft !== undefined ? nftName === undefined : !named) && <Hex value={category} head={4} tail={4} />}
    </span>
  );
};

const WayItems = ({ way }: { way: Way }) =>
  empty(way) ? (
    <span class="flow-nothing">Nothing</span>
  ) : (
    <>
      {way.satoshis > 0n && (
        <span class="flow-bch">
          {formatBch(way.satoshis)} <span class="unit">BCH</span>
        </span>
      )}
      {way.fungible.map((entry) => (
        <TokenChip category={entry.category} amount={entry.amount} />
      ))}
      {way.nfts.map((token) => (
        <TokenChip category={token.category} nft={token.nft} />
      ))}
    </>
  );

/** The action at a glance: the wallet, the application, and what goes each way. */
export const Picture = ({ preview }: { preview: ActionPreview }) => {
  const { out, back } = ways(preview.figures);
  const name = preview.template.name;
  return (
    <figure class="flow" aria-label={`What goes between your wallet and ${name}`}>
      <div class="flow-node mine">
        <span class="flow-icon" aria-hidden="true">
          <Icon name="wallets" />
        </span>
        <span class="flow-name">Your wallet</span>
      </div>
      <div class="flow-lanes">
        <div class="lane out">
          <span class="visually-hidden">From your wallet to {name}:</span>
          <div class="lane-items">
            <WayItems way={out} />
          </div>
          <div class="lane-line" aria-hidden="true" />
        </div>
        <div class="lane back">
          <span class="visually-hidden">From {name} to your wallet:</span>
          <div class="lane-line" aria-hidden="true" />
          <div class="lane-items">
            <WayItems way={back} />
          </div>
        </div>
      </div>
      <div class="flow-node theirs">
        <span class="flow-icon" aria-hidden="true">
          <Icon name="apps" />
        </span>
        <span class="flow-name">{name}</span>
      </div>
    </figure>
  );
};

/** By how much the wallet goes up or down, in Bitcoin Cash and in tokens, the fee included. */
export const Headline = ({ figures }: { figures: ActionPreview['figures'] }) => {
  const net = figures.getsSatoshis - figures.givesSatoshis;
  const { out, back } = ways(figures);
  const tokens: [string, ComponentChildren][] = [];
  if (back.fungible.length > 0 || back.nfts.length > 0) {
    tokens.push([
      'Your wallet receives',
      <>
        {back.fungible.map((entry) => (
          <TokenChip category={entry.category} amount={entry.amount} sign="+" />
        ))}
        {back.nfts.map((token) => (
          <TokenChip category={token.category} nft={token.nft} />
        ))}
      </>,
    ]);
  }
  if (out.fungible.length > 0 || out.nfts.length > 0) {
    tokens.push([
      'Your wallet pays',
      <>
        {out.fungible.map((entry) => (
          <TokenChip category={entry.category} amount={entry.amount} sign="−" />
        ))}
        {out.nfts.map((token) => (
          <TokenChip category={token.category} nft={token.nft} />
        ))}
      </>,
    ]);
  }
  return (
    <div class="headline">
      <div class="headline-label">
        {net < 0n ? 'Your wallet goes down by' : 'Your wallet goes up by'}{' '}
        <Info label="Where these figures come from">Worked out by this wallet from the transaction it built. The application cannot change them.</Info>
      </div>
      <div class={`headline-figure ${net < 0n ? 'down' : 'up'}`}>
        {net < 0n ? '−' : '+'}
        {formatBch(net < 0n ? -net : net)}
        <span class="unit">BCH</span>
      </div>
      <div class="headline-sub">
        <Sat satoshis={net < 0n ? -net : net} />, the network fee of <Sat satoshis={figures.feeSatoshis} /> included
      </div>
      {tokens.map(([words, chips]) => (
        <div class="headline-tokens">
          <span>{words}</span>
          <span class="chips">{chips}</span>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ what asks for care, always in view

/** Tokens the transaction destroys: whose they were and how. */
const Destroyed = ({ figures }: { figures: ActionPreview['figures'] }) => (
  <Notice tone="warn">
    <div class="stack-s destroyed-warning">
      <strong>{figures.tokensDestroyed.length === 1 ? 'A token is destroyed' : `${figures.tokensDestroyed.length} tokens are destroyed`}</strong>
      <span>These tokens can never be used again after this transaction.</span>
      <ul class="destroyed-list">
        {figures.tokensDestroyed.map((entry) => (
          <li>
            <span class="destroyed-name">{entry.name}</span> <span class="destroyed-whose">{entry.wallet ? 'yours' : 'the application\'s'}</span>
            <div class="small">
              The <TokenWords token={entry.token} />, {entry.how === 'data output' ? 'sent to a data output, which no one can spend' : 'spent and not carried on'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  </Notice>
);

/** The standing of the template where it asks for care, and what else does: tokens destroyed, paying itself first, a time. */
const Cautions = ({ preview, summary }: { preview: ActionPreview; summary: TemplateSummary }) => {
  const { figures } = preview;
  return (
    <>
      {summary.verdict.statement !== 'verified' && (
        <div class={`standing ${summary.verdict.statement === 'violation' ? 'bad' : 'warn'}`}>
          <Statement verdict={summary.verdict} subject="Template" />
        </div>
      )}
      <FirstUse summary={summary} firstUse={preview.firstUse} />
      {figures.tokensDestroyed.length > 0 && <Destroyed figures={figures} />}
      {figures.payingItself !== undefined && (
        <Notice tone="warn">
          This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of <Sat satoshis={figures.payingItself.feeSatoshis} />, and then carries out the action.
        </Notice>
      )}
      {figures.notBefore !== undefined && (
        <Notice>
          The network accepts this transaction from {earliest(figures.notBefore)} on, not earlier.
          {figures.notBefore >= 500_000_000 && ' It goes by the chain\'s clock, which runs a little behind the real one.'}
        </Notice>
      )}
    </>
  );
};

// ------------------------------------------------------------------ folded: the figures in full, and the template

/** A section folded away under a name, with a short line of what is in it. */
const Fold = ({ title, hint, cls, children }: { title: string; hint?: string; cls?: string; children: ComponentChildren }) => (
  <details class={`fold${cls === undefined ? '' : ` ${cls}`}`}>
    <summary>
      <span class="fold-title">{title}</span>
      {hint !== undefined && <span class="fold-hint">{hint}</span>}
    </summary>
    {children}
  </details>
);

/** The wallet's own figures from the transaction it worked out, in full. The application cannot influence them. */
export const OwnFigures = ({ figures }: { figures: ActionPreview['figures'] }) => {
  const names = useContext(TokenNamesContext);
  const net = figures.getsSatoshis - figures.givesSatoshis;
  const into = figures.intoApplicationSatoshis;
  const rows: [ComponentChildren, ComponentChildren][] = [
    [<>Leaves your wallet<small>The coins it spends, token coins included</small></>, <Amount satoshis={figures.givesSatoshis} exact />],
    [<>Comes back to your wallet</>, <Amount satoshis={figures.getsSatoshis} exact />],
  ];
  if (into > 0n) rows.push([<>Goes into the application<small>To its contracts and others, less what comes back from them</small></>, <Amount satoshis={into} exact />]);
  if (into < 0n) rows.push([<>Comes back from the application<small>Out of its contracts, more than goes into them</small></>, <Amount satoshis={-into} exact />]);
  rows.push([<>Network fee<small>{figures.bytes} bytes at one satoshi per byte</small></>, <Sat satoshis={figures.feeSatoshis} />]);
  rows.push([<strong>{net < 0n ? 'Your wallet goes down by' : 'Your wallet goes up by'}</strong>, <strong><Amount satoshis={net < 0n ? -net : net} exact /></strong>]);
  const coins = figures.tokensSpent.length + figures.applicationInputs.length + figures.toOthers.length + figures.toWallet.length;
  return (
    <Fold title="This wallet's own figures" hint={`The fee, and ${coins === 1 ? 'the one coin' : `all ${coins} coins`} in and out`} cls="own-figures">
      <p class="small muted moved-note">Worked out by this wallet from the transaction it built. The application cannot change them.</p>
      <KeyValues entries={rows} />
      {figures.remainderSatoshis > 0n && <Notice>The fee includes {formatSatoshis(figures.remainderSatoshis)} satoshis that are too few to come back as change.</Notice>}
      {figures.tokensNet.length > 0 && (
        <div class="moved-group">
          <div class="moved-title">Tokens</div>
          <KeyValues
            entries={figures.tokensNet.map((entry) => [
              <>
                {entry.amount > 0n ? 'Your wallet receives' : 'Your wallet pays'}
                <small>
                  Of token <Hex value={entry.category} />
                </small>
              </>,
              <span class={`token-net ${entry.amount > 0n ? 'up' : 'down'}`}>{`${entry.amount > 0n ? '+' : '−'}${amountText(entry.amount, names.fungible(entry.category))}`}</span>,
            ])}
          />
        </div>
      )}
      {figures.tokensDestroyed.length > 0 && (
        <div class="moved-group destroyed">
          <div class="moved-title">Destroyed</div>
          <p class="small muted moved-note">These tokens can never be used again after this transaction.</p>
          <ul class="list">
            {figures.tokensDestroyed.map((entry) => (
              <li class="moved">
                <div class="moved-head">
                  <span>{entry.name}</span>
                  <span class="small muted">{entry.wallet ? 'Yours' : 'The application\'s'}</span>
                </div>
                <div class="small muted">
                  The <TokenWords token={entry.token} />, {entry.how === 'data output' ? 'sent to a data output, which no one can spend' : 'spent and not carried on'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {figures.tokensSpent.length > 0 && (
        <div class="moved-group">
          <div class="moved-title">Your tokens it spends</div>
          <ul class="list">
            {figures.tokensSpent.map((output) => (
              <Moved output={output} label="A coin of your wallet" />
            ))}
          </ul>
        </div>
      )}
      {figures.applicationInputs.length > 0 && (
        <div class="moved-group">
          <div class="moved-title">The application's coins it spends</div>
          <p class="small muted moved-note">Read from the chain by this wallet. None of them is yours.</p>
          <ul class="list">
            {figures.applicationInputs.map((input) => (
              <Moved
                output={input}
                label={
                  <>
                    {input.name}
                    <span class="small muted"> · <Hex value={input.outpoint} head={6} tail={4} /></span>
                  </>
                }
              />
            ))}
          </ul>
        </div>
      )}
      {figures.toOthers.length > 0 && (
        <div class="moved-group">
          <div class="moved-title">Goes to others</div>
          <ul class="list">
            {figures.toOthers.map((output) => (
              <Moved
                output={output}
                label={
                  <>
                    {output.name}
                    <span class="small muted"> · at <Hex value={output.lockingBytecode} head={6} tail={6} /></span>
                  </>
                }
              />
            ))}
          </ul>
        </div>
      )}
      {figures.toWallet.length > 0 && (
        <div class="moved-group">
          <div class="moved-title">Arrives at your wallet</div>
          <ul class="list">
            {figures.toWallet.map((output) => (
              <Moved output={output} label={<>{(KINDS[output.kind] ?? output.kind).replace(/^./, (first) => first.toUpperCase())}</>} />
            ))}
          </ul>
        </div>
      )}
    </Fold>
  );
};

/** The template folded away: its name and description, who vouches for it, its actions and identifiers. */
const TheTemplate = ({ summary }: { summary: TemplateSummary }) => (
  <Fold title="The template" hint={summary.verdict.statement === 'verified' ? 'Verified, and what that rests on' : 'What it is, and its identifiers'} cls="template-fold">
    <TemplateView summary={summary} showActions={!summary.trusted} standing={summary.verdict.statement === 'verified'} />
  </Fold>
);

/**
 * An action, for a decision: the picture and the headline, what asks for care, the action in the template's
 * words, and folded, the figures in full and the template.
 */
export const ActionReview = ({ preview, summary }: { preview: ActionPreview; summary?: TemplateSummary }) => {
  const template = summary ?? preview.template;
  return (
    <div class="review stack">
      <div class="review-summary">
        <Picture preview={preview} />
        <Headline figures={preview.figures} />
      </div>
      <Cautions preview={preview} summary={template} />
      <TheirWords words={preview.words} />
      <div class="folds">
        <OwnFigures figures={preview.figures} />
        <TheTemplate summary={template} />
      </div>
    </div>
  );
};

/** What approving does to a template the wallet has not trusted or not yet stored. */
export const FirstUse = ({ summary, firstUse }: { summary: TemplateSummary; firstUse: boolean }) => {
  // A template with a violation is not taken in: approving is not offered, so nothing is said about it.
  if ((summary.trusted && !firstUse) || (!summary.trusted && summary.verdict.statement === 'violation')) return null;
  return (
    <Notice tone="wait">
      {summary.replacesDeclaration === true
        ? 'You trust this template on this phone with an earlier recovery declaration. This request comes with a new one. Approving takes the new one in its place and stores it in your backup first, before anything is signed; declining keeps the one you have.'
        : summary.trusted
        ? 'You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed.'
        : 'This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it.'}
    </Notice>
  );
};

/**
 * A refusal by the network, in plain words where it is one a person can act on, with the network's own words
 * after them. Otherwise the message as it is.
 */
export const plainRefusal = (message: string): string => {
  const said = (/rejected by network rules\.?\s*([^]+)$/i.exec(message)?.[1] ?? message).replace(/\s*\(code \d+\)[^]*$/, '').replace(/[\s."]+$/, '');
  if (/non-?BIP68-?final/i.test(message)) {
    return `The network does not take this transaction yet: a coin it spends has not waited as long as its script asks since it was confirmed. Nothing was spent. (The network said: ${said}.)`;
  }
  if (/non-?final/i.test(message)) {
    return `The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: ${said}.)`;
  }
  return message;
};

/** Why an action cannot be carried out, in full. */
export const refusalOf = (error: unknown): string => {
  if (error instanceof InsufficientFundsError) {
    return `The wallet's coins do not cover this. It can spend ${formatSatoshis(error.totalSatoshis)} satoshis; the action and its fee of ${formatSatoshis(error.feeSatoshis)} need ${formatSatoshis(error.neededSatoshis)}.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|NetworkError|Load failed/i.test(message) ? plainError(error) : plainRefusal(message);
};
