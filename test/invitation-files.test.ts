import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { invitationFiles, writeInvitationFiles } from '../scripts/invitation-files.js';

const sent = (transactionId: string, action: string) => ({ transactionId, invitationIdentifier: `i-${transactionId}`, templateIdentifier: 'aa', templateName: 'A template', action, role: 'owner', text: `{"action":"${action}"}` });

describe('the invitation files of a scripted run', () => {
  it('writes one file for each transaction, numbered in the order sent, and an index', () => {
    const directory = `${mkdtempSync(join(tmpdir(), 'invitations-'))}/`;
    writeInvitationFiles(directory, "the owner's device")(sent('1d0e50cd00', 'create'));
    // Another part of the run, in a process of its own, goes on counting.
    writeInvitationFiles(directory, 'the recoverer')(sent('d7124f2400', 'pay'));
    expect(readdirSync(directory).sort()).toEqual(['01-the-owner-s-device-create-1d0e50cd.json', '02-the-recoverer-pay-d7124f24.json', 'index.json']);
    expect(readFileSync(`${directory}02-the-recoverer-pay-d7124f24.json`, 'utf8')).toBe('{"action":"pay"}\n');
    expect(invitationFiles(directory).map(({ file, account, action }) => [file, account, action])).toEqual([
      ['01-the-owner-s-device-create-1d0e50cd.json', "the owner's device", 'create'],
      ['02-the-recoverer-pay-d7124f24.json', 'the recoverer', 'pay'],
    ]);
  });

  it('writes a transaction once', () => {
    const directory = `${mkdtempSync(join(tmpdir(), 'invitations-'))}/`;
    const write = writeInvitationFiles(directory, 'the recoverer');
    write(sent('d7124f2400', 'pay'));
    write(sent('d7124f2400', 'pay'));
    expect(invitationFiles(directory)).toHaveLength(1);
  });
});
