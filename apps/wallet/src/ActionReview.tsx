import type { ActionPreview, MovedOutput, TemplateSummary } from '@grandmas-wallet/app';
import { InsufficientFundsError } from '@grandmas-wallet/core';
import { Amount, KeyValues, More, Notice, Sat, Status, formatSatoshis, formatTime, plainError, shorten } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/**
 * What the user sees before deciding on an action of an application's template: what the template is and
 * what the wallet can say about it; the action in the template's words; and the wallet's own figures from
 * the transaction it worked out. Nothing here knows any application: every name comes from the template.
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

/** A heading inside a card, small and quiet. */
export const Part = ({ title, note, children, cls }: { title: string; note?: ComponentChildren; children: ComponentChildren; cls?: string }) => (
  <section class={`part${cls === undefined ? '' : ` ${cls}`}`}>
    <h3 class="part-title">{title}</h3>
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
export const Statement = ({ verdict }: { verdict: TemplateSummary['verdict'] }) => {
  if (verdict.statement === 'verified') {
    return (
      <Status tone="good" title="Verified">
        <p>{verdict.basis}</p>
      </Status>
    );
  }
  if (verdict.statement === 'not verified') {
    return (
      <Status title="Not verified">
        {verdict.reasons.map((reason) => (
          <p>{reason}</p>
        ))}
      </Status>
    );
  }
  return (
    <Status tone="bad" title={verdict.violations.length === 1 ? 'A violation found' : `${verdict.violations.length} violations found`}>
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
export const TemplateView = ({ summary, showActions }: { summary: TemplateSummary; showActions?: boolean }) => (
  <div class="stack-s">
    <div>
      <div class="template-name">{summary.name}</div>
      {summary.description !== '' && <p class="template-description">{summary.description}</p>}
    </div>
    <Statement verdict={summary.verdict} />
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

/** The action as the template puts it. */
export const TheirWords = ({ words }: { words: ActionPreview['words'] }) => (
  <Part title="In the template's words" note="Written by whoever made the template. The wallet cannot tell whether they are true; the figures below are its own." cls="their-words">
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

/** A token that moves, in words. */
export const TokenWords = ({ token }: { token: NonNullable<MovedOutput['token']> }) => (
  <span class="token-words">
    {token.nft === undefined ? `${token.amount.toLocaleString('en-US')} units of token ` : `${token.nft.capability === 'none' ? 'NFT' : `NFT (${token.nft.capability})`} of token `}
    <Hex value={token.category} />
    {token.nft !== undefined && token.nft.commitment !== '' && (
      <>
        {' '}
        with <Hex value={token.nft.commitment} head={6} tail={4} />
      </>
    )}
    {token.nft !== undefined && token.amount > 0n && `, and ${token.amount.toLocaleString('en-US')} units`}
  </span>
);

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

/** Fungible tokens, more or fewer, in plain words. */
const tokenAmount = (amount: bigint): string => `${(amount < 0n ? -amount : amount).toLocaleString('en-US')} ${amount === 1n || amount === -1n ? 'unit' : 'units'}`;

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

/** The wallet's own figures from the transaction it worked out. The application cannot influence them. */
export const OwnFigures = ({ figures }: { figures: ActionPreview['figures'] }) => {
  const net = figures.getsSatoshis - figures.givesSatoshis;
  const into = figures.intoApplicationSatoshis;
  const rows: [ComponentChildren, ComponentChildren][] = [
    [<>Leaves your wallet<small>The coins it spends, token coins included</small></>, <Amount satoshis={figures.givesSatoshis} exact />],
    [<>Comes back to your wallet</>, <Amount satoshis={figures.getsSatoshis} exact />],
  ];
  if (into > 0n) rows.push([<>Goes into the application<small>To its contracts and others, less what comes back from them</small></>, <Amount satoshis={into} exact />]);
  if (into < 0n) rows.push([<>Comes back from the application<small>Out of its contracts, more than goes into them</small></>, <Amount satoshis={-into} exact />]);
  rows.push([<>Network fee<small>{figures.bytes} bytes</small></>, <Sat satoshis={figures.feeSatoshis} />]);
  rows.push([<strong>{net < 0n ? 'Your wallet goes down by' : 'Your wallet goes up by'}</strong>, <strong><Amount satoshis={net < 0n ? -net : net} exact /></strong>]);
  return (
    <Part title="This wallet's own figures" note="Worked out by this wallet from the transaction it built. The application cannot change them." cls="own-figures">
      <KeyValues entries={rows} />
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
              <span class={`token-net ${entry.amount > 0n ? 'up' : 'down'}`}>{`${entry.amount > 0n ? '+' : '−'}${tokenAmount(entry.amount)}`}</span>,
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
      <div class="stack-s">
        {figures.remainderSatoshis > 0n && <Notice>The fee includes {formatSatoshis(figures.remainderSatoshis)} satoshis that are too few to come back as change.</Notice>}
        {figures.notBefore !== undefined && (
          <Notice>
            The network accepts this transaction from {earliest(figures.notBefore)} on, not earlier.
            {figures.notBefore >= 500_000_000 && ' It goes by the chain\'s clock, which runs a little behind the real one.'}
          </Notice>
        )}
        {figures.payingItself !== undefined && (
          <Notice>
            This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of <Sat satoshis={figures.payingItself.feeSatoshis} />, and then carries out the action.
          </Notice>
        )}
      </div>
    </Part>
  );
};

/** The template, the words and the figures of an action, in that order. */
export const ActionReview = ({ preview, summary }: { preview: ActionPreview; summary?: TemplateSummary }) => (
  <>
    <Part title="Template">
      <TemplateView summary={summary ?? preview.template} showActions={!(summary ?? preview.template).trusted} />
    </Part>
    <FirstUse summary={summary ?? preview.template} firstUse={preview.firstUse} />
    <TheirWords words={preview.words} />
    <OwnFigures figures={preview.figures} />
  </>
);

/** What approving does to a template the wallet has not trusted or not yet stored. */
export const FirstUse = ({ summary, firstUse }: { summary: TemplateSummary; firstUse: boolean }) => {
  // A template with a violation is not taken in: approving is not offered, so nothing is said about it.
  if ((summary.trusted && !firstUse) || (!summary.trusted && summary.verdict.statement === 'violation')) return null;
  return (
    <Notice tone="wait">
      {summary.trusted
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
