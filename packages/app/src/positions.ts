import { type PositionKind, templateOutputKind } from '@grandmas-wallet/archive';

import type { XoAccount } from './account.js';

/**
 * The kinds of position these applications can rebuild when restoring: outputs of XO templates, with the
 * account's engine working out each script from the template kept in the archive. The template is taken in
 * by the engine for that purpose only; trusting it for new actions is a separate decision.
 */
export const positionKinds = (account: XoAccount): PositionKind[] => [
  templateOutputKind(async (template, origin, variables) => {
    const templateIdentifier = await account.importTemplate(template);
    return account.resolveOutput({ templateIdentifier, action: origin.action, role: origin.role, variables }, origin.output);
  }),
];
