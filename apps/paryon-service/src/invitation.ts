import { binToHex } from '@bitauth/libauth';
import { readInvitationOutline } from '@grandmas-wallet/connect';
import { type BorrowerCommitted, type ParyonAction, PARYON_SERVICE_SPLIT } from '@grandmas-wallet/paryon';
import type { XOInvitation } from '@xo-cash/types';
import { deserializeInvitation } from '@xo-cash/utils';

/**
 * The invitation a wallet sends with a join, read without the engine: whether it is one of the served template's
 * actions holding the wallet's commits and nothing else, and what the wallet committed. The engine checks its
 * signatures and its agreement with the template afterwards (`validateInvitation`, in the engine's process).
 */

/** The role the wallet takes in the template, and the one the service takes. */
export const WALLET_ROLE = 'borrower';
export const SERVICE_ROLE = 'service';

export interface WalletInvitation {
  ok: true;
  invitation: XOInvitation;
  action: ParyonAction;
  /** The wallet's variables, and the outpoints of the coins it committed. */
  committed: BorrowerCommitted;
}

export interface InvitationRefusal {
  ok: false;
  code: 'bad-invitation' | 'unknown-template';
  reason: string;
}

const refuse = (reason: string, code: InvitationRefusal['code'] = 'bad-invitation'): InvitationRefusal => ({ ok: false, code, reason });
const isAction = (name: string): name is ParyonAction => Object.hasOwn(PARYON_SERVICE_SPLIT, name);
const ofWallet = (role: string | undefined): boolean => role === undefined || role === WALLET_ROLE;

/**
 * Read the wallet's invitation for the served template.
 * @param template the served template's identifier and its actions
 */
export const readWalletInvitation = (text: string, template: { identifier: string; actions: readonly string[] }): WalletInvitation | InvitationRefusal => {
  let outline: ReturnType<typeof readInvitationOutline>;
  try {
    outline = readInvitationOutline(text);
  } catch (error) {
    return refuse((error as Error).message);
  }
  if (outline.templateIdentifier !== template.identifier) return refuse('This service does not serve the template of this invitation.', 'unknown-template');
  const action = outline.actionIdentifier;
  if (!isAction(action) || !template.actions.includes(action)) return refuse(`The invitation is for "${action.slice(0, 40)}", which is not an action of the template.`);
  let invitation: XOInvitation;
  try {
    invitation = deserializeInvitation(text);
  } catch {
    return refuse('The invitation cannot be read.');
  }
  const { commits } = invitation;
  if (!Array.isArray(commits) || commits.length === 0) return refuse('The invitation holds no commit of the wallet\'s.');
  if (invitation.result !== undefined) return refuse('The invitation has a transaction already.');
  const entity = commits[0]?.entityIdentifier;
  if (commits.some((commit) => commit.entityIdentifier !== entity)) return refuse('The invitation holds commits of more than one participant; the service joins the wallet\'s alone.');
  if (commits[0]?.data?.roleIdentifier !== WALLET_ROLE) return refuse(`The wallet's commit does not take the role "${WALLET_ROLE}".`);
  for (const commit of commits) {
    const data = commit.data ?? {};
    const roles = [data.roleIdentifier, ...(data.variables ?? []).map((item) => item.roleIdentifier), ...(data.inputs ?? []).map((item) => item.roleIdentifier), ...(data.outputs ?? []).map((item) => item.roleIdentifier)];
    if (!roles.every(ofWallet)) return refuse(`The wallet's commits name a role other than "${WALLET_ROLE}".`);
    const reference = commit.actionReference;
    if (reference !== undefined && (reference.templateIdentifier !== invitation.templateIdentifier || reference.actionIdentifier !== action)) return refuse('A commit of the invitation names another template or action.');
  }
  const variables: BorrowerCommitted['variables'] = {};
  for (const variable of commits.flatMap((commit) => commit.data?.variables ?? [])) {
    const value: unknown = variable.value;
    variables[variable.variableIdentifier] = value instanceof Uint8Array ? binToHex(value) : typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? value : String(value);
  }
  const inputs = commits
    .flatMap((commit) => commit.data?.inputs ?? [])
    .flatMap((input) => (input.outpointTransactionHash instanceof Uint8Array && typeof input.outpointIndex === 'number' ? [`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`] : []));
  return { ok: true, invitation, action, committed: { variables, inputs } };
};
