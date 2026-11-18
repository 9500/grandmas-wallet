import { ADDRESS_KIND } from '@grandmas-wallet/core';
import { Button, Card, Choice, CopyButton, Loading, Notice, PageHead, QrCode, Segmented, TaskStatus, useTask } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import type { Owner } from './OwnerApp.js';
import { keep, kept } from './session.js';

type Kind = 'once' | 'vault';

/**
 * Receiving (proposal section 8): a fresh address for each payment, and a vault address for a payer who
 * keeps the address for years. When the window of unused addresses is full, an address already given out is
 * shown again, and the page says so. Every address can hold tokens: a switch shows the same address in the
 * form that says so, which wallets that send tokens ask for.
 */
export const Receive = ({ owner }: { owner: Owner }) => {
  const { wallet } = owner;
  const [kind, setKind] = useState<Kind>('once');
  const [once, setOnce] = useState(() => kept('receive'));
  const [vault, setVault] = useState(() => kept('vaultReceive'));
  const [tokens, setTokens] = useState(false);
  const task = useTask();
  const shown = kind === 'once' ? once : vault;

  const give = (which: Kind) =>
    task.run('give', async () => {
      const { address, again } = which === 'once' ? await wallet.receiveAddress() : await wallet.vaultAddress();
      const entry = { number: address.number, again };
      if (which === 'once') {
        keep('receive', entry);
        setOnce(entry);
      } else {
        keep('vaultReceive', entry);
        setVault(entry);
      }
    });

  useEffect(() => {
    if (shown === undefined && task.busy === undefined) void give(kind);
  }, [kind]);

  const made = shown === undefined ? undefined : wallet.address(kind === 'once' ? ADDRESS_KIND.givenOut : ADDRESS_KIND.vault, shown.number);
  const address = made === undefined ? undefined : tokens ? made.tokenAddress : made.address;
  const [prefix, rest] = address === undefined ? ['', ''] : address.includes(':') ? [`${address.split(':')[0]}:`, address.split(':')[1] ?? ''] : ['', address];
  return (
    <div class="stack">
      <PageHead title="Receive">Give the payer this address, or let them scan the code.</PageHead>
      <div class="grid two">
        <Card>
          <div class="stack">
            <Segmented
              label="Kind of address"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'once', label: 'For one payment' },
                { value: 'vault', label: 'For regular payments' },
              ]}
            />
            {address === undefined ? (
              task.error === undefined ? (
                <Loading>Making an address…</Loading>
              ) : null
            ) : (
              <>
                <QrCode text={address.toUpperCase()} label={tokens ? 'QR code of the token address' : 'QR code of the address'} />
                <div class="address-big" data-testid="receive-address" data-value={address} data-form={tokens ? 'tokens' : 'plain'}>
                  <span class="addr-prefix">{prefix}</span>
                  {rest}
                </div>
                <div class="row">
                  <CopyButton text={address} label={tokens ? 'Copy token address' : 'Copy address'} />
                  {kind === 'once' && (
                    <Button kind="quiet" task={task} name="give" onClick={() => void give('once')}>
                      Another address
                    </Button>
                  )}
                </div>
                <div class="token-form">
                  <Choice type="checkbox" checked={tokens} onChange={setTokens} title="Receiving a token?">
                    The same address, written for wallets that send tokens.
                  </Choice>
                </div>
                {shown?.again === true && (
                  <Notice tone="warn">
                    {kind === 'once'
                      ? 'This address was given out before and has not been used yet. The wallet shows it again because twenty unused addresses in a row is as far as it goes. Anything sent to it arrives safely.'
                      : 'This vault address was given out before and has not been used yet. The wallet shows it again because five unused ones in a row is as far as it goes.'}
                  </Notice>
                )}
              </>
            )}
            <TaskStatus task={task} name="give" />
          </div>
        </Card>
        <Card flat>
          {kind === 'once' ? (
            <div class="stack-s">
              <h3>One address for each payment</h3>
              <p class="muted">Every payment gets a new address, so payers cannot see each other. What arrives here can be recovered if you lose this phone.</p>
              <p class="muted">After a recovery the wallet gets new addresses. Someone who pays an old one later still reaches you, but tell regular payers your new address.</p>
            </div>
          ) : (
            <div class="stack-s">
              <h3>An address that lasts</h3>
              <p class="muted">A vault address stays valid for years, also after the wallet has moved to a new phone. Use it where it is published or saved by others: a salary, a donation page, a payout agreed long in advance.</p>
              <p class="muted">Spending from it goes through the wallet's controller and costs a little more in fees.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
