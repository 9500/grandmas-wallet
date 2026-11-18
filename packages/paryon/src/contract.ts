import { bigIntToVmNumber, encodeDataPush, flattenBinArray } from '@bitauth/libauth';
import { instantiate, lockingBytecodeOf } from '@grandmas-wallet/core';

/**
 * A compiled CashScript contract from a published artifact, with its constructor arguments: its address, and
 * the unlocking bytecode of each of its functions. The artifact is used as published; nothing is compiled here.
 */

/** The parts of a CashScript artifact this needs. */
export interface Artifact {
  readonly contractName: string;
  readonly constructorInputs: readonly { readonly name: string; readonly type: string }[];
  readonly abi: readonly { readonly name: string; readonly inputs: readonly { readonly name: string; readonly type: string }[] }[];
  /** The compiled contract as hex, without its constructor arguments. */
  readonly debug?: { readonly bytecode: string };
}

/** An argument: a whole number for `int`, bytes for every other type. */
export type Argument = bigint | Uint8Array;

export interface ContractScript {
  name: string;
  redeemBytecode: Uint8Array;
  /** Pay-to-script-hash (32-byte) locking bytecode: the contract's address. */
  lockingBytecode: Uint8Array;
  /** The unlocking bytecode that calls a function with the given arguments. */
  unlock: (functionName: string, ...args: Argument[]) => Uint8Array;
}

/** An argument as the script receives it, checked against its declared type. */
const encodeArgument = (where: string, type: string, value: Argument | undefined): Uint8Array => {
  if (value === undefined) throw new Error(`${where}: an argument of type ${type} is missing.`);
  if (type === 'int') {
    if (typeof value !== 'bigint') throw new Error(`${where}: an int is a whole number.`);
    return bigIntToVmNumber(value);
  }
  if (type === 'bool') throw new Error(`${where}: bool arguments are not used here.`);
  if (typeof value === 'bigint') throw new Error(`${where}: a ${type} is bytes.`);
  const fixed = /^bytes(\d+)$/.exec(type);
  const length = fixed !== null ? Number(fixed[1]) : type === 'pubkey' ? 33 : undefined;
  if (length !== undefined && value.length !== length) throw new Error(`${where}: a ${type} is ${length} bytes, got ${value.length}.`);
  return value;
};

/**
 * The contract an artifact describes, built with its constructor arguments. Arguments are given in the order
 * the artifact declares them; the script receives them last first, as CashScript places them.
 */
export const contractScript = (artifact: Artifact, constructorArguments: Argument[]): ContractScript => {
  const body = artifact.debug?.bytecode;
  if (body === undefined) throw new Error(`The artifact of ${artifact.contractName} carries no compiled bytecode.`);
  if (constructorArguments.length !== artifact.constructorInputs.length) {
    throw new Error(`${artifact.contractName} takes ${artifact.constructorInputs.length} constructor arguments, got ${constructorArguments.length}.`);
  }
  const encoded = artifact.constructorInputs.map((input, index) => encodeArgument(`${artifact.contractName}(${input.name})`, input.type, constructorArguments[index]));
  const redeemBytecode = instantiate(body, encoded);
  return {
    name: artifact.contractName,
    redeemBytecode,
    lockingBytecode: lockingBytecodeOf(redeemBytecode),
    unlock: (functionName, ...args) => {
      const index = artifact.abi.findIndex((entry) => entry.name === functionName);
      const declared = artifact.abi[index];
      if (declared === undefined) throw new Error(`${artifact.contractName} has no function ${functionName}.`);
      if (args.length !== declared.inputs.length) throw new Error(`${artifact.contractName}.${functionName} takes ${declared.inputs.length} arguments, got ${args.length}.`);
      const values = declared.inputs.map((input, position) => encodeArgument(`${artifact.contractName}.${functionName}(${input.name})`, input.type, args[position]));
      // Arguments last first, then the function's number when the contract has more than one, then the script.
      const selector = artifact.abi.length > 1 ? [encodeDataPush(bigIntToVmNumber(BigInt(index)))] : [];
      return flattenBinArray([...values.reverse().map((value) => encodeDataPush(value)), ...selector, encodeDataPush(redeemBytecode)]);
    },
  };
};
