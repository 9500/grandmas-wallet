import type { ReadTemplate } from '@grandmas-wallet/core';

import { actionShape } from './action-shape.js';

/**
 * What an action leaves behind (proposal section 12.3), worked out from the template before the user is asked, for
 * a template that comes with nothing beside it. The wallet looks at the outputs of the action's transaction that sit
 * at a script of the template it would follow in its role, and reaches one of three findings:
 *
 * - **It comes back**: no such output sits at a script that takes a key of the device. An action that only empties
 *   or closes a position, or leaves nothing outside the wallet's own addresses, comes back.
 * - **It does not come back**: such an output sits at a script that takes a key of the device, a key the engine makes
 *   for the wallet under the application's template. A new seed has no such key.
 * - **The wallet cannot tell**: whether it would follow such an output's script is given by an expression, which the
 *   engine does not evaluate yet.
 *
 * What a program cannot see stays outside all three: a key hash that reaches a script as plain bytes, what an
 * application keeps on its servers, a position that someone else's transaction changes later.
 *
 * What a wallet does with each finding is its own choice (section 12.5). This wallet's is `THIS_WALLET_ANSWERS`, and
 * nowhere else. Nothing here knows any application.
 */

type Definition = ReadTemplate['definition'];

export type Finding = 'comes back' | 'does not come back' | 'cannot tell';

/** An output of an action at a script of the template that the wallet would, or might, follow in its role. */
export interface FollowedOutput {
  output: string;
  /** The template's names for the output and for its script. */
  name: string;
  lockingScript: string;
  scriptName: string;
  /** The keys of the device the script takes; none where it takes none. */
  keys: string[];
  /** Whether the template's rule for following the script is an expression the wallet cannot work out. */
  expression?: true;
}

export interface ActionFinding {
  action: string;
  role: string;
  /** The template's name for the action. */
  name: string;
  finding: Finding;
  /** The outputs the finding rests on: every output at a script the wallet would, or might, follow. */
  outputs: FollowedOutput[];
}

/** What a wallet does with a finding: carry the action out, or refuse it with the reason. */
export type FindingAnswer = 'carry out' | 'refuse';

/**
 * This wallet's answers (section 12.5; decisions 21 and 22): it refuses an action that would leave something that does
 * not come back, and treats "cannot tell" like "does not come back". Warning and going on, or a copy of the key with
 * the recoverer, are left to other wallets.
 */
export const THIS_WALLET_ANSWERS: Readonly<Record<Finding, FindingAnswer>> = {
  'comes back': 'carry out',
  'does not come back': 'refuse',
  'cannot tell': 'refuse',
};

/** Whether this wallet refuses an action with this finding. */
export const thisWalletRefuses = (finding: Pick<ActionFinding, 'finding'>): boolean => THIS_WALLET_ANSWERS[finding.finding] === 'refuse';

const isExpression = (value: unknown): value is string => typeof value === 'string' && /^\$\(.*\)$/s.test(value.trim());
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

interface LockingScriptEntry {
  name?: string;
  lockingBytecode?: string;
  unlockingBytecode?: string;
  relevant?: unknown;
  state?: { secrets?: string[] };
  roles?: Record<string, { relevant?: unknown; state?: { secrets?: string[] } }>;
}
const lockingScriptOf = (definition: Definition, identifier: string): LockingScriptEntry | undefined => definition.lockingScripts?.[identifier] as LockingScriptEntry | undefined;

/** The keys a template names: its variables of type `private_key`, and the secrets its scripts' roles keep. */
const keysOf = (definition: Definition): Set<string> => {
  const keys = new Set<string>();
  for (const [name, variable] of Object.entries(definition.variables ?? {})) if ((variable as { type?: string }).type === 'private_key') keys.add(name);
  for (const script of Object.values(definition.lockingScripts ?? {})) {
    const entry = script as LockingScriptEntry;
    for (const secret of entry.state?.secrets ?? []) keys.add(secret);
    for (const role of Object.values(entry.roles ?? {})) for (const secret of role.state?.secrets ?? []) keys.add(secret);
  }
  return keys;
};

/** The keys a script uses, by its text, following the scripts it refers to; a script given as an expression is read as it stands. */
const keysIn = (definition: Definition, script: string | undefined, keys: Set<string>, seen = new Set<string>()): Set<string> => {
  const found = new Set<string>();
  if (script === undefined || seen.has(script)) return found;
  seen.add(script);
  const text = isExpression(script) ? script : definition.scripts?.[script];
  if (text === undefined) return found;
  for (const word of text.match(WORD) ?? []) {
    if (keys.has(word)) found.add(word);
    else if (word !== script && definition.scripts?.[word] !== undefined) for (const key of keysIn(definition, word, keys, seen)) found.add(key);
  }
  return found;
};

/**
 * The keys of the device a locking script of the template takes for a role: those its locking or its own unlocking
 * script uses, and the secrets the role keeps there.
 */
export const scriptKeys = (definition: Definition, lockingScript: string, role: string): string[] => {
  const entry = lockingScriptOf(definition, lockingScript);
  if (entry === undefined) return [];
  const keys = keysOf(definition);
  const found = new Set([...keysIn(definition, entry.lockingBytecode, keys), ...keysIn(definition, entry.unlockingBytecode, keys)]);
  for (const secret of [...(entry.state?.secrets ?? []), ...(entry.roles?.[role]?.state?.secrets ?? [])]) found.add(secret);
  return [...found];
};

/**
 * Whether the wallet follows an output's script in its role, as XO's engine decides it: `false` on the output's role
 * or on the script's skips it, an omitted rule follows it, and a rule given as an expression is one the engine does
 * not evaluate yet.
 */
const followed = (definition: Definition, output: string, lockingScript: string, role: string): boolean | 'expression' => {
  const fromOutput = (definition.outputs?.[output] as { roles?: Record<string, { relevant?: unknown }> } | undefined)?.roles?.[role]?.relevant;
  if (typeof fromOutput === 'string') return 'expression';
  if (fromOutput === false) return false;
  const script = lockingScriptOf(definition, lockingScript);
  if (script?.relevant === false || script?.roles?.[role]?.relevant === false) return false;
  if (typeof script?.relevant === 'string' || typeof script?.roles?.[role]?.relevant === 'string') return 'expression';
  return true;
};

/**
 * The finding for one action of a template in a role (section 12.3), from the template alone: which outputs of its
 * transaction sit at a script of the template the wallet would follow, and whether one of them takes a key of the
 * device. An action the template does not have, or not for the role, is no finding: `undefined`.
 */
export const actionFinding = (definition: Definition, action: string, role: string): ActionFinding | undefined => {
  const shape = actionShape(definition, action, role);
  if (typeof shape === 'string') return undefined;
  const outputs: FollowedOutput[] = [];
  for (const { output } of shape.outputs) {
    const described = definition.outputs?.[output] as { name?: string; lockingScript?: string } | undefined;
    const lockingScript = described?.lockingScript;
    // An output whose script is a value (an address of the wallet's, or one a request supplies) is at no script of the template.
    if (lockingScript === undefined || isExpression(lockingScript) || lockingScriptOf(definition, lockingScript) === undefined) continue;
    const follows = followed(definition, output, lockingScript, role);
    if (follows === false) continue;
    outputs.push({
      output,
      name: described?.name ?? output,
      lockingScript,
      scriptName: lockingScriptOf(definition, lockingScript)?.name ?? lockingScript,
      keys: scriptKeys(definition, lockingScript, role),
      ...(follows === 'expression' ? { expression: true as const } : {}),
    });
  }
  const finding: Finding = outputs.some(({ keys, expression }) => keys.length > 0 && expression !== true) ? 'does not come back' : outputs.some(({ expression }) => expression === true) ? 'cannot tell' : 'comes back';
  return { action, role, name: definition.actions?.[action]?.name ?? action, finding, outputs };
};

/** The finding for every action of a template, in each of its roles, as the wallet names them when the template is shown (section 14.3). */
export const templateFindings = (definition: Definition): ActionFinding[] =>
  Object.entries(definition.actions ?? {}).flatMap(([action, described]) =>
    Object.keys((described as { roles?: Record<string, unknown> }).roles ?? {}).flatMap((role) => {
      const found = actionFinding(definition, action, role);
      return found === undefined ? [] : [found];
    }),
  );

/** Why this wallet refuses an action with a finding, in full: what it found, and on which output. */
export const findingReason = (finding: ActionFinding): string => {
  if (finding.finding === 'does not come back') {
    const tied = finding.outputs.filter(({ keys, expression }) => keys.length > 0 && expression !== true);
    const where = tied.map(({ name, scriptName, keys }) => `"${name}" would be at "${scriptName}", a script that takes a key of this device (${keys.map((key) => `"${key}"`).join(', ')})`).join('; ');
    return `This would tie money to this phone alone: ${where}. A new phone has no such key. If the phone is lost, nobody can get it back. This wallet does not carry it out.`;
  }
  if (finding.finding === 'cannot tell') {
    const unclear = finding.outputs.filter(({ expression }) => expression === true);
    const where = unclear.map(({ name, scriptName }) => `"${name}" at "${scriptName}"`).join(', ');
    return `This wallet cannot tell whether this would come back if the phone is lost: the template decides by an expression whether the wallet follows ${where}, and the wallet cannot work that out. This wallet does not carry it out.`;
  }
  return 'It comes back.';
};
