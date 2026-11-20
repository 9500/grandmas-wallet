import {
  type LedgerEntry,
  type LedgerStorage,
  type Offer,
  type Proposal,
  type RecordedPositionReport,
  type ReportedPosition,
  type XoAdvertisement,
  WalletConnector,
  XO_EXTENSION_VERSION,
  XO_EXTENSION_VERSIONS,
} from '@grandmas-wallet/connect';

import { type ApplicationAction, type Applications, type HeldToken, type RecordedPosition } from './applications.js';
import { BINDING_KINDS, RECOVERY_PROFILE } from './declaration.js';

/**
 * A session with an application (proposal section 14): what the wallet announces, and how a request that
 * arrives becomes an action the wallet works out, shows and carries out.
 *
 * The application is never sent the wallet's identity, a viewing key, or anything about other
 * applications. What it is told is in this file: whether a request was taken on, how far it got, the
 * transaction, the tokens the wallet received, and the tokens of its own template that the wallet holds.
 */

/**
 * What the wallet announces under `xo_v1`. It names no template and no application. It answers requests of
 * version 1, with the recovery profile the pages of the second design check for, and of version 2, which need
 * no declaration (section 14.2).
 */
export const walletAnnouncement = (network: string): XoAdvertisement => ({
  version: XO_EXTENSION_VERSION,
  network,
  profiles: [RECOVERY_PROFILE],
  bindings: [...BINDING_KINDS],
  versions: [...XO_EXTENSION_VERSIONS],
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
  ...(entry.inputs === undefined ? {} : { inputs: entry.inputs }),
  ...(entry.about === undefined ? {} : { about: entry.about }),
  ...(entry.page === undefined ? {} : { page: entry.page }),
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

/**
 * A position of an application's template as a positions request of version 2 is answered (section 14.2): the
 * token and the value of the coin that holds it; for a position at a script of its own, the script's values and
 * whether it is open, closed or not confirmed; for one at a script many users share, only that the token is held.
 */
export const reportedFromRecord = (position: RecordedPosition): RecordedPositionReport => ({
  category: position.token.category,
  commitment: position.token.commitment,
  capability: position.token.capability,
  satoshis: String(position.token.satoshis),
  status: position.status,
  ...(position.status === 'held' || position.record.lockingScriptIdentifier === undefined ? {} : { lockingScript: position.record.lockingScriptIdentifier, variables: { ...(position.record.variables ?? {}) } }),
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
    /** Templates that applications present without an action, for the user to trust or not. */
    onOffers?: (offers: Offer[]) => void;
    now?: () => number;
  },
): WalletConnector =>
  new WalletConnector({
    has: (template) => applications.has(template),
    // Reading what was sent refuses a text that is not the one named, and a declaration of an unknown profile.
    check: (template, texts) => void applications.describe(template, texts),
    execute: async (entry, stage, consent) => {
      const outcome = await applications.carryOut(actionOf(entry), stage, consent.tokensLeave === true ? { tokensLeave: true } : {});
      return { transactionId: outcome.transactionId, tokens: outcome.tokens };
    },
    positions: async (templateIdentifier, application, version) => {
      if (version === 2) {
        const recorded = await applications.positionsFromRecords(templateIdentifier, application);
        if (recorded === undefined && applications.mayAllow(templateIdentifier, application)) options.onPositionsAsked?.(templateIdentifier, application);
        return recorded?.map(reportedFromRecord);
      }
      const held = await applications.positions(templateIdentifier, application);
      if (held === undefined && applications.mayAllow(templateIdentifier, application)) options.onPositionsAsked?.(templateIdentifier, application);
      return held?.map(reported);
    },
    onProposals: options.onProposals,
    trustedWith: (template, application) => applications.has(template) && !applications.mayAllow(template.identifier, application),
    trustOffered: async (template, texts, application) => {
      const kept = await applications.trust(template, texts, application);
      // A token the wallet already holds may depend on the template: it goes to the backup now, where a store answers.
      await applications.storeNow(kept.identifier);
    },
    ...(options.onOffers === undefined ? {} : { onOffers: options.onOffers }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
