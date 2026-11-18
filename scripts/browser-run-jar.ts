// The scripted run of stage 8 in a browser: the wallet page, the recoverer page and the Savings Jar page, driven
// as a person would, on the local node or on chipnet. Each device is a browser profile of its own, kept on disk;
// the Savings Jar page is a second tab of the phone that uses it.
//
//   1. the recoverer opens its page and gives its link        6. emptying the jar before its date is refused
//   2. the owner creates a wallet with that recoverer         7. the phone is lost
//   3. the recoverer takes in the kit; recovery is on         8. a new phone takes the wallet over and sweeps
//   4. the owner receives                                     9. the new phone finds the jar from the swept key and
//   5. the owner connects the wallet to the Savings Jar          the template, the jar's site not consulted, and empties it
//      page and opens a jar from it                          10. someone pays into the jar again; that is emptied too
//                                                            11. the new phone connects to the Savings Jar page, which
//                                                                lists the jar from the wallet's answer
//                                                            12. the coins go back to where they came from
//
// usage (from the repository's root):
//   npx tsx scripts/browser-run-jar.ts [local|chipnet] [--until <step number>] [--from 9] [--screens] [--headed]
//
// --from 9 (or 12) continues a run that stopped in step 9 or later (or in step 12), with the profiles it left on
// disk: the jar's facts come from the state file the run keeps (jar.json beside the log) or, for a run made before
// there was one, from its log; the log goes on from the lines the stopped run wrote.
//
// local (the default): against the local node (deploy/regtest/regtest.sh status), with the pages of this
// checkout (deploy/preview.sh build) served on 127.0.0.1:8101, :8102 and :8103 and two backup stores on :8111
// and :8112, unless something already answers there. The run makes the blocks and moves the chain's clock. The
// wallet page and the Savings Jar page reach each other through the public relays the configuration names.
//
// chipnet: against the public pages named in deploy/config/production.json, as they are served. Coins come
// from the key in .chipnet/funder-design-2.json; blocks, the waiting period and the jar's date take their real time.
//
// Profiles and store data are under .chipnet/browser-run-jar/ or .chipnet/browser-run-jar-chipnet/ (not in git).
// The log is written to docs/runs/; with --screens, screenshots of the Applications screen and of the Savings
// Jar page at 390x844 and 1280x800 go to docs/screens/, as apps-*.png and jar-*.png.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';
import type { Locator, Page } from 'playwright';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type Device, JAR, RECOVERER, WALLET, argument, balanceOf, chipnet, click, completeTakeover, config, course, firstSteps, newPhoneAsks, openDesk, patience, root, see, wait } from './browser-course.js';

const until = Number(argument('until') ?? '99');
/** Continue a run that stopped in step 9 or later, with the browser profiles it left on disk. */
const from = Number(argument('from') ?? '1');
if (from !== 1 && from !== 9 && from !== 12) throw new Error('A run continues from step 9 or 12.');
const theCourse = course({ directory: 'browser-run-jar', continuing: from > 1, until });
const { work, started, lines, note, log, run, pay, mine, passTime, prepare, device, watchPage, close, shot, state, begin, elsewhere } = theCourse;
/** The screens of the first steps are those of the stage 6 course; they are not taken again. */
const noShot = async (): Promise<void> => undefined;
const JAR_ORIGIN = new URL(JAR).origin;

// ------------------------------------------------------------------ the log

/** What the run showed, for the head of the record. Kept on disk, so that a continued run has it too. */
const factsFile = `${work}facts.json`;
const facts: string[] = from > 1 && existsSync(factsFile) ? (JSON.parse(readFileSync(factsFile, 'utf8')) as string[]) : [];
const fact = (line: string): void => {
  facts.push(line);
  writeFileSync(factsFile, JSON.stringify(facts, null, 1));
};
const writeLog = (outcome: string): void => {
  mkdirSync(`${root}docs/runs`, { recursive: true });
  const where = chipnet
    ? `The pages are the public ones, ${WALLET}, ${RECOVERER} and ${JAR}, as served, on chipnet with the public backup stores. Blocks, the waiting period and the jar's date took their real time.`
    : 'The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain\'s clock.';
  writeFileSync(
    `${root}docs/runs/stage-8-browser-${chipnet ? 'chipnet' : 'local-node'}.md`,
    [
      `# Stage 8 scripted run in a browser, ${chipnet ? 'on chipnet with the public pages' : 'against the local node'}: a savings jar through the loss of a phone`,
      '',
      `Written by \`scripts/browser-run-jar.ts\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the Savings Jar page is a second tab of the phone that uses it. ${where} The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (${(JSON.parse(JSON.stringify(config)) as { relays?: string[] }).relays?.join(', ') ?? 'as configured'}); nothing but the session's messages went over them. Times are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      ...(continued.length === 0 ? [] : ['', ...continued]),
      '',
      ...(facts.length === 0 ? [] : ['What the run showed:', '', ...facts.map((line) => `- ${line}`), '']),
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
};

// ------------------------------------------------------------------ reading the pages

/** Text without its line breaks and repeated spaces. */
const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const textOf = async (locator: Locator): Promise<string> => flat(await locator.first().innerText());

/** The rows of the key-value lists in a part of a page, as "name: value", the name without its small print. */
const rows = (locator: Locator): Promise<string[]> =>
  locator.evaluate((element) =>
    Array.from(element.querySelectorAll('dl.kv > div')).map((row) => {
      const name = (row.querySelector('dt')?.childNodes[0]?.textContent ?? row.querySelector('dt')?.textContent ?? '').trim();
      return `${name}: ${(row.querySelector('dd') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? ''}`;
    }),
  );

/** The items of the lists of coins that move, as "group: label, amount". */
const movedItems = (locator: Locator): Promise<string[]> =>
  locator.evaluate((element) =>
    Array.from(element.querySelectorAll('.moved-group')).flatMap((group) => {
      const title = group.querySelector('.moved-title')?.textContent ?? '';
      return Array.from(group.querySelectorAll('li.moved')).map((item) => `${title}: ${(item as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}`);
    }),
  );

/** What a review of an action shows: the template and the wallet's statement, the template's words, and the wallet's own figures. */
const readReview = async (card: Locator, who: string): Promise<void> => {
  const template = await textOf(card.locator('.template-name'));
  const statement = await textOf(card.locator('.status-title'));
  const reasons = flat(await card.locator('.status-body').first().innerText().catch(() => ''));
  log(`   ${who}: template "${template}", "${statement}"${reasons === '' ? '' : ` (${reasons})`}`);
  const firstUse = card.locator('.notice').filter({ hasText: /Approving (trusts|stores)/ });
  if ((await firstUse.count()) > 0) log(`   it says: "${await textOf(firstUse)}"`);
  const words = card.locator('.their-words');
  log(`   in the template's words: "${await textOf(words.locator('.quote-title'))}"; ${(await rows(words)).join('; ')}`);
  const figures = card.locator('.own-figures');
  log(`   the wallet's own figures: ${(await rows(figures)).join('; ')}`);
  for (const item of await movedItems(figures)) log(`     ${item}`);
  for (const notice of await figures.locator('.notice').all()) log(`     "${flat(await notice.innerText())}"`);
};

/** The token row of the jar's key on the Applications screen. */
const keyRow = (page: Page, category: string): Locator => page.locator('li.token').filter({ has: page.locator(`.token-id [title="${category}"], .token-id :text("${category}")`) });

/** The chain's clock: the time of the last block and the median time of the last eleven, on the local node. */
const chainClock = (): { tip: number; median: number } | undefined => {
  if (chipnet) return undefined;
  const cli = (...parameters: string[]): string => run(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters]);
  const header = JSON.parse(cli('getblockheader', cli('getbestblockhash'))) as { time: number; mediantime: number };
  return { tip: header.time, median: header.mediantime };
};
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

/** Connect the wallet to the Savings Jar page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, jarPage: Page, who: string): Promise<string> => {
  await jarPage.goto(JAR);
  const address = jarPage.locator('.value-text[data-value^="wiz:"]').first();
  await address.waitFor({ state: 'visible', timeout: 120_000 * patience });
  const uri = (await address.getAttribute('data-value')) ?? '';
  await see(jarPage, 'Waiting for your wallet.', 120_000);
  log(`   the Savings Jar page shows its connection address (${uri.length} characters, ${uri.slice(0, uri.indexOf('?') === -1 ? 30 : Math.min(uri.indexOf('?'), 60))}…) and waits for a wallet`);
  await shot(jarPage, `jar-connect${who}`);
  await wallet.goto(`${WALLET}apps`);
  await see(wallet, 'Connect to an application');
  await wallet.locator('#connect-address').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').first();
  await row.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}", ${await textOf(row.locator('.small.muted'))}; "Connected"`);
  await see(jarPage, /Connected to /, 120_000);
  log(`   the Savings Jar page: "${await textOf(jarPage.locator('.status-title'))}"`);
  return uri;
};

// ------------------------------------------------------------------ the run

/** Jar facts carried from step to step, kept on disk for a run that continues. */
const jar = { category: '', unlockTime: 0, address: '' };
const jarFile = `${work}jar.json`;
const keepJar = (): void => writeFileSync(jarFile, JSON.stringify(jar, null, 1));
/** What the record says about a continued run, after its Outcome line. Kept on disk for a later continuation. */
const continuedFile = `${work}continued.json`;
const continued: string[] = from > 1 && existsSync(continuedFile) ? (JSON.parse(readFileSync(continuedFile, 'utf8')) as string[]) : [];
const keepContinued = (line: string): void => {
  continued.push(line);
  writeFileSync(continuedFile, JSON.stringify(continued, null, 1));
};
/** What the record says about the requests of a run continued from step 9, from what the profiles' local storage held. */
const requestsNote = (stored: string[], storedOld: string[]): string =>
  `The run stopped in step 9 and was continued from step 9 with the same profiles (\`--from 9\`); the line "continued from step 9" in the log marks where. The stopped run kept the list of the new phone's requests in memory, and it was lost with that process: the requests of the new phone's browser were recorded only in the continued part. What remains of the first part is the profile's local storage, read before the profile was opened again: the new phone's held entries of ${stored.join(', ')}, and none of the Savings Jar page (${JAR_ORIGIN}), whose page writes there whenever it starts (the old phone's profile, which opened it, held ${storedOld.includes(JAR_ORIGIN) ? 'entries of it' : 'none either'}). That shows that the Savings Jar page did not run in the new phone's browser; it does not show, as a recording would, that nothing in that browser ever asked the page's server for anything.`;

/** The jar's facts for a run that continues: from the state file, or from the log of a run made before there was one. */
const jarFromDisk = (): void => {
  if (existsSync(jarFile)) {
    Object.assign(jar, JSON.parse(readFileSync(jarFile, 'utf8')) as typeof jar);
    return;
  }
  const text = lines.join('\n');
  jar.category = /the wallet's tokens: .*; key ([0-9a-f]{64})/.exec(text)?.[1] ?? '';
  const date = /\(the date (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\)/.exec(text)?.[1];
  jar.unlockTime = date === undefined ? 0 : Date.parse(date) / 1000;
  jar.address = /as the contract makes it from the key and the date: (\S+)/.exec(text)?.[1] ?? '';
  if (jar.category === '' || jar.unlockTime === 0 || jar.address === '') throw new Error('The stopped run\'s log does not name the jar\'s key, date and address.');
  keepJar();
  // What the stopped run showed before step 9, as far as its log says it; the rest is in the log itself.
  const opened = /approved; the wallet: "Done: [^"]*", transaction ([0-9a-f]{64})/.exec(text)?.[1];
  const refused = /"Not carried out": "([^"]*)"/.exec(text)?.[1];
  if (facts.length === 0) {
    facts.push(`(From the log of the stopped run.) The jar was opened from the Savings Jar page through the wallet${opened === undefined ? '' : ` (transaction \`${opened}\`)`}: 30,000 satoshis until ${iso(jar.unlockTime)}, key \`${jar.category}\`, address \`${jar.address}\`.`);
    if (refused !== undefined) facts.push(`(From the log of the stopped run.) Emptying before the date: the jar page offered no button for it ("Locked"), and from the wallet's list of tokens the network refused it: "${refused}"`);
  }
};

/**
 * The origins whose pages kept something in a profile's local storage, read from its files before the profile is
 * opened. Every page this course opens writes there when it starts, so an origin that is missing ran no page in it.
 */
const originsStoredIn = (name: string): string[] => {
  const directory = `${work}profiles/${name}/Default/Local Storage/leveldb/`;
  if (!existsSync(directory)) return [];
  const found = new Set<string>();
  for (const file of readdirSync(directory)) {
    for (const match of readFileSync(`${directory}${file}`).toString('latin1').matchAll(/_(https?:\/\/[a-z0-9.-]+(?::\d+)?)(?![a-z0-9.:/-])/g)) if (match[1] !== undefined) found.add(match[1]);
  }
  // Keys in the files may be cut short where they share a beginning with the key before: only whole host names count.
  return [...found].filter((origin) => /^https?:\/\/(localhost|127\.0\.0\.1|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?$/.test(origin)).sort();
};

/** The network's clock: the median time of the last eleven blocks, as the network checks a lock time against it. */
const medianTime = async (): Promise<{ height: number; medianTime: number }> => {
  const [server] = (JSON.parse(readFileSync(`${root}deploy/config/${chipnet ? 'production' : 'local-regtest'}.json`, 'utf8')) as { chain: string[] }).chain;
  const electrum = await Electrum.connect(server ?? '');
  try {
    const { height } = await electrum.tip();
    const times = await Promise.all(Array.from({ length: 11 }, (_, offset) => electrum.headerTime(height - offset)));
    return { height, medianTime: [...times].sort((a, b) => a - b)[5] ?? 0 };
  } finally {
    await electrum.disconnect();
  }
};

/**
 * Until the network takes a withdrawal: its median time past the jar's date. On the local node the run moves the
 * chain's clock; on chipnet it waits, and says once a minute where the clock stands.
 */
const untilTheDate = async (): Promise<void> => {
  let clock = await medianTime();
  if (clock.medianTime > jar.unlockTime) {
    log(`   the chain's median time is ${iso(clock.medianTime)} at height ${clock.height}, past the jar's date ${iso(jar.unlockTime)}`);
    return;
  }
  if (!chipnet) {
    const tip = chainClock();
    log(`   ${passTime(jar.unlockTime - (tip?.tip ?? clock.medianTime) + 120)}`);
  } else {
    // The median time runs some minutes behind the clock; an hour past the date is far more than it ever needs.
    const deadline = Math.max(Date.now() / 1000, jar.unlockTime) + 3_600;
    log(`   the chain's median time is ${iso(clock.medianTime)} at height ${clock.height}; the jar's date is ${iso(jar.unlockTime)}. Waiting for the network's clock to pass it`);
    while (clock.medianTime <= jar.unlockTime) {
      if (Date.now() / 1000 > deadline) throw new Error(`the chain's median time did not pass the jar's date by ${iso(deadline)}`);
      await wait(60_000);
      clock = await medianTime().catch(() => clock);
      log(`   the chain's median time is ${iso(clock.medianTime)} at height ${clock.height}`);
    }
  }
  clock = await medianTime();
  log(`   the chain's median time is ${iso(clock.medianTime)} at height ${clock.height}, past the jar's date ${iso(jar.unlockTime)}`);
};

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let next: Device;
  /** Everything the new phone's browser asks of any server, to show that the Savings Jar page is not among them. */
  const requested: string[] = [];
  const record = (phone: Device): void => {
    phone.context.on('request', (asked) => void requested.push(asked.url()));
    phone.context.on('page', (page) => page.on('websocket', (socket) => void requested.push(socket.url())));
    phone.page.on('websocket', (socket) => void requested.push(socket.url()));
  };
  if (from === 12) {
    jarFromDisk();
    // A run continued from step 9 before its note was kept on disk: the note again, from the log's line of what the profiles held.
    const held = /before it is opened again, the new phone's profile holds local storage of ([^;]*); the old phone's of (.*)$/m.exec(lines.join('\n'));
    if (held !== null && !continued.some((line) => line.startsWith('The run stopped in step 9'))) keepContinued(requestsNote((held[1] ?? '').split(', '), (held[2] ?? '').split(', ')));
    log(`   the jar: key ${jar.category}, date ${iso(jar.unlockTime)}, address ${jar.address}`);
    state.step = 11;
    await lastStep(await device('recoverer', false), await device('new-phone', false));
    return;
  }
  if (from === 9) {
    jarFromDisk();
    log(`   the jar: key ${jar.category}, date ${iso(jar.unlockTime)}, address ${jar.address}`);
    const stored = originsStoredIn('new-phone');
    const storedOld = originsStoredIn('old-phone');
    log(`   before it is opened again, the new phone's profile holds local storage of ${stored.join(', ')}; the old phone's of ${storedOld.join(', ')}`);
    keepContinued(requestsNote(stored, storedOld));
    state.step = 8;
    recoverer = await device('recoverer', false);
    next = await device('new-phone', false);
    record(next);
  } else {
  const reached = await firstSteps(theCourse, noShot);
  if (reached === undefined) return;
  const { old, recovererLink } = reached;
  recoverer = reached.recoverer;

  // 5 ------------------------------------------------------------------
  if (!begin('The owner connects the wallet to the Savings Jar page and opens a jar from it')) return;
  const oldJar = await old.context.newPage();
  watchPage('old-phone, jar tab', oldJar);
  await connect(old.page, oldJar, '');
  await shot(old.page, 'apps-connected');
  await see(oldJar, /^No jars (yet|to show)\./);
  log(`   the jar page lists: "${await textOf(oldJar.locator('.card').filter({ hasText: 'Your jars' }).locator('p'))}"`);
  await shot(oldJar, 'jar-connected');

  // The date: some minutes ahead of the chain's clock and of this machine's, so that it is still ahead after the
  // waiting period of the takeover has moved the chain's clock on.
  const clock = chainClock();
  const now = Math.floor(Date.now() / 1000);
  const base = Math.max(now, clock?.tip ?? 0, clock?.median ?? 0);
  jar.unlockTime = Math.ceil((base + (chipnet ? 40 : 25) * 60) / 60) * 60;
  if (clock !== undefined) log(`   the chain's clock: last block ${iso(clock.tip)}, median time ${iso(clock.median)}; this machine ${iso(now)}`);
  // In the browser's time zone, as the page's date field takes it. (No function is defined inside: the page has no helpers of the bundler's.)
  const local = await oldJar.evaluate((seconds) => {
    const date = new Date(seconds * 1000);
    return [date.getFullYear(), '-', date.getMonth() + 1, '-', date.getDate(), 'T', date.getHours(), ':', date.getMinutes()].map((part) => (typeof part === 'number' && part < 10 ? `0${part}` : String(part))).join('');
  }, jar.unlockTime);
  await oldJar.locator('#jar-amount').fill('0.0003');
  await oldJar.locator('#jar-date').fill(local);
  await see(oldJar, /stays in the jar until/);
  log(`   the form says: "${await textOf(oldJar.locator('.summary'))}" (the date ${iso(jar.unlockTime)})`);
  await click(oldJar, 'Open the jar');
  await see(oldJar, 'On its way');
  await see(oldJar, 'Your wallet has the request', 120_000);
  log(`   the jar page: "On its way", "${await textOf(oldJar.locator('.steps li.current'))}"`);
  await shot(oldJar, 'jar-on-its-way');

  const request = old.page.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await request.waitFor({ state: 'visible', timeout: 120_000 * patience });
  await request.getByText('This wallet\'s own figures').waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(request.locator('h2, .card-title'))}"; ${await textOf(request.locator('.asker'))}`);
  await readReview(request, 'the request');
  fact(`Before the jar was opened, the wallet's Applications screen showed the request of the page that names itself "Savings Jar" (its own name, marked as not verified), the template "Savings Jar" as "Not verified", that approving trusts the template and stores it in the backup first, the action in the template's words, and the wallet's own figures.`);
  await shot(old.page, 'apps-request');
  await click(old.page, /^Approve$/);
  const done = old.page.locator('.request-card').filter({ hasText: 'Done:' }).first();
  await done.waitFor({ state: 'visible', timeout: 180_000 * patience });
  const opened = (await done.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  log(`   approved; the wallet: "${await textOf(done.locator('h2, .card-title'))}", transaction ${opened}`);
  await see(oldJar, 'The jar is open. Its key is in your wallet.', 120_000);
  const item = oldJar.getByTestId('jar').first();
  await item.waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the jar page: "The jar is open. Its key is in your wallet."; the jar: ${await textOf(item.locator('.jar-top'))}, "${await textOf(item.locator('.jar-when'))}"`);
  await shot(old.page, 'apps-done');
  mine(1);

  // The key's category, from the wallet's list of tokens.
  const tokens = old.page.locator('li.token').filter({ hasText: 'Savings Jar' }).first();
  await tokens.getByText(/^Holds/).waitFor({ state: 'visible', timeout: 120_000 * patience });
  jar.category = (await tokens.locator('.token-id button.hex').first().getAttribute('title')) ?? '';
  if (!/^[0-9a-f]{64}$/.test(jar.category)) throw new Error(`the key's category could not be read: ${jar.category}`);
  keepJar();
  log(`   the wallet's tokens: "${await textOf(tokens.locator('.token-title'))}" (${await textOf(tokens.locator('.pill'))}), ${await textOf(tokens.locator('.token-body p').first())}; key ${jar.category}`);
  await shot(old.page, 'apps-tokens');

  // The jar's address, as the page gives it for paying in from any wallet, and as the application's code makes it.
  await item.getByRole('button', { name: 'Pay in', exact: true }).click();
  await item.locator('summary', { hasText: 'Pay in from any wallet' }).click();
  jar.address = (await item.locator('.value-text').first().getAttribute('data-value')) ?? '';
  const made = lockingBytecodeToCashAddress({ prefix: config.network === 'mainnet' ? 'bitcoincash' : config.network === 'regtest' ? 'bchreg' : 'bchtest', bytecode: savingsJarScript(hexToBin(jar.category), jar.unlockTime).lockingBytecode });
  const expected = typeof made === 'string' ? made : made.address;
  if (jar.address !== expected) throw new Error(`the page gives the jar's address as ${jar.address}, the contract ${expected}`);
  keepJar();
  log(`   the jar's address, as the page gives it and as the contract makes it from the key and the date: ${jar.address}`);
  await shot(oldJar, 'jar-opened');
  await item.getByRole('button', { name: 'Close' }).click();
  fact(`The jar was opened from the Savings Jar page through the wallet (transaction \`${opened}\`): 30,000 satoshis until ${iso(jar.unlockTime)}, key \`${jar.category}\`, address \`${jar.address}\`.`);

  // 6 ------------------------------------------------------------------
  if (!begin('Emptying the jar before its date is refused')) return;
  await oldJar.reload();
  const locked = oldJar.getByTestId('jar').first();
  await locked.waitFor({ state: 'visible', timeout: 120_000 * patience });
  if ((await locked.getByRole('button', { name: 'Empty the jar' }).count()) > 0) throw new Error('the jar page offers to empty a jar before its date');
  log(`   the jar page offers no "Empty the jar": ${await textOf(locked.locator('.jar-top'))}, "${await textOf(locked.locator('.jar-when'))}", "${await textOf(locked.locator('.jar-note'))}"`);
  await shot(oldJar, 'jar-locked');
  await old.page.goto(`${WALLET}apps`);
  const row = old.page.locator('li.token').filter({ hasText: 'Savings Jar' }).first();
  await click(old.page, 'Empty a savings jar');
  const review = old.page.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
  await review.waitFor({ state: 'visible', timeout: 120_000 * patience });
  log('   from the wallet\'s list of tokens, "Empty a savings jar":');
  await readReview(review, 'the review');
  await shot(old.page, 'apps-empty-early');
  await click(old.page, 'Carry it out');
  await see(old.page, 'Not carried out', 120_000);
  const refusal = await textOf(old.page.locator('.failure'));
  log(`   "Not carried out": "${refusal}"`);
  if (!/non-?final/i.test(refusal)) throw new Error('the refusal does not say that the transaction is not final yet');
  fact(`Emptying before the date: the jar page offers no button for it ("Locked"); from the wallet's list of tokens the review says when the network takes the transaction, and the network refused it: "${refusal}".`);
  await shot(old.page, 'apps-empty-refused');
  await click(old.page, 'Back');
  await row.waitFor({ state: 'visible', timeout: 60_000 * patience });

  // 7 ------------------------------------------------------------------
  if (!begin('The phone is lost')) return;
  await close(old);
  log('   the old phone\'s profile, with its wallet tab and its Savings Jar tab, is no longer opened');

  // 8 ------------------------------------------------------------------
  if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
  next = await device('new-phone');
  record(next);
  await newPhoneAsks(theCourse, recoverer, recovererLink, noShot, next);
  await completeTakeover(theCourse, recoverer, next, noShot);
  }

  // 9 ------------------------------------------------------------------
  if (!begin('The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it')) return;
  await next.page.goto(`${WALLET}apps`);
  const swept = keyRow(next.page, jar.category);
  const trustButton = swept.getByRole('button', { name: 'Trust this template' });
  await trustButton.or(swept.getByText(/^Holds/)).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
  if (!(await trustButton.isVisible())) {
    // A continued run: the stopped one trusted the template on this phone already, as its log says.
    log(`   the template is trusted on this phone already (by the stopped run); the key: "${await textOf(swept.locator('.token-title'))}" (${await textOf(swept.locator('.pill'))}), "${await textOf(swept.locator('.token-body p').first())}"`);
  } else {
  log(`   the Applications screen lists the swept key: "${await textOf(swept.locator('.token-title'))}" (${await textOf(swept.locator('.pill'))}): "${await textOf(swept.locator('.token-body p').first())}"`);
  fact(`On the new phone the swept key was listed as "${await textOf(swept.locator('.pill'))}": "${await textOf(swept.locator('.token-body p').first())}"`);
  await shot(next.page, 'apps-incomplete');
  await swept.getByRole('button', { name: 'Trust this template' }).click();
  await see(next.page, 'A template from your backup');
  log(`   "A template from your backup": "${await textOf(next.page.locator('.template-name'))}", "${await textOf(next.page.locator('.status-title'))}"`);
  await shot(next.page, 'apps-trust');
  await click(next.page, 'Trust this template');
  const found = keyRow(next.page, jar.category);
  await found.getByText(/^Holds/).waitFor({ state: 'visible', timeout: 120_000 * patience });
  const holds = await textOf(found.locator('.token-body p').first());
  log(`   trusted; the key: "${await textOf(found.locator('.token-title'))}" (${await textOf(found.locator('.pill'))}), "${holds}"; actions: ${(await found.locator('.token-actions button').allInnerTexts()).map((text) => `"${flat(text)}"`).join(', ')}`);
  fact(`After the template from the backup was trusted, the new phone found the jar from the key and the chain: "${await textOf(found.locator('.pill'))}", "${holds}".`);
  await shot(next.page, 'apps-jar-found');
  }

  // The chain's clock past the jar's date.
  await untilTheDate();
  await next.page.getByRole('link', { name: 'Home' }).first().click();
  await see(next.page, 'In your wallet');
  const balanceBefore = await balanceOf(next.page);
  await next.page.getByRole('link', { name: 'Apps' }).first().click();
  const emptied = await empty(next, 'the first withdrawal');
  const toJar = requested.filter((url) => url.startsWith(JAR_ORIGIN));
  const origins = [...new Set(requested.map((url) => new URL(url).origin))];
  if (toJar.length > 0) throw new Error(`the new phone asked the Savings Jar page: ${toJar.join(', ')}`);
  const part = from === 9 ? ' in the continued part of the run' : '';
  log(`   up to here${part} the new phone's browser made ${requested.length} requests, to ${origins.join(', ')}; none to the Savings Jar page (${JAR_ORIGIN})`);
  fact(`Up to the first withdrawal${part} the new phone's browser made ${requested.length} requests, to ${origins.join(', ')}: none to the Savings Jar page (${JAR_ORIGIN}).${from === 9 ? ' (The requests of the stopped part were not kept; see above.)' : ''} The jar was emptied from the wallet's list of tokens (transaction \`${emptied}\`).`);
  mine(1);
  await next.page.getByRole('link', { name: 'Home' }).first().click();
  let balanceAfter = balanceBefore;
  for (let attempt = 0; attempt < 30 && balanceAfter <= balanceBefore; attempt++) {
    await wait(1_000);
    balanceAfter = await balanceOf(next.page);
  }
  if (balanceAfter <= balanceBefore) throw new Error('the wallet\'s balance did not rise');
  log(`   the wallet's balance rose from ${balanceBefore} to ${balanceAfter} satoshis`);
  await next.page.getByRole('link', { name: 'Apps' }).first().click();
  const kept = keyRow(next.page, jar.category);
  await kept.getByText('It holds nothing now.').waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the key is still listed: "${await textOf(kept.locator('.token-title'))}" (${await textOf(kept.locator('.pill'))}), "It holds nothing now."`);
  fact(`The wallet's balance rose from ${balanceBefore} to ${balanceAfter} satoshis, and the key is still listed ("${await textOf(kept.locator('.pill'))}").`);
  await shot(next.page, 'apps-emptied');

  // 10 ------------------------------------------------------------------
  if (!begin('Someone pays into the jar again, and the new phone empties that too')) return;
  log(`   ${pay(jar.address, 8_000)}`);
  const again = keyRow(next.page, jar.category);
  for (let attempt = 0; attempt < 30; attempt++) {
    await next.page.getByRole('button', { name: 'Read again' }).click().catch(() => undefined);
    if (await again.getByText(/^Holds/).isVisible()) break;
    await wait(2_000);
  }
  log(`   the key: (${await textOf(again.locator('.pill'))}), "${await textOf(again.locator('.token-body p').first())}"`);
  const second = await empty(next, 'the second withdrawal');
  fact(`8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction \`${second}\`).`);
  mine(1);

  // 11 ------------------------------------------------------------------
  if (!begin('The new phone connects to the Savings Jar page, which lists the jar from the wallet\'s answer')) return;
  const nextJar = await next.context.newPage();
  watchPage('new-phone, jar tab', nextJar);
  await connect(next.page, nextJar, '-new-phone');
  // The page asks which tokens of its template the wallet holds. The wallet answers only for a template the user
  // trusted in a session with this application; this one was trusted from the backup, so the wallet asks first.
  const ask = next.page.locator('.request-card').filter({ hasText: 'asks to see' }).first();
  await ask.waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet: "${await textOf(ask.locator('h2, .card-title'))}": "${await textOf(ask.locator('p').first())}"`);
  await shot(next.page, 'apps-positions-ask');
  await ask.getByRole('button', { name: 'Allow' }).click();
  const listed = nextJar.getByTestId('jar').first();
  await listed.waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   allowed; the Savings Jar page lists, from the wallet's answer: ${await textOf(listed.locator('.jar-top'))}, "${await textOf(listed.locator('.jar-when'))}", "${await textOf(listed.locator('.jar-note'))}"`);
  fact(`Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: ${await textOf(listed.locator('.jar-top'))}, "${await textOf(listed.locator('.jar-note'))}".`);
  await shot(nextJar, 'jar-listed-new-phone');
  await lastStep(recoverer, next);
};

/** Step 12: what the wallet and the recoverer hold goes back to where it came from, and what is left is said. */
const lastStep = async (recoverer: Device, next: Device): Promise<void> => {
  // 12 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  const to = elsewhere();
  await next.page.goto(`${WALLET}send`);
  await next.page.getByLabel('To').fill(to);
  await click(next.page, 'Send everything instead');
  const everything = next.page.getByText('The coin kept for cancelling goes too');
  const nothing = next.page.getByText('Too little to send');
  await everything.or(nothing).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
  let walletPart: string;
  if (await everything.isVisible()) {
    const arrives = flat(await next.page.locator('dd').nth(1).textContent());
    const fee = flat(await next.page.locator('dd').nth(2).textContent());
    await click(next.page, /^Send everything$/);
    await see(next.page, 'Sent');
    log(`   the new phone sent everything to ${to}: ${arrives} arrives, fee ${fee}; the wallet says that tokens stay where they are, so the jar's key stays in the wallet`);
    walletPart = `the wallet's coins (${arrives} arrived, fee ${fee}; the coin kept for cancelling went too)`;
  } else {
    const holds = flat(await next.page.locator('dd').first().textContent());
    log(`   the wallet has nothing left to send: "Too little to send", it holds ${holds} it could spend`);
    // A continued run: the part that stopped may have sent everything already, as its log says.
    const earlier = /the new phone sent everything to \S+: (.+?) arrives, fee ([\d,]+ sat)/.exec(lines.join('\n'));
    walletPart = earlier === null ? `nothing from the wallet, which held ${holds} it could spend` : `the wallet's coins, sent by the part of the run that stopped (${earlier[1]} arrived, fee ${earlier[2]}; the coin kept for cancelling went too)`;
  }
  mine(1);
  await openDesk(recoverer.page);
  const elsewhereRow = recoverer.page.getByText('Send the fee coins elsewhere');
  await elsewhereRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await elsewhereRow.click();
  await recoverer.page.getByLabel('To').fill(to);
  await click(recoverer.page, 'Send them');
  // The page says it in a toast, which goes after a few seconds: it is read once.
  const returned = recoverer.page.getByText(/Sent; the fee was \d+ satoshis|holds too little to send on/).first();
  await returned.waitFor({ state: 'visible', timeout: 120_000 * patience });
  const returnedText = flat(await returned.textContent());
  let recovererPart: string;
  if (/^Sent/.test(returnedText)) {
    log(`   Anna sent her fee coins back: ${returnedText}`);
    recovererPart = `the recoverer's fee coins (${returnedText})`;
  } else {
    log(`   Anna's fee address: "${returnedText}"`);
    const earlier = /Anna sent her fee coins back: (.+)$/m.exec(lines.join('\n'));
    recovererPart = earlier === null ? `nothing from the recoverer, whose page said: "${returnedText}"` : `the recoverer's fee coins, sent by the part of the run that stopped (${earlier[1]}); her page now says: "${returnedText}"`;
  }
  mine(1);
  await next.page.goto(WALLET);
  await see(next.page, 'In your wallet');
  await wait(10_000);
  const left = await balanceOf(next.page);
  await next.page.goto(`${WALLET}apps`);
  const key = keyRow(next.page, jar.category);
  await key.getByText('It holds nothing now.').waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   left: the new phone's wallet shows ${left} satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing`);
  fact(`At the end the coins went back to ${to}${chipnet ? ', the address that paid for the run' : ''}: ${walletPart}, and ${recovererPart}. What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet, whose balance shows ${left} satoshis; the jar is empty; the wallet's controller coin stays on chain, since sending everything leaves it in place and the pages do not close a wallet (its value was not read by this run). Every profile stays on disk.`);
  if (chipnet) {
    await wait(5_000);
    log(`   funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
  }
};

/** Empty the jar from the wallet's list of tokens, once the chain's median time has passed its date. On chipnet a node may still be a block behind: it is tried again, a few times. */
const empty = async (phone: Device, what: string): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    const row = keyRow(phone.page, jar.category);
    await row.getByRole('button', { name: 'Empty a savings jar' }).click();
    const review = phone.page.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
    await review.waitFor({ state: 'visible', timeout: 120_000 * patience });
    log(`   ${what}, from the wallet's list of tokens:`);
    await readReview(review, 'the review');
    if (what === 'the first withdrawal') await shot(phone.page, 'apps-empty-review');
    await click(phone.page, 'Carry it out');
    const outcome = phone.page.getByText(/^(Done|Not carried out)$/).first();
    await outcome.waitFor({ state: 'visible', timeout: 180_000 * patience });
    if ((await outcome.innerText()).trim() === 'Done') {
      const transaction = (await phone.page.getByTestId('action-transaction').first().getAttribute('data-value')) ?? '';
      log(`   done: ${transaction}`);
      await click(phone.page, 'Back to the tokens');
      return transaction;
    }
    const reason = await textOf(phone.page.locator('.failure'));
    if (!chipnet || attempt >= 5 || !/non-?final/i.test(reason)) throw new Error(`${what} was not carried out: ${reason}`);
    log(`   not yet: "${reason}"; tried again in a minute`);
    await click(phone.page, 'Back');
    await wait(60_000);
  }
};

try {
  if (from > 1) note(`       continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the times below are seconds since then`);
  await prepare(['wallet', 'recoverer', 'jar']);
  await steps();
  const all = state.step >= 12 && until >= 12;
  // Where a run stopped before it was continued, in the words of its log.
  const stops = lines.filter((line) => / FAILED at step \d+: /.test(line)).map((line) => line.replace(/^ *\d+ s +/, ''));
  if (from > 1) continued.push(...stops.map((stop) => `A part of the run stopped: "${stop.slice(0, 300)}" It was continued from the next "continued from step" line of the log.`));
  writeLog(all ? (from > 1 ? `every step was carried out, in ${stops.length + 1} parts with the same browser profiles: each part that stopped, and where the next took over, is named below and in the log.` : 'every step was carried out.') : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  writeLog(`failed at step ${state.step}; see the last lines.`);
  process.exitCode = 1;
} finally {
  await theCourse.end();
}


