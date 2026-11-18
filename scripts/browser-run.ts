// The scripted run of stage 6: the two pages in a real browser, driven as a person would, on the local node
// or on chipnet. Each device is a browser profile of its own, kept on disk, so that a device that is "lost"
// is a profile that is no longer opened, and one that comes back is the same profile opened again.
//
//   1. the recoverer opens its page and gives its link        7. the phone is lost
//   2. the owner creates a wallet with that recoverer         8. a new phone takes the wallet over and sweeps
//   3. the recoverer takes in the kit; recovery is on         9. the wallet moves to a newer phone (new seed)
//   4. the owner receives                                     10. a new recoverer replaces the first
//   5. the owner pays                                         11. the user's own backup, restored elsewhere
//   6. an unwanted request is made and refused                12. the coins go back to where they came from
//
// usage (from the repository's root):
//   npx tsx scripts/browser-run.ts [local|chipnet] [--local-pages] [--until <step number>] [--from 11|12] [--screens] [--headed] [--ask-again]
//                                  [--directory <name>] [--record <file name>]
//
// --local-pages (chipnet): the pages of this checkout (deploy/preview.sh build), served on this machine with
// deploy/config/local.json and two backup stores of the run's own, instead of the public ones.
// --directory and --record: the profiles under .chipnet/<name>-chipnet/ and the record in docs/runs/<file name>,
// instead of the course's own (see scripts/browser-course.ts).
//
// The run measures the wall-clock time from the payment that funds the wallet to the wallet in use and to
// "Protected", and from the completion of the takeover to the swept coins, and reads from the chain which of the
// wallet's transactions were not in a block yet at those moments; the record says so in its head.
//
// --ask-again: the phone whose request is refused in step 6 is the same that takes over in step 8, and the
// recoverer asks the network again with the request it saved (the course of docs/walkthrough.md).
//
// local (the default): against the local node (deploy/regtest/regtest.sh status), with the pages of this
// checkout (deploy/preview.sh build) served on 127.0.0.1:8101 and :8102 and two backup stores on :8111 and
// :8112, unless something already answers there. The run makes the blocks and moves the chain's clock.
//
// chipnet: against the public pages named in deploy/config/production.json, as they are served. Coins come
// from the key in .chipnet/funder-design-2.json and go back to it at the end; blocks and the waiting period
// take their real time.
//
// --from 11 (or 12) continues a run that stopped there, with the profiles it left on disk; the log goes on
// from the lines the stopped run wrote.
//
// Profiles and store data are under .chipnet/browser-run/ or .chipnet/browser-run-chipnet/ (not in git).
// The log is written to docs/runs/; with --screens, screenshots of every main screen at 390x844 and
// 1280x800 go to docs/screens/.
import { mkdirSync, writeFileSync } from 'node:fs';

import { type Device, RECOVERER, WALLET, argument, blockSection, chipnet, click, completeTakeover, course, firstSteps, localPages, newPhoneAsks, openDesk, openDeskWorking, pagesUsed, recordFile, root, see, tick, valueOf, wait } from './browser-course.js';

const until = Number(argument('until') ?? '99');
/** Continue a run that stopped at step 11 or 12, with the browser profiles it left on disk. */
const from = Number(argument('from') ?? '1');
/** The phone whose request was refused in step 6 is the one that takes over in step 8: the recoverer asks the network again. */
const askAgain = process.argv.includes('--ask-again');

const theCourse = course({ directory: 'browser-run', continuing: from > 1, until });
const { work, started, lines, note, log, run, mine, prepare, device, close, shot, state, begin, elsewhere, mark, since, blockFacts, standingNow } = theCourse;

// ------------------------------------------------------------------ the log

const writeLog = (outcome: string): void => {
  mkdirSync(`${root}docs/runs`, { recursive: true });
  const where = chipnet && localPages
    ? pagesUsed([WALLET, RECOVERER], 'Blocks and the waiting period took their real time.')
    : chipnet
      ? `The pages are the public ones, ${WALLET} and ${RECOVERER}, as served, on chipnet with the public backup stores. Blocks and the waiting period took their real time.`
      : 'The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain\'s clock.';
  writeFileSync(
    recordFile(`stage-6-${chipnet ? 'chipnet' : 'local-node'}.md`),
    [
      chipnet && localPages ? '# The wallet course in a browser, on chipnet with the pages of this checkout' : `# Stage 6 scripted run in a browser, ${chipnet ? 'on chipnet with the public pages (run C)' : 'against the local node'}`,
      '',
      `Written by \`scripts/browser-run.ts${process.argv.slice(2).length === 0 ? '' : ` ${process.argv.slice(2).join(' ')}`}\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`. ${where} Times are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      '',
      ...blockSection(blockFacts),
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
};

// ------------------------------------------------------------------ the run

/** Steps 1 to 10. Returns the two devices the last steps go on with, or nothing when the run was asked to stop earlier. */
const toStepTen = async (): Promise<{ recoverer: Device; newer: Device } | undefined> => {
  if (askAgain) log('course: the phone whose request is refused in step 6 is the one that takes over in step 8 (--ask-again)');

  const reached = await firstSteps(theCourse, shot);
  if (reached === undefined) return;
  const { recoverer, old, recovererLink } = reached;

  // 5 ------------------------------------------------------------------
  if (!begin('The owner pays, and sees the fee before sending')) return;
  await old.page.getByRole('link', { name: 'Send' }).first().click();
  await old.page.getByLabel('To').fill(elsewhere());
  await old.page.getByLabel('Amount').fill('0.0002');
  await click(old.page, 'Review');
  await see(old.page, 'Check and send');
  const fee = (await old.page.locator('dd').nth(2).textContent()) ?? '';
  log(`   the review shows a fee of ${fee}`);
  await shot(old.page, 'wallet-send-review');
  await click(old.page, /^Send$/);
  await see(old.page, 'Sent');
  log(`   sent in ${await valueOf(old.page, 'sent-transaction')}`);
  await standingNow(old.page, `A payment from the wallet, ${since('paid')} after the payment that funded it`);
  await shot(old.page, 'wallet-send-done');
  mine(1);

  // 6 ------------------------------------------------------------------
  if (!begin('A request the owner did not make is refused')) return;
  const stranger = await device('stranger');
  await stranger.page.goto(recovererLink);
  await click(stranger.page, /Take over my wallet on this phone/);
  await tick(stranger.page, 'The fingerprints are the same');
  await click(stranger.page, 'Make my request');
  const strangerLink = await valueOf(stranger.page, 'takeover-link');
  const strangerFingerprint = (await stranger.page.locator('.fingerprint').first().textContent()) ?? '';
  log(`   a request from a phone with key ${strangerFingerprint}`);
  await recoverer.page.goto(strangerLink);
  await see(recoverer.page, 'A takeover request has arrived');
  await click(recoverer.page, 'See the request');
  await tick(recoverer.page, 'I have made sure who is asking');
  await shot(recoverer.page, 'recoverer-request');
  await click(recoverer.page, 'Save it for this wallet');
  await click(recoverer.page, /Ask the network/);
  await see(recoverer.page, 'The request is sent');
  log('   the recoverer (deceived, or its key stolen) asked the network');
  mine(1);
  await see(recoverer.page, 'Your request is waiting');
  await shot(recoverer.page, 'recoverer-request-waiting');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await see(old.page, 'Someone asked to move your wallet', 60_000);
  log('   the owner\'s phone shows the alarm');
  await shot(old.page, 'wallet-alarm');
  await click(old.page, 'Refuse the request');
  await see(old.page, 'The request is refused.');
  mark('refused');
  log('   refused');
  mine(1);
  await see(old.page, 'Protected', 60_000);
  log('   the fee of the refusal came from the wallet\'s coins; protected again');
  await standingNow(old.page, `From the refusal to "Protected" again: ${since('refused')}`);
  await see(recoverer.page, 'The owner\'s phone refused your request', 60_000);
  log('   the recoverer sees the refusal; the wallet is protected again');
  if (!askAgain) await close(stranger);

  // 7 ------------------------------------------------------------------
  if (!begin('The phone is lost')) return;
  await close(old);
  log('   the old phone\'s profile is no longer opened');

  // 8 ------------------------------------------------------------------
  if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
  let next: Device;
  if (askAgain) {
    // The same phone asks again: its request is still with the recoverer, who asks the network once more.
    next = stranger;
    await openDesk(recoverer.page);
    await see(recoverer.page, 'A saved takeover request');
    const shown = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
    if (shown !== strangerFingerprint) throw new Error(`the recoverer sees ${shown}, the phone ${strangerFingerprint}`);
    log(`   the recoverer still holds the request of ${shown}, and asks the network again`);
    await click(recoverer.page, 'Ask the network again');
  } else {
    next = await newPhoneAsks(theCourse, recoverer, recovererLink, shot);
  }
  await completeTakeover(theCourse, recoverer, next, shot);
  // The lost phone, found again, knows it no longer owns the wallet.
  const found = await device('old-phone', false);
  await found.page.goto(WALLET);
  await see(found.page, 'This wallet now belongs to another key');
  log('   the old phone, opened again, says the wallet belongs to another key');
  await shot(found.page, 'wallet-owned-elsewhere');
  await close(found);

  // 9 ------------------------------------------------------------------
  if (!begin('The wallet moves to a newer phone, the new phone still working')) return;
  const newer = await device('newer-phone');
  await newer.page.goto(WALLET);
  await click(newer.page, /Move from my other phone/);
  await click(newer.page, 'Start');
  const prepareLink = await valueOf(newer.page, 'prepare-link');
  await theCourse.keepStorage(newer);
  await shot(newer.page, 'wallet-move-in');
  await next.page.goto(prepareLink);
  await click(next.page, 'Move to the new phone');
  await tick(next.page, 'The new phone shows the same fingerprint');
  await click(next.page, 'Continue');
  const updateLink = await valueOf(next.page, 'update-link');
  const moveLink = await valueOf(next.page, 'move-link');
  await shot(next.page, 'wallet-move-out');
  await recoverer.page.goto(updateLink);
  await see(recoverer.page, 'update taken in');
  log('   the recoverer took in the update and left a prepared receipt');
  await newer.page.goto(moveLink);
  mark('move');
  await see(next.page, 'Your wallet is on your new phone now', 120_000);
  await theCourse.nameNewest('the change to the newer phone\'s key');
  log('   the old phone made the change');
  mine(1);
  await see(newer.page, 'Bringing your coins over', 120_000);
  for (let attempt = 0; attempt < 180 && !(await newer.page.getByRole('button', { name: 'Open the wallet' }).isVisible()); attempt++) {
    if (await theCourse.sweepSent(newer.page)) {
      await standingNow(newer.page, `From the move link opened on the newer phone to the sweep it sent: ${since('move')}`);
      break;
    }
    await wait(1_000);
  }
  await click(newer.page, 'Open the wallet', 180_000);
  mine(1);
  await see(newer.page, 'Protected', 120_000);
  log(`   the newer phone holds ${(await newer.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}; recovery is on`);
  await standingNow(newer.page, `From the move link opened on the newer phone to its wallet in use with recovery on: ${since('move')}`);
  await shot(newer.page, 'wallet-home-after-move');

  // 10 ------------------------------------------------------------------
  if (!begin('Ben replaces Anna as recoverer')) return;
  const ben = await device('second-recoverer');
  await ben.page.goto(`${RECOVERER}link`);
  await ben.page.getByLabel('Your name, as their wallet shows it').fill('Ben');
  await wait(300);
  const benLink = await valueOf(ben.page, 'recoverer-link');
  await newer.page.goto(benLink);
  await click(newer.page, 'Change recoverer');
  await tick(newer.page, 'The fingerprints are the same');
  await click(newer.page, 'Send them a kit');
  const benKit = await valueOf(newer.page, 'new-recoverer-link');
  await ben.page.goto(benKit);
  await see(ben.page, 'A recovery kit has arrived');
  await ben.page.getByLabel('Whose wallet is this?').fill('Grandma');
  await click(ben.page, 'Check and keep the kit');
  await see(ben.page, 'This kit is for a new recoverer');
  await click(ben.page, 'Keep it as the new recoverer');
  await see(ben.page, 'You look after Grandma now');
  mark('ben');
  log('   Ben took the kit in as the new recoverer');
  await see(newer.page, /is your recoverer now|The wallet names/, 120_000);
  mine(1);
  await newer.page.getByRole('link', { name: 'Home' }).first().click();
  await see(newer.page, 'Recovery is on with Ben', 180_000);
  log('   the wallet names Ben, and recovery is on with him');
  await standingNow(newer.page, `From Ben keeping the kit to "Recovery is on with Ben": ${since('ben')}`);
  await shot(newer.page, 'wallet-home-after-new-recoverer');
  await newer.page.getByRole('link', { name: 'Recovery' }).first().click();
  await see(newer.page, 'Refuse requests without asking');
  await shot(newer.page, 'wallet-recovery');
  await ben.page.goto(RECOVERER);
  await see(ben.page, 'Quiet', 60_000);
  await shot(ben.page, 'recoverer-wallets');

  return { recoverer, newer };
};

/** Steps 11 and 12. */
const lastSteps = async (recoverer: Device, newer: Device): Promise<void> => {
  // 11 ------------------------------------------------------------------
  if (state.step < 11) {
  if (!begin('The owner keeps a backup, and restores the wallet from it on another phone')) return;
  await newer.page.goto(`${WALLET}recovery`);
  await newer.page.getByRole('button', { name: /Your own backup/ }).click();
  await newer.page.getByRole('button', { name: 'Complete' }).click();
  await click(newer.page, 'Show the backup');
  const backup = await valueOf(newer.page, 'backup-text');
  log(`   the complete backup has ${backup.split('\n').length - 1} lines, ${backup.length} characters`);
  // The words are not put into the repository, not even as a picture.
  await newer.page.evaluate(() =>
    document.querySelectorAll<HTMLElement>('.backup-text > div').forEach((line) => {
      if (line.textContent?.startsWith('words: ') === true) line.textContent = 'words: (twelve words, hidden in this picture)';
    }),
  );
  await shot(newer.page, 'wallet-backup');
  await newer.page.goto(`${WALLET}details`);
  await see(newer.page, 'Technical details');
  await see(newer.page, /active/);
  await shot(newer.page, 'wallet-details');
  const restored = await device('restored-phone');
  await restored.page.goto(WALLET);
  await click(restored.page, /Restore from my own backup/);
  await restored.page.getByLabel('Your backup').fill(backup);
  await click(restored.page, /^Restore$/);
  await see(restored.page, 'Bringing your coins over');
  await click(restored.page, 'Open the wallet', 180_000);
  await see(restored.page, 'In your wallet');
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await restored.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.001) break;
    await wait(1_000);
  }
  log(`   the restored phone shows ${(await restored.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}, the same wallet with no waiting period`);
  await shot(restored.page, 'wallet-home-restored');
  await close(restored);
  }

  // 12 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  // A run continued from step 12 whose stopped part had sent the wallet's coins already goes on with the recoverer's.
  if (/ {3}the wallet sent everything: /.test(lines.join('\n'))) log('   the wallet\'s coins were sent back by the part of the run that stopped (see above)');
  else {
  await newer.page.getByRole('link', { name: 'Send' }).first().click();
  await newer.page.getByLabel('To').fill(elsewhere());
  await click(newer.page, 'Send everything instead');
  await newer.page.getByText('Arrives', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  const arrives = (await newer.page.locator('dd').nth(1).textContent()) ?? '';
  const everythingFee = (await newer.page.locator('dd').nth(2).textContent()) ?? '';
  await shot(newer.page, 'wallet-send-everything');
  await click(newer.page, /^Send everything$/);
  await see(newer.page, 'Sent');
  log(`   the wallet sent everything: ${arrives.replace('BCH', ' BCH')} arrives, fee ${everythingFee}`);
  mine(1);
  }
  // Anna is no longer the wallet's recoverer. What is left of her allowance is hers, and she sends it back.
  await openDeskWorking(theCourse, recoverer);
  await see(recoverer.page, 'The wallet no longer names you');
  // The bar fixed at the bottom of a phone's screen would cover a row scrolled just into view.
  const elsewhereRow = recoverer.page.getByText('Send the fee coins elsewhere');
  await elsewhereRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await elsewhereRow.click();
  await recoverer.page.getByLabel('To').fill(elsewhere());
  await click(recoverer.page, 'Send them');
  await see(recoverer.page, /Sent; the fee was \d+ satoshis/);
  log(`   Anna, no longer the recoverer, sent the rest of her allowance back: ${(await recoverer.page.getByText(/Sent; the fee was \d+ satoshis/).first().textContent())?.trim()}`);
  mine(1);
  if (chipnet) {
    await wait(5_000);
    log(`   funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
  }
};

const main = async (): Promise<void> => {
  if (from === 1) {
    await prepare(['wallet', 'recoverer']);
    const reached = await toStepTen();
    if (reached !== undefined) await lastSteps(reached.recoverer, reached.newer);
    return;
  }
  if (from !== 11 && from !== 12) throw new Error('A run continues from step 11 or 12.');
  note(`       continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the times below are seconds since then`);
  await prepare(['wallet', 'recoverer']);
  state.step = from - 1;
  const recoverer = await device('recoverer', false);
  const newer = await device('newer-phone', false);
  await newer.page.goto(WALLET);
  await see(newer.page, 'In your wallet');
  log(`   the newer phone's profile opens the wallet again: ${(await newer.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}`);
  await lastSteps(recoverer, newer);
};

try {
  await main();
  writeLog(state.step >= 12 && until >= 12 ? 'every step was carried out.' : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  writeLog(`failed at step ${state.step}; see the last lines.`);
  process.exitCode = 1;
} finally {
  await theCourse.end();
}
