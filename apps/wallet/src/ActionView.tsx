import type { ActionPreview, TemplateSummary } from '@grandmas-wallet/app';
import { Amount, formatTime, shorten } from '@grandmas-wallet/ui';

/**
 * Showing what a template says, and what the wallet itself worked out, for
 * any template. A value is shown by the type the template gives it.
 */

export const TemplateValue = ({ type, value, identity }: { type: string; value: string | number; identity: string }) => {
  if ((type === 'satoshis' || type === 'token_amount') && /^\d+$/.test(String(value))) return <Amount satoshis={BigInt(value)} />;
  if (type === 'timestamp' && Number.isInteger(Number(value))) return <span>{formatTime(Number(value))}</span>;
  if (type === 'token_category' && value === identity) return <span>this wallet</span>;
  const text = String(value);
  return <span class={/^[0-9a-f]{16,}$/i.test(text) ? 'mono' : undefined}>{shorten(text, 16, 8)}</span>;
};

/** What a template says about itself, before the user decides whether to trust it. */
export const TemplateCard = ({ summary }: { summary: TemplateSummary }) => (
  <>
    <p>
      <strong>{summary.name}</strong>
    </p>
    <p>{summary.description}</p>
    <p class="small muted">With this template the application can ask for:</p>
    <ul class="list">
      {summary.actions.map((action) => (
        <li>
          <strong>{action.name}</strong>
          <div class="small muted">{action.description}</div>
        </li>
      ))}
    </ul>
    <p class="small muted">
      Template <span class="mono">{shorten(summary.identifier)}</span>. A template sets the rules for money put into it. Trust one only from an application you trust.
    </p>
  </>
);

/** An action in the template's words, followed by the wallet's own figures for it. */
export const ActionView = ({ preview, identity }: { preview: ActionPreview; identity: string }) => (
  <>
    <p>
      <strong>{preview.action.name}</strong>
      {preview.action.description === '' ? '' : ` — ${preview.action.description}`}
    </p>
    {preview.variables.length > 0 && (
      <ul class="list">
        {preview.variables.map((variable) => (
          <li>
            <span class="muted">{variable.name}:</span> <TemplateValue type={variable.type} value={variable.value} identity={identity} />
          </li>
        ))}
      </ul>
    )}
    <p class="small muted">The lines above are from the template "{preview.template.name}". What follows is what this wallet worked out from the transaction itself.</p>
    <ul class="list">
      {preview.spends.map((spent) => (
        <li>
          Takes <Amount satoshis={spent.satoshis} /> out of "{spent.label}".
        </li>
      ))}
      {preview.creates.map((created) => (
        <li>
          Puts <Amount satoshis={created.satoshis} /> into "{created.name}"{created.kept ? ', which stays yours and moves with your wallet.' : ', which leaves your wallet.'}
          {created.description === '' ? '' : <div class="small muted">{created.description}</div>}
        </li>
      ))}
      <li>
        {preview.fundsChange < 0n ? (
          <>
            Your wallet's funds go down by <Amount satoshis={-preview.fundsChange} />
          </>
        ) : (
          <>
            Your wallet's funds go up by <Amount satoshis={preview.fundsChange} />
          </>
        )}
        , after a network fee of about <Amount satoshis={preview.fee} />.
      </li>
      {preview.notBefore > 0 && <li>The network accepts this only after {formatTime(preview.notBefore)}.</li>}
    </ul>
  </>
);
