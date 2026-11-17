// Writes the record of a stage's acceptance tests: for each test number of the proposal's section 21,
// the tests that carry it and whether they passed.
//
// usage: node scripts/test-record.mjs <stage> <first>-<last> [<first>-<last> ...] > docs/results/stage-<n>.md
//        e.g. node scripts/test-record.mjs 1 CT01-CT15 AD01-AD13 FE01-FE03
//
// A test carries a number when its title starts with it ("AD04: ...").
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const [stage, ...ranges] = process.argv.slice(2);
if (stage === undefined || ranges.length === 0) {
  console.error('usage: node scripts/test-record.mjs <stage> <first>-<last> ...');
  process.exit(2);
}
const wanted = ranges.flatMap((range) => {
  const match = /^([A-Z]{2})(\d{2})-\1(\d{2})$/.exec(range);
  if (match === null) throw new Error(`not a range of test numbers: ${range}`);
  const [, group, first, last] = match;
  return Array.from({ length: Number(last) - Number(first) + 1 }, (_, n) => `${group}${String(Number(first) + n).padStart(2, '0')}`);
});

// vitest writes its report to a file. It exits with an error when a test fails; the report is written all the same.
const reportFile = join(mkdtempSync(join(tmpdir(), 'test-record-')), 'report.json');
try {
  execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`], { stdio: 'ignore' });
} catch {
  // read below
}
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
rmSync(dirname(reportFile), { recursive: true });

const byNumber = new Map(wanted.map((id) => [id, []]));
for (const file of report.testResults) {
  for (const test of file.assertionResults) {
    const id = /^([A-Z]{2}\d{2}):/.exec(test.title)?.[1];
    if (id !== undefined && byNumber.has(id)) byNumber.get(id).push({ file: relative(process.cwd(), file.name), title: test.title.replace(/^[A-Z]{2}\d{2}: /, ''), status: test.status });
  }
}

const proposal = readFileSync('Grandmas_Wallet_Architecture_Proposal_v0.4.md', 'utf8');
const stated = (id) => new RegExp(`^\\| ${id} \\| (.+?) \\| (.+?) \\|$`, 'm').exec(proposal);
const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';

const lines = [
  `# Stage ${stage}: record of the acceptance tests`,
  '',
  `Made by \`node scripts/test-record.mjs ${process.argv.slice(2).join(' ')}\` at revision \`${revision}\`${dirty ? ' with changes not yet committed' : ''}.`,
  `All tests of the repository: ${report.numPassedTests} passed, ${report.numFailedTests} failed, of ${report.numTotalTests}.`,
  '',
  '| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |',
  '| --- | --- | --- | --- | --- |',
];
let open = 0;
for (const [id, tests] of byNumber) {
  const [, what = '?', expected = '?'] = stated(id) ?? [];
  const passed = tests.length > 0 && tests.every((test) => test.status === 'passed');
  if (!passed) open += 1;
  const list = tests.length === 0 ? 'none' : tests.map((test) => `${test.title} (\`${test.file}\`)${test.status === 'passed' ? '' : ` **${test.status}**`}`).join('<br>');
  lines.push(`| ${id} | ${what} | ${expected} | ${list} | ${tests.length === 0 ? '**open**' : passed ? 'passed' : '**failed**'} |`);
}
lines.push('', open === 0 ? 'Every number has at least one test, and all of them pass.' : `${open} of ${byNumber.size} numbers are open or failing.`);
console.log(lines.join('\n'));
process.exitCode = open === 0 ? 0 : 1;
