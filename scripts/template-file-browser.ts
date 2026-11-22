// Adding a template from a file and deleting it, in the real wallet page on the local node: Anna's recoverer page sets
// up Grandma's wallet and the owner receives (steps 1 to 3 of scripts/browser-course.ts), then, under Apps, the Savings Jar's frozen template
// is added from its file, trusted and stored in the backup; its screen opens. The Apps tab brings back the list. The
// template is stopped and deleted: it is no longer listed, and after the page is opened again and has read the backup,
// it is not suggested either, and the backup holds its mark. Added again from the file, it is trusted and stored again.
// Nothing is sent to an application, and no template action is carried out.
//
// usage (from the repository's root, with the local node running and the pages built: deploy/preview.sh build):
//   npx tsx scripts/template-file-browser.ts [--headed] [--ports <base>]
// The pages, a relay and two backup stores are served on ports of the run's own (8351, 8352, 8361 and 8362 unless
// --ports says otherwise). The run pays from a key of its own and gives back what it did not spend; the wallet keeps
// its starting balance on the local chain. Profiles, stores and the log are under .local-runs/template-file-browser/.
import { readFileSync } from 'node:fs';

import type { Page } from 'playwright';

import { LIMIT, chainShows, course, firstSteps, pageShows, root, walletKey } from './browser-course.js';

const FILE = `${root}packages/savings-jar/frozen/savings-jar-v4.json`;
const theCourse = course({ directory: 'template-file-browser', continuing: false, until: 99, ports: 8350, need: 200_000 });
const { log, prepare, fundRunKey, returnCoins, end, failed, begin } = theCourse;
const noShot = async (): Promise<void> => undefined;

/** What the wallet page keeps about templates: trusted, suggested and deleted, by name and number. */
const kept = async (page: Page): Promise<{ templates: string[]; suggested: string[]; deleted: { renewal: number; stored: boolean }[] }> =>
  page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}') as { applications?: { templates?: { name: string; stored: boolean }[]; suggested?: { name: string }[]; deleted?: { renewal: number; stored: boolean }[] } };
    const applications = state.applications ?? {};
    return {
      templates: (applications.templates ?? []).map((template) => `${template.name} (${template.stored ? 'stored' : 'not stored'})`),
      suggested: (applications.suggested ?? []).map((template) => template.name),
      deleted: (applications.deleted ?? []).map(({ renewal, stored }) => ({ renewal, stored })),
    };
  }, walletKey('state'));
const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`not so: ${what}`);
  log(`   ok: ${what}`);
};
const addFromFile = async (page: Page): Promise<void> => {
  await page.locator('[data-testid="template-add"] input[type=file]').setInputFiles(FILE);
  await pageShows(page.getByText('A template from a file'), 'the review of the template from the file');
  await pageShows(page.getByText('From a file on this phone'), 'the mark that it comes from a file');
};

try {
  await prepare(['wallet', 'recoverer']);
  fundRunKey();
  const steps = await firstSteps(theCourse, noShot, async () => undefined, { balance: 150_000, receive: 20_000 });
  if (steps === undefined) throw new Error('the wallet was not set up');
  const { old } = steps;
  const page = old.page;
  const text = readFileSync(FILE, 'utf8');
  log(`   the file: ${FILE.slice(root.length)}, ${text.length} characters`);

  begin('Under Apps, the owner adds the template from its file and trusts it');
  await page.getByRole('link', { name: 'Apps' }).first().click();
  await pageShows(page.getByText('Add from a file'), 'the way to add a template from a file');
  await addFromFile(page);
  await page.getByRole('button', { name: 'Trust this template' }).click();
  await pageShows(page.getByText('Trusted since'), 'the template\'s screen after trusting it');
  await pageShows(page.getByText('By you, not by an app'), 'that it was added by the owner');
  await chainShows(page.getByText('Stored', { exact: true }), 'the template to be stored in the backup', LIMIT.read);
  log(`   the wallet keeps: ${JSON.stringify(await kept(page))}`);

  begin('The Apps tab, tapped inside the template\'s screen, brings back the list');
  await page.getByRole('link', { name: 'Apps' }).first().click();
  await pageShows(page.getByText('Connect an app'), 'the Apps list');
  check(!(await page.getByText('Trusted since').isVisible()), 'the template\'s screen is left');
  await page.getByTestId('template-row').first().click();
  await pageShows(page.getByText('Trusted since'), 'the template\'s screen again');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await pageShows(page.getByText('Connect an app'), 'the Apps list, by the back button');

  begin('The owner stops trusting the template and deletes it');
  await page.getByTestId('template-row').first().click();
  await page.getByRole('button', { name: 'Stop trusting this template' }).click();
  await page.getByText('Also delete it from this wallet').click();
  await pageShows(page.getByRole('button', { name: 'Stop and delete' }), 'the button to stop and delete');
  // The wallet holds no token of it: no warning, no tick.
  await page.getByRole('button', { name: 'Stop and delete' }).click({ timeout: 20_000 });
  await pageShows(page.getByText('Connect an app'), 'the Apps list after the deletion');
  check((await page.getByTestId('template-row').count()) === 0 && (await page.getByTestId('template-row-untrusted').count()) === 0, 'the template is neither listed nor suggested');
  const afterDeletion = await kept(page);
  log(`   the wallet keeps: ${JSON.stringify(afterDeletion)}`);
  check(afterDeletion.templates.length === 0 && afterDeletion.suggested.length === 0 && afterDeletion.deleted.length === 1 && afterDeletion.deleted[0]?.stored === true, 'the device keeps only the mark, and a store confirmed it');

  begin('The page is opened again and reads the backup: the template is not offered again');
  await page.reload();
  await page.getByRole('link', { name: 'Apps' }).first().click();
  await pageShows(page.getByText('Add from a file'), 'the Apps list');
  // The backup is read once each time the page opens; its reading is waited for, at most 20 seconds.
  for (let attempt = 0; attempt < 40 && (await page.getByTestId('template-row-untrusted').count()) === 0; attempt++) await page.waitForTimeout(500);
  check((await page.getByTestId('template-row').count()) === 0 && (await page.getByTestId('template-row-untrusted').count()) === 0, 'after the backup is read, the template is neither listed nor suggested');

  begin('The owner adds the same template again from the file');
  await addFromFile(page);
  await page.getByRole('button', { name: 'Trust this template' }).click();
  await pageShows(page.getByText('Trusted since'), 'the template\'s screen');
  await chainShows(page.getByText('Stored', { exact: true }), 'the template to be stored in the backup again', LIMIT.read);
  const again = await kept(page);
  log(`   the wallet keeps: ${JSON.stringify(again)}`);
  check(again.templates.length === 1 && again.deleted.length === 0, 'trusted again, and the mark gone from the device');
  log('done');
} catch (error) {
  await failed(error);
  process.exitCode = 1;
} finally {
  await end();
  try {
    returnCoins();
  } catch (error) {
    log(`the run's key could not give back its coins: ${(error as Error).message}`);
  }
}
