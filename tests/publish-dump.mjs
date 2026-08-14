/*
 * Every template published in full, with deterministic node ids.
 *
 * `uid()` is random, so two builds of one template never share a class name
 * and a raw diff of two revisions is entirely noise. Canonicalising the ids
 * afterwards nearly worked and kept inventing differences of its own — a
 * four-character prefix shared by two nodes on different pages of one template
 * collapses to a single name, and whether that happens is luck.
 *
 * So the randomness is removed at the source instead. `uid` is read off its
 * module at call time, so replacing the export before anything builds makes
 * every id a counter — and then the two dumps are comparable byte for byte
 * with no post-processing to be wrong about.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

/*
 * Usage, and why it takes a path:
 *
 *     git worktree add /tmp/base <ref>
 *     ln -s "$PWD/node_modules" /tmp/base/node_modules
 *     node tests/publish-dump.mjs "$PWD"   > after.txt
 *     node tests/publish-dump.mjs /tmp/base > before.txt
 *     cmp before.txt after.txt
 *
 * Written for the change that widened `StyleRule.when` from a list of
 * conditions to a `Test`, whose whole claim was that nothing a designer had
 * already built would publish one byte differently. That is not a claim a
 * committed baseline can carry — a baseline goes stale the first time somebody
 * legitimately improves a template — so it is checked between two revisions,
 * on demand, and the tool lives here so the next such change need not rebuild
 * it.
 */
const here = process.argv[2] ?? process.cwd();
const require = createRequire(path.join(here, 'package.json'));
const { loadBlocks } = await import(path.join(here, 'tests/static/load-blocks.mjs'));

// Transpiling first, so the emitted modules exist to be patched.
const loaded = loadBlocks();
const idModule = require(path.join(here, 'node_modules/.cache/cre8-blocks/document/id.js'));
let counter = 0;
idModule.uid = () => `id${String(counter++).padStart(6, '0')}`;

const { TEMPLATES, generateSite } = loaded;
const out = [];
for (const template of TEMPLATES) {
  counter = 0;
  const site = generateSite(template.build(), { origin: 'https://x.test' });
  for (const file of site.files) {
    out.push(`===== ${template.id} :: ${file.path} =====\n${file.contents}`);
  }
}
process.stdout.write(out.join('\n'));
