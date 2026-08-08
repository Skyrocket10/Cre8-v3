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
/**
 * The reset, written so it can never outrank a node's own styles.
 *
 * Every scope goes through `:where()`, which contributes nothing to
 * specificity. That matters more than it looks: a bare `[data-cre8-root] a`
 * scores (0,1,1) and beats the per-node class at (0,1,0), so a reset line as
 * innocent as `a { color: inherit }` silently wins over the colour the designer
 * set — a primary button renders with the page's text colour instead of its
 * own.
 *
 * With `:where()` these are type selectors at (0,0,1): they still establish the
 * baseline, and any node rule beats them.
 *
 * It also has to be *complete*. The canvas renders inside the editor app, whose
 * Tailwind preflight already zeroes margin, padding and border on everything;
 * a published page has no Tailwind at all. Anything the reset leaves to the
 * user-agent therefore renders one way in the editor and another way once
 * shipped — a border side with no explicit width computed to `0` on the canvas
 * and to `medium` (3px) in production. So the universal baseline is stated
 * here rather than inherited from whatever stylesheet happens to be nearby,
 * and every surface loads this file.
 *
 * The root's own `font-size` and `line-height` are part of that. The canvas
 * renders inside the editor's chrome, which runs at 12px because that is a
 * sensible size for a tool; a published page inherits the browser's 16px. Left
 * to inherit, every unstyled run of text and every `em` in the document — the
 * `1.25em` list indent below included — resolved to a different number on each
 * surface. Production is the truth, so both are pinned to it.
 */
export const DOCUMENT_RESET = `
*, *::before, *::after { box-sizing: border-box; }
:where([data-cre8-root]), :where([data-cre8-root]) *, :where([data-cre8-root]) *::before, :where([data-cre8-root]) *::after { margin: 0; padding: 0; border: 0 solid; }
:where([data-cre8-root]) { font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:where([data-cre8-root]) :is(ul, ol) { padding-left: 1.25em; }
:where([data-cre8-root]) :is(img, video, svg) { max-width: 100%; }
:where([data-cre8-root]) :is(img, video) { display: block; }
:where([data-cre8-root]) a { color: inherit; text-decoration: none; }
:where([data-cre8-root]) button { font: inherit; color: inherit; background: none; cursor: pointer; }
:where([data-cre8-root]) :is(input, textarea, select) { font: inherit; color: inherit; }
:where([data-cre8-root]) textarea { resize: vertical; }
:where([data-cre8-root]) :focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
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
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{};>])\s*/g, '$1')
      .replace(/\s*,\s*/g, ',')
      // Colons are collapsed only *inside* a declaration block. In a selector a
      // space before one is a descendant combinator, so squeezing it turns
      // `.card :focus-visible` into `.card:focus-visible` — a different rule
      // that matches the wrong element and fails silently.
      .replace(/\{([^{}]*)\}/g, (_, body: string) => `{${body.replace(/\s*:\s*/g, ':')}}`)
      .replace(/;}/g, '}')
      .trim()
  );
}
