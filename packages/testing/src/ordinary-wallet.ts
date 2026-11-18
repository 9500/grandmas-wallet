import {
  type Output,
  SigningSerializationFlag,
  binToHex,
  decodeTransactionBch,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeDataPush,
  encodeHdPublicKey,
  encodeTransactionBch,
  flattenBinArray,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';

/**
 * An ordinary wallet as an application meets it over WizardConnect: it
 * shares the public keys of three address chains and signs the inputs it is
 * told to, knowing nothing about what the application does.
 *
 * Written from the protocol's description, independently of the application
 * that talks to it:
 * - an input named in `inputPaths` whose source output has no `contract` is an
 *   ordinary address: the wallet writes its signature and public key
 * - an input whose source output has a `contract` keeps its unlocking script,
 *   in which a push of 65 zero bytes is replaced by the signature and a push
 *   of 33 zero bytes by the public key
 * - every signature is Schnorr over all outputs and all spent outputs
 * - a source output may carry a token (`category` and `commitment` as hex, `amount` as `<bigint: Nn>`); the
 *   coin is still an ordinary address, and the token is part of what the signature covers
 */

const CHAINS = { receive: 0, change: 1, defi: 7 } as const;
type ChainName = keyof typeof CHAINS;

const HASH_TYPE = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
const SIGNATURE_PLACEHOLDER = `41${'00'.repeat(65)}`;
const PUBLIC_KEY_PLACEHOLDER = `21${'00'.repeat(33)}`;

const bytes = (value: unknown): Uint8Array => {
  if (typeof value !== 'string' || !/^([0-9a-f]{2})*$/i.test(value)) throw new Error('A byte field is not hex.');
  return hexToBin(value);
};

const amount = (value: unknown): bigint => {
  const match = typeof value === 'string' ? /^<bigint: (\d+)n>$/.exec(value) : null;
  if (match?.[1] === undefined) throw new Error('An amount is not in the expected form.');
  return BigInt(match[1]);
};

const CAPABILITIES = ['none', 'mutable', 'minting'] as const;

const tokenOf = (value: unknown): Output['token'] => {
  if (value === undefined) return undefined;
  const { category, amount: fungible, nft } = (value ?? {}) as { category?: unknown; amount?: unknown; nft?: { capability?: unknown; commitment?: unknown } };
  const read: NonNullable<Output['token']> = { category: bytes(category), amount: amount(fungible) };
  if (nft !== undefined) {
    const capability = CAPABILITIES.find((name) => name === nft.capability);
    if (capability === undefined) throw new Error('A token\'s capability is not one the wallet knows.');
    read.nft = { capability, commitment: bytes(nft.commitment ?? '') };
  }
  return read;
};

export interface OrdinaryWallet {
  /** What the wallet shares when it connects. */
  paths: { name: ChainName; xpub: string }[];
  /** Sign a request as it arrives on the wire, returning the signed transaction as hex. */
  sign(request: { transaction: { transaction: unknown; sourceOutputs: Record<string, unknown>[] }; inputPaths: [number, string, number][] }): string;
  /** The last request's prompt, as the wallet would show it. */
  lastPrompt: string | undefined;
}

export const ordinaryWallet = (seed: Uint8Array, network: 'mainnet' | 'testnet' = 'testnet'): OrdinaryWallet => {
  const root = deriveHdPrivateNodeFromSeed(seed);
  const chain = (name: ChainName) => {
    const node = deriveHdPath(root, `m/44'/145'/0'/${CHAINS[name]}`);
    if (typeof node === 'string') throw new Error(node);
    return node;
  };
  const wallet: OrdinaryWallet = {
    paths: (Object.keys(CHAINS) as ChainName[]).map((name) => ({ name, xpub: encodeHdPublicKey({ node: deriveHdPublicNode(chain(name)), network }).hdPublicKey })),
    lastPrompt: undefined,
    sign: (request) => {
      const { transaction: hex, sourceOutputs } = request.transaction;
      wallet.lastPrompt = (request.transaction as { userPrompt?: string }).userPrompt;
      const transaction = decodeTransactionBch(bytes(hex));
      if (typeof transaction === 'string') throw new Error(transaction);
      if (transaction.inputs.length !== sourceOutputs.length) throw new Error('Inputs and source outputs differ in number.');
      const spent: Output[] = sourceOutputs.map((source) => {
        const token = tokenOf(source['token']);
        return { lockingBytecode: bytes(source['lockingBytecode']), valueSatoshis: amount(source['valueSatoshis']), ...(token === undefined ? {} : { token }) };
      });
      for (const [inputIndex, name, addressIndex] of request.inputPaths) {
        const input = transaction.inputs[inputIndex];
        const source = sourceOutputs[inputIndex];
        if (input === undefined || source === undefined || !(name in CHAINS)) throw new Error('The request names an input or a chain that does not exist.');
        const key = deriveHdPrivateNodeChild(chain(name as ChainName), addressIndex);
        const publicKey = secp256k1.derivePublicKeyCompressed(key.privateKey);
        if (typeof publicKey === 'string') throw new Error(publicKey);
        const sign = (coveredBytecode: Uint8Array): Uint8Array => {
          const message = generateSigningSerializationBch({ inputIndex, sourceOutputs: spent, transaction }, { coveredBytecode, signingSerializationType: Uint8Array.of(HASH_TYPE) });
          const signature = secp256k1.signMessageHashSchnorr(key.privateKey, hash256(message));
          if (typeof signature === 'string') throw new Error(signature);
          return Uint8Array.from([...signature, HASH_TYPE]);
        };
        const contract = source['contract'] as { redeemScript?: unknown } | undefined;
        if (contract === undefined) {
          input.unlockingBytecode = flattenBinArray([encodeDataPush(sign(spent[inputIndex]?.lockingBytecode ?? new Uint8Array())), encodeDataPush(publicKey)]);
        } else {
          const unlocking = binToHex(bytes(source['unlockingBytecode']));
          input.unlockingBytecode = hexToBin(
            unlocking.replace(SIGNATURE_PLACEHOLDER, `41${binToHex(sign(bytes(contract.redeemScript)))}`).replace(PUBLIC_KEY_PLACEHOLDER, `21${binToHex(publicKey)}`),
          );
        }
      }
      return binToHex(encodeTransactionBch(transaction));
    },
  };
  return wallet;
};
