import { type Output, bigIntToVmNumber, binToHex, createCompilerBch, hexToBin, sha256, utf8ToBin, vmNumberToBigInt } from '@bitauth/libauth';
import type { XOTemplate } from '@xo-cash/types';
import { compileCashAssemblyString, generateTemplateIdentifier, isCashAssemblyExpression, parseTemplate } from '@xo-cash/utils';

/**
 * Reading an XO template that is not the wallet's own, and working out what one of its actions comes to:
 * each output, the lock time, the sequence number of each input, and how a coin at one of its scripts is
 * unlocked.
 *
 * The XO engine builds a template's transactions. This is the same reading in this project's own code, with
 * the engine's rules for values and scripts, for three uses: the wallet works out a transaction before
 * anything is signed, so that it can show the user its own figures and choose coins and the exact fee; it
 * compares what the engine built with what it worked out; and the tests' key holder builds without the
 * engine. Nothing here knows any particular template.
 */

export type TemplateValue = string | number | bigint;
export type TemplateValues = Record<string, TemplateValue>;

/** A template as it arrived, with the two names it goes by. */
export interface ReadTemplate {
  /** The text as it arrived. A template's identifier depends on the order of its fields, so the text is what is kept. */
  text: string;
  definition: XOTemplate;
  /** The identifier the XO engine gives the template: the hash of the template as the engine's parser writes it out. */
  identifier: string;
  /** SHA-256 of the text, as hex. */
  contentHash: string;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const fail = (message: string): never => {
  throw new TemplateError(message);
};

/** SHA-256 of a text's bytes, as hex: the name a template, a declaration or a file it refers to is bound by. */
export const textHash = (text: string): string => binToHex(sha256.hash(utf8ToBin(text)));

/**
 * Read a template from its text and check it against the XO schema.
 * @throws TemplateError if it is not a template the XO engine would take
 */
export const readTemplate = (text: string): ReadTemplate => {
  let definition: XOTemplate;
  try {
    definition = parseTemplate(text) as XOTemplate;
  } catch (error) {
    return fail(`This is not a template the XO engine accepts: ${(error as Error).message.slice(0, 300)}`);
  }
  return { text, definition, identifier: generateTemplateIdentifier(definition), contentHash: textHash(text) };
};

const NUMERIC_TYPES = new Set(['integer', 'bigint', 'satoshis', 'token_amount']);

/** The type a template gives a variable or a constant. */
export const variableType = (template: XOTemplate, name: string): string | undefined =>
  (template.variables?.[name]?.type ?? template.constants?.[name]?.type) as string | undefined;

/**
 * Values in the form the engine takes them: whole numbers as numbers, everything else as text. A whole
 * number that arrives as text, as it does in a message, is read by the variable's type.
 */
export const typedValues = (template: XOTemplate, values: TemplateValues): TemplateValues => {
  const typed: TemplateValues = {};
  for (const [name, value] of Object.entries(values)) {
    if (NUMERIC_TYPES.has(variableType(template, name) ?? '') && typeof value === 'string') {
      if (!/^-?\d+$/.test(value)) fail(`The value of "${name}" is not a whole number.`);
      typed[name] = BigInt(value);
    } else {
      typed[name] = value;
    }
  }
  return typed;
};

const withConstants = (template: XOTemplate, values: TemplateValues): TemplateValues => {
  const all: TemplateValues = {};
  for (const [name, constant] of Object.entries(template.constants ?? {})) {
    const { value } = constant as { value?: unknown };
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') all[name] = value;
  }
  return { ...all, ...values };
};

/** One value as the bytes a script is compiled with, by the engine's rule. */
const scriptBytes = (value: TemplateValue, type: string | undefined): Uint8Array => {
  if (typeof value === 'bigint') return bigIntToVmNumber(value);
  if (typeof value === 'number') return Number.isInteger(value) ? bigIntToVmNumber(BigInt(value)) : fail('A number in a template is a whole number.');
  const text = value.startsWith('0x') ? value.slice(2) : value;
  if (type === 'string') return utf8ToBin(value);
  if (type === 'bytes') return hexToBin(text);
  return /^([0-9a-f]{2})*$/i.test(text) ? hexToBin(text) : utf8ToBin(value);
};

const evaluate = (template: XOTemplate, text: string, values: TemplateValues, mode: 'utf8' | 'bigint'): string => {
  try {
    return compileCashAssemblyString({
      cashAssemblyText: text,
      variables: withConstants(template, values),
      evaluationDecodeMode: mode,
      templateVariables: template.variables,
      templateScripts: template.scripts,
    } as Parameters<typeof compileCashAssemblyString>[0]);
  } catch (error) {
    return fail(`The template's expression ${text} cannot be worked out: ${(error as Error).message.slice(0, 200)}`);
  }
};

const isExpression = (value: unknown): value is string => typeof value === 'string' && isCashAssemblyExpression(value);

/**
 * A field of a template given as an expression, such as `$(<keyCategory>)`, worked out for the given values,
 * as the wallet works out the token fields of an output: bytes as hex.
 * @returns `undefined` when the field is not an expression
 * @throws TemplateError if a value the expression needs is missing
 */
export const templateExpression = (template: XOTemplate, field: unknown, values: TemplateValues): string | undefined => (isExpression(field) ? evaluate(template, field, values, 'utf8') : undefined);

const secretsOf = (template: XOTemplate): Set<string> => {
  const secrets = new Set<string>();
  for (const [name, variable] of Object.entries(template.variables ?? {})) if ((variable as { type?: string }).type === 'private_key') secrets.add(name);
  for (const script of Object.values(template.lockingScripts ?? {})) {
    for (const secret of (script as { state?: { secrets?: string[] } }).state?.secrets ?? []) secrets.add(secret);
    for (const role of Object.values((script as { roles?: Record<string, { state?: { secrets?: string[] } }> }).roles ?? {})) for (const secret of role.state?.secrets ?? []) secrets.add(secret);
  }
  return secrets;
};

/** The keys a template names: variables that hold a private key, and the secrets of its scripts. */
export const templateKeys = (template: XOTemplate): string[] => [...secretsOf(template)];

const compilerFor = (template: XOTemplate, lockingScriptIdentifier: string, unlockingScriptIdentifier?: string) => {
  const lockingScript = template.lockingScripts?.[lockingScriptIdentifier];
  if (lockingScript === undefined) return fail(`The template has no locking script "${lockingScriptIdentifier}".`);
  const scriptId = lockingScript.lockingBytecode;
  if (scriptId === undefined || template.scripts?.[scriptId] === undefined) return fail(`The locking script "${lockingScriptIdentifier}" names no script of the template.`);
  const keys = secretsOf(template);
  const variables: Record<string, { type: 'Key' | 'WalletData' }> = {};
  for (const name of Object.keys(template.variables ?? {})) variables[name] = { type: keys.has(name) ? 'Key' : 'WalletData' };
  for (const name of keys) variables[name] = { type: 'Key' };
  for (const name of Object.keys(template.constants ?? {})) variables[name] ??= { type: 'WalletData' };
  const unlockId = unlockingScriptIdentifier ?? lockingScript.unlockingBytecode;
  const compiler = createCompilerBch({
    scripts: template.scripts as Record<string, string>,
    variables,
    lockingScriptTypes: { [scriptId]: lockingScript.lockingType === 'p2sh' ? 'p2sh32' : 'standard' },
    ...(unlockId === undefined ? {} : { unlockingScripts: { [unlockId]: scriptId } }),
  } as Parameters<typeof createCompilerBch>[0]);
  return { compiler, scriptId, unlockId };
};

const bytecodeData = (template: XOTemplate, values: TemplateValues): Record<string, Uint8Array> => {
  const keys = secretsOf(template);
  const data: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(withConstants(template, values))) if (!keys.has(name)) data[name] = scriptBytes(value, variableType(template, name));
  return data;
};

const describeErrors = (errors: unknown): string =>
  Array.isArray(errors) ? errors.map((entry: { error?: string }) => entry.error ?? '').join('; ').slice(0, 300) : 'the script cannot be compiled';

/**
 * The locking bytecode of one of a template's locking scripts, for the given values.
 * @throws TemplateError if a value the script needs is missing
 */
export const templateLockingBytecode = (template: XOTemplate, lockingScriptIdentifier: string, values: TemplateValues): Uint8Array => {
  const lockingScript = template.lockingScripts?.[lockingScriptIdentifier];
  if (lockingScript === undefined) return fail(`The template has no locking script "${lockingScriptIdentifier}".`);
  if (isExpression(lockingScript.lockingBytecode)) return hexToBin(evaluate(template, lockingScript.lockingBytecode, values, 'utf8'));
  const { compiler, scriptId } = compilerFor(template, lockingScriptIdentifier);
  const result = compiler.generateBytecode({ scriptId, data: { bytecode: bytecodeData(template, values) } });
  return result.success ? result.bytecode : fail(`The locking script "${lockingScriptIdentifier}" cannot be made from the values given: ${describeErrors((result as { errors?: unknown }).errors)}`);
};

/**
 * The unlocking bytecode for a coin at one of a template's locking scripts, by the unlocking script a
 * template input names. Only scripts that need no key can be unlocked here: an application's own coins
 * carry no signature of the wallet (proposal section 12.1, rule 1).
 */
export const templateUnlockingBytecode = (template: XOTemplate, lockingScriptIdentifier: string, inputIdentifier: string | undefined, values: TemplateValues): Uint8Array => {
  const unlockingScript = inputIdentifier === undefined ? undefined : template.inputs?.[inputIdentifier]?.unlockingScript;
  if (inputIdentifier !== undefined && unlockingScript === undefined) return fail(`The template has no input "${inputIdentifier}".`);
  const { compiler, unlockId } = compilerFor(template, lockingScriptIdentifier, unlockingScript);
  if (unlockId === undefined) return fail(`The template does not say how a coin at "${lockingScriptIdentifier}" is unlocked.`);
  const result = compiler.generateBytecode({ scriptId: unlockId, data: { bytecode: bytecodeData(template, values) } });
  return result.success ? result.bytecode : fail(`A coin at "${lockingScriptIdentifier}" cannot be unlocked with the values given: ${describeErrors((result as { errors?: unknown }).errors)}`);
};

const CAPABILITIES = new Set(['none', 'mutable', 'minting']);

/** One of a template's outputs, for the given values. */
export const templateOutput = (template: XOTemplate, outputIdentifier: string, values: TemplateValues): Output => {
  const definition = template.outputs?.[outputIdentifier];
  if (definition === undefined) return fail(`The template has no output "${outputIdentifier}".`);
  const { lockingScript, valueSatoshis, token } = definition as { lockingScript?: string; valueSatoshis?: string | number | bigint; token?: { category?: string; amount?: string | number | bigint | null; nft?: { capability?: string; commitment?: string } | null } | null };
  if (lockingScript === undefined) return fail(`The output "${outputIdentifier}" names no locking script.`);
  const lockingBytecode = isExpression(lockingScript) ? hexToBin(evaluate(template, lockingScript, values, 'utf8')) : templateLockingBytecode(template, lockingScript, values);
  if (valueSatoshis === undefined) return fail(`The output "${outputIdentifier}" states no amount.`);
  const amountText = isExpression(valueSatoshis) ? evaluate(template, valueSatoshis, values, 'bigint') : String(valueSatoshis);
  if (!/^\d+$/.test(amountText)) return fail(`The amount of the output "${outputIdentifier}" is not a whole number of satoshis.`);
  const output: Output = { lockingBytecode, valueSatoshis: BigInt(amountText) };
  if (token === undefined || token === null) return output;
  if (token.category === undefined) return fail(`The token of the output "${outputIdentifier}" names no category.`);
  const category = isExpression(token.category) ? evaluate(template, token.category, values, 'utf8') : token.category;
  if (!/^[0-9a-f]{64}$/.test(category)) return fail(`The token category of the output "${outputIdentifier}" is not 32 bytes of hex.`);
  const amount = token.amount === undefined || token.amount === null ? '0' : isExpression(token.amount) ? evaluate(template, token.amount, values, 'bigint') : String(token.amount);
  if (!/^\d+$/.test(amount)) return fail(`The token amount of the output "${outputIdentifier}" is not a whole number.`);
  output.token = { category: hexToBin(category), amount: BigInt(amount) };
  if (token.nft !== undefined && token.nft !== null) {
    if (token.nft.capability === undefined) return fail(`The token of the output "${outputIdentifier}" states no capability.`);
    const capability = isExpression(token.nft.capability) ? evaluate(template, token.nft.capability, values, 'utf8') : token.nft.capability;
    if (!CAPABILITIES.has(capability)) return fail(`The token of the output "${outputIdentifier}" has a capability that is not known.`);
    const commitment = token.nft.commitment === undefined ? '' : isExpression(token.nft.commitment) ? evaluate(template, token.nft.commitment, values, 'utf8') : token.nft.commitment;
    if (!/^([0-9a-f]{2})*$/.test(commitment)) return fail(`The token commitment of the output "${outputIdentifier}" is not hex.`);
    output.token.nft = { capability: capability as 'none' | 'mutable' | 'minting', commitment: hexToBin(commitment) };
  }
  return output;
};

/** The transaction of one of a template's actions, as far as the template fixes it. */
export interface TemplateTransaction {
  version: number;
  locktime: number;
  /** The template's inputs in the order it lists them. */
  inputs: { input: string; index?: number }[];
  /** The template's outputs in the order it lists them. */
  outputs: { output: string; index?: number }[];
}

const wholeNumber = (template: XOTemplate, value: unknown, values: TemplateValues, what: string, maximum: number): number => {
  const text = typeof value === 'number' ? String(value) : isExpression(value) ? evaluate(template, value, values, 'bigint') : fail(`The template's ${what} is neither a number nor an expression.`);
  const number = Number(text);
  return Number.isInteger(number) && number >= 0 && number <= maximum ? number : fail(`The template's ${what} is out of range.`);
};

export const templateTransaction = (template: XOTemplate, actionIdentifier: string, values: TemplateValues): TemplateTransaction => {
  const action = template.actions?.[actionIdentifier];
  if (action === undefined) return fail(`The template has no action "${actionIdentifier}".`);
  const transaction = template.transactions?.[action.transaction ?? ''] as { version?: number; locktime?: number | string; inputs?: { input: string; inputIndex?: number }[]; outputs?: { output: string; outputIndex?: number }[] } | undefined;
  if (transaction === undefined) return fail(`The action "${actionIdentifier}" has no transaction.`);
  return {
    version: transaction.version ?? 2,
    locktime: transaction.locktime === undefined ? 0 : wholeNumber(template, transaction.locktime, values, 'lock time', 0xffffffff),
    inputs: (transaction.inputs ?? []).map(({ input, inputIndex }) => ({ input, ...(inputIndex === undefined ? {} : { index: inputIndex }) })),
    outputs: (transaction.outputs ?? []).map(({ output, outputIndex }) => ({ output, ...(outputIndex === undefined ? {} : { index: outputIndex }) })),
  };
};

/** The sequence number a template gives one of its inputs, or `undefined` when it states none. */
export const templateSequenceNumber = (template: XOTemplate, inputIdentifier: string, values: TemplateValues): number | undefined => {
  const input = template.inputs?.[inputIdentifier] as { sequenceNumber?: number | string } | undefined;
  if (input === undefined) return fail(`The template has no input "${inputIdentifier}".`);
  return input.sequenceNumber === undefined ? undefined : wholeNumber(template, input.sequenceNumber, values, `sequence number of "${inputIdentifier}"`, 0xffffffff);
};

/** A template's text with the values put in where it refers to them as `$(<name>)`: its own words about an action. */
export const templateWords = (template: XOTemplate, text: string | undefined, values: TemplateValues): string => {
  if (text === undefined) return '';
  return text.replace(/\$\(<([A-Za-z0-9_]+)>\)/g, (whole, name: string) => {
    const value = withConstants(template, values)[name];
    return value === undefined ? whole : String(value);
  });
};

/** The value a template variable takes from bytes found on chain, by the variable's type: a whole number from a script number, anything else as hex. */
export const valueFromBytes = (template: XOTemplate, name: string, bytes: Uint8Array): TemplateValue => {
  if (!NUMERIC_TYPES.has(variableType(template, name) ?? '')) return binToHex(bytes);
  const number = vmNumberToBigInt(bytes, { requireMinimalEncoding: true });
  return typeof number === 'bigint' ? number : fail(`The bytes for "${name}" are not a number as scripts write it.`);
};
