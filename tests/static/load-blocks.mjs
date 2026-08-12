/**
 * Loads the block registry into plain Node.
 *
 * The block modules are TypeScript, but every import they make outside their
 * own directory is type-only — so `tsc` can transpile the eight of them on
 * their own, with no bundler and no extra dependency. That keeps these checks
 * runnable from a bare `npm install`, which matters: a test that needs a
 * toolchain nobody has installed is a test that never runs.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'node_modules/.cache/cre8-blocks');

export function loadBlocks() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const result = spawnSync(
    'npx',
    [
      'tsc',
      'src/lib/templates/blocks/index.ts',
      // The icon registry too, so a block can be checked against the names
      // that actually exist, and the element table, which knows which types
      // can hold children. Both import types only.
      'src/lib/renderer/icons.ts',
      'src/lib/document/schema.ts',
      // The style vocabulary: what every property is called and what edits it.
      // Data, and therefore checkable — the coverage claim it makes is the
      // audit that produced it, and a regex over the panel source is exactly
      // the way that audit used to have to be done.
      'src/lib/document/style-vocabulary.ts',
      // The upgrade every stored document goes through on load. It runs on
      // every project every time and would otherwise be exercised only by
      // accident, which is a poor arrangement for the one piece of code that
      // can silently discard somebody's work.
      'src/lib/document/migrate.ts',
      'src/lib/renderer/css.ts',
      // The two composite declarations, whose parsers are the whole of the
      // motion controls and the only part of them a function can check.
      'src/lib/renderer/motion.ts',
      // Every editor mutation, so component properties can be checked by
      // driving the real operations rather than by hand-writing the document
      // they are supposed to produce.
      'src/lib/document/operations.ts',
      // The publisher, so the checks can read a finished page rather than
      // reason about what one would contain.
      'src/lib/publishing/html.ts',
      'src/lib/publishing/routes.ts',
      // Every template. Eight of them ship, they are the first thing anybody
      // sees, and until this line nothing checked one of them.
      'src/lib/templates/index.ts',
      '--outDir',
      OUT,
      // Pinned so the emitted path is predictable no matter which files tsc
      // pulls in behind the entry point.
      '--rootDir',
      'src/lib',
      // CommonJS on purpose: it resolves extensionless relative imports, which
      // the source uses and ESM would reject.
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.error(result.stdout || result.stderr);
    throw new Error('could not transpile the block modules');
  }

  const require = createRequire(import.meta.url);
  return {
    ...require(path.join(OUT, 'templates/blocks/index.js')),
    ICON_NAMES: require(path.join(OUT, 'renderer/icons.js')).ICON_NAMES,
    ELEMENTS: require(path.join(OUT, 'document/schema.js')).ELEMENTS,
    canContain: require(path.join(OUT, 'document/schema.js')).canContain,
    isInteractive: require(path.join(OUT, 'document/schema.js')).isInteractive,
    readCase: require(path.join(OUT, 'document/schema.js')).readCase,
    anchorId: require(path.join(OUT, 'document/schema.js')).anchorId,
    vocabulary: require(path.join(OUT, 'document/style-vocabulary.js')),
    motion: require(path.join(OUT, 'renderer/motion.js')),
    // References, on their own: "one walk services all of them" is a claim
    // about a function, and the cleanup that was missing for years is the
    // reason to check it rather than infer it from a rendered page.
    everyRef: require(path.join(OUT, 'document/factory.js')).everyRef,
    pruneRefs: require(path.join(OUT, 'document/factory.js')).pruneRefs,
    danglingReads: require(path.join(OUT, 'document/factory.js')).danglingReads,
    migrateDocument: require(path.join(OUT, 'document/migrate.js')).migrateDocument,
    // Actions, on their own. The encoding a control's assignments reach the
    // markup in is a claim about a function, and the runtime that reads them
    // back is written in literals and cannot import it — so the two halves are
    // driven against each other rather than read side by side.
    actions: require(path.join(OUT, 'document/actions.js')),
    // The generator, so the checks can assert on real compiled selectors
    // rather than on a description of what they are supposed to be.
    buildTree: require(path.join(OUT, 'document/factory.js')).buildTree,
    finishDocument: require(path.join(OUT, 'document/factory.js')).finishDocument,
    // The jump resolver on its own. It is asked by three callers and its
    // answer now names a page, which is the whole of the cross-page jump —
    // a claim about a function, so checked as one.
    resolveNodeHref: require(path.join(OUT, 'renderer/element-model.js')).resolveNodeHref,
    canReparent: require(path.join(OUT, 'document/tree.js')).canReparent,
    wouldNestInteractive: require(path.join(OUT, 'document/tree.js')).wouldNestInteractive,
    jumpTargetsFor: require(path.join(OUT, 'document/tree.js')).jumpTargetsFor,
    generateNodeCss: require(path.join(OUT, 'renderer/css.js')).generateNodeCss,
    generateStylesheet: require(path.join(OUT, 'renderer/css.js')).generateStylesheet,
    parseCustomDeclarations: require(path.join(OUT, 'renderer/css.js')).parseCustomDeclarations,
    APPEAR_EFFECTS: require(path.join(OUT, 'renderer/css.js')).APPEAR_EFFECTS,
    // The whole site, not just a page: D3's gate is that the Worker's output
    // matches this one's byte for byte, and a site is sitemap and robots too.
    generateSite: require(path.join(OUT, 'publishing/html.js')).generateSite,
    // One subtree, rendered on its own — the only way to ask "are these two
    // sections the same thing" without borrowing the answer from the code
    // that decides it.
    renderNodeToHtml: require(path.join(OUT, 'publishing/html.js')).renderNodeToHtml,
    plan: require(path.join(OUT, 'publishing/routes.js')).plan,
    renderPage: onePage(require),
    createEmptyDocument: require(path.join(OUT, 'document/factory.js')).createEmptyDocument,
    createPage: require(path.join(OUT, 'document/factory.js')).createPage,
    hydrateDocument: require(path.join(OUT, 'document/factory.js')).hydrateDocument,
    buildInto: require(path.join(OUT, 'document/factory.js')).buildTree,
    PLACEHOLDER_MIN_HEIGHT: require(path.join(OUT, 'renderer/css.js')).PLACEHOLDER_MIN_HEIGHT,
    ops: require(path.join(OUT, 'document/operations.js')),
    components: require(path.join(OUT, 'document/components.js')),
    // Formatting, on its own rather than only through a rendered page: it is
    // the one part of the renderer whose whole claim is that two different
    // JavaScript engines agree, and that is a claim about a function.
    format: require(path.join(OUT, 'renderer/format.js')),
    boundProps: require(path.join(OUT, 'renderer/repeat.js')).boundProps,
    // The Test evaluator, for the same reason as the formatter: three answers
    // and an arbitration order are claims about a function.
    tests: require(path.join(OUT, 'renderer/test.js')),
    values: require(path.join(OUT, 'renderer/values.js')),
    TEMPLATES: require(path.join(OUT, 'templates/index.js')).TEMPLATES,
    // And the runtime itself, so the second implementation of the comparison
    // can be driven against the first rather than read alongside it.
    behaviour: require(path.join(OUT, 'runtime/behaviour.js')),
  };
}

/**
 * "Render this one page", which production no longer offers.
 *
 * Since D4 a page is not a file: a dynamic one becomes a file per record and a
 * paginated index becomes several, so `renderPage` takes a planned *output*
 * and the plan is the only thing that decides what exists. That is the right
 * shape for the publisher and an awkward one for a check that just wants the
 * markup of a fixture, so the adapter lives here — in the tests, where a
 * second way to answer "what does this page look like" cannot drift into the
 * product.
 *
 * It goes through the real plan rather than fabricating an output, so a check
 * written against a page still sees whatever routing decided about it.
 */
function onePage(require) {
  const html = require(path.join(OUT, 'publishing/html.js'));
  const routes = require(path.join(OUT, 'publishing/routes.js'));
  return (doc, page, options = {}) => {
    const outputs = routes.plan(doc, options.records);
    const mine = outputs.filter((output) => output.page.id === page.id);
    if (!mine.length) {
      throw new Error(`“${page.name}” publishes no files — there is nothing to render`);
    }
    return html.renderPage(doc, mine[0], options, outputs);
  };
}

/** Every node in a spec tree, with the path taken to reach it. */
export function* walk(spec, trail = []) {
  const here = [...trail, spec.name ?? spec.type];
  yield { node: spec, path: here.join(' › ') };
  for (const child of spec.children ?? []) yield* walk(child, here);
}

/** Every style layer on a node: base, each breakpoint, each interaction state. */
export function* layers(node) {
  if (node.styles) yield { where: 'base', styles: node.styles };
  for (const [bp, styles] of Object.entries(node.responsive ?? {})) {
    if (styles) yield { where: bp, styles };
  }
  for (const [state, styles] of Object.entries(node.states ?? {})) {
    if (styles) yield { where: `:${state}`, styles };
  }
}
