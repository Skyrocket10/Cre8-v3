/**
 * Runs every browser suite in sequence against a Worker.
 *
 * Sequential on purpose — they each sign up, publish and hit the same D1 and
 * R2, and running them in parallel turns a real failure into a race nobody can
 * reproduce.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['fidelity', 'editor and published render the same'],
  ['blocks', 'every block, on its own, at three widths'],
  ['panel', 'the Insert panel at library scale'],
  ['nav', 'page navigation inside a published site'],
  ['native', 'native primitives behave without a runtime'],
  ['tables', 'tabular markup survives the parser'],
  ['behaviour', 'switches work, and the CSS does the work'],
  ['data', 'conditions on the visit, resolved before the first paint'],
  ['repeat', 'a bound list, on the canvas and in the file'],
  ['worker-publish', 'the Worker publishes the same bytes the browser would'],
  ['routes', 'a collection becomes pages, and every one is reachable'],
  ['collections', 'the whole data layer, driven from the editor'],
  ['republish', 'the site follows its records, and writes only what moved'],
  ['history', 'every publish is kept, and a design can be put back'],
  ['forms', 'published forms reach the submissions endpoint'],
  ['assets', 'images survive publish and export'],
  ['bodyreset', 'the published page starts at the edge'],
  ['borders', 'per-side border widths'],
  ['e2e', 'accounts, teams, roles, publishing'],
  ['security', 'authorisation holds under a hostile client'],
  ['origin', 'published sites cannot reach the editor session'],
  ['local', 'the same build works with no backend'],
];

const only = process.argv.slice(2);
const selected = only.length ? SUITES.filter(([n]) => only.includes(n)) : SUITES;

const response = await fetch(`${APP}/signin`).catch(() => null);
if (!response?.ok) {
  console.error(
    `No Worker answering at ${APP}.\n` +
      'Start one with `npm run preview`, or point CRE8_TEST_URL at a deployment.'
  );
  process.exit(2);
}

const failures = [];
for (const [name, description] of selected) {
  console.log(`\n${'─'.repeat(64)}\n${name} — ${description}\n${'─'.repeat(64)}`);
  const result = spawnSync(process.execPath, [path.join(HERE, `${name}.mjs`)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) failures.push(name);
}

console.log(`\n${'═'.repeat(64)}`);
if (failures.length) {
  console.log(`${selected.length - failures.length}/${selected.length} suites passed`);
  console.log(`failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`all ${selected.length} suites passed`);
