import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  type ChainReader,
  type ControllerHistory,
  type UnspentOutputEntry,
  assetScript,
  readControllerHistory,
} from '@grandmas-wallet/core';

import type { JsonValue } from './canonical.js';
import type { PositionKind } from './kinds.js';
import {
  type ArchiveRecord,
  type PositionDescription,
  type PositionStatus,
  decodeBlob,
  parseRecord,
  templateContentHash,
  verifyRecordSignature,
} from './records.js';
import { blobIdOf, unseal } from './seal.js';
import { type SignedMessage, keyHashOf } from './signing.js';
import type { ArchiveStore } from './store.js';
import type { WriterState } from './writer.js';

/**
 * Restoring a wallet's picture of itself from its identity, the chain and
 * the archive.
 *
 * The chain is the authority. The controller's history gives the owners; a
 * record counts only if it was signed by the owner of the epoch it names.
 * Each recorded position is then checked against the chain. Anything that
 * cannot be resolved is listed in the result; nothing is left out silently.
 */

export interface RestoreParameters {
  network: string;
  /** Wallet identity as hex, in the byte order shown by explorers. */
  identity: string;
  genesisTransactionId?: string;
  archiveId: Uint8Array;
  contentKey: Uint8Array;
  chain: ChainReader;
  stores: ArchiveStore[];
  /** Where the restoring device keeps its own copy of the archive; filled with everything that was accepted. */
  local?: ArchiveStore;
  /** The kinds of position the restoring wallet can rebuild. Without any, every position is reported as unsupported. */
  kinds?: PositionKind[];
  /** Templates the restoring wallet already has, by content hash. */
  knownTemplates?: Map<string, JsonValue>;
}

export interface StoreReport {
  name: string;
  reachable: boolean;
  error?: string;
  listed: number;
  /** Blobs the store listed but did not return, or returned with different content. */
  damaged: number;
}

export interface RejectedBlob {
  blobId: string;
  reason: string;
}

export type PositionFinding =
  /** Funds are at the position's script now. */
  | 'live'
  /** Recorded as prepared or confirmed, but nothing was ever paid to the script. */
  | 'never-created'
  /** The script was used and holds nothing now. */
  | 'spent';

export interface RestoredPosition {
  position: PositionDescription;
  /** Newest status the archive records. */
  recorded: PositionStatus;
  /**
   * - `complete`: found, checked, and operable by this wallet
   * - `incomplete`: something needed to operate it is missing
   * - `unsupported`: this wallet does not know how to handle it
   */
  result: 'complete' | 'incomplete' | 'unsupported';
  /** Why the result is not `complete`. */
  reasons: string[];
  onChain?: PositionFinding;
  unspent: UnspentOutputEntry[];
  template?: JsonValue;
}

export interface UndescribedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  lockingBytecode: string;
}

export interface RestoreReport {
  controller: ControllerHistory;
  /** The wallet's ordinary funds. */
  funds: { lockingBytecode: string; unspent: UnspentOutputEntry[]; balance: bigint };
  positions: RestoredPosition[];
  stores: StoreReport[];
  rejected: RejectedBlob[];
  /** Records naming a previous record that no store returned. */
  missingRecords: string[];
  /** Records that follow the same record, where only one could. */
  conflicts: string[][];
  /** Entries of a type this version does not know. */
  unknownEntries: { blobId: string; type: string }[];
  /**
   * Outputs the owner paid to a script address that no record describes and
   * that are still unspent: a payment to someone else, or a position whose
   * record is missing.
   */
  undescribed: UndescribedOutput[];
  /** `complete` only if nothing above is left unresolved. */
  completeness: 'complete' | 'incomplete';
  /** Why the restoration is not known to be complete. */
  unresolved: string[];
  /** Where a new owner continues the chain of records. */
  writerState: WriterState;
}

interface ValidRecord {
  blobId: string;
  record: ArchiveRecord;
}

const isScriptHashOutput = (lockingBytecode: Uint8Array): boolean =>
  (lockingBytecode.length === 35 && lockingBytecode[0] === 0xaa && lockingBytecode[1] === 0x20 && lockingBytecode[34] === 0x87) ||
  (lockingBytecode.length === 23 && lockingBytecode[0] === 0xa9 && lockingBytecode[1] === 0x14 && lockingBytecode[22] === 0x87);

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Read every blob the stores hold; a blob counts only if its content matches its name. */
export const collectBlobs = async (stores: ArchiveStore[], archiveId: string): Promise<{ blobs: Map<string, Uint8Array>; reports: StoreReport[] }> => {
  const blobs = new Map<string, Uint8Array>();
  const reports = await Promise.all(
    stores.map(async (store): Promise<StoreReport> => {
      const report: StoreReport = { name: store.name, reachable: true, listed: 0, damaged: 0 };
      try {
        const names = await store.list(archiveId);
        report.listed = names.length;
        for (const name of names) {
          const sealed = await store.get(archiveId, name).catch(() => undefined);
          if (sealed === undefined || blobIdOf(sealed) !== name) {
            report.damaged += 1;
            continue;
          }
          blobs.set(name, sealed);
        }
      } catch (error) {
        report.reachable = false;
        report.error = (error as Error).message;
      }
      return report;
    }),
  );
  return { blobs, reports };
};

/** A record counts if it is about this wallet and signed by the owner of the epoch it names. */
const checkRecord = (signed: SignedMessage, parameters: RestoreParameters, controller: ControllerHistory): ArchiveRecord => {
  const record = parseRecord(signed.message);
  if (record.network !== parameters.network) throw new Error('The record is for a different network.');
  if (record.identity !== parameters.identity) throw new Error('The record is for a different wallet.');
  if (!verifyRecordSignature(signed)) throw new Error('The record signature is not valid.');
  const owner = controller.owners.find((period) => period.ownerEpoch === record.ownerEpoch);
  if (owner === undefined) throw new Error(`The wallet has had no owner epoch ${record.ownerEpoch}.`);
  if (!sameBytes(keyHashOf(signed.publicKey), owner.ownerKeyHash)) {
    throw new Error(`The record was not signed by the owner of epoch ${record.ownerEpoch}.`);
  }
  return record;
};

/**
 * Put the valid records in order. Returns the main line from the first
 * record on, the records left outside it, and what is wrong with the chain.
 */
const orderRecords = (valid: ValidRecord[]) => {
  const byId = new Map(valid.map((item) => [item.blobId, item]));
  const followers = new Map<string, ValidRecord[]>();
  const missingRecords: string[] = [];
  const rejected: RejectedBlob[] = [];
  for (const item of valid) {
    const { previous, sequence, ownerEpoch } = item.record;
    const parent = previous === null ? undefined : byId.get(previous);
    if (previous !== null && parent === undefined) {
      missingRecords.push(previous);
    } else if (parent !== undefined && (parent.record.sequence + 1 !== sequence || parent.record.ownerEpoch > ownerEpoch)) {
      // A record cannot follow one from a later owner: the earlier owner's authority had ended.
      rejected.push({ blobId: item.blobId, reason: 'The record does not follow the record it names.' });
      byId.delete(item.blobId);
      continue;
    }
    const key = previous ?? 'first';
    followers.set(key, [...(followers.get(key) ?? []), item]);
  }

  // Where records conflict, follow the line the latest owner wrote, then the longer one.
  const conflicts: string[][] = [];
  const reach = new Map<string, { ownerEpoch: number; length: number }>();
  const present = (item: ValidRecord): boolean => byId.has(item.blobId);
  for (const item of [...byId.values()].sort((a, b) => b.record.sequence - a.record.sequence)) {
    const next = (followers.get(item.blobId) ?? []).filter(present).map((follower) => reach.get(follower.blobId));
    reach.set(item.blobId, {
      ownerEpoch: Math.max(item.record.ownerEpoch, ...next.map((score) => score?.ownerEpoch ?? 0)),
      length: 1 + Math.max(0, ...next.map((score) => score?.length ?? 0)),
    });
  }
  const choose = (candidates: ValidRecord[]): ValidRecord | undefined => {
    const options = candidates.filter(present);
    if (options.length > 1) conflicts.push(options.map((candidate) => candidate.blobId).sort());
    const score = (item: ValidRecord) => reach.get(item.blobId) ?? { ownerEpoch: 0, length: 0 };
    return [...options].sort(
      (a, b) => score(b).ownerEpoch - score(a).ownerEpoch || score(b).length - score(a).length || a.blobId.localeCompare(b.blobId),
    )[0];
  };

  const main: ValidRecord[] = [];
  let current = choose(followers.get('first') ?? []);
  while (current !== undefined) {
    main.push(current);
    current = choose(followers.get(current.blobId) ?? []);
  }
  const onMain = new Set(main.map((item) => item.blobId));
  const aside = [...byId.values()].filter((item) => !onMain.has(item.blobId)).sort((a, b) => a.record.sequence - b.record.sequence);
  return { main, aside, missingRecords: [...new Set(missingRecords)], conflicts, rejected };
};

export const restore = async (parameters: RestoreParameters): Promise<RestoreReport> => {
  const identity = hexToBin(parameters.identity);
  const kinds = new Map((parameters.kinds ?? []).map((kind) => [kind.kind, kind]));
  const unresolved: string[] = [];

  // 1. The chain: who has owned the wallet, and what state it is in now.
  const controller = await readControllerHistory(parameters.chain, identity, parameters.genesisTransactionId);

  // 2. The archive: everything any store returns intact.
  const { blobs, reports } = await collectBlobs(parameters.stores, binToHex(parameters.archiveId));
  for (const report of reports) {
    if (!report.reachable) unresolved.push(`Backup store ${report.name} could not be reached.`);
    if (report.damaged > 0) unresolved.push(`Backup store ${report.name} returned ${report.damaged} damaged or missing record(s).`);
  }

  const rejected: RejectedBlob[] = [];
  const valid: ValidRecord[] = [];
  const templates = new Map(parameters.knownTemplates ?? []);
  for (const [blobId, sealed] of blobs) {
    try {
      const blob = decodeBlob(unseal(parameters.contentKey, parameters.archiveId, sealed));
      if (blob.type === 'template') templates.set(templateContentHash(blob.template), blob.template);
      if (blob.type === 'record') valid.push({ blobId, record: checkRecord(blob.signed, parameters, controller) });
      await parameters.local?.put(binToHex(parameters.archiveId), sealed);
    } catch (error) {
      rejected.push({ blobId, reason: (error as Error).message });
    }
  }

  // 3. The order of the records, and whether any are missing or in conflict.
  const ordered = orderRecords(valid);
  rejected.push(...ordered.rejected);
  if (rejected.length > 0) unresolved.push(`${rejected.length} stored item(s) were rejected.`);
  if (ordered.missingRecords.length > 0) unresolved.push(`${ordered.missingRecords.length} record(s) that others refer to are missing.`);
  if (ordered.conflicts.length > 0) unresolved.push('The archive holds conflicting histories.');

  // 4. The newest word on each position. Records outside the main line still name places to look.
  const newest = new Map<string, { status: PositionStatus; position: PositionDescription }>();
  const unknownEntries: RestoreReport['unknownEntries'] = [];
  for (const { blobId, record } of [...ordered.aside, ...ordered.main]) {
    if (record.entry.type !== 'position' || !('position' in record.entry)) {
      unknownEntries.push({ blobId, type: record.entry.type });
      continue;
    }
    newest.set(record.entry.position.positionId, { status: record.entry.status, position: record.entry.position });
  }
  if (unknownEntries.length > 0) unresolved.push(`${unknownEntries.length} record(s) are of a type this wallet does not know.`);

  // 5. Each position against the chain.
  const locate = async (restored: RestoredPosition, lockingBytecode: Uint8Array): Promise<void> => {
    restored.unspent = await parameters.chain.listUnspent(lockingBytecode);
    if (restored.unspent.length > 0) restored.onChain = 'live';
    else restored.onChain = (await parameters.chain.getHistory(lockingBytecode)).length > 0 ? 'spent' : 'never-created';
  };
  const positions: RestoredPosition[] = [];
  const describedScripts = new Set<string>();
  for (const { status, position } of newest.values()) {
    const restored: RestoredPosition = { position, recorded: status, result: 'complete', reasons: [], unspent: [] };
    positions.push(restored);
    const kind = kinds.get(position.kind);
    if (kind === undefined) {
      restored.result = 'unsupported';
      restored.reasons.push(`This wallet does not know positions of kind "${position.kind}".`);
      // Recorded by the owner, so not a stray output even though this wallet cannot operate it.
      describedScripts.add(position.lockingBytecode);
      await locate(restored, hexToBin(position.lockingBytecode));
      continue;
    }
    const template = position.template === undefined ? undefined : templates.get(position.template.contentHash);
    if (position.template !== undefined && template === undefined) {
      restored.result = 'incomplete';
      restored.reasons.push(`The template ${position.template.identifier} is not in the archive and not known to this wallet.`);
    } else if (template !== undefined) {
      restored.template = template;
    }
    let expected: string;
    try {
      expected = await kind.lockingBytecode(identity, position.parameters, { position, ...(template === undefined ? {} : { template }) });
    } catch (error) {
      restored.result = 'incomplete';
      restored.reasons.push((error as Error).message);
      // Recorded by the owner; where it says the funds are is still worth a look.
      describedScripts.add(position.lockingBytecode);
      await locate(restored, hexToBin(position.lockingBytecode));
      continue;
    }
    if (expected !== position.lockingBytecode) {
      restored.result = 'incomplete';
      restored.reasons.push('The recorded script does not match the recorded parameters for this wallet.');
      continue;
    }
    describedScripts.add(expected);
    if (!kind.interfaceVersions.includes(position.interfaceVersion)) {
      restored.result = 'unsupported';
      restored.reasons.push(`Approval interface version ${position.interfaceVersion} is not supported for this kind.`);
    }
    const unmet = position.requires.filter((requirement) => !kind.provides.includes(requirement));
    if (unmet.length > 0) {
      restored.result = 'unsupported';
      restored.reasons.push(`Needs something this wallet does not have: ${unmet.join(', ')}.`);
    }
    await locate(restored, hexToBin(expected));
  }
  for (const restored of positions) {
    if (restored.result !== 'complete' && restored.onChain !== 'spent' && restored.onChain !== 'never-created') {
      unresolved.push(`Position "${restored.position.label ?? restored.position.positionId}" is ${restored.result}.`);
    }
  }

  // 6. The wallet's ordinary funds need no record: their address follows from the identity.
  const funds = assetScript(identity).lockingBytecode;
  const fundsUnspent = await parameters.chain.listUnspent(funds);
  describedScripts.add(binToHex(funds));

  // 7. Everything the owner ever approved is in the controller's history. An output there that went
  //    to a script address, is still unspent, and is described by no record may be a missing position.
  const undescribed: UndescribedOutput[] = [];
  const unspentAt = new Map<string, Set<string>>();
  for (const { transactionId, transaction } of controller.transactions) {
    for (const [index, output] of transaction.outputs.entries()) {
      const script = binToHex(output.lockingBytecode);
      if (index === 0 || describedScripts.has(script) || !isScriptHashOutput(output.lockingBytecode)) continue;
      if (!unspentAt.has(script)) {
        const unspent = await parameters.chain.listUnspent(output.lockingBytecode);
        unspentAt.set(script, new Set(unspent.map((entry) => `${entry.transactionId}:${entry.index}`)));
      }
      if (unspentAt.get(script)?.has(`${transactionId}:${index}`) === true) {
        undescribed.push({ transactionId, index, valueSatoshis: output.valueSatoshis, lockingBytecode: script });
      }
    }
  }
  if (undescribed.length > 0) {
    unresolved.push(`${undescribed.length} output(s) paid from the wallet to a script address are described by no record.`);
  }

  const head = ordered.main.at(-1);
  return {
    controller,
    funds: { lockingBytecode: binToHex(funds), unspent: fundsUnspent, balance: fundsUnspent.reduce((sum, entry) => sum + entry.valueSatoshis, 0n) },
    positions,
    stores: reports,
    rejected,
    missingRecords: ordered.missingRecords,
    conflicts: ordered.conflicts,
    unknownEntries,
    undescribed,
    completeness: unresolved.length === 0 ? 'complete' : 'incomplete',
    unresolved,
    writerState: {
      nextSequence: head === undefined ? 0 : head.record.sequence + 1,
      head: head?.blobId ?? null,
      templates: [...templates.keys()],
      stored: {},
    },
  };
};
