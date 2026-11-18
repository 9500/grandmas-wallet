import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Acceptance test OP03 of the proposal is an act on the machine that serves the public sites, which a test
 * cannot repeat. Its record is `docs/runs/stage-6-switch.md`, written when the sites were switched. This
 * test reads the record and checks that it shows what OP03 asks for: services installed from the intended
 * checkout, the running version read from outside, the stores' data kept and compared, the pages tried on
 * the public addresses, and the way back taken once.
 */

const record = readFileSync(new URL('../docs/runs/stage-6-switch.md', import.meta.url), 'utf8');
const section = (title: string): string => {
  const from = record.indexOf(`## ${title}`);
  expect(from, `the record has a section "${title}"`).toBeGreaterThan(-1);
  const next = record.indexOf('\n## ', from + 1);
  return record.slice(from, next === -1 ? undefined : next);
};
/** What the check from outside printed for the two pages: the commit each serves, or that it has no version record. */
const served = (text: string): string[] => [...text.matchAll(/^(wallet|recoverer): https:\/\/\S+ answers 200, .*; (commit ([0-9a-f]{7}) of design-2, network chipnet|no version record)/gm)].map((match) => match[3] ?? 'first design');

describe('the public sites, as recorded when they were switched', () => {
  it('OP03: the sites were switched to this design and back; the version, the stores\' data and the pages were checked, and the way back was tried', () => {
    // Before: the first design, which has no version record.
    expect(served(section('Before'))).toEqual(['first design', 'first design']);
    // What the way back needs was kept: the running service definitions and the stores' data.
    const kept = section('What was kept');
    expect(kept).toMatch(/the five service definitions as they were running/);
    expect(kept).toMatch(/a copy of each store's data: \d+ files in \d+ archives each, compared with the original and found the same/);
    // Switched: installed with this design's installer, and both pages say from outside which commit they serve.
    const switched = section('Switched to this design');
    expect(switched).toMatch(/^\$ deploy\/install-services\.sh \S+ deploy\/config\/production\.json 2$/m);
    const [wallet, recoverer] = served(switched);
    expect(wallet).toMatch(/^[0-9a-f]{7}$/);
    expect(recoverer).toBe(wallet);
    expect(switched).toMatch(new RegExp(`--expect ${wallet}`));
    expect(switched).toMatch(/no uncommitted changes/);
    expect(switched).toMatch(/The stores' data\*\* was the same as the copy after the switch/);
    expect(switched.match(/^store: https:\/\/\S+ answers 200, lists an unused archive as empty/gm)).toHaveLength(2);
    // The pages were tried on the public addresses, without coins and with them.
    expect(switched).toMatch(/opened its keys in the XO engine in \d+ seconds and showed the address for the first coins, with no error logged/);
    expect(switched).toMatch(/\[stage-6-chipnet\.md\]\(stage-6-chipnet\.md\)/);
    // The way back: the first design served again from its own checkout, then this design again.
    const back = section('The way back, tried once');
    expect(back).toMatch(/^\$ cd \S*grandmas-wallet-design-1$/m);
    expect(served(back)).toEqual(['first design', 'first design', wallet, wallet]);
    expect(back).toMatch(/the stores' data was still the same as the copy/);
  });

  it('OP03: the public walkthrough was carried out on the public addresses, every step of it', () => {
    const run = readFileSync(new URL('../docs/runs/stage-6-chipnet.md', import.meta.url), 'utf8');
    expect(run).toMatch(/^# Stage 6 scripted run in a browser, on chipnet with the public pages \(run C\)/);
    expect(run).toMatch(/^Outcome: every step was carried out\./m);
    const [commit] = served(section('Switched to this design'));
    // The run names the version the pages served, and it is the one the switch installed.
    expect(run).toMatch(new RegExp(`wallet page: https://\\S+, commit ${commit} of design-2`));
    // A run that stopped and was continued begins the step it stopped in a second time.
    const steps = [...run.matchAll(/^\s*\d+ s {2}(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(steps.filter((step, index) => step !== steps[index - 1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(run).not.toMatch(/FAILED/);
    // The coins went back: the wallet sent everything, and the replaced recoverer sent on what was left of the allowance.
    expect(run).toMatch(/the wallet sent everything: [\d.]+ +BCH · [\d,]+ sat arrives, fee \d+ sat/);
    expect(run).toMatch(/Anna, no longer the recoverer, sent the rest of her allowance back/);
  });
});
