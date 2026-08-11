/**
 * The block authoring kit.
 *
 * Blocks are plain `NodeSpec` trees — the exact same structure the editor
 * produces when you build something by hand. There is no privileged "template
 * element": a block is data, which is what will let an AI emit one later.
 *
 * This module exists so that stays true at scale. A library of a hundred blocks
 * is mostly the same grid, the same card and the same type scale repeated, and
 * repeating them by hand is how a design system drifts: one card gets 26px of
 * padding, the next gets 24px, and nobody can say which is right. Everything
 * recurring lives here once.
 *
 * Two rules for anything added below.
 *
 * **Tokens only.** Every colour, space, radius and font resolves through a
 * theme variable, so an inserted block adopts the project's brand instead of
 * importing a second one. A raw hex here becomes a raw hex in fifty blocks.
 *
 * **Responsive by default.** Helpers that lay out in more than one column carry
 * their own narrow-width behaviour. A block that only works at 1440 is a bug
 * the designer discovers after publishing.
 */

import type { NodeSpec } from '../../document/factory';
import type { NodeProps, ResponsiveStyles, StyleDecl } from '../../document/types';

/* --------------------------------------------------------------------------
 * Links
 * ----------------------------------------------------------------------- */

/**
 * A navigation or footer link.
 *
 * `href` is optional because most of these labels are section names with
 * nowhere to go — a one-page template's "Features" link has no destination.
 * A template that *does* have the page passes `pageRef('pricing')`, which is
 * resolved to a real reference once the document exists.
 */
export interface BlockLink {
  label: string;
  href?: string;
}

export const asLink = (link: string | BlockLink): BlockLink =>
  typeof link === 'string' ? { label: link } : link;

/* --------------------------------------------------------------------------
 * Style shorthands
 * ----------------------------------------------------------------------- */

export const pad = (top: string, right = top, bottom = top, left = right): StyleDecl => ({
  paddingTop: top,
  paddingRight: right,
  paddingBottom: bottom,
  paddingLeft: left,
});

export const radius = (r: string): StyleDecl => ({
  borderTopLeftRadius: r,
  borderTopRightRadius: r,
  borderBottomRightRadius: r,
  borderBottomLeftRadius: r,
});

export const border = (width = '1px', color = 'var(--c-border)'): StyleDecl => ({
  borderStyle: 'solid',
  borderTopWidth: width,
  borderRightWidth: width,
  borderBottomWidth: width,
  borderLeftWidth: width,
  borderColor: color,
});

/** One edge only — headers, footers and dividers want a single rule. */
export const borderSide = (
  side: 'Top' | 'Right' | 'Bottom' | 'Left',
  width = '1px',
  color = 'var(--c-border)'
): StyleDecl => ({
  borderStyle: 'solid',
  [`border${side}Width`]: width,
  borderColor: color,
});

/** A tint of a theme colour. Keeps `color-mix` spelling consistent. */
export const tint = (token: string, percent: number): string =>
  `color-mix(in srgb, ${token} ${percent}%, transparent)`;

/* --------------------------------------------------------------------------
 * Type scale
 *
 * Blocks pick a step; they do not invent sizes. Each step that changes at
 * narrow widths ships its responsive pair alongside it.
 * ----------------------------------------------------------------------- */

export const EYEBROW: StyleDecl = {
  fontSize: '12px',
  fontWeight: '600',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--c-primary)',
};

export const DISPLAY: StyleDecl = {
  fontSize: '64px',
  fontWeight: '620',
  lineHeight: '1.04',
  letterSpacing: '-0.033em',
};

export const DISPLAY_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '48px' },
  mobile: { fontSize: '34px', letterSpacing: '-0.022em' },
};

export const TITLE: StyleDecl = {
  fontSize: '40px',
  fontWeight: '600',
  lineHeight: '1.14',
  letterSpacing: '-0.026em',
};

export const TITLE_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '34px' },
  mobile: { fontSize: '27px' },
};

export const SUBTITLE: StyleDecl = {
  fontSize: '24px',
  fontWeight: '600',
  lineHeight: '1.26',
  letterSpacing: '-0.021em',
};

export const SUBTITLE_RESPONSIVE: ResponsiveStyles = { mobile: { fontSize: '20px' } };

/** The heading inside a card — smaller than a section title, still a heading. */
export const CARD_TITLE: StyleDecl = {
  fontSize: '17.5px',
  fontWeight: '600',
  letterSpacing: '-0.014em',
  lineHeight: '1.3',
};

/**
 * Body steps set size only.
 *
 * `schema.ts` already gives each element type its reading measure — 1.62 for a
 * paragraph, 1.5 for a span — and repeating that here would make two sources of
 * truth for the same number. A block that genuinely wants a different measure
 * says so at the call site.
 */
export const LEAD: StyleDecl = { fontSize: '19px', lineHeight: '1.58' };
export const LEAD_RESPONSIVE: ResponsiveStyles = { mobile: { fontSize: '16.5px' } };

export const BODY: StyleDecl = { fontSize: '17.5px' };
export const BODY_RESPONSIVE: ResponsiveStyles = { mobile: { fontSize: '16px' } };

export const SMALL: StyleDecl = { fontSize: '14.5px' };
export const CAPTION: StyleDecl = { fontSize: '12.5px' };

/* --------------------------------------------------------------------------
 * Responsive column patterns
 * ----------------------------------------------------------------------- */

/**
 * Weighted columns that can actually shrink.
 *
 * A bare `1fr` track is `minmax(auto, 1fr)`, and `auto` floors at the content's
 * min-content width — so a track holding an image with an aspect ratio, or a
 * long unbroken word, refuses to go below it and steals width from its
 * neighbour. A 50/50 split silently renders as 35/65 and nothing overflows, so
 * no width check notices.
 *
 * It bites hardest where it looks safest: even a *single* `1fr` column will
 * grow past the viewport if one child demands it — an image with a min-height
 * and a 16/9 ratio is asking for 600px of width whatever the screen says. So
 * every column the kit emits is spelled `minmax(0, …)`, and the narrow-width
 * resets below use this too.
 */
export const cols = (...weights: number[]): string =>
  weights.map((w) => `minmax(0, ${w}fr)`).join(' ');

export const ONE_COLUMN: ResponsiveStyles = { mobile: { gridTemplateColumns: cols(1) } };

export const TWO_TO_ONE: ResponsiveStyles = {
  tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  mobile: { gridTemplateColumns: cols(1) },
};

/** Side-by-side that becomes stacked. For split heroes and alternating rows. */
export const SPLIT_TO_STACK: ResponsiveStyles = {
  tablet: { gridTemplateColumns: cols(1) },
};

/* --------------------------------------------------------------------------
 * Structure
 * ----------------------------------------------------------------------- */

/**
 * Omit an empty responsive map instead of storing `{}` on every node.
 *
 * `createNode` spreads it into `styles`, so the two are equivalent to the
 * renderer — but the empty object is saved to D1 on every node of every block,
 * and it turns every document diff into noise.
 */
const rsp = (responsive: ResponsiveStyles): { responsive?: ResponsiveStyles } =>
  Object.keys(responsive).length > 0 ? { responsive } : {};

export const section = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'section',
  name,
  styles: { ...pad('112px', '24px'), gap: '0px', ...styles },
  responsive: {
    tablet: { paddingTop: '80px', paddingBottom: '80px', ...responsive.tablet },
    mobile: {
      paddingTop: '56px',
      paddingBottom: '56px',
      paddingLeft: '20px',
      paddingRight: '20px',
      ...responsive.mobile,
    },
  },
  children,
});

export const container = (
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'container',
  name: 'Container',
  styles: { gap: '48px', ...styles },
  ...rsp(responsive),
  children,
});

export const stack = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({ type: 'stack', name, styles, ...rsp(responsive), children });

/** A vertical stack. The plain `stack` is a row, which is easy to forget. */
export const column = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec =>
  stack(name, children, { flexDirection: 'column', alignItems: 'flex-start', ...styles }, responsive);

export const frame = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({ type: 'frame', name, styles, ...rsp(responsive), children });

/**
 * A grid. `columns` takes a count — the `repeat(n, minmax(0, 1fr))` spelling
 * matters, because a bare `1fr` track refuses to shrink below its content and
 * a long word in one cell pushes the whole row wider than the viewport.
 */
export const grid = (
  name: string,
  columns: number | string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = typeof columns === 'number' && columns >= 3
    ? TWO_TO_ONE
    : ONE_COLUMN
): NodeSpec => ({
  type: 'grid',
  name,
  styles: {
    gridTemplateColumns:
      typeof columns === 'number' ? `repeat(${columns}, minmax(0, 1fr))` : columns,
    gap: '20px',
    ...styles,
  },
  ...rsp(responsive),
  children,
});

/** A two-column split that stacks. The shape most sections want. */
export const splitGrid = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  weights: [number, number] = [1, 1]
): NodeSpec =>
  grid(name, cols(...weights), children, { gap: '56px', alignItems: 'center', ...styles }, {
    tablet: { gridTemplateColumns: cols(1), gap: '36px' },
  });

export const divider = (styles: StyleDecl = {}): NodeSpec => ({
  type: 'divider',
  name: 'Divider',
  styles,
});

export const spacer = (height: string): NodeSpec => ({
  type: 'spacer',
  name: 'Spacer',
  styles: { height },
});

/** The bordered surface most content sits on. */
export const card = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'frame',
  name,
  styles: {
    ...pad('26px'),
    gap: '14px',
    ...radius('var(--r-lg)'),
    ...border('1px', 'var(--c-border)'),
    backgroundColor: 'var(--c-background)',
    ...styles,
  },
  ...rsp(responsive),
  children,
});

/** A card that lifts on hover. For anything clickable. */
export const liftCard = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  ...card(
    name,
    children,
    {
      transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
      ...styles,
    },
    responsive
  ),
  states: {
    hover: {
      borderColor: `color-mix(in srgb, var(--c-primary) 40%, var(--c-border))`,
      boxShadow: 'var(--sh-md)',
      transform: 'translateY(-2px)',
    },
  },
});

/* --------------------------------------------------------------------------
 * Content
 * ----------------------------------------------------------------------- */

export const heading = (
  text: string,
  level: number,
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'heading',
  name: text.slice(0, 28),
  props: { text, level },
  styles: { color: 'var(--c-text)', ...styles },
  ...rsp(responsive),
});

export const paragraph = (
  text: string,
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'paragraph',
  name: 'Paragraph',
  props: { text },
  styles: { color: 'var(--c-muted)', ...styles },
  ...rsp(responsive),
});

export const label = (text: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'text',
  name: text.slice(0, 24) || 'Text',
  props: { text },
  styles,
});

export const button = (
  text: string,
  variant: 'primary' | 'secondary' | 'ghost' = 'primary',
  href = '#'
): NodeSpec => ({
  type: 'button',
  name: `${text} button`,
  props: { label: text, href },
  styles:
    variant === 'primary'
      ? {}
      : variant === 'secondary'
        ? {
            backgroundColor: 'transparent',
            color: 'var(--c-text)',
            ...border('1px', 'var(--c-border)'),
          }
        : { backgroundColor: 'transparent', color: 'var(--c-text)' },
  states:
    variant === 'primary'
      ? { hover: { backgroundColor: 'var(--c-secondary)' } }
      : { hover: { backgroundColor: 'var(--c-surface)' } },
});

export const textLink = (text: string, href = '#', styles: StyleDecl = {}): NodeSpec => ({
  type: 'link',
  name: text.slice(0, 24) || 'Link',
  props: { text, href },
  styles: { fontSize: '14.5px', color: 'var(--c-muted)', ...styles },
  states: { hover: { color: 'var(--c-text)' } },
});

export const icon = (name: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'icon',
  name: `${name} icon`,
  props: { name, strokeWidth: 1.75 },
  styles,
});

/**
 * An image slot.
 *
 * `alt` is written as an instruction rather than left empty on purpose: the
 * designer sees it in the inspector, and a prompt is far likelier to be
 * replaced with something true than an empty field is to be filled in.
 */
export const media = (
  alt: string,
  ratio = '16 / 10',
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'image',
  name: 'Image',
  props: { alt },
  styles: {
    width: '100%',
    aspectRatio: ratio,
    objectFit: 'cover',
    ...radius('var(--r-lg)'),
    ...styles,
  },
  ...rsp(responsive),
});

/** The gradient stand-in used wherever a real person's photo will go. */
export const avatar = (size = '34px', styles: StyleDecl = {}): NodeSpec => ({
  type: 'frame',
  name: 'Avatar',
  styles: {
    width: size,
    height: size,
    ...pad('0px'),
    ...radius('var(--r-full)'),
    backgroundImage: 'linear-gradient(135deg, var(--c-primary), var(--c-accent))',
    flexShrink: '0',
    ...styles,
  },
});

export const badge = (text: string, tone: 'primary' | 'subtle' = 'primary'): NodeSpec =>
  label(text, {
    fontSize: '10.5px',
    fontWeight: '650',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    ...(tone === 'primary'
      ? { color: 'var(--c-on-primary)', backgroundColor: 'var(--c-primary)' }
      : { color: 'var(--c-primary)', backgroundColor: tint('var(--c-primary)', 12) }),
    ...pad('3px', '8px'),
    ...radius('var(--r-full)'),
  });

/** A neutral pill — categories, tags, filters. */
export const chip = (text: string, href?: string): NodeSpec => {
  const styles: StyleDecl = {
    fontSize: '13px',
    color: 'var(--c-muted)',
    backgroundColor: 'var(--c-surface)',
    ...border('1px', 'var(--c-border)'),
    ...pad('5px', '11px'),
    ...radius('var(--r-full)'),
  };
  return href ? textLink(text, href, styles) : label(text, styles);
};

/** The rounded square that holds a feature icon. */
export const iconBadge = (name: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'frame',
  name: 'Icon badge',
  styles: {
    width: '38px',
    height: '38px',
    ...pad('0px'),
    ...radius('var(--r-md)'),
    backgroundColor: tint('var(--c-primary)', 11),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    ...styles,
  },
  children: [icon(name, { width: '19px', height: '19px', color: 'var(--c-primary)' })],
});

/** A ticked list. Pricing features, hero reassurance, comparison columns. */
export const bullets = (items: string[], glyph = 'check', name = 'List'): NodeSpec => ({
  type: 'stack',
  name,
  styles: { flexDirection: 'column', alignItems: 'flex-start', gap: '11px', width: '100%' },
  children: items.map((text) =>
    stack(
      text.slice(0, 24),
      [
        icon(glyph, {
          width: '15px',
          height: '15px',
          color: 'var(--c-primary)',
          flexShrink: '0',
        }),
        label(text, { ...SMALL, color: 'var(--c-muted)' }),
      ],
      { gap: '9px', alignItems: 'center' }
    )
  ),
});

/** One numbered step of a process block. */
export const step = (n: number, title: string, body: string): NodeSpec =>
  column(
    `Step ${n}`,
    [
      frame(
        'Step number',
        [
          label(String(n), {
            fontSize: '15px',
            fontWeight: '650',
            color: 'var(--c-primary)',
          }),
        ],
        {
          width: '38px',
          height: '38px',
          ...pad('0px'),
          ...radius('var(--r-full)'),
          backgroundColor: tint('var(--c-primary)', 11),
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: '0',
        }
      ),
      heading(title, 3, CARD_TITLE),
      paragraph(body, SMALL),
    ],
    { gap: '14px' }
  );

/** Eyebrow, title and standfirst. Every section that needs an intro uses this. */
export const sectionHeader = (
  eyebrow: string,
  title: string,
  body: string,
  align: 'center' | 'start' = 'center'
): NodeSpec =>
  stack(
    'Section header',
    [
      label(eyebrow, EYEBROW),
      heading(title, 2, { ...TITLE, maxWidth: '24ch', textWrap: 'balance' }, TITLE_RESPONSIVE),
      paragraph(body, { ...BODY, maxWidth: '58ch' }, BODY_RESPONSIVE),
    ],
    {
      flexDirection: 'column',
      alignItems: align === 'center' ? 'center' : 'flex-start',
      textAlign: align === 'center' ? 'center' : 'left',
      gap: '16px',
      width: '100%',
    }
  );

/* --------------------------------------------------------------------------
 * Tables
 *
 * Real table markup, not a grid of boxes that looks like one. The difference
 * is inaudible on screen and total in a screen reader: a `<td>` knows which
 * column header describes it, so a blind user hears "Bandwidth, Team, 1 TB"
 * instead of the bare word "1 TB" with nothing to attach it to.
 * ----------------------------------------------------------------------- */

/**
 * A cell.
 *
 * Takes text or nodes, because half of what goes in a real table is a badge,
 * a tick or an avatar. Text is wrapped in a `text` node rather than set as a
 * prop on the cell so it can be selected and edited on its own, the same as
 * text anywhere else.
 */
export const cell = (
  content: string | NodeSpec | NodeSpec[],
  options: {
    header?: boolean;
    scope?: 'col' | 'row';
    colSpan?: number;
    rowSpan?: number;
    styles?: StyleDecl;
    responsive?: ResponsiveStyles;
  } = {}
): NodeSpec => {
  const children =
    typeof content === 'string'
      ? [label(content, { fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' })]
      : Array.isArray(content)
        ? content
        : [content];

  return {
    type: 'tableCell',
    name:
      typeof content === 'string' ? content.slice(0, 24) || 'Cell' : options.header ? 'Header' : 'Cell',
    props: {
      ...(options.header ? { header: true, scope: options.scope ?? 'col' } : {}),
      ...(options.colSpan && options.colSpan > 1 ? { colSpan: options.colSpan } : {}),
      ...(options.rowSpan && options.rowSpan > 1 ? { rowSpan: options.rowSpan } : {}),
    },
    styles: {
      ...(options.header
        ? { fontWeight: '600', color: 'var(--c-text)', fontSize: '12.5px' }
        : {}),
      ...options.styles,
    },
    ...rsp(options.responsive ?? {}),
    children,
  };
};

export const tableRow = (
  name: string,
  cells: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({ type: 'tableRow', name, styles, ...rsp(responsive), children: cells });

/**
 * A table, inside the horizontal scroller it needs.
 *
 * A table does not reflow: six columns are six columns at 390px too, and the
 * only honest options are to shrink the text until it is unreadable or to let
 * the table scroll on its own. Scrolling is the one that still works, so it
 * ships with the table rather than being left for the designer to remember.
 */
export const table = (
  name: string,
  rows: NodeSpec[],
  options: {
    caption?: string;
    minWidth?: string;
    styles?: StyleDecl;
    responsive?: ResponsiveStyles;
  } = {}
): NodeSpec =>
  frame(
    `${name} scroller`,
    [
      {
        type: 'table',
        name,
        props: options.caption ? { caption: options.caption } : {},
        styles: { minWidth: options.minWidth ?? '560px', ...options.styles },
        ...rsp(options.responsive ?? {}),
        children: rows,
      },
    ],
    { ...pad('0px'), width: '100%', overflowX: 'auto' },
    // Nothing changes about the table when narrow — the scroller is the
    // response. Stated so the check that every block declares narrow
    // behaviour is answered deliberately rather than by omission.
    { mobile: { width: '100%' } }
  );

/* --------------------------------------------------------------------------
 * Popovers
 * ----------------------------------------------------------------------- */

/** Where a panel opens, relative to the button that opens it. */
export interface AnchorPlacement {
  to: 'below' | 'above';
  /** Which edge lines up with the button's. `start` is the left one in LTR. */
  align?: 'start' | 'end';
  gap?: string;
}

/**
 * The styles that put a panel under its button, and undo the centring.
 *
 * A popover's element defaults are `inset: 0` with four auto margins, which is
 * how a top-layer box centres itself and exactly right for a modal. A menu is
 * not a modal, and every one in this library was inheriting that: the account
 * menu opened in the middle of the viewport. Undoing it takes all four margins
 * and the inset, not just the two you would think of, which is the sort of
 * thing worth writing once.
 *
 * `position-try-fallbacks` is not optional polish. Without it an account menu
 * in the top-right corner hangs off the edge of the page, because the browser
 * places it where it was told and stops.
 */
export const anchorStyles = ({ to, align = 'start', gap = '8px' }: AnchorPlacement): StyleDecl => ({
  position: 'fixed',
  inset: 'auto',
  marginTop: to === 'below' ? gap : '0px',
  marginBottom: to === 'above' ? gap : '0px',
  marginLeft: '0px',
  marginRight: '0px',
  // Logical, so a right-to-left site puts its menus on the side they belong
  // on with nobody editing a template. `span-inline-end` reads oddly and means
  // "spread away from the anchor's start edge", which lines the two up on the
  // left; `span-inline-start` lines them up on the right.
  positionArea: `${to === 'below' ? 'block-end' : 'block-start'} ${
    align === 'end' ? 'span-inline-start' : 'span-inline-end'
  }`,
  positionTryFallbacks: 'flip-block, flip-inline',
});

/**
 * A panel the browser opens, and the button that opens it.
 *
 * Everything a hand-rolled dropdown has to reimplement — stacking above the
 * rest of the page, closing on Escape, closing on a click outside, putting
 * focus back on the button afterwards — is what `[popover]` already is. The
 * published page ships no script for any of it.
 *
 * `anchor` is what makes one a *menu* rather than a modal. The alternative —
 * an absolutely positioned panel inside a `position: relative` nav item —
 * gives up the top layer, and with it the light dismiss, the Escape key and
 * the immunity from being clipped by the navbar's own stacking context.
 */
export const popover = (
  name: string,
  children: NodeSpec[],
  options: {
    mode?: 'auto' | 'manual';
    anchor?: AnchorPlacement;
    styles?: StyleDecl;
    responsive?: ResponsiveStyles;
  } = {}
): NodeSpec => ({
  type: 'popover',
  name,
  props: {
    popoverMode: options.mode ?? 'auto',
    // Read by the renderer, which mints the pair of names tying the panel to
    // its button and marks the panel for the no-anchor-positioning fallback.
    ...(options.anchor ? { anchorTo: options.anchor.to } : {}),
  },
  styles: { ...(options.anchor ? anchorStyles(options.anchor) : {}), ...options.styles },
  ...rsp(options.responsive ?? {}),
  children,
});

/**
 * A dialog: the same top-layer surface, in the element that says so.
 *
 * Announced as a dialog and read out by its label, which a `div` never is.
 * Opened by the popover attribute rather than `showModal()`, so the page
 * still ships no script — at the price of the page behind staying reachable
 * by keyboard, which is the one thing only `showModal()` can fix.
 */
export const dialog = (
  name: string,
  label: string,
  children: NodeSpec[],
  options: { mode?: 'auto' | 'manual'; styles?: StyleDecl; responsive?: ResponsiveStyles } = {}
): NodeSpec => ({
  type: 'dialog',
  name,
  props: { popoverMode: options.mode ?? 'auto', label },
  styles: options.styles ?? {},
  ...rsp(options.responsive ?? {}),
  children,
});

/**
 * A button wired to a popover.
 *
 * `target` is the popover's or dialog's *name*; `buildTree` resolves those to
 * node ids once the tree exists, because a NodeSpec has no id to point at yet.
 */
export const popoverButton = (
  text: string,
  target: string,
  options: {
    action?: 'toggle' | 'show' | 'hide';
    variant?: 'primary' | 'secondary' | 'ghost';
    styles?: StyleDecl;
  } = {}
): NodeSpec => {
  const base = button(text, options.variant ?? 'secondary');
  return {
    ...base,
    props: {
      label: text,
      ...(options.action && options.action !== 'toggle' ? { popoverAction: options.action } : {}),
    },
    // By name, because a spec has no ids. `buildTree` turns it into a real
    // reference once every node in the block exists.
    refs: { popover: target },
    styles: { ...base.styles, ...options.styles },
  };
};

/* --------------------------------------------------------------------------
 * Native form controls
 * ----------------------------------------------------------------------- */

/**
 * A named group of controls.
 *
 * The `<legend>` is the whole reason to reach for this: without it a screen
 * reader announces "Monthly" with no idea what question it answers.
 */
export const fieldset = (
  legendText: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'fieldset',
  name: legendText,
  props: { legend: legendText },
  styles,
  ...rsp(responsive),
  children,
});

export const slider = (
  name: string,
  options: { min?: number; max?: number; step?: number; value?: number; styles?: StyleDecl } = {}
): NodeSpec => ({
  type: 'range',
  name: `${name} slider`,
  props: {
    name,
    min: options.min ?? 0,
    max: options.max ?? 100,
    step: options.step ?? 1,
    value: options.value ?? 50,
  },
  styles: options.styles ?? {},
});

/**
 * A slider wired to a continuous value rather than to a form.
 *
 * The `name` is dropped on purpose: this one is a control, not a field, and a
 * comparison position has no business arriving in somebody's contact-form
 * submission. `aria-label` earns its keep here for the same reason a form
 * field would have a visible label and this cannot — the handle *is* the
 * divider, so there is nowhere to put one.
 */
export const valueSlider = (
  name: string,
  drives: string,
  value: number,
  options: { min?: number; max?: number; step?: number; label?: string; styles?: StyleDecl } = {}
): NodeSpec => ({
  type: 'range',
  name,
  props: {
    drives,
    min: options.min ?? 0,
    max: options.max ?? 100,
    step: options.step ?? 1,
    // The same number the group holds, and required rather than defaulted so
    // it cannot be forgotten. With no script the group's custom property puts
    // the split somewhere and this puts the handle somewhere, and the two
    // being different is a handle floating away from the line it draws. A
    // static check asserts they match for every block in the registry.
    value,
    ariaLabel: options.label ?? name,
  },
  styles: options.styles ?? {},
});

export const fileField = (
  name: string,
  options: { accept?: string; multiple?: boolean; styles?: StyleDecl } = {}
): NodeSpec => ({
  type: 'file',
  name: `${name} upload`,
  props: {
    name,
    ...(options.accept ? { accept: options.accept } : {}),
    ...(options.multiple ? { multiple: true } : {}),
  },
  styles: options.styles ?? {},
});

/**
 * A progress bar.
 *
 * The two colours are ordinary node styles — `color` fills it, the background
 * is the track — because the reset strips the user-agent look. Pass no
 * `value` for the indeterminate "still working" state.
 */
export const progress = (
  name: string,
  value: number | null,
  options: { max?: number; styles?: StyleDecl } = {}
): NodeSpec => ({
  type: 'progress',
  name,
  props:
    value === null
      ? { indeterminate: true, max: options.max ?? 100 }
      : { value, max: options.max ?? 100 },
  styles: options.styles ?? {},
});

export const checkbox = (label: string, name: string, checked = false): NodeSpec => ({
  type: 'checkbox',
  name: label.slice(0, 24) || 'Checkbox',
  props: { label, name, ...(checked ? { checked: true } : {}) },
  styles: { fontSize: '14px' },
});

/**
 * A switch: a checkbox that is announced as one, and looks like one.
 *
 * `role="switch"` is the whole of the semantic difference — "on" and "off"
 * rather than "checked" and "not checked", which is what a person expects of
 * a setting that takes effect the moment it moves. It stays a real checkbox
 * underneath, so it is keyboard-operable, it submits with the form, and it
 * needs no script.
 *
 * The row lights up when it is on. That is a `checked` rule on the label,
 * which is worth knowing about because it did not work until recently: the
 * class is on the `<label>` and `:checked` is on the `<input>` inside it, so
 * the obvious selector compiled and matched nothing.
 */
export const toggle = (
  label: string,
  name: string,
  checked = false,
  styles: StyleDecl = {}
): NodeSpec => ({
  type: 'checkbox',
  name: label.slice(0, 24) || 'Switch',
  props: { label, name, role: 'switch', ...(checked ? { checked: true } : {}) },
  styles: {
    fontSize: '14.5px',
    gap: '12px',
    width: '100%',
    alignItems: 'center',
    ...pad('12px', '14px'),
    ...radius('var(--r-md)'),
    ...border('1px', 'var(--c-border)'),
    backgroundColor: 'var(--c-surface)',
    accentColor: 'var(--c-primary)',
    cursor: 'pointer',
    ...styles,
  },
  rules: [
    {
      id: 'r-on',
      when: [{ kind: 'control', pseudo: 'checked' }],
      apply: { borderColor: 'var(--c-primary)' },
    },
  ],
});

export const radio = (label: string, group: string, value: string, checked = false): NodeSpec => ({
  type: 'radio',
  name: label.slice(0, 24) || 'Radio',
  props: { label, name: group, value, ...(checked ? { checked: true } : {}) },
  styles: { fontSize: '14px' },
});

export const dropdown = (
  name: string,
  options: string[],
  placeholder?: string,
  styles: StyleDecl = {}
): NodeSpec => ({
  type: 'select',
  name: `${name} select`,
  props: {
    name,
    options: options.join('\n'),
    ...(placeholder ? { placeholder } : {}),
  },
  styles,
});

/* --------------------------------------------------------------------------
 * Switches
 *
 * The one thing on a Cre8 page that needs a script, and it needs about thirty
 * lines of one. A group holds a value; controls set it; anything tagged with
 * a case is hidden by a generated CSS rule while the value is something else.
 * Same mechanism on the canvas, in preview and in the published file — the
 * editor simply chooses the value from the inspector instead of from a click.
 * ----------------------------------------------------------------------- */

/** Wraps children in a group that holds one of several named values. */
export const switchGroup = (
  key: string,
  initial: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'frame',
  name: `${key} switch`,
  props: { switchKey: key, switchDefault: initial },
  styles: { ...pad('0px'), width: '100%', gap: '0px', ...styles },
  ...rsp(responsive),
  children,
});

/** A control that sets the enclosing group. Always a button — it is one. */
export const switchButton = (text: string, value: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'button',
  name: `${text} option`,
  props: { label: text, switchSet: value },
  styles: {
    backgroundColor: 'transparent',
    color: 'var(--c-muted)',
    fontSize: '13.5px',
    fontWeight: '560',
    ...pad('7px', '15px'),
    ...radius('var(--r-full)'),
    ...styles,
  },
  states: {
    hover: { color: 'var(--c-text)' },
    // Not a `:hover`-style pseudo-class: the generator turns this into a rule
    // keyed on the group's own value, so the selected option is styled by the
    // stylesheet rather than painted on by the script after first paint.
    pressed: {
      backgroundColor: 'var(--c-background)',
      color: 'var(--c-text)',
      boxShadow: 'var(--sh-sm)',
    },
  },
});

/**
 * A rule that hides a node unless a state holds one of these values.
 *
 * Blocks write the condition rather than an intent: the stored form is always
 * the literal *when this, apply that*, and it is the inspector that presents
 * it back as "shown when". More than one value is how a filter gets an
 * "All" — an item answering to `all design` survives both.
 */
export const switchCase = (
  value: string,
  node: NodeSpec,
  options: { state?: string; keepSpace?: boolean } = {}
): NodeSpec => hideRule(node, value, 'isNot', options);

/**
 * The opposite: hide it *when* the state is one of these.
 *
 * "Clear the filter" belongs on screen for every category except the one that
 * shows everything, and writing that the other way round would mean listing
 * the other three and keeping the list in step with them.
 */
export const switchUnless = (
  value: string,
  node: NodeSpec,
  options: { state?: string; keepSpace?: boolean } = {}
): NodeSpec => hideRule(node, value, 'is', options);

const hideRule = (
  node: NodeSpec,
  value: string,
  op: 'is' | 'isNot',
  options: { state?: string; keepSpace?: boolean }
): NodeSpec => ({
  ...node,
  rules: [
    ...(node.rules ?? []),
    {
      id: `r-${op}-${value.replace(/\s+/g, '-')}`,
      when: [{ kind: 'state', key: options.state ?? '', op, values: value.split(/\s+/) }],
      apply: options.keepSpace ? { visibility: 'hidden' } : { display: 'none' },
    },
  ],
});

/**
 * What this says while a state holds one of these values.
 *
 * The other half of a condition. `switchCase` decides whether an element is on
 * screen; this decides what it *reads*, which CSS cannot do — `content:` works
 * only on pseudo-elements, so it is neither selectable nor indexed. So the
 * node expands at render into one element per alternative, every string in the
 * published file, with the same generated rules hiding the ones that do not
 * apply. No script, no flash, and a crawler sees all of it.
 *
 * The alternative it replaces is two nodes with opposite cases, which works
 * but doubles the layer tree and leaves the designer keeping two copies of one
 * sentence in step.
 */
export const switchSet = (
  value: string,
  set: NodeProps,
  node: NodeSpec,
  options: { state?: string } = {}
): NodeSpec => ({
  ...node,
  rules: [
    ...(node.rules ?? []),
    {
      id: `s-${value.replace(/\s+/g, '-')}`,
      when: [{ kind: 'state', key: options.state ?? '', op: 'is', values: value.split(/\s+/) }],
      apply: {},
      set,
    },
  ],
});

/**
 * What this says when something about the *visit* is true.
 *
 * The same expansion `switchSet` gets, on a condition nobody clicks: the time
 * on the visitor's own clock, where they arrived from, what the link carried.
 * Both strings ship, a rule chooses, and the value is resolved in the document
 * head — so there is no flash and no script decides what the page says.
 */
export const dataSet = (
  source: string,
  value: string,
  set: NodeProps,
  node: NodeSpec
): NodeSpec => ({
  ...node,
  rules: [
    ...(node.rules ?? []),
    {
      id: `d-${source}-${value.replace(/\s+/g, '-')}`,
      when: [{ kind: 'data', source, op: 'is', values: value.split(/\s+/) }],
      apply: {},
      set,
    },
  ],
});

/**
 * A control that moves the switch on without claiming to be a toggle.
 *
 * Back and Continue in a stepper. Announcing them as pressed or unpressed —
 * "Next, toggle button, not pressed" — describes something the button is not.
 */
export const switchStep = (
  text: string,
  value: string,
  variant: 'primary' | 'secondary' = 'secondary',
  styles: StyleDecl = {}
): NodeSpec => {
  const base = button(text, variant);
  return {
    ...base,
    name: `${text} step`,
    props: { label: text, switchSet: value, switchQuiet: true },
    styles: { ...base.styles, fontSize: '14px', ...pad('10px', '18px'), ...styles },
  };
};

/**
 * A whole tab set, from a list of panels.
 *
 * Built as one call rather than three, because tabs are the arrangement most
 * likely to be assembled half-right: a tab list with no panel paired to it, a
 * panel with no tab, a default naming a case that does not exist. All three
 * are invisible until somebody uses the page, and none of them is possible
 * from here — the values come from the same array the labels do.
 *
 * The state machine underneath is the same one the pricing toggle uses. What
 * `switchRole` adds is the tab semantics, which the runtime applies.
 */
export const tabs = (
  key: string,
  items: { value: string; label: string; panel: NodeSpec }[],
  options: { styles?: StyleDecl; listStyles?: StyleDecl; responsive?: ResponsiveStyles } = {}
): NodeSpec => ({
  type: 'frame',
  name: `${key} tabs`,
  props: { switchKey: key, switchDefault: items[0]?.value ?? '', switchRole: 'tabs' },
  styles: { ...pad('0px'), width: '100%', gap: '28px', ...options.styles },
  ...rsp(options.responsive ?? {}),
  children: [
    stack(
      'Tab list',
      items.map((item) =>
        switchButton(item.label, item.value, {
          fontSize: '14.5px',
          ...pad('9px', '16px'),
          ...radius('var(--r-md)'),
        })
      ),
      {
        gap: '4px',
        width: 'fit-content',
        ...pad('4px'),
        ...radius('var(--r-lg)'),
        backgroundColor: 'var(--c-surface)',
        ...border('1px', 'var(--c-border)'),
        ...options.listStyles,
      },
      // A row of tabs is the first thing to overflow a phone. Wrapping beats
      // a horizontal scroller here because the labels are short.
      { mobile: { flexWrap: 'wrap', width: '100%' } }
    ),
    ...items.map((item) => switchCase(item.value, item.panel)),
  ],
});
