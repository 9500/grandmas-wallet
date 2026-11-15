/**
 * Controller state, as stored in the commitment of the wallet's identity NFT.
 *
 * Layout (69 bytes, fixed):
 *
 * | offset | bytes | field                                              |
 * | ------ | ----- | -------------------------------------------------- |
 * | 0      | 1     | format / authorization-interface version           |
 * | 1      | 1     | status: 0x00 Active, 0x01 Pending                  |
 * | 2      | 4     | owner epoch, little-endian, 0 .. 2^31-1            |
 * | 6      | 20    | owner public key hash (hash160)                    |
 * | 26     | 20    | recoverer public key hash (hash160)                |
 * | 46     | 3     | challenge delay, BIP68 relative locktime, LE       |
 * | 49     | 20    | proposed owner public key hash; zero when Active   |
 *
 * Integers are fixed-width little-endian with the top bit clear, so a contract
 * can read them with OP_BIN2NUM without sign ambiguity.
 */

export const CONTROLLER_STATE_VERSION = 0x01;
export const CONTROLLER_STATE_LENGTH = 69;
export const KEY_HASH_LENGTH = 20;
export const MAX_OWNER_EPOCH = 0x7fffffff;

/** BIP68: bit 22 selects 512-second units instead of blocks; low 16 bits carry the value. */
const DELAY_TYPE_FLAG = 1 << 22;
const DELAY_VALUE_MASK = 0xffff;

const OFFSET = {
  version: 0,
  status: 1,
  ownerEpoch: 2,
  ownerKeyHash: 6,
  recovererKeyHash: 26,
  challengeDelay: 46,
  proposedOwnerKeyHash: 49,
} as const;

export type ControllerStatus = 'active' | 'pending';

/** `blocks`: number of blocks. `time512`: number of 512-second intervals. */
export interface ChallengeDelay {
  unit: 'blocks' | 'time512';
  value: number;
}

export interface ControllerState {
  version: typeof CONTROLLER_STATE_VERSION;
  status: ControllerStatus;
  ownerEpoch: number;
  ownerKeyHash: Uint8Array;
  recovererKeyHash: Uint8Array;
  challengeDelay: ChallengeDelay;
  /** Present exactly when `status` is `pending`. */
  proposedOwnerKeyHash?: Uint8Array;
}

export type ControllerStateErrorCode =
  | 'invalid-length'
  | 'unsupported-version'
  | 'invalid-status'
  | 'invalid-owner-epoch'
  | 'invalid-key-hash'
  | 'invalid-challenge-delay'
  | 'inconsistent-claim';

export class ControllerStateError extends Error {
  readonly code: ControllerStateErrorCode;

  constructor(code: ControllerStateErrorCode, message: string) {
    super(message);
    this.name = 'ControllerStateError';
    this.code = code;
  }
}

const fail = (code: ControllerStateErrorCode, message: string): never => {
  throw new ControllerStateError(code, message);
};

const isAllZero = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0);

const assertKeyHash = (name: string, hash: Uint8Array): void => {
  if (!(hash instanceof Uint8Array) || hash.length !== KEY_HASH_LENGTH) {
    fail('invalid-key-hash', `${name} must be ${KEY_HASH_LENGTH} bytes.`);
  }
  if (isAllZero(hash)) {
    fail('invalid-key-hash', `${name} must not be all zero.`);
  }
};

/** Encode a challenge delay as the BIP68 sequence number the finalizing input must carry. */
export const encodeChallengeDelay = (delay: ChallengeDelay): number => {
  if (delay.unit !== 'blocks' && delay.unit !== 'time512') {
    fail('invalid-challenge-delay', 'Challenge delay unit must be "blocks" or "time512".');
  }
  if (!Number.isInteger(delay.value) || delay.value < 1 || delay.value > DELAY_VALUE_MASK) {
    fail('invalid-challenge-delay', `Challenge delay value must be an integer from 1 to ${DELAY_VALUE_MASK}.`);
  }
  return delay.unit === 'time512' ? DELAY_TYPE_FLAG | delay.value : delay.value;
};

export const decodeChallengeDelay = (sequence: number): ChallengeDelay => {
  if (!Number.isInteger(sequence) || (sequence & ~(DELAY_TYPE_FLAG | DELAY_VALUE_MASK)) !== 0) {
    fail('invalid-challenge-delay', 'Challenge delay has bits set outside the relative locktime type flag and value.');
  }
  const value = sequence & DELAY_VALUE_MASK;
  if (value === 0) {
    fail('invalid-challenge-delay', 'Challenge delay must not be zero.');
  }
  return { unit: (sequence & DELAY_TYPE_FLAG) !== 0 ? 'time512' : 'blocks', value };
};

/** Throws `ControllerStateError` unless the state is well-formed and internally consistent. */
export const validateControllerState = (state: ControllerState): void => {
  if (state.version !== CONTROLLER_STATE_VERSION) {
    fail('unsupported-version', `Unsupported controller state version ${String(state.version)}.`);
  }
  if (state.status !== 'active' && state.status !== 'pending') {
    fail('invalid-status', `Unknown controller status ${String(state.status)}.`);
  }
  if (!Number.isInteger(state.ownerEpoch) || state.ownerEpoch < 0 || state.ownerEpoch > MAX_OWNER_EPOCH) {
    fail('invalid-owner-epoch', `Owner epoch must be an integer from 0 to ${MAX_OWNER_EPOCH}.`);
  }
  assertKeyHash('Owner key hash', state.ownerKeyHash);
  assertKeyHash('Recoverer key hash', state.recovererKeyHash);
  encodeChallengeDelay(state.challengeDelay);
  if (state.status === 'pending') {
    if (state.proposedOwnerKeyHash === undefined) {
      fail('inconsistent-claim', 'A pending controller must name a proposed owner.');
    } else {
      assertKeyHash('Proposed owner key hash', state.proposedOwnerKeyHash);
    }
  } else if (state.proposedOwnerKeyHash !== undefined) {
    fail('inconsistent-claim', 'An active controller must not name a proposed owner.');
  }
};

export const encodeControllerState = (state: ControllerState): Uint8Array => {
  validateControllerState(state);
  const bytes = new Uint8Array(CONTROLLER_STATE_LENGTH);
  const view = new DataView(bytes.buffer);
  bytes[OFFSET.version] = state.version;
  bytes[OFFSET.status] = state.status === 'pending' ? 0x01 : 0x00;
  view.setUint32(OFFSET.ownerEpoch, state.ownerEpoch, true);
  bytes.set(state.ownerKeyHash, OFFSET.ownerKeyHash);
  bytes.set(state.recovererKeyHash, OFFSET.recovererKeyHash);
  const delay = encodeChallengeDelay(state.challengeDelay);
  bytes[OFFSET.challengeDelay] = delay & 0xff;
  bytes[OFFSET.challengeDelay + 1] = (delay >> 8) & 0xff;
  bytes[OFFSET.challengeDelay + 2] = (delay >> 16) & 0xff;
  if (state.proposedOwnerKeyHash !== undefined) {
    bytes.set(state.proposedOwnerKeyHash, OFFSET.proposedOwnerKeyHash);
  }
  return bytes;
};

/**
 * Decode and validate an NFT commitment as controller state.
 * Unknown versions are rejected before any other field is interpreted.
 */
export const decodeControllerState = (commitment: Uint8Array): ControllerState => {
  if (commitment.length < 1) {
    fail('invalid-length', 'Controller commitment is empty.');
  }
  if (commitment[OFFSET.version] !== CONTROLLER_STATE_VERSION) {
    fail('unsupported-version', `Unsupported controller state version ${String(commitment[OFFSET.version])}.`);
  }
  if (commitment.length !== CONTROLLER_STATE_LENGTH) {
    fail('invalid-length', `Controller commitment must be ${CONTROLLER_STATE_LENGTH} bytes, got ${commitment.length}.`);
  }
  const view = new DataView(commitment.buffer, commitment.byteOffset, commitment.byteLength);
  const statusByte = commitment[OFFSET.status];
  if (statusByte !== 0x00 && statusByte !== 0x01) {
    fail('invalid-status', `Unknown controller status byte ${String(statusByte)}.`);
  }
  const status: ControllerStatus = statusByte === 0x01 ? 'pending' : 'active';
  const ownerEpoch = view.getUint32(OFFSET.ownerEpoch, true);
  const slice = (offset: number): Uint8Array => commitment.slice(offset, offset + KEY_HASH_LENGTH);
  const delayBytes = commitment.subarray(OFFSET.challengeDelay, OFFSET.challengeDelay + 3);
  const challengeDelay = decodeChallengeDelay(
    (delayBytes[0] ?? 0) | ((delayBytes[1] ?? 0) << 8) | ((delayBytes[2] ?? 0) << 16),
  );
  const proposed = slice(OFFSET.proposedOwnerKeyHash);
  if (status === 'active' && !isAllZero(proposed)) {
    fail('inconsistent-claim', 'An active controller must have a zero proposed owner field.');
  }
  const state: ControllerState = {
    version: CONTROLLER_STATE_VERSION,
    status,
    ownerEpoch,
    ownerKeyHash: slice(OFFSET.ownerKeyHash),
    recovererKeyHash: slice(OFFSET.recovererKeyHash),
    challengeDelay,
    ...(status === 'pending' ? { proposedOwnerKeyHash: proposed } : {}),
  };
  validateControllerState(state);
  return state;
};
