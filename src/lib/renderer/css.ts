/**
 * CSS generation.
 *
 * One generator serves all three surfaces:
 *
 *   editor canvas  → `@container` queries, evaluated against the page frame
 *   preview        → `@container` queries, same frame mechanism
 *   published site → `@media` queries, evaluated against the real viewport
 *
 * Using container queries in the canvas is what makes responsive editing
 * truthful: a 390px frame really is 390px as far as the CSS is concerned, so
 * what a designer sees at "Mobile" is what ships. Everything else — the rules,
 * the cascade, the reset — is byte-for-byte identical between the two modes.
 */

import { BREAKPOINT_DEFS, BREAKPOINT_ORDER, type Breakpoint, type SceneNode, type StyleDecl, type Cre8Document } from '../document/types';

export type QueryMode = 'media' | 'container';

export const FRAME_CONTAINER = 'cre8';

/** Stable, collision-free class name for a node. */
export function nodeClass(id: string): string {
  return `c-${id}`;
}

const CAMEL_RE = /[A-Z]/g;

function cssProp(prop: string): string {
  return prop.replace(CAMEL_RE, (m) => `-${m.toLowerCase()}`);
}

/**
 * Declarations that aren't 1:1 with CSS. Kept tiny on purpose — the further
 * the document format drifts from real CSS, the more the published output can
 * diverge from the canvas.
 */
function expand(prop: string, value: string): [string, string][] {
  if (prop === 'textGradient') {
    return [
      ['background-image', value],
      ['-webkit-background-clip', 'text'],
      ['background-clip', 'text'],
      ['color', 'transparent'],
    ];
  }
  return [[cssProp(prop), value]];
}

export function declarationsToCss(styles: StyleDecl, indent = '  '): string {
  const out: string[] = [];
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === null || value === '') continue;
    for (const [name, resolved] of expand(prop, String(value))) {
      out.push(`${indent}${name}: ${resolved};`);
    }
  }
  return out.join('\n');
}

/** Inline-style object, used for the page frame's token variables. */
export function declarationsToStyleObject(styles: StyleDecl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === null || value === '') continue;
    for (const [name, resolved] of expand(prop, String(value))) out[name] = resolved;
  }
  return out;
}

function atRule(mode: QueryMode, breakpoint: Breakpoint): string | null {
  const def = BREAKPOINT_DEFS[breakpoint];
  if (def.maxWidth === null) return null;
  return mode === 'media'
    ? `@media (max-width: ${def.maxWidth}px)`
    : `@container ${FRAME_CONTAINER} (max-width: ${def.maxWidth}px)`;
}

/* --------------------------------------------------------------------------
 * Per-node rules, memoised
 * ----------------------------------------------------------------------- */

interface NodeRules {
  base: string;
  /** Keyed by breakpoint, base excluded. */
  responsive: Partial<Record<Breakpoint, string>>;
  states: string;
}

/**
 * Immer gives us a new object only for nodes that actually changed, so keying
 * the cache on node identity makes regeneration proportional to the size of
 * the edit rather than the size of the document.
 */
const ruleCache = new WeakMap<SceneNode, NodeRules>();

function rulesFor(node: SceneNode, selectorPrefix: string): NodeRules {
  const cached = ruleCache.get(node);
  if (cached) return cached;

  const selector = `${selectorPrefix}.${nodeClass(node.id)}`;
  const base = node.styles.desktop ?? {};
  const baseBody = declarationsToCss(base);

  const responsive: Partial<Record<Breakpoint, string>> = {};
  for (const bp of BREAKPOINT_ORDER) {
    if (bp === 'desktop') continue;
    const layer = node.styles[bp];
    if (!layer || Object.keys(layer).length === 0) continue;
    const body = declarationsToCss(layer, '    ');
    if (body) responsive[bp] = `  ${selector} {\n${body}\n  }`;
  }

  const stateChunks: string[] = [];
  for (const [state, layer] of Object.entries(node.states ?? {})) {
    if (!layer || Object.keys(layer).length === 0) continue;
    const body = declarationsToCss(layer as StyleDecl);
    if (body) stateChunks.push(`${selector}:${state} {\n${body}\n}`);
  }

  const rules: NodeRules = {
    base: baseBody ? `${selector} {\n${baseBody}\n}` : '',
    responsive,
    states: stateChunks.join('\n'),
  };
  ruleCache.set(node, rules);
  return rules;
}

/* --------------------------------------------------------------------------
 * Document stylesheet
 * ----------------------------------------------------------------------- */

export interface GenerateCssOptions {
  mode: QueryMode;
  /** Restrict output to these nodes (a single page + the components it uses). */
  nodeIds?: Iterable<string>;
  /** Prefix every selector, e.g. `.cre8-doc` to scope preview output. */
  scope?: string;
  /** Emit hover/active/focus rules. Off inside the editor canvas. */
  includeStates?: boolean;
}

export function generateNodeCss(
  nodes: Record<string, SceneNode>,
  options: GenerateCssOptions
): string {
  const prefix = options.scope ? `${options.scope} ` : '';
  const ids = options.nodeIds ? [...options.nodeIds] : Object.keys(nodes);

  const baseChunks: string[] = [];
  const stateChunks: string[] = [];
  const responsiveChunks: Partial<Record<Breakpoint, string[]>> = {};

  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const rules = rulesFor(node, prefix);
    if (rules.base) baseChunks.push(rules.base);
    if (options.includeStates !== false && rules.states) stateChunks.push(rules.states);
    for (const bp of BREAKPOINT_ORDER) {
      const chunk = rules.responsive[bp];
      if (!chunk) continue;
      (responsiveChunks[bp] ??= []).push(chunk);
    }
  }

  const out: string[] = [];
  if (baseChunks.length) out.push(baseChunks.join('\n'));
  if (stateChunks.length) out.push(stateChunks.join('\n'));

  // Narrow breakpoints emitted last so they win at equal specificity.
  for (const bp of BREAKPOINT_ORDER) {
    const chunks = responsiveChunks[bp];
    if (!chunks?.length) continue;
    const rule = atRule(options.mode, bp);
    out.push(rule ? `${rule} {\n${chunks.join('\n')}\n}` : chunks.join('\n'));
  }
  return out.join('\n\n');
}

/* --------------------------------------------------------------------------
 * Document reset
 * ----------------------------------------------------------------------- */

/**
 * The baseline every Cre8 page sits on, in the canvas and in production. Kept
 * deliberately small: it normalises the handful of defaults that make visual
 * editing unpredictable and nothing else.
 */
export const DOCUMENT_RESET = `
*, *::before, *::after { box-sizing: border-box; }
[data-cre8-root] { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
[data-cre8-root] h1, [data-cre8-root] h2, [data-cre8-root] h3,
[data-cre8-root] h4, [data-cre8-root] h5, [data-cre8-root] h6,
[data-cre8-root] p, [data-cre8-root] figure, [data-cre8-root] blockquote { margin: 0; }
[data-cre8-root] ul, [data-cre8-root] ol { margin: 0; padding-left: 1.25em; }
[data-cre8-root] img, [data-cre8-root] video, [data-cre8-root] svg { max-width: 100%; }
[data-cre8-root] img, [data-cre8-root] video { display: block; }
[data-cre8-root] a { color: inherit; text-decoration: none; }
[data-cre8-root] button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
[data-cre8-root] input, [data-cre8-root] textarea, [data-cre8-root] select { font: inherit; color: inherit; }
[data-cre8-root] textarea { resize: vertical; }
[data-cre8-root] :focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
`.trim();

/**
 * The reset a *published* document needs on top of `DOCUMENT_RESET`.
 *
 * In the editor the page root lives inside a frame element, which carries no
 * user-agent margin. Published, that same root sits directly in `<body>` —
 * which every browser gives `margin: 8px`. Without this a full-bleed section is
 * inset by 8px on every side and the page overflows its own viewport
 * horizontally, so the canvas and the published page disagree about where the
 * page begins.
 *
 * Deliberately separate from `DOCUMENT_RESET`, because that one is also
 * injected into the editor page, where `body` is the *editor's* body and must
 * not be touched.
 */
export const PUBLISHED_DOCUMENT_RESET = `
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 0; }
`.trim();

/** Styles for the placeholder shown where an image has no source yet. */
export const PLACEHOLDER_CSS = `
[data-cre8-placeholder] {
  display: flex; align-items: center; justify-content: center;
  background:
    repeating-linear-gradient(45deg, rgba(120,130,150,0.07) 0 8px, rgba(120,130,150,0.02) 8px 16px);
  color: rgba(90,100,120,0.75);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px; letter-spacing: 0.02em;
  min-height: 120px;
}
`.trim();

/* --------------------------------------------------------------------------
 * Whole-document stylesheet
 * ----------------------------------------------------------------------- */

export interface DocumentStylesheetOptions extends GenerateCssOptions {
  /** Emit `:root { --c-…: … }` from the theme. */
  themeVars?: string;
  rootSelector?: string;
  /**
   * The page root is the document body, not a frame inside one — so the
   * document's own margins have to go. True for published files; false for the
   * editor and preview, which render into a page that is not theirs.
   */
  standalone?: boolean;
}

export function generateStylesheet(
  doc: Cre8Document,
  options: DocumentStylesheetOptions
): string {
  const parts = options.standalone
    ? [PUBLISHED_DOCUMENT_RESET, DOCUMENT_RESET, PLACEHOLDER_CSS]
    : [DOCUMENT_RESET, PLACEHOLDER_CSS];
  if (options.themeVars) {
    parts.unshift(`${options.rootSelector ?? ':root'} {\n${options.themeVars}\n}`);
  }
  parts.push(generateNodeCss(doc.nodes, options));
  return parts.filter(Boolean).join('\n\n');
}

/** Minify enough to matter for published output without needing a dependency. */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*([{};:,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}
