// The XO invitation behind every transaction an account sends in a scripted run, written to a file of its own.
//
// Each file holds one invitation exactly as the engine serializes it for sharing (`serializeInvitation`), so it
// can be given to XO's tools as it is. `index.json` beside them says which transaction, template, action and
// role each file belongs to. A run on chipnet writes under docs/runs/invitations/, which is kept in git; a run
// on the local node writes under .chipnet/invitations/, which is not.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SentInvitation } from '../packages/app/src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

export interface InvitationFile {
  file: string;
  transactionId: string;
  /** Whose account sent it, in the run's own words. */
  account: string;
  templateName: string;
  templateIdentifier: string;
  action: string;
  role: string;
}

/** Where a run's invitations go. */
export const invitationDirectory = (run: string, local: boolean): string => `${root}${local ? '.chipnet/invitations' : 'docs/runs/invitations'}/${run}/`;

/** Empty the directory, at the start of a new run. */
export const clearInvitationFiles = (directory: string): void => rmSync(directory, { recursive: true, force: true });

export const invitationFiles = (directory: string): InvitationFile[] => (existsSync(`${directory}index.json`) ? (JSON.parse(readFileSync(`${directory}index.json`, 'utf8')) as InvitationFile[]) : []);

/** The listener to give `Account.open`: writes each sent invitation, numbered in the order sent. */
export const writeInvitationFiles =
  (directory: string, account: string) =>
  (sent: SentInvitation): void => {
    mkdirSync(directory, { recursive: true });
    const index = invitationFiles(directory);
    if (index.some((entry) => entry.transactionId === sent.transactionId)) return;
    const number = String(readdirSync(directory).filter((name) => /^\d+-.*\.json$/.test(name)).length + 1).padStart(2, '0');
    const file = `${number}-${account.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${sent.action}-${sent.transactionId.slice(0, 8)}.json`;
    writeFileSync(`${directory}${file}`, `${sent.text}\n`);
    index.push({ file, transactionId: sent.transactionId, account, templateName: sent.templateName, templateIdentifier: sent.templateIdentifier, action: sent.action, role: sent.role });
    writeFileSync(`${directory}index.json`, `${JSON.stringify(index, null, 2)}\n`);
  };
