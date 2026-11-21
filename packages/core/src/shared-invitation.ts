import { binToHex } from '@bitauth/libauth';
import type { XOInvitation, XOInvitationCommit } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

/**
 * Reading an XO invitation that another participant joined: what each commit holds, in a form the wallet's checks
 * read without the engine. Nothing here knows any template or application, and nothing is checked here: the wallet's
 * checks judge what these parts say (docs/xo-service.md, "What a wallet must check before signing").
 */

/** A variable as a commit states it. */
export interface CommitVariable {
  variableIdentifier: string;
  /** The role the commit tags it with; the engine lets a tag override the template's assignment. */
  roleIdentifier?: string;
  value: string | number | bigint | boolean;
  /** Whether it extends an item of an earlier commit. */
  mergesWith: boolean;
}

/** An input as a commit states it. Fields the commit leaves out are absent. */
export interface CommitInput {
  /** The outpoint's transaction identifier, as hex in the order block explorers show (the engine's `outpointTransactionHash`). */
  transactionId?: string;
  index?: number;
  inputIdentifier?: string;
  unlockingBytecode?: Uint8Array;
  sequenceNumber?: number;
  roleIdentifier?: string;
  transactionIndex?: number;
  /** How many resolutions (signatures, public keys) the input carries. */
  resolutions: number;
  mergesWith: boolean;
}

/** An output as a commit states it. Fields the commit leaves out are absent; the engine works them out from the template. */
export interface CommitOutput {
  outputIdentifier?: string;
  roleIdentifier?: string;
  lockingBytecode?: Uint8Array;
  valueSatoshis?: bigint;
  token?: {
    category?: Uint8Array;
    amount?: bigint;
    nft?: { capability?: 'none' | 'mutable' | 'minting'; commitment?: Uint8Array };
  };
  transactionIndex?: number;
  secretIdentifier?: string;
  mergesWith: boolean;
}

/** One commit of an invitation. */
export interface CommitPart {
  commitIdentifier: string;
  entityIdentifier: string;
  /** The role the committing entity takes with this commit, where it names one. */
  role?: string;
  createdAtTimestamp: number;
  /** Not enforced by the engine and not covered by the commit's signature: the wallet keeps its own time limit. */
  expiresAtTimestamp: number;
  actionReference?: { templateIdentifier: string; actionIdentifier: string };
  transactionVersion?: number;
  transactionLocktime?: number;
  variables: CommitVariable[];
  inputs: CommitInput[];
  outputs: CommitOutput[];
  /** How many resolutions the commit carries outside its inputs. */
  resolutions: number;
}

/** An invitation as text: XO's own serialization (`serializeInvitation` of `@xo-cash/utils`), which every participant reads. */
export const invitationToText = (invitation: XOInvitation): string => serializeInvitation(invitation);

/** @throws if the text is not XO's serialization of an invitation */
export const invitationFromText = (text: string): XOInvitation => deserializeInvitation(text);

const optional = <Key extends string, Value>(key: Key, value: Value | undefined): { [K in Key]?: Value } => (value === undefined ? {} : ({ [key]: value } as { [K in Key]?: Value }));

/** One commit's parts. */
export const commitPart = (commit: XOInvitationCommit): CommitPart => {
  const { data } = commit;
  return {
    commitIdentifier: commit.commitIdentifier,
    entityIdentifier: commit.entityIdentifier,
    ...optional('role', data.roleIdentifier),
    createdAtTimestamp: commit.createdAtTimestamp,
    expiresAtTimestamp: commit.expiresAtTimestamp,
    ...optional('actionReference', commit.actionReference === undefined ? undefined : { templateIdentifier: commit.actionReference.templateIdentifier, actionIdentifier: commit.actionReference.actionIdentifier }),
    ...optional('transactionVersion', data.transactionVersion),
    ...optional('transactionLocktime', data.transactionLocktime),
    variables: (data.variables ?? []).map((variable) => ({
      variableIdentifier: variable.variableIdentifier,
      ...optional('roleIdentifier', variable.roleIdentifier),
      value: variable.value,
      mergesWith: variable.mergesWith !== undefined,
    })),
    inputs: (data.inputs ?? []).map((input) => ({
      ...optional('transactionId', input.outpointTransactionHash === undefined ? undefined : binToHex(input.outpointTransactionHash)),
      ...optional('index', input.outpointIndex),
      ...optional('inputIdentifier', input.inputIdentifier),
      ...optional('unlockingBytecode', input.unlockingBytecode),
      ...optional('sequenceNumber', input.sequenceNumber),
      ...optional('roleIdentifier', input.roleIdentifier),
      ...optional('transactionIndex', input.transactionIndex),
      resolutions: input.resolutions?.length ?? 0,
      mergesWith: input.mergesWith !== undefined,
    })),
    outputs: (data.outputs ?? []).map((output) => ({
      ...optional('outputIdentifier', output.outputIdentifier),
      ...optional('roleIdentifier', output.roleIdentifier),
      ...optional('lockingBytecode', output.lockingBytecode),
      ...optional('valueSatoshis', output.valueSatoshis === undefined ? undefined : BigInt(output.valueSatoshis)),
      ...optional(
        'token',
        output.token === undefined
          ? undefined
          : {
              ...optional('category', output.token.category),
              ...optional('amount', output.token.amount === undefined ? undefined : BigInt(output.token.amount)),
              ...optional('nft', output.token.nft === undefined ? undefined : { ...optional('capability', output.token.nft.capability), ...optional('commitment', output.token.nft.commitment) }),
            },
      ),
      ...optional('transactionIndex', output.transactionIndex),
      ...optional('secretIdentifier', output.secretIdentifier),
      mergesWith: output.mergesWith !== undefined,
    })),
    resolutions: data.resolutions?.length ?? 0,
  };
};

/**
 * An invitation split into the commits of one participant and those of everyone else, each in order.
 * @param entityIdentifier - the participant's entity in this invitation
 */
export const invitationParts = (invitation: XOInvitation, entityIdentifier: string): { own: CommitPart[]; others: CommitPart[] } => {
  const parts = invitation.commits.map(commitPart);
  return { own: parts.filter((part) => part.entityIdentifier === entityIdentifier), others: parts.filter((part) => part.entityIdentifier !== entityIdentifier) };
};
