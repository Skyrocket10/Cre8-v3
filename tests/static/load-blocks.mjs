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
      // that actually exist. It has no imports of its own.
      'src/lib/renderer/icons.ts',
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
