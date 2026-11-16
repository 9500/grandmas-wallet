import type { JsonValue } from './canonical.js';
import type { PositionDescription } from './records.js';

/**
 * The kinds of position a wallet knows how to rebuild.
 *
 * A record is a hint, not an authority: for a known kind the script is
 * rebuilt from what the record says and must equal the recorded script. A
 * record that fails this cannot make the wallet look anywhere it would not
 * have looked by its own rules.
 *
 * The wallet has no kinds of its own for particular applications. The one
 * kind it uses is an output of an XO template, which covers any application
 * whose template is kept in the archive.
 */

export interface PositionKind {
  kind: string;
  /** Versions of the owner-approval interface this kind is known to work with. */
  interfaceVersions: number[];
  /** Requirements this wallet can meet for the kind. */
  provides: string[];
  /**
   * The script for these parameters under this wallet identity, as hex.
   * @param context - the whole description, and the position's template when the archive or the wallet has it
   * @throws if the description is not valid for the kind
   */
  lockingBytecode(identity: Uint8Array, parameters: PositionDescription['parameters'], context: { position: PositionDescription; template?: JsonValue }): string | Promise<string>;
}

export const TEMPLATE_OUTPUT_KIND = 'xo-template-output';

/** Works out the script of a template's output for an action's variables. An XO engine does this. */
export type TemplateOutputResolver = (template: JsonValue, origin: NonNullable<PositionDescription['origin']>, variables: PositionDescription['parameters']) => Promise<string>;

/**
 * Positions that are an output of an XO template: the record names the template, the action that made
 * the output and the action's variables, and the script is whatever the template gives for them.
 */
export const templateOutputKind = (resolve: TemplateOutputResolver, interfaceVersions: number[] = [2]): PositionKind => ({
  kind: TEMPLATE_OUTPUT_KIND,
  interfaceVersions,
  provides: [],
  lockingBytecode: async (_identity, parameters, { position, template }) => {
    if (position.origin === undefined) throw new Error('The record does not say which action of the template made the position.');
    if (template === undefined) throw new Error('The position\'s template is not available.');
    return resolve(template, position.origin, parameters);
  },
});

/** Describe an output of a template for the archive. */
export const describeTemplateOutput = (options: {
  positionId: string;
  template: NonNullable<PositionDescription['template']>;
  origin: NonNullable<PositionDescription['origin']>;
  variables: PositionDescription['parameters'];
  lockingBytecode: string;
  interfaceVersion?: number;
  label?: string;
}): PositionDescription => ({
  positionId: options.positionId,
  kind: TEMPLATE_OUTPUT_KIND,
  interfaceVersion: options.interfaceVersion ?? 2,
  parameters: options.variables,
  lockingBytecode: options.lockingBytecode,
  template: options.template,
  origin: options.origin,
  requires: [],
  ...(options.label === undefined ? {} : { label: options.label }),
});
