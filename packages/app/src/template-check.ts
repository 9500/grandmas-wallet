import { type ReadTemplate, type TemplateValues, TemplateError, readTemplate, templateKeys, templateLockingBytecode, textHash, variableType } from '@grandmas-wallet/core';
import type { XOTemplate } from '@xo-cash/types';

import { type ReadDeclaration, type RecoveryDeclaration, type ValueSource, declarationIsFor, isCompanionPosition, readDeclaration } from './declaration.js';

/**
 * What the wallet can say about a template an application brings (proposal sections 12.2 and 14.3): it is
 * the template the request names; and one of three statements about the three rules.
 *
 * - **A violation found**: the template breaks a rule, which is named with what that means for recovery.
 * - **Not verified**: nothing was found against it, and something remains that the wallet cannot check.
 *   This is the ordinary state of a template the wallet meets for the first time.
 * - **Verified**: every check the wallet can run has passed, the last of them on chain: a token made with
 *   the template led to its position as the declaration says. It does not mean that the contract was audited.
 *
 * Whether a contract gives authority to the token and to nothing else takes reading the contract and
 * testing it. No statement here covers that.
 */

export interface Violation {
  rule: 1 | 2 | 3;
  /** What the template does. */
  what: string;
  /** What that means for recovery. */
  consequence: string;
}

export type Verdict =
  | { statement: 'verified'; basis: string }
  | { statement: 'violation'; violations: Violation[] }
  | { statement: 'not verified'; reasons: string[] };

/** A template as an application presents it: the texts, each of which the request names by its hash. */
export interface PresentedTexts {
  template: string;
  declaration?: string;
  /** Other files the declaration refers to. */
  references?: string[];
}

/** How a request names what it presents. */
export interface TemplateNames {
  identifier: string;
  contentHash: string;
  /** The content hash of the recovery declaration. */
  declaration?: string;
}

export interface Presented {
  template: ReadTemplate;
  declaration?: ReadDeclaration;
  references: { contentHash: string; text: string }[];
}

/** What was presented is not what the request names, or cannot be used. The request is refused. */
export class PresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresentationError';
  }
}

/**
 * Read what an application presents, and check that it is what the request names: the template by
 * identifier and content hash, the declaration by content hash and by the template it names, and every file
 * the declaration refers to by content hash. A later download does not replace any of them.
 *
 * @throws PresentationError, or UnknownProfileError for a declaration of a profile this wallet does not know
 */
export const readPresented = (names: TemplateNames, texts: PresentedTexts): Presented => {
  let template: ReadTemplate;
  try {
    template = readTemplate(texts.template);
  } catch (error) {
    throw new PresentationError((error as Error).message);
  }
  if (template.identifier !== names.identifier || template.contentHash !== names.contentHash) {
    throw new PresentationError('The template sent with the request is not the one the request names.');
  }
  // The engine reads a stored value of this type back as text when it unlocks a coin later (section 13.1).
  const unreadable = Object.entries(template.definition.variables ?? {}).find(([, variable]) => (variable as { type?: string }).type === 'timestamp');
  if (unreadable !== undefined) {
    throw new PresentationError(`The template uses a kind of value ("timestamp", for "${unreadable[0]}") that this wallet's engine cannot read back when it unlocks a coin. What is put under it might not come out again.`);
  }
  if ((names.declaration === undefined) !== (texts.declaration === undefined)) {
    throw new PresentationError(names.declaration === undefined ? 'A recovery declaration was sent that the request does not name.' : 'The request names a recovery declaration that was not sent.');
  }
  if (texts.declaration === undefined) {
    if ((texts.references ?? []).length > 0) throw new PresentationError('Files were sent that nothing the request names refers to.');
    return { template, references: [] };
  }
  if (textHash(texts.declaration) !== names.declaration) throw new PresentationError('The recovery declaration sent with the request is not the one the request names.');
  const declaration = readDeclaration(texts.declaration);
  if (!declarationIsFor(declaration.declaration, template)) throw new PresentationError('The recovery declaration is for another template than the one the request names.');
  const references = (texts.references ?? []).map((text) => ({ contentHash: textHash(text), text }));
  const wanted = new Set(declaration.declaration.references ?? []);
  for (const { contentHash } of references) if (!wanted.has(contentHash)) throw new PresentationError('A file was sent that is not one the recovery declaration refers to.');
  for (const contentHash of wanted) if (!references.some((reference) => reference.contentHash === contentHash)) throw new PresentationError('A file the recovery declaration refers to was not sent.');
  return { template, declaration, references };
};

const placeholder = (template: XOTemplate, variable: string): string | bigint => {
  switch (variableType(template, variable)) {
    case 'integer':
    case 'bigint':
    case 'satoshis':
    case 'token_amount':
      return 0n;
    case 'token_category':
      return '00'.repeat(32);
    default:
      return '00';
  }
};

/** The variable that gives an output its locking script, when the template leaves the script to a variable. */
const scriptVariable = (template: XOTemplate, outputIdentifier: string): string | undefined => {
  const script = template.outputs?.[outputIdentifier]?.lockingScript;
  const direct = /^\$\(<([A-Za-z0-9_]+)>\)$/.exec(script ?? '')?.[1];
  if (direct !== undefined) return direct;
  const viaScript = template.scripts?.[template.lockingScripts?.[script ?? '']?.lockingBytecode ?? ''];
  return /^\$\(<([A-Za-z0-9_]+)>\)$/.exec(viaScript ?? '')?.[1];
};

/** Whether a script can be made from values of the given sources alone. */
const derivable = (template: XOTemplate, lockingScript: string, variables: Record<string, ValueSource>): string | true => {
  if (template.lockingScripts?.[lockingScript] === undefined) return `the template has no locking script "${lockingScript}"`;
  const values: TemplateValues = {};
  for (const variable of Object.keys(variables)) values[variable] = placeholder(template, variable);
  try {
    templateLockingBytecode(template, lockingScript, values);
    return true;
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return error.message;
  }
};

const violationsOf = (template: XOTemplate, declaration: RecoveryDeclaration): Violation[] => {
  const violations: Violation[] = [];
  const lost = 'After a recovery the wallet could not find or operate what the token controls.';
  for (const [name, entry] of Object.entries(declaration.authority)) {
    // Rule 2: the token goes where the wallet says.
    if (template.outputs?.[entry.token] === undefined) {
      violations.push({ rule: 3, what: `The declaration says the token "${name}" is made by the output "${entry.token}", which the template does not have.`, consequence: lost });
      continue;
    }
    const holder = scriptVariable(template, entry.token);
    const wallets = Object.values(declaration.actions).some((action) => holder !== undefined && action.outputs?.[holder] !== undefined);
    if (holder === undefined || !wallets) {
      violations.push({
        rule: 2,
        what: `The token "${name}", which carries authority, goes to an address the template fixes and not to one the wallet names.`,
        consequence: 'The wallet could not hold the token at an address of its own, so a recovery could not move it to the new owner.',
      });
    }
    // Rule 3: the token leads to the position.
    const place = entry.position;
    const checks = isCompanionPosition(place)
      ? [derivable(template, place.companion.lockingScript, place.companion.variables ?? {}), derivable(template, place.genuine.lockingScript, place.genuine.variables)]
      : [derivable(template, place.lockingScript, place.variables)];
    if (!isCompanionPosition(place) && Object.values(place.variables).some((source) => !source.startsWith('token.') || source === 'token.inputIndex')) {
      checks.push('a position at an address of its own must follow from the token alone');
    }
    for (const check of checks) {
      if (check !== true) violations.push({ rule: 3, what: `The position of the token "${name}" cannot be worked out from the token and the chain: ${check}.`, consequence: lost });
    }
    for (const action of entry.actions) {
      if (template.actions?.[action] === undefined) violations.push({ rule: 3, what: `The declaration offers the action "${action}" to the holder of "${name}", which the template does not have.`, consequence: lost });
    }
  }
  for (const [name, action] of Object.entries(declaration.actions)) {
    if (template.actions?.[name] === undefined) {
      violations.push({ rule: 3, what: `The declaration describes an action "${name}" that the template does not have.`, consequence: lost });
      continue;
    }
    if (action.spends !== undefined && declaration.authority[action.spends] === undefined) {
      violations.push({ rule: 3, what: `The action "${name}" spends a token "${action.spends}" that the declaration does not describe.`, consequence: lost });
    }
    if (action.position !== undefined && template.inputs?.[action.position] === undefined) {
      violations.push({ rule: 3, what: `The action "${name}" spends its position as the input "${action.position}", which the template does not have.`, consequence: lost });
    }
    for (const variable of Object.keys(action.outputs ?? {})) {
      if (variableType(template, variable) !== 'locking_script') {
        violations.push({ rule: 2, what: `The action "${name}" leaves "${variable}" to the wallet, but the template does not use it as a locking script.`, consequence: 'The wallet could not put its own address there.' });
      }
    }
  }
  return violations;
};

/**
 * The statement about a template.
 *
 * @param evidence.positionFound - a token made with the template has led to its position on chain as the declaration says
 */
export const checkTemplate = (template: ReadTemplate, declaration: ReadDeclaration | undefined, evidence: { positionFound?: boolean } = {}): Verdict => {
  const violations: Violation[] = [];
  // Rule 1: authority is a token. A key of the user's in an application's script cannot be replaced.
  const keys = templateKeys(template.definition);
  if (keys.length > 0) {
    violations.push({
      rule: 1,
      what: `The template's scripts take a key of the user's (${keys.map((key) => `"${key}"`).join(', ')}).`,
      consequence: 'A key cannot be replaced. After a recovery the new owner could not act on what was made with it, and the earlier seed still could.',
    });
  }
  if (declaration !== undefined) violations.push(...violationsOf(template.definition, declaration.declaration));
  if (violations.length > 0) return { statement: 'violation', violations };
  if (declaration === undefined) {
    return { statement: 'not verified', reasons: ['The template comes without a recovery declaration, so this wallet cannot tell how a token of it would lead to what the token controls.'] };
  }
  if (evidence.positionFound !== true) {
    return {
      statement: 'not verified',
      reasons: [
        'Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain.',
        'Whether its contracts give authority to the token and to nothing else, a wallet cannot check.',
      ],
    };
  }
  return { statement: 'verified', basis: 'The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.' };
};
