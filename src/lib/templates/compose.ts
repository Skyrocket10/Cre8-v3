/**
 * Parameterised block builders.
 *
 * Where `blocks.ts` holds ready-made sections for the insert panel, these take
 * their content as arguments so a template can describe a whole site as data.
 * Both produce the same `NodeSpec` trees, which is the point: a template is
 * never a special kind of page, just a document someone happened to generate.
 */

import type { NodeSpec } from '../document/factory';
import type { ResponsiveStyles, StyleDecl } from '../document/types';

/* --------------------------------------------------------------------------
 * Primitives
 * ----------------------------------------------------------------------- */

/**
 * A link, with somewhere to go if the caller knows where.
 *
 * The bare-string spelling is kept because most of these lists read better as
 * words, and a block dropped from the insert panel genuinely has nowhere to
 * point — it has no idea what else is on the page. A *template* does know, and
 * every one of its links now says so.
 */
export type LinkSpec = string | { label: string; href?: string };

export const linkLabel = (link: LinkSpec): string =>
  typeof link === 'string' ? link : link.label;

/** `#` is the honest answer for a link with no destination: it goes nowhere. */
export const linkHref = (link: LinkSpec): string =>
  typeof link === 'string' ? '#' : (link.href ?? '#');

/**
 * Give a section a name a link can point at.
 *
 * A wrapper rather than an argument on each block builder, because every one
 * of them returns a section and none of them should have to care. `#work` is
 * then an ordinary href — the renderer emits the `id`, the browser does the
 * scrolling, and nothing about it needs scripting.
 */
export const anchored = (spec: NodeSpec, anchor: string): NodeSpec => ({
  ...spec,
  props: { ...spec.props, anchor },
});

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

export const text = (value: string, styles: StyleDecl = {}, responsive?: ResponsiveStyles): NodeSpec => ({
  type: 'text',
  name: value.slice(0, 24) || 'Text',
  props: { text: value },
  styles,
  responsive,
});

export const heading = (
  value: string,
  level: number,
  styles: StyleDecl = {},
  responsive?: ResponsiveStyles
): NodeSpec => ({
  type: 'heading',
  name: value.slice(0, 28),
  props: { text: value, level },
  styles: { color: 'var(--c-text)', ...styles },
  responsive,
});

export const body = (value: string, styles: StyleDecl = {}, responsive?: ResponsiveStyles): NodeSpec => ({
  type: 'paragraph',
  name: 'Paragraph',
  props: { text: value },
  styles: { color: 'var(--c-muted)', fontSize: '17px', lineHeight: '1.62', ...styles },
  responsive,
});

export const icon = (name: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'icon',
  name: `${name} icon`,
  props: { name, strokeWidth: 1.75 },
  styles,
});

export const image = (src: string, alt: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'image',
  name: alt || 'Image',
  props: { src, alt },
  styles,
});

export const stack = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive?: ResponsiveStyles
): NodeSpec => ({ type: 'stack', name, styles, responsive, children });

export const frame = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive?: ResponsiveStyles
): NodeSpec => ({ type: 'frame', name, styles: { ...pad('0px'), ...styles }, responsive, children });

export const grid = (
  name: string,
  children: NodeSpec[],
  columns: number,
  styles: StyleDecl = {},
  responsive?: ResponsiveStyles
): NodeSpec => ({
  type: 'grid',
  name,
  styles: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '24px', ...styles },
  responsive: responsive ?? {
    tablet: { gridTemplateColumns: `repeat(${Math.min(2, columns)}, minmax(0, 1fr))` },
    mobile: { gridTemplateColumns: '1fr' },
  },
  children,
});

export interface ButtonSpec {
  label: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const button = ({ label, href = '#', variant = 'primary' }: ButtonSpec): NodeSpec => ({
  type: 'button',
  name: `${label} button`,
  props: { label, href },
  styles:
    variant === 'primary'
      ? {}
      : variant === 'secondary'
        ? {
            backgroundColor: 'transparent',
            color: 'var(--c-text)',
            ...border('1px', 'var(--c-border)'),
          }
        : {
            backgroundColor: 'transparent',
            color: 'var(--c-text)',
            paddingLeft: '4px',
            paddingRight: '4px',
          },
  states:
    variant === 'primary'
      ? { hover: { backgroundColor: 'var(--c-secondary)' } }
      : { hover: { backgroundColor: 'var(--c-surface)' } },
});

export const section = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'section',
  name,
  styles: { ...pad('104px', '24px'), gap: '0px', ...styles },
  responsive: {
    tablet: { paddingTop: '76px', paddingBottom: '76px', ...responsive.tablet },
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
  responsive?: ResponsiveStyles
): NodeSpec => ({
  type: 'container',
  name: 'Container',
  styles: { gap: '48px', ...styles },
  responsive,
  children,
});

const DISPLAY_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '46px' },
  mobile: { fontSize: '33px', letterSpacing: '-0.02em' },
};

const TITLE_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '33px' },
  mobile: { fontSize: '26px' },
};

/* --------------------------------------------------------------------------
 * Navigation
 * ----------------------------------------------------------------------- */

export interface NavOptions {
  brand: string;
  brandIcon?: string;
  links: LinkSpec[];
  cta?: LinkSpec;
  sticky?: boolean;
}

export function navBlock({ brand, brandIcon = 'sparkles', links, cta, sticky = true }: NavOptions): NodeSpec {
  return {
    type: 'section',
    name: 'Navbar',
    styles: {
      ...pad('16px', '24px'),
      ...(sticky ? { position: 'sticky', top: '0px', zIndex: '50' } : {}),
      backgroundColor: 'color-mix(in srgb, var(--c-background) 84%, transparent)',
      backdropFilter: 'saturate(180%) blur(14px)',
      borderStyle: 'solid',
      borderBottomWidth: '1px',
      borderColor: 'var(--c-border)',
    },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      container(
        [
          stack(
            'Brand',
            [
              icon(brandIcon, { width: '24px', height: '24px', color: 'var(--c-primary)' }),
              text(brand, {
                fontSize: '17px',
                fontWeight: '640',
                letterSpacing: '-0.02em',
                color: 'var(--c-text)',
              }),
            ],
            { gap: '9px', alignItems: 'center' }
          ),
          {
            type: 'navigation',
            name: 'Nav links',
            styles: { gap: '28px', alignItems: 'center' },
            responsive: { mobile: { display: 'none' } },
            children: links.map((link) => ({
              type: 'link' as const,
              name: linkLabel(link),
              props: { text: linkLabel(link), href: linkHref(link) },
              styles: { fontSize: '14.5px', color: 'var(--c-muted)' },
              states: { hover: { color: 'var(--c-text)' } },
            })),
          },
          ...(cta
            ? [
                {
                  type: 'button' as const,
                  name: `${linkLabel(cta)} button`,
                  props: { label: linkLabel(cta), href: linkHref(cta) },
                  styles: {
                    fontSize: '14px',
                    paddingTop: '9px',
                    paddingBottom: '9px',
                    paddingLeft: '16px',
                    paddingRight: '16px',
                  },
                  states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                },
              ]
            : []),
        ],
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '32px',
          maxWidth: 'var(--w-wide)',
        }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Hero
 * ----------------------------------------------------------------------- */

export interface HeroOptions {
  eyebrow?: string;
  title: string;
  body: string;
  buttons?: ButtonSpec[];
  align?: 'center' | 'left';
  media?: NodeSpec;
  tone?: 'plain' | 'glow' | 'inverse';
}

export function heroBlock({
  eyebrow,
  title,
  body: copy,
  buttons = [],
  align = 'center',
  media,
  tone = 'glow',
}: HeroOptions): NodeSpec {
  const centred = align === 'center';
  const inverse = tone === 'inverse';

  const content = stack(
    'Hero copy',
    [
      ...(eyebrow
        ? [
            text(eyebrow, {
              fontSize: '12px',
              fontWeight: '600',
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: inverse ? 'var(--c-accent)' : 'var(--c-primary)',
            }),
          ]
        : []),
      heading(
        title,
        1,
        {
          fontSize: '62px',
          fontWeight: '620',
          lineHeight: '1.05',
          letterSpacing: '-0.032em',
          maxWidth: centred ? '21ch' : '17ch',
          textWrap: 'balance',
          ...(inverse ? { color: 'var(--c-on-inverse)' } : {}),
        },
        DISPLAY_RESPONSIVE
      ),
      body(
        copy,
        {
          fontSize: '19px',
          maxWidth: '54ch',
          ...(inverse
            ? { color: 'color-mix(in srgb, var(--c-on-inverse) 76%, transparent)' }
            : {}),
        },
        { mobile: { fontSize: '16.5px' } }
      ),
      ...(buttons.length
        ? [
            stack('Hero actions', buttons.map(button), { gap: '12px', marginTop: '10px' }, {
              mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' },
            }),
          ]
        : []),
    ],
    {
      flexDirection: 'column',
      alignItems: centred ? 'center' : 'flex-start',
      textAlign: centred ? 'center' : 'left',
      gap: '20px',
      ...(centred ? {} : { flexBasis: '0px', flexGrow: '1' }),
    }
  );

  const inner = media
    ? centred
      ? container([content, media], { gap: '60px', alignItems: 'center', maxWidth: 'var(--w-wide)' }, { mobile: { gap: '36px' } })
      : container(
          [content, frame('Hero media', [media], { flexBasis: '0px', flexGrow: '1', minWidth: '0px' })],
          { flexDirection: 'row', gap: '56px', alignItems: 'center', maxWidth: 'var(--w-wide)' },
          { tablet: { flexDirection: 'column', gap: '40px' } }
        )
    : container([content], { alignItems: centred ? 'center' : 'flex-start', maxWidth: 'var(--w-wide)' });

  return section(
    'Hero',
    [inner],
    {
      paddingTop: '104px',
      paddingBottom: '112px',
      ...(tone === 'glow'
        ? {
            backgroundImage:
              'radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--c-primary) 14%, transparent) 0%, transparent 62%)',
          }
        : {}),
      ...(inverse ? { backgroundColor: 'var(--c-inverse)' } : {}),
    },
    { mobile: { paddingTop: '52px', paddingBottom: '56px' } }
  );
}

/* --------------------------------------------------------------------------
 * Section header
 * ----------------------------------------------------------------------- */

export function sectionHeader(
  eyebrow: string | undefined,
  title: string,
  copy?: string,
  align: 'center' | 'left' = 'center'
): NodeSpec {
  return stack(
    'Section header',
    [
      ...(eyebrow
        ? [
            text(eyebrow, {
              fontSize: '12px',
              fontWeight: '600',
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: 'var(--c-primary)',
            }),
          ]
        : []),
      heading(
        title,
        2,
        {
          fontSize: '40px',
          fontWeight: '600',
          lineHeight: '1.14',
          letterSpacing: '-0.026em',
          maxWidth: '24ch',
          textWrap: 'balance',
        },
        TITLE_RESPONSIVE
      ),
      ...(copy ? [body(copy, { maxWidth: '58ch' })] : []),
    ],
    {
      flexDirection: 'column',
      alignItems: align === 'center' ? 'center' : 'flex-start',
      textAlign: align,
      gap: '14px',
      width: '100%',
    }
  );
}

/* --------------------------------------------------------------------------
 * Card grid
 * ----------------------------------------------------------------------- */

export interface CardItem {
  icon?: string;
  title: string;
  body: string;
  meta?: string;
}

export interface CardGridOptions {
  name?: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  items: CardItem[];
  columns?: number;
  surface?: boolean;
  bordered?: boolean;
}

export function cardGridBlock({
  name = 'Features',
  eyebrow,
  title,
  intro,
  items,
  columns = 3,
  surface = false,
  bordered = true,
}: CardGridOptions): NodeSpec {
  return section(
    name,
    [
      container(
        [
          ...(title ? [sectionHeader(eyebrow, title, intro)] : []),
          grid(
            'Cards',
            items.map((item) => ({
              type: 'frame' as const,
              name: item.title,
              styles: {
                ...pad('26px'),
                gap: '13px',
                ...radius('var(--r-lg)'),
                ...(bordered ? border('1px', 'var(--c-border)') : {}),
                backgroundColor: surface ? 'var(--c-background)' : 'var(--c-surface)',
                transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
              },
              states: {
                hover: {
                  borderColor: 'color-mix(in srgb, var(--c-primary) 40%, var(--c-border))',
                  boxShadow: 'var(--sh-md)',
                  transform: 'translateY(-2px)',
                },
              },
              children: [
                ...(item.icon
                  ? [
                      frame(
                        'Icon badge',
                        [icon(item.icon, { width: '19px', height: '19px', color: 'var(--c-primary)' })],
                        {
                          width: '38px',
                          height: '38px',
                          ...radius('var(--r-md)'),
                          backgroundColor: 'color-mix(in srgb, var(--c-primary) 11%, transparent)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: '0',
                        }
                      ),
                    ]
                  : []),
                ...(item.meta
                  ? [
                      text(item.meta, {
                        fontSize: '11.5px',
                        fontWeight: '600',
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: 'var(--c-primary)',
                      }),
                    ]
                  : []),
                heading(item.title, 3, {
                  fontSize: '17.5px',
                  fontWeight: '600',
                  letterSpacing: '-0.014em',
                  lineHeight: '1.3',
                }),
                body(item.body, { fontSize: '14.5px', lineHeight: '1.6' }),
              ],
            })),
            columns,
            { gap: '20px' }
          ),
        ],
        { gap: title ? '52px' : '0px' }
      ),
    ],
    surface ? { backgroundColor: 'var(--c-surface)' } : {}
  );
}

/* --------------------------------------------------------------------------
 * Split: copy beside media
 * ----------------------------------------------------------------------- */

export interface SplitOptions {
  eyebrow?: string;
  title: string;
  body: string;
  bullets?: string[];
  media: NodeSpec;
  reverse?: boolean;
  cta?: ButtonSpec;
  surface?: boolean;
}

export function splitBlock({
  eyebrow,
  title,
  body: copy,
  bullets = [],
  media,
  reverse = false,
  cta,
  surface = false,
}: SplitOptions): NodeSpec {
  const content = stack(
    'Split copy',
    [
      sectionHeader(eyebrow, title, copy, 'left'),
      ...(bullets.length
        ? [
            stack(
              'Bullets',
              bullets.map((item) =>
                stack(
                  item.slice(0, 22),
                  [
                    icon('circle-check', {
                      width: '17px',
                      height: '17px',
                      color: 'var(--c-primary)',
                      flexShrink: '0',
                      marginTop: '2px',
                    }),
                    body(item, { fontSize: '15px' }),
                  ],
                  { gap: '10px', alignItems: 'flex-start' }
                )
              ),
              { flexDirection: 'column', alignItems: 'flex-start', gap: '11px' }
            ),
          ]
        : []),
      ...(cta ? [button(cta)] : []),
    ],
    { flexDirection: 'column', alignItems: 'flex-start', gap: '24px', flexBasis: '0px', flexGrow: '1', minWidth: '0px' }
  );

  return section(
    'Split',
    [
      container(
        reverse
          ? [frame('Split media', [media], { flexBasis: '0px', flexGrow: '1', minWidth: '0px' }), content]
          : [content, frame('Split media', [media], { flexBasis: '0px', flexGrow: '1', minWidth: '0px' })],
        { flexDirection: 'row', alignItems: 'center', gap: '64px' },
        { tablet: { flexDirection: 'column', gap: '40px' } }
      ),
    ],
    surface ? { backgroundColor: 'var(--c-surface)' } : {}
  );
}

/* --------------------------------------------------------------------------
 * Stats
 * ----------------------------------------------------------------------- */

export function statsBlock(items: { value: string; label: string }[], surface = true): NodeSpec {
  return section(
    'Stats',
    [
      container(
        [
          grid(
            'Stat grid',
            items.map((item) =>
              stack(
                item.label,
                [
                  text(item.value, {
                    fontSize: '44px',
                    fontWeight: '620',
                    letterSpacing: '-0.032em',
                    lineHeight: '1',
                    color: 'var(--c-text)',
                  }),
                  text(item.label, { fontSize: '14px', color: 'var(--c-muted)' }),
                ],
                { flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }
              )
            ),
            items.length,
            { gap: '32px' },
            { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '28px' } }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    {
      paddingTop: '64px',
      paddingBottom: '64px',
      ...(surface ? { backgroundColor: 'var(--c-surface)' } : {}),
    }
  );
}

/* --------------------------------------------------------------------------
 * Gallery
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Photography
 * ----------------------------------------------------------------------- */

/**
 * Where a template's stand-in photography comes from.
 *
 * One constant, because it is the whole of the decision and the whole of the
 * cost. A template ships as code and a photograph ships as a file, and the two
 * do not meet: the project's own storage does not exist until somebody has
 * clicked the template, so a template cannot reference an upload. The
 * alternatives were seeding R2 on create — real bytes, real work, real storage
 * bill for pictures every user is expected to replace — or pointing at a
 * service. This points at a service.
 *
 * What that buys and what it costs, plainly: the templates look like sites
 * instead of like wireframes, and a published site that keeps the placeholders
 * depends on a third party staying up and hands it the visitor's IP. Both are
 * acceptable for a stand-in and neither is acceptable for a finished site,
 * which is the message the Assets panel exists to answer. Moving to our own
 * CDN later is this line.
 *
 * `/seed/<seed>/<w>/<h>` is deterministic — the same slot shows the same
 * photograph on every build, so a template does not reshuffle itself between
 * the screenshot and the project.
 */
const PLACEHOLDER_PHOTO = 'https://picsum.photos';

export interface PhotoOptions {
  /** Stable per picture. Two slots wanting the same photo share a seed. */
  seed: string;
  /** Required, not optional: an image nobody can describe is decoration. */
  alt: string;
  width: number;
  height: number;
  /** Above the fold. Loads eagerly, decodes on the main thread, high priority. */
  priority?: boolean;
  styles?: StyleDecl;
}

/**
 * A photograph, sized so nothing moves when it arrives.
 *
 * `width`/`height` are the intrinsic pixels — the browser wants the ratio, and
 * CSS still decides the laid-out size — and the surface colour underneath
 * means a photo that is slow, blocked or replaced by a broken URL reads as a
 * panel in the page's own palette rather than as a hole in the layout. That
 * matters more here than it usually would: these images are the one part of a
 * template served from somewhere else.
 */
export function photo({
  seed,
  alt,
  width,
  height,
  priority,
  styles = {},
}: PhotoOptions): NodeSpec {
  return {
    type: 'image',
    name: alt.slice(0, 28),
    props: {
      src: `${PLACEHOLDER_PHOTO}/seed/${seed}/${width}/${height}`,
      alt,
      width,
      height,
      ...(priority ? { priority: true } : {}),
    },
    styles: {
      width: '100%',
      height: 'auto',
      aspectRatio: `${width} / ${height}`,
      objectFit: 'cover',
      backgroundColor: 'var(--c-surface-2)',
      ...radius('var(--r-lg)'),
      ...styles,
    },
  };
}

/* --------------------------------------------------------------------------
 * Gallery
 * ----------------------------------------------------------------------- */

export interface GalleryItem {
  title: string;
  subtitle?: string;
  /** A photograph, or a gradient where the picture is the point rather than a stand-in. */
  photo?: { seed: string; alt: string; width: number; height: number };
  gradient?: string;
  ratio?: string;
}

export function galleryBlock(
  title: string,
  intro: string | undefined,
  items: GalleryItem[],
  columns = 3
): NodeSpec {
  return section('Gallery', [
    container(
      [
        ...(title ? [sectionHeader(undefined, title, intro)] : []),
        grid(
          'Gallery grid',
          items.map((item) => ({
            type: 'frame' as const,
            name: item.title,
            styles: {
              ...pad('0px'),
              gap: '0px',
              ...radius('var(--r-lg)'),
              overflow: 'hidden',
              ...border('1px', 'var(--c-border)'),
              transition: 'transform 220ms ease, box-shadow 220ms ease',
            },
            states: { hover: { transform: 'translateY(-3px)', boxShadow: 'var(--sh-lg)' } },
            children: [
              item.photo
                ? photo({
                    ...item.photo,
                    // Square off the bottom: the card's own radius clips it,
                    // and a rounded photo inside a rounded card leaves a
                    // sliver of border showing at each corner.
                    styles: { ...radius('0px'), aspectRatio: item.ratio ?? '4 / 3' },
                  })
                : frame('Thumbnail', [], {
                    width: '100%',
                    aspectRatio: item.ratio ?? '4 / 3',
                    backgroundImage: item.gradient ?? 'linear-gradient(135deg, var(--c-surface-2), var(--c-surface))',
                  }),
              stack(
                'Caption',
                [
                  text(item.title, {
                    fontSize: '15.5px',
                    fontWeight: '580',
                    color: 'var(--c-text)',
                  }),
                  ...(item.subtitle
                    ? [text(item.subtitle, { fontSize: '13px', color: 'var(--c-muted)' })]
                    : []),
                ],
                {
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '4px',
                  ...pad('16px', '18px'),
                  backgroundColor: 'var(--c-background)',
                  width: '100%',
                }
              ),
            ],
          })),
          columns,
          { gap: '20px' }
        ),
      ],
      { gap: '52px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Detail list — menus, FAQs, changelogs
 * ----------------------------------------------------------------------- */

export function listBlock(
  name: string,
  title: string,
  intro: string | undefined,
  items: { title: string; body: string; meta?: string }[],
  columns = 2,
  surface = false
): NodeSpec {
  return section(
    name,
    [
      container(
        [
          sectionHeader(undefined, title, intro),
          grid(
            'List',
            items.map((item) =>
              frame(
                item.title.slice(0, 26),
                [
                  stack(
                    'Row',
                    [
                      heading(item.title, 3, {
                        fontSize: '16.5px',
                        fontWeight: '600',
                        letterSpacing: '-0.012em',
                        lineHeight: '1.35',
                        flexGrow: '1',
                      }),
                      ...(item.meta
                        ? [
                            text(item.meta, {
                              fontSize: '15px',
                              fontWeight: '580',
                              color: 'var(--c-primary)',
                              whiteSpace: 'nowrap',
                            }),
                          ]
                        : []),
                    ],
                    { gap: '16px', alignItems: 'baseline', width: '100%' }
                  ),
                  body(item.body, { fontSize: '14.5px', lineHeight: '1.62' }),
                ],
                { gap: '7px' }
              )
            ),
            columns,
            { gap: '24px 40px' },
            { mobile: { gridTemplateColumns: '1fr' } }
          ),
        ],
        { gap: '52px' }
      ),
    ],
    surface ? { backgroundColor: 'var(--c-surface)' } : {}
  );
}

/* --------------------------------------------------------------------------
 * Content, from a collection
 * ----------------------------------------------------------------------- */

export interface FeedOptions {
  name: string;
  title: string;
  intro?: string;
  /** The collection's id, which only exists once the document is built. */
  collection: string;
  /** Where a card goes — the deferred reference to the detail page. */
  detail: string;
  columns?: number;
  /** Rows per published file. Splits the page, not the list. */
  paginate?: number;
  surface?: boolean;
}

/**
 * `listBlock`, except the rows are records rather than an array in the source.
 *
 * The same design either way, deliberately: a template's list should not look
 * different for being backed by content, and the whole claim of the repeater
 * is that one card and a collection produce what six hand-written cards do.
 *
 * The grid carries the `repeat`, because a repeater renders its *children*
 * once per record. Each card is a link rather than a card containing one, so
 * the whole row is a target — and its href names the detail page, which the
 * publisher resolves per record: the same href on six cards becomes six
 * different files.
 */
export function feedBlock({
  name,
  title,
  intro,
  collection,
  detail,
  columns = 2,
  paginate,
  surface = false,
}: FeedOptions): NodeSpec {
  const card: NodeSpec = {
    type: 'link',
    name: 'Essay card',
    props: { href: detail },
    styles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
      ...pad('16px'),
      marginLeft: '-16px',
      marginRight: '-16px',
      ...radius('var(--r-md)'),
      transition: 'background-color 140ms ease',
    },
    states: { hover: { backgroundColor: 'var(--c-surface-2)' } },
    children: [
      stack(
        'Row',
        [
          {
            ...heading('Essay title', 3, {
              fontSize: '16.5px',
              fontWeight: '600',
              letterSpacing: '-0.012em',
              lineHeight: '1.35',
              flexGrow: '1',
            }),
            bind: { text: 'title' },
          },
          {
            ...text('12 min', {
              fontSize: '15px',
              fontWeight: '580',
              color: 'var(--c-primary)',
              whiteSpace: 'nowrap',
            }),
            bind: { text: 'readingTime' },
          },
        ],
        { gap: '16px', alignItems: 'baseline', width: '100%' }
      ),
      { ...body('The essay’s opening line.', { fontSize: '14.5px' }), bind: { text: 'excerpt' } },
    ],
  };

  return section(
    name,
    [
      container(
        [
          sectionHeader(undefined, title, intro),
          {
            ...grid('Essays', [card], columns, { gap: '8px 40px' }, { mobile: { gridTemplateColumns: '1fr' } }),
            repeat: { collection, ...(paginate ? { paginate } : {}) },
          },
          // Only where the list is split. `series:prev` and `series:next`
          // resolve to nothing at the ends, and a link with nowhere to go
          // hides itself rather than sitting there doing nothing.
          ...(paginate
            ? [
                stack(
                  'Pages',
                  [
                    {
                      type: 'link' as const,
                      name: 'Newer',
                      props: { text: '← Newer', href: 'series:prev' },
                      styles: { fontSize: '14px', color: 'var(--c-muted)' },
                      states: { hover: { color: 'var(--c-text)' } },
                    },
                    {
                      type: 'link' as const,
                      name: 'Older',
                      props: { text: 'Older →', href: 'series:next' },
                      styles: { fontSize: '14px', color: 'var(--c-muted)' },
                      states: { hover: { color: 'var(--c-text)' } },
                    },
                  ],
                  { gap: '24px', justifyContent: 'space-between', width: '100%' }
                ),
              ]
            : []),
        ],
        { gap: '52px' }
      ),
    ],
    surface ? { backgroundColor: 'var(--c-surface)' } : {}
  );
}

/**
 * One record, laid out to be read.
 *
 * The other half of a collection: a list is only half a blog. Everything on it
 * is bound, so the page is a template rather than a page — the publisher makes
 * one file per record from it.
 */
export function articleBlock(back: string): NodeSpec {
  return section('Essay', [
    {
      ...container(
        [
          {
            type: 'link',
            name: 'Back',
            props: { text: '← All essays', href: back },
            styles: { fontSize: '14px', color: 'var(--c-muted)' },
            states: { hover: { color: 'var(--c-text)' } },
          },
          {
            ...heading(
              'The essay title',
              1,
              { fontSize: '44px', fontWeight: '600', lineHeight: '1.14', letterSpacing: '-0.028em' },
              { mobile: { fontSize: '31px' } }
            ),
            bind: { text: 'title' },
          },
          {
            ...text('12 min', {
              fontSize: '14px',
              fontWeight: '580',
              color: 'var(--c-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }),
            bind: { text: 'readingTime' },
          },
          {
            type: 'richtext',
            name: 'Essay body',
            props: { html: '<p>The essay.</p>' },
            bind: { html: 'body' },
            styles: { fontSize: '18px', lineHeight: '1.7', color: 'var(--c-text)' },
          },
        ],
        { gap: '20px', maxWidth: 'var(--w-narrow)', alignItems: 'flex-start' }
      ),
    },
  ]);
}

/* --------------------------------------------------------------------------
 * Call to action
 * ----------------------------------------------------------------------- */

export function ctaBlock(
  title: string,
  copy: string,
  buttons: ButtonSpec[],
  tone: 'inverse' | 'surface' = 'inverse'
): NodeSpec {
  const inverse = tone === 'inverse';
  return section('Call to action', [
    container(
      [
        frame(
          'CTA card',
          [
            heading(
              title,
              2,
              {
                fontSize: '40px',
                fontWeight: '600',
                lineHeight: '1.14',
                letterSpacing: '-0.026em',
                maxWidth: '17ch',
                textWrap: 'balance',
                ...(inverse ? { color: 'var(--c-on-inverse)' } : {}),
              },
              TITLE_RESPONSIVE
            ),
            body(copy, {
              maxWidth: '48ch',
              ...(inverse
                ? { color: 'color-mix(in srgb, var(--c-on-inverse) 74%, transparent)' }
                : {}),
            }),
            stack(
              'CTA actions',
              buttons.map((spec) => {
                const node = button(spec);
                if (!inverse) return node;
                return spec.variant === 'primary' || !spec.variant
                  ? {
                      ...node,
                      styles: { backgroundColor: 'var(--c-on-inverse)', color: 'var(--c-inverse)' },
                      states: { hover: { opacity: '0.9' } },
                    }
                  : {
                      ...node,
                      styles: {
                        backgroundColor: 'transparent',
                        color: 'var(--c-on-inverse)',
                        ...border('1px', 'color-mix(in srgb, var(--c-on-inverse) 30%, transparent)'),
                      },
                      states: {
                        hover: {
                          backgroundColor: 'color-mix(in srgb, var(--c-on-inverse) 10%, transparent)',
                        },
                      },
                    };
              }),
              { gap: '12px', marginTop: '8px' },
              { mobile: { flexDirection: 'column', width: '100%', alignItems: 'stretch' } }
            ),
          ],
          {
            ...pad('64px', '48px'),
            gap: '18px',
            alignItems: 'center',
            textAlign: 'center',
            ...radius('var(--r-xl)'),
            width: '100%',
            ...(inverse
              ? {
                  backgroundColor: 'var(--c-inverse)',
                  backgroundImage:
                    'radial-gradient(90% 140% at 50% 0%, color-mix(in srgb, var(--c-primary) 42%, transparent) 0%, transparent 70%)',
                }
              : { backgroundColor: 'var(--c-surface)', ...border('1px', 'var(--c-border)') }),
          },
          {
            mobile: {
              paddingTop: '40px',
              paddingBottom: '40px',
              paddingLeft: '24px',
              paddingRight: '24px',
            },
          }
        ),
      ],
      { gap: '0px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Contact
 * ----------------------------------------------------------------------- */

export function contactBlock(title: string, copy: string, buttonLabel = 'Send message'): NodeSpec {
  return section('Contact', [
    container(
      [
        sectionHeader(undefined, title, copy),
        {
          type: 'form',
          name: 'Contact form',
          styles: { gap: '12px', maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto' },
          children: [
            { type: 'input', name: 'Name', props: { placeholder: 'Your name', inputType: 'text', name: 'name' }, styles: {} },
            { type: 'input', name: 'Email', props: { placeholder: 'you@company.com', inputType: 'email', name: 'email' }, styles: {} },
            { type: 'textarea', name: 'Message', props: { placeholder: 'How can we help?', name: 'message', rows: 4 }, styles: {} },
            {
              type: 'button',
              name: 'Submit',
              props: { label: buttonLabel, submit: true },
              styles: { width: '100%' },
              states: { hover: { backgroundColor: 'var(--c-secondary)' } },
            },
          ],
        },
      ],
      { gap: '44px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Footer
 * ----------------------------------------------------------------------- */

export function footerBlock(
  brand: string,
  tagline: string,
  columns: { title: string; links: LinkSpec[] }[],
  brandIcon = 'sparkles'
): NodeSpec {
  return section(
    'Footer',
    [
      container(
        [
          {
            type: 'grid',
            name: 'Footer columns',
            styles: {
              gridTemplateColumns: `1.6fr repeat(${columns.length}, minmax(0, 1fr))`,
              gap: '40px',
              width: '100%',
            },
            responsive: {
              tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
              mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '32px 20px' },
            },
            children: [
              frame(
                'Footer brand',
                [
                  stack(
                    'Brand',
                    [
                      icon(brandIcon, { width: '21px', height: '21px', color: 'var(--c-primary)' }),
                      text(brand, {
                        fontSize: '16px',
                        fontWeight: '640',
                        letterSpacing: '-0.02em',
                        color: 'var(--c-text)',
                      }),
                    ],
                    { gap: '8px', alignItems: 'center' }
                  ),
                  body(tagline, { fontSize: '13.5px', maxWidth: '30ch' }),
                ],
                { gap: '12px' }
              ),
              ...columns.map((column) =>
                frame(
                  column.title,
                  [
                    text(column.title, {
                      fontSize: '12px',
                      fontWeight: '620',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      color: 'var(--c-text)',
                    }),
                    ...column.links.map((link) => ({
                      type: 'link' as const,
                      name: linkLabel(link),
                      props: { text: linkLabel(link), href: linkHref(link) },
                      styles: { fontSize: '13.5px', color: 'var(--c-muted)' },
                      states: { hover: { color: 'var(--c-text)' } },
                    })),
                  ],
                  { gap: '11px' }
                )
              ),
            ],
          },
          { type: 'divider', name: 'Divider', styles: {} },
          stack(
            'Footer base',
            [
              text(`© 2026 ${brand}. All rights reserved.`, {
                fontSize: '12.5px',
                color: 'var(--c-muted)',
              }),
              stack(
                'Social',
                ['globe', 'send', 'mail'].map((name) =>
                  icon(name, { width: '16px', height: '16px', color: 'var(--c-muted)' })
                ),
                { gap: '16px' }
              ),
            ],
            {
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              flexWrap: 'wrap',
              gap: '16px',
            }
          ),
        ],
        { gap: '40px' }
      ),
    ],
    {
      paddingTop: '60px',
      paddingBottom: '44px',
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderColor: 'var(--c-border)',
    }
  );
}

/* --------------------------------------------------------------------------
 * Decorative media
 * ----------------------------------------------------------------------- */

/** A gradient panel that stands in for photography without a broken image. */
export function gradientPanel(gradient: string, ratio = '4 / 3', label?: string): NodeSpec {
  return frame(
    'Media',
    label
      ? [
          text(label, {
            fontSize: '13px',
            fontWeight: '560',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.82)',
          }),
        ]
      : [],
    {
      width: '100%',
      aspectRatio: ratio,
      backgroundImage: gradient,
      ...radius('var(--r-lg)'),
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--sh-lg)',
    }
  );
}
