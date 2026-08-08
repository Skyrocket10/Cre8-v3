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
import type { ResponsiveStyles, StyleDecl } from '../../document/types';

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

export const ONE_COLUMN: ResponsiveStyles = { mobile: { gridTemplateColumns: '1fr' } };

export const TWO_TO_ONE: ResponsiveStyles = {
  tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  mobile: { gridTemplateColumns: '1fr' },
};

/** Side-by-side that becomes stacked. For split heroes and alternating rows. */
export const SPLIT_TO_STACK: ResponsiveStyles = {
  tablet: { gridTemplateColumns: '1fr' },
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
  styles: StyleDecl = {}
): NodeSpec => ({
  ...card(name, children, {
    transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
    ...styles,
  }),
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
