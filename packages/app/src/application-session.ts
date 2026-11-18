import { type LedgerEntry, type LedgerStorage, type Proposal, type ReportedPosition, type XoAdvertisement, WalletConnector, XO_EXTENSION_VERSION } from '@grandmas-wallet/connect';

import { type ApplicationAction, type Applications, type HeldToken } from './applications.js';
import { BINDING_KINDS, RECOVERY_PROFILE } from './declaration.js';

/**
 * A session with an application (proposal section 14): what the wallet announces, and how a request that
 * arrives becomes an action the wallet works out, shows and carries out.
 *
 * The application is never sent the wallet's identity, a viewing key, or anything about other
 * applications. What it is told is in this file: whether a request was taken on, how far it got, the
 * transaction, the tokens the wallet received, and the tokens of its own template that the wallet holds.
 */

/** What the wallet announces under `xo_v1`. It names no template and no application. */
export const walletAnnouncement = (network: string): XoAdvertisement => ({
  version: XO_EXTENSION_VERSION,
  network,
  profiles: [RECOVERY_PROFILE],
  bindings: [...BINDING_KINDS],
});

/** A request as it was recorded, as the action it asks for. */
export const actionOf = (entry: LedgerEntry): ApplicationAction => ({
  template: entry.template,
  ...(entry.definition === undefined ? {} : { presented: entry.definition }),
  action: entry.templateAction,
  role: entry.role,
  variables: entry.variables,
  ...(entry.bindings === undefined ? {} : { bindings: entry.bindings }),
  ...(entry.creates === undefined ? {} : { creates: entry.creates }),
  ...(entry.spends === undefined ? {} : { tokens: entry.spends }),
  application: entry.application,
});

/** A token of an application's template, as that application is told about it. */
const reported = (token: HeldToken): ReportedPosition => ({
  category: token.category,
  commitment: token.commitment,
  authority: token.authority ?? '',
  status: token.position?.status ?? 'incomplete',
  satoshis: String(token.position?.satoshis ?? 0n),
  ...(token.position?.lockingBytecode === undefined ? {} : { lockingBytecode: token.position.lockingBytecode }),
  actions: (token.actions ?? []).map(({ action }) => action),
});

/** The part of the wallet that answers applications, on the wallet's own handling of templates and actions. */
export const applicationConnector = (
  applications: Applications,
  options: {
    storage?: LedgerStorage;
    onProposals: (proposals: Proposal[]) => void;
    /**
     * An application asked about the tokens of a template the user trusts on this device, but not in a session
     * with that application. It was answered as for any other template, with nothing. The user may let it see
     * them (`Applications.allow`); its next request is then answered.
     */
    onPositionsAsked?: (templateIdentifier: string, application: string) => void;
    now?: () => number;
  },
): WalletConnector =>
  new WalletConnector({
    has: (template) => applications.has(template),
    // Reading what was sent refuses a text that is not the one named, and a declaration of an unknown profile.
    check: (template, texts) => void applications.describe(template, texts),
    execute: async (entry, stage) => {
      const outcome = await applications.carryOut(actionOf(entry), stage);
      return { transactionId: outcome.transactionId, tokens: outcome.tokens };
    },
    positions: async (templateIdentifier, application) => {
      const held = await applications.positions(templateIdentifier, application);
      if (held === undefined && applications.mayAllow(templateIdentifier, application)) options.onPositionsAsked?.(templateIdentifier, application);
      return held?.map(reported);
    },
    onProposals: options.onProposals,
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
