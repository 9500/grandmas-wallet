import type { ReadTemplate } from '@grandmas-wallet/core';
import { variableType } from '@grandmas-wallet/core';

/**
 * What a template says about one of its actions, read for a template that comes with nothing beside it
 * (proposal section 13.3): which variables the wallet's role provides, which of them the action makes a new token
 * category in, whether the template gives the token the action spends an input of its own, and which of the
 * transaction's inputs spend a coin at a given script. Nothing here knows any application, and nothing here
 * reads a recovery declaration.
 */

type Definition = ReadTemplate['definition'];

export interface ShapeInput {
  input: string;
  inputIndex?: number;
}

export interface ShapeOutput {
  output: string;
  outputIndex?: number;
}

/** An action of a template, as far as the wallet's role in it is concerned. */
export interface ActionShape {
  action: string;
  role: string;
  /** The template's inputs and outputs of the action's transaction, in the template's order. */
  inputs: ShapeInput[];
  outputs: ShapeOutput[];
  /** The variables the role has to provide, in the template's order. */
  required: string[];
  /**
   * The template input that is the token the action spends: an input that names a token whose category is an
   * expression and that has no unlocking script. `variable` is the variable the category is, where the
   * expression is that one variable.
   */
  tokenInput?: { input: string; index?: number; variable?: string };
  /**
   * The variables the action makes a new token category in: an output of the transaction names the variable as
   * its token's category, and no input of it does.
   */
  creating: string[];
}

/** The one variable an expression such as `$(<keyCategory>)` stands for, or `undefined` where it is anything else. */
export const expressionVariable = (expression: unknown): string | undefined =>
  typeof expression === 'string' ? /^\$\(\s*<([A-Za-z_][A-Za-z0-9_]*)>\s*\)$/.exec(expression)?.[1] : undefined;

/** Whether a field of the template is an expression, `$( … )`. */
const isExpression = (value: unknown): value is string => typeof value === 'string' && /^\$\(.*\)$/s.test(value.trim());

type TokenField = { category?: unknown; nft?: { capability?: unknown; commitment?: unknown } | null } | null | undefined;
const tokenOf = (item: unknown): TokenField => (item as { token?: TokenField } | undefined)?.token;

/**
 * The shape of an action for a role.
 * @returns a reason in plain words where the template does not have it
 */
export const actionShape = (definition: Definition, action: string, role: string): ActionShape | string => {
  const described = definition.actions?.[action];
  if (described === undefined) return `The template "${definition.name ?? ''}" has no action "${action}".`;
  if (described.roles?.[role] === undefined) return `The action "${described.name ?? action}" has no role "${role}".`;
  const transaction = definition.transactions?.[described.transaction ?? ''] as { inputs?: ShapeInput[]; outputs?: ShapeOutput[] } | undefined;
  if (transaction === undefined) return `The action "${described.name ?? action}" has no transaction.`;
  const inputs = transaction.inputs ?? [];
  const outputs = transaction.outputs ?? [];
  const tokenInputs = inputs.filter(({ input }) => {
    const item = definition.inputs?.[input] as { unlockingScript?: unknown } | undefined;
    return item !== undefined && item.unlockingScript === undefined && isExpression(tokenOf(item)?.category);
  });
  if (tokenInputs.length > 1) return `The action "${described.name ?? action}" names ${tokenInputs.length} tokens of the wallet's as inputs of their own; this wallet spends one token in an action.`;
  const [named] = tokenInputs;
  const tokenInput =
    named === undefined
      ? undefined
      : (() => {
          const variable = expressionVariable(tokenOf(definition.inputs?.[named.input])?.category);
          return { input: named.input, ...(named.inputIndex === undefined ? {} : { index: named.inputIndex }), ...(variable === undefined ? {} : { variable }) };
        })();
  const required = (described.roles?.[role]?.requirements?.variables ?? []) as string[];
  const namedBy = (items: unknown[], variable: string): boolean => items.some((item) => expressionVariable(tokenOf(item)?.category) === variable);
  const inputItems = inputs.map(({ input }) => definition.inputs?.[input]);
  const outputItems = outputs.map(({ output }) => definition.outputs?.[output]);
  const creating = required.filter((variable) => variableType(definition, variable) === 'token_category' && namedBy(outputItems, variable) && !namedBy(inputItems, variable));
  return { action, role, inputs, outputs, required, ...(tokenInput === undefined ? {} : { tokenInput }), creating };
};

/**
 * The inputs of an action that spend a coin at one of the template's locking scripts: those whose unlocking
 * script is the one the locking script names as its own. A locking script that names none has no input the
 * wallet can tell is its; a coin there is spent only where a request names it.
 */
export const spendingInputs = (definition: Definition, shape: Pick<ActionShape, 'inputs'>, lockingScript: string): string[] => {
  const unlocking = (definition.lockingScripts?.[lockingScript] as { unlockingBytecode?: string } | undefined)?.unlockingBytecode;
  if (unlocking === undefined) return [];
  return shape.inputs.filter(({ input }) => (definition.inputs?.[input] as { unlockingScript?: string } | undefined)?.unlockingScript === unlocking).map(({ input }) => input);
};

/** Whether an output of the action is at one of the template's locking scripts. */
export const paysTo = (definition: Definition, shape: Pick<ActionShape, 'outputs'>, lockingScript: string): boolean =>
  shape.outputs.some(({ output }) => definition.outputs?.[output]?.lockingScript === lockingScript);

/** The template's inputs of an action that are coins of the application's: each has an unlocking script, and none is the wallet's token. */
export const applicationInputs = (definition: Definition, shape: Pick<ActionShape, 'inputs' | 'tokenInput'>): ShapeInput[] =>
  shape.inputs.filter(({ input }) => input !== shape.tokenInput?.input);

/** Types of values a person can type when the wallet acts by itself: amounts, numbers, a date, a text. */
export const TYPEABLE = new Set(['satoshis', 'token_amount', 'integer', 'bigint', 'timestamp', 'string']);

/** The actions a locking script offers its role, as the template lists them. */
export const offeredAt = (definition: Definition, lockingScript: string, role: string): string[] =>
  ((definition.lockingScripts?.[lockingScript] as { roles?: Record<string, { actions?: { action: string }[] }> } | undefined)?.roles?.[role]?.actions ?? []).map(({ action }) => action);
