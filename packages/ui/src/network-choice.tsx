import { useEffect, useRef, useState } from 'preact/hooks';

import type { Environment } from './environment.js';
import { confirmMainnetChoice } from './mainnet.js';
import { type StorageNetwork, forgetNetwork, rememberNetwork, storageNetworkOf } from './network.js';

/*
 * The choice of network on a page whose deployment offers more than one: the network label in the header opens
 * it. Mainnet is shown with the full statement every time it is chosen; a test network needs no confirmation.
 * The choice is kept in this browser and the page loads again on the chosen network.
 */

/** How a network is named in the choice. */
export const networkWords = (network: string): { name: string; coins: string } =>
  network === 'mainnet' ? { name: 'Mainnet', coins: 'real coins' } : { name: network.slice(0, 1).toUpperCase() + network.slice(1), coins: 'test coins' };

/**
 * Change the page to another network the deployment offers: the statement first for mainnet, then the page loads
 * again on it. `before` runs just before, to carry something over. Resolves false where the person went back,
 * or where the deployment does not offer that network.
 */
export const chooseNetwork = async (environment: Pick<Environment, 'network' | 'choice'>, network: string, before?: (side: StorageNetwork) => void): Promise<boolean> => {
  if (network === environment.network) return true;
  if (environment.choice?.networks.includes(network) !== true) return false;
  if (network === 'mainnet' && !(await confirmMainnetChoice())) return false;
  rememberNetwork(network, before === undefined ? undefined : () => before(storageNetworkOf(network)));
  return true;
};

/** What an application does with the network of the wallet that connects to it. */
export type FollowWallet = { kind: 'same' } | { kind: 'switch'; network: string } | { kind: 'refuse'; reason: string };

/**
 * Whether an application page works on the network of the wallet that connected: on it already, by changing to
 * it where the deployment offers it (and `refused` does not exclude it), or not at all, said in a plain sentence.
 */
export const followWallet = (environment: Pick<Environment, 'network' | 'choice'>, walletNetwork: string, refused: string[] = []): FollowWallet => {
  if (walletNetwork === environment.network) return { kind: 'same' };
  if (environment.choice?.networks.includes(walletNetwork) === true && !refused.includes(walletNetwork)) return { kind: 'switch', network: walletNetwork };
  const here = (environment.choice?.networks ?? [environment.network]).filter((network) => !refused.includes(network) || network === environment.network);
  const names = here.map((network) => networkWords(network).name);
  return { kind: 'refuse', reason: `Your wallet is on ${networkWords(walletNetwork).name}, and this page works on ${names.join(' or ')} only. Switch the wallet to ${names[0] ?? environment.network} and connect again.` };
};

/**
 * An application's page that followed a wallet to another network goes back to the deployment's starting network
 * when the wallet is disconnected. Returns whether it loads again for that.
 */
export const returnToStartingNetwork = (environment: Pick<Environment, 'network' | 'choice'>): boolean => {
  forgetNetwork();
  if (environment.choice === undefined || environment.choice.starting === environment.network) return false;
  window.location.reload();
  return true;
};

/** The network label of the header; where the deployment offers a choice, it opens it. */
export const NetworkChip = ({ environment, choosable }: { environment: Environment; choosable: boolean }) => {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const test = environment.network !== 'mainnet';
  const words = networkWords(environment.network);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: Event) => {
      if (!(event.target instanceof Node) || holder.current?.contains(event.target) !== true) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const label = (
    <>
      {test ? environment.network : words.name}
      {test && <span class="chip-more"> · test coins</span>}
    </>
  );
  const networks = environment.choice?.networks;
  if (!choosable || networks === undefined) {
    return (
      <span class={`netchip${test ? ' test' : ''}`} title={test ? 'A test network: its coins have no value.' : undefined}>
        {label}
      </span>
    );
  }
  return (
    <span class="netchoice" ref={holder}>
      <button type="button" class={`netchip choosable${test ? ' test' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Choose the network">
        {label}
        <span class="netchip-caret" aria-hidden="true" />
      </button>
      {open && (
        <span class="netmenu" role="menu" aria-label="Network">
          {networks.map((network) => {
            const choice = networkWords(network);
            const current = network === environment.network;
            return (
              <button
                key={network}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                class={`netmenu-item${current ? ' current' : ''}${network === 'mainnet' ? ' real' : ''}`}
                onClick={() => {
                  setOpen(false);
                  void chooseNetwork(environment, network);
                }}
              >
                <span class="netmenu-name">{choice.name}</span>
                <span class="netmenu-coins"> · {choice.coins}</span>
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
};
