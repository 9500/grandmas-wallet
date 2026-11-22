import { binToHex } from '@bitauth/libauth';
import type { ServiceErrorCode, ServiceFetch, ServiceItem, ServiceNetworkKind, ServiceStart } from '@grandmas-wallet/connect';
import { type ReadTemplate, TemplateError, templateLockingBytecode, variableType } from '@grandmas-wallet/core';

import { type ActionShape, TYPEABLE, applicationInputs, offeredAt } from './action-shape.js';
import type { ServiceFailureKind } from './service-client.js';

/**
 * An application's service, as the wallet's handling of applications (`Applications`) uses it: what the wallet keeps
 * on this device about a trusted template's service, what it shows the screens, and the rules it reads from a template
 * alone: whether an action needs another participant, which role is the wallet's, and which of the service's items a
 * template allows. Nothing here knows any template or application, and nothing here speaks to a service.
 */

type Definition = ReadTemplate['definition'];

/**
 * What the wallet keeps on this device about the service of a template the user trusts (docs/xo-service.md). It is a
 * note of what a server last said, which the wallet can ask again: it is not in the backup, and a template trusted
 * again from the backup starts without it (the screens offer Connect).
 */
export interface KeptService {
  identifier: string;
  contentHash: string;
  /** The resource the template names for the wallet's network, when it was last used. */
  url: string;
  description: string;
  /** The role the wallet takes in the template, as it introduced itself. */
  walletRole: string;
  /** The role the service takes, as its hello answer named it. */
  role?: string;
  /** Unix seconds: the last usable answer of the service. */
  reachedAt?: number;
  /** The last exchange gave no usable answer: when, and why in the client's plain words. Cleared by the next answer. */
  failure?: { at: number; kind: ServiceFailureKind; message: string; code?: ServiceErrorCode };
  /** The last answer to what is possible, and when it came (unix seconds). */
  possible?: { at: number; height: number; start: ServiceStart[]; items: ServiceItem[] };
}

/**
 * A token category the wallet created with one of a template's actions. A service needs it to say what is possible for a
 * token that is not in the wallet yet, such as a key that waits in an application's contract. Kept on this device until
 * the wallet holds a token of the category, which it then names among its tokens.
 */
export interface MadeCategory {
  templateIdentifier: string;
  category: string;
  transactionId: string;
  /** Unix seconds. */
  madeAt: number;
}

/** Where the wallet speaks to services, if it does. Without it, no service is ever contacted. */
export interface ServiceOptions {
  /** The network the wallet is on, as `xo_service_v1` names it: `mainnet`, `chipnet`, `regtest`, … */
  network: string;
  /** `local`: a chain of one's own, where an `http:` address is allowed. */
  kind: ServiceNetworkKind;
  /** The fetch to use; the global one unless given. */
  fetch?: ServiceFetch;
}

/** A template's service, as the screens show it. */
export interface ServiceStatus {
  /** The resource's description, in the template's words. */
  description: string;
  url?: string;
  /**
   * - `not usable`: the template names a service this wallet cannot use here; `problem` says why.
   * - `never asked`: the wallet has not spoken to it on this device (a trust restored from the backup); the screens offer Connect.
   * - `reached`: its last answer was usable.
   * - `not reached`: its last exchange failed; `failure` says why in plain words.
   */
  state: 'not usable' | 'never asked' | 'reached' | 'not reached';
  problem?: string;
  /** The role the wallet takes, and the role the service takes, with the template's names for them. */
  walletRole?: { role: string; name: string };
  role?: { role: string; name: string };
  /** Unix seconds: the last usable answer. */
  reachedAt?: number;
  /** Unix seconds: the time of the answer the offered actions come from ("Checked with its service <time>"). */
  checkedAt?: number;
  failure?: KeptService['failure'];
}

/** What a service says about an action the wallet offers (`TokenAction.service`). */
export interface ServiceOffer {
  /**
   * The service's word on a starting action: `false` with its reason when it says it cannot be done now; absent when it
   * was never asked, so the action is offered and checked when the user acts.
   */
  available?: boolean;
  /** The service's own words, shown as "The service declined: …". */
  reason?: string;
  /** Unix seconds: the answer this comes from. */
  checkedAt?: number;
  /** Values the service states beside the action, by the template's names and types: shown as "From the service", never trusted. */
  says?: SaidValue[];
}

/** A value a service said, by the template's name for its variable and the template's type for it (`satoshis`, `integer`, …) where it gives one. */
export interface SaidValue {
  variable: string;
  name: string;
  value: string;
  type?: string;
}

/** The part of an action's review that the service gave: shown apart from the wallet's own figures. */
export interface ServicePart {
  /** The template's role for the service, and its name. */
  role: string;
  roleName: string;
  /** Where the wallet spoke to it. */
  url: string;
  /**
   * The values the service stated, by the template's names and types. The wallet checked them only through the
   * application's contracts, which it ran against the transaction before anything was signed.
   */
  values: (SaidValue & { description: string })[];
  /** What the service said beside them: for display, never trusted. */
  says: SaidValue[];
}

/** The roles of an action that need a participant other than the wallet's role: each named with at least one slot. */
export const otherParticipants = (definition: Definition, action: string, role: string): string[] => {
  const participants = (definition.actions?.[action] as { requirements?: { participants?: { role?: string; slots?: { min?: number } }[] } } | undefined)?.requirements?.participants ?? [];
  return [...new Set(participants.filter((entry) => entry.role !== undefined && entry.role !== role && (entry.slots?.min ?? 0) >= 1).map((entry) => entry.role as string))];
};

/** The roles a template gives the wallet's side: those of its starting actions, or failing those, of its follow-up actions. */
export const walletRoleOf = (definition: Definition): string | undefined => {
  const starting = new Set((definition.start ?? []).map((entry) => (entry as { role?: string }).role).filter((role): role is string => role !== undefined));
  const following = new Set(
    Object.values(definition.lockingScripts ?? {}).flatMap((script) =>
      Object.entries((script as { roles?: Record<string, { actions?: unknown[] }> }).roles ?? {}).flatMap(([role, entry]) => ((entry.actions ?? []).length > 0 ? [role] : [])),
    ),
  );
  const roles = starting.size > 0 ? starting : following;
  return roles.size === 1 ? [...roles][0] : undefined;
};

/** The template's starting actions for a role, in its order. */
export const startingActionsOf = (definition: Definition, role: string): string[] => [
  ...new Set((definition.start ?? []).flatMap((entry) => ((entry as { role?: string }).role === role ? [(entry as { action: string }).action] : []))),
];

/** The template's locking scripts that offer an action to a role as a follow-up. */
export const scriptsOffering = (definition: Definition, action: string, role: string): string[] => Object.keys(definition.lockingScripts ?? {}).filter((script) => offeredAt(definition, script, role).includes(action));

/** Which of the template's locking scripts a bytecode is, where the script needs no value to be made. */
export const scriptOfBytecode = (definition: Definition, bytecode: string): string | undefined =>
  Object.keys(definition.lockingScripts ?? {}).find((script) => {
    try {
      return binToHex(templateLockingBytecode(definition, script, {})) === bytecode;
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return false;
    }
  });

/**
 * Whether the wallet takes an item of a service's answer: a service cannot invent an action. The action has to be one the
 * template gives the wallet's role, and one a locking script of the template offers that role as a follow-up; a script
 * the item names, where the wallet can tell which it is, has to be one of those; the item has to be about a category
 * the wallet holds a token of or made; and a position it names has to be that category.
 * @returns the template's name for where the action stands, or why the item is dropped
 */
export const checkServiceItem = (definition: Definition, walletRole: string, item: ServiceItem, categories: Set<string>): { ok: true; place: string } | { ok: false; reason: string } => {
  if (definition.actions?.[item.action]?.roles?.[walletRole] === undefined) return { ok: false, reason: `The template gives the wallet no action "${item.action}".` };
  const offering = scriptsOffering(definition, item.action, walletRole);
  if (offering.length === 0) return { ok: false, reason: `The template does not offer "${item.action}" under a token.` };
  const named = item.lockingScript === undefined ? undefined : scriptOfBytecode(definition, item.lockingScript);
  if (named !== undefined && !offering.includes(named)) return { ok: false, reason: `The template's script the service names does not offer "${item.action}".` };
  if (!categories.has(item.category)) return { ok: false, reason: 'The item is about a token the wallet neither holds nor made with this template.' };
  if (item.about !== undefined && item.about.category !== item.category) return { ok: false, reason: 'The item names a position of another token than its own.' };
  const script = named ?? (offering[0] as string);
  return { ok: true, place: definition.lockingScripts?.[script]?.name ?? script };
};

/**
 * What a person is asked for in an action the wallet carries out by itself: each value of the wallet's role that the
 * wallet does not fill by its own rules and a person can type. `missing`: those nobody here can give.
 * @param filled - whether a value is filled otherwise (a record's, a request's)
 */
export const askedValues = (definition: Definition, shape: ActionShape, filled: (variable: string) => boolean = () => false): { asks: string[]; missing: string[] } => {
  const asks: string[] = [];
  const missing: string[] = [];
  for (const variable of shape.required) {
    const type = variableType(definition, variable) ?? '';
    if (filled(variable) || shape.creating.includes(variable) || type === 'locking_script' || variable === shape.tokenInput?.variable) continue;
    if (TYPEABLE.has(type)) asks.push(variable);
    else missing.push(variable);
  }
  return { asks, missing };
};

/** The template inputs of an action that are not the wallet's token: its application's coins. */
export const othersCoins = (definition: Definition, shape: ActionShape): string[] => applicationInputs(definition, shape).map(({ input }) => input);

/**
 * Where the coins of the wallet's first commit stand in the transaction, by the rule the wallet places every item when
 * it works an action out: the template's places first; the coin that defines a new token category at input 0; the
 * template's other inputs, one coin each, in the template's order at the lowest places left (the wallet's token among
 * them where the template gives it an input of its own); then the wallet's token.
 */
export const firstCommitPlaces = (shape: ActionShape, options: { defining: boolean; token: boolean }): { defining?: number; token?: number } => {
  const slots: string[] = [];
  const tokenInput = shape.tokenInput?.input;
  for (const { input, inputIndex } of shape.inputs) {
    if (inputIndex === undefined || (input === tokenInput && !options.token)) continue;
    slots[inputIndex] = input;
  }
  const takeFree = (item: string): number => {
    const free = slots.findIndex((slot) => slot === undefined);
    const at = free >= 0 ? free : slots.length;
    slots[at] = item;
    return at;
  };
  let defining: number | undefined;
  if (options.defining && slots[0] === undefined) {
    slots[0] = '';
    defining = 0;
  }
  for (const { input, inputIndex } of shape.inputs) if (inputIndex === undefined && (input !== tokenInput || options.token)) takeFree(input);
  let token: number | undefined;
  if (options.token) token = tokenInput === undefined ? takeFree('\u0000token') : slots.indexOf(tokenInput);
  return { ...(defining === undefined ? {} : { defining }), ...(token === undefined ? {} : { token }) };
};

/** A value a service said, by the template's name and type for its variable, so that a screen can show it as the template's other values. */
export const saidValue = (definition: Definition, variable: string, value: unknown): SaidValue => {
  const type = definition.variables?.[variable]?.type;
  return { variable, name: definition.variables?.[variable]?.name ?? variable, value: String(value), ...(typeof type === 'string' ? { type } : {}) };
};

/** The words for a value a service stated, by the template's names and type. */
export const statedValue = (definition: Definition, variable: string, value: unknown): SaidValue & { description: string } => ({
  ...saidValue(definition, variable, value),
  description: definition.variables?.[variable]?.description ?? '',
});
