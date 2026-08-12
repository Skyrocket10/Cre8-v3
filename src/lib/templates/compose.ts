/**
 * Parameterised block builders.
 *
 * Where `blocks.ts` holds ready-made sections for the insert panel, these take
 * their content as arguments so a template can describe a whole site as data.
 * Both produce the same `NodeSpec` trees, which is the point: a template is
 * never a special kind of page, just a document someone happened to generate.
 */

import type { NodeSpec } from '../document/factory';
// Peer module, no cycle: `kit` imports only from `document/` and `runtime/`.
import { asLink, goesTo, type BlockLink } from './blocks/kit';
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
/*
 * The same thing the kit calls a `BlockLink`, and now literally so.
 *
 * It was a separate, identical declaration, which is how the two halves of the
 * library drifted: the kit learned `jumpTo` and this did not, so every nav
 * built through `navBlock` could only type a fragment. An alias rather than a
 * second shape means the next field arrives in both at once.
 */
export type LinkSpec = string | BlockLink;

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

/**
 * A button, which is a link that looks like a button.
 *
 * Extends `BlockLink` rather than restating it. This was the *third* parallel
 * declaration of "a label and somewhere to go" — the kit had one, the nav had
 * one, and this had one — and they drifted exactly as you would expect:
 * `jumpTo` was added to the first and the other two carried on able to type a
 * fragment and nothing else.
 */
export interface ButtonSpec extends BlockLink {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const button = (spec: ButtonSpec): NodeSpec => {
  const { label, variant = 'primary' } = spec;
  const to = goesTo(spec);
  return {
  type: 'button',
  name: `${label} button`,
  props: { label, ...to.props },
  ...(to.refs ? { refs: to.refs } : {}),
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
  };
};

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
  const ctaGoes = cta ? goesTo(asLink(cta)) : { props: {} };
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
            /*
             * A nav entry that can name a section rather than typing its
             * fragment. `goesTo` decides which, so the nav row, the nav's call
             * to action and every button in the kit answer "where does this go"
             * the same way.
             */
            children: links.map((link) => {
              const to = goesTo(asLink(link));
              return {
                type: 'link' as const,
                /*
                 * "Work link", not "Work", and the suffix is load-bearing.
                 *
                 * References resolve by name and the first match wins, so a nav
                 * entry named after the section it points at claimed its own id
                 * — the link resolved to itself, had no anchor, and shipped as a
                 * link to nowhere. `buildTree` refuses a self-reference now,
                 * which turns that into a visible miss; naming them apart is
                 * what makes the reference land on the section instead. It also
                 * matches the `… button` convention beside it.
                 */
                name: `${linkLabel(link)} link`,
                props: { text: linkLabel(link), ...to.props },
                ...(to.refs ? { refs: to.refs } : {}),
                styles: { fontSize: '14.5px', color: 'var(--c-muted)' },
                states: { hover: { color: 'var(--c-text)' } },
              };
            }),
          },
          ...(cta
            ? [
                {
                  type: 'button' as const,
                  name: `${linkLabel(cta)} button`,
                  ...(ctaGoes.refs ? { refs: ctaGoes.refs } : {}),
                  props: { label: linkLabel(cta), ...ctaGoes.props },
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
                transition: 'border-color 180ms ease, box-shadow 180ms ease',
              },
              /*
               * Border and shadow, and no lift.
               *
               * The rule the library now holds to: a card that *rises* under
               * the pointer is promising a destination, and these cards are
               * features and promises and prices — they have nowhere to go and
               * never will. A border warming and a shadow arriving is feedback
               * ("you are here"); two pixels of travel is an offer. The same
               * cut `galleryBlock` took, and `checkFakeAffordance` in the
               * static suite is what stops it coming back.
               */
              states: {
                hover: {
                  borderColor: 'color-mix(in srgb, var(--c-primary) 40%, var(--c-border))',
                  boxShadow: 'var(--sh-md)',
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

/**
 * The same URL a `photo` node carries, for content rather than for design.
 *
 * A seeded row supplies its own picture — that is what an `image` field is —
 * and it has to spell the address the same way, or the one line above stops
 * being the only place the host is named and moving off picsum quietly leaves
 * every template's records pointing at it.
 */
export const photoUrl = (seed: string, width: number, height: number): string =>
  `${PLACEHOLDER_PHOTO}/seed/${seed}/${width}/${height}`;

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
      src: photoUrl(seed, width, height),
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
  /**
   * Twice the width, for the one piece of work worth leading with.
   *
   * Optional and off by default: a gallery where everything is featured is a
   * gallery where nothing is. The narrow-width reset is handled below rather
   * than asked of the caller — a span left un-released on a phone makes the
   * grid invent a column and the page scroll sideways, which is not a mistake
   * a template author should have to remember not to make.
   */
  wide?: boolean;
}

/**
 * A wide card gets a wide picture unless the caller says otherwise.
 *
 * Not cosmetic: at three columns a double-width card is a bit over twice as
 * wide as its neighbours, so holding the ratio at 4/3 makes it twice as tall
 * as well and the row goes badly out of balance. A letterbox crop brings the
 * two within a hand's breadth of each other, which is as close as a fixed
 * ratio can get across breakpoints.
 */
const ratioOf = (item: GalleryItem): string =>
  item.ratio ?? (item.wide ? '11 / 4' : '4 / 3');

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
              ...(item.wide ? { gridColumn: 'span 2' } : {}),
              /*
               * Arrives as it is scrolled to, and costs the page nothing to run:
               * the timeline is the scrollport.
               *
               * On a gallery and not on every card in the library, which is a
               * judgement rather than an oversight. A reveal reads as intent on
               * something with visual weight arriving in a rhythm — pictures of
               * work, products — and as noise on a dense list of lines, which
               * is what `listBlock` mostly is: menus, FAQs, changelogs. Twelve
               * menu prices fading up one after another is motion for its own
               * sake.
               */
              appear: 'rise',
            },
            ...(item.wide
              ? {
                  responsive: {
                    tablet: { gridColumn: 'span 2' },
                    mobile: { gridColumn: 'auto' },
                  },
                }
              : {}),
            /*
             * And no lift on hover, which it used to have.
             *
             * That lift was borrowed from a card you click, and while this
             * block was standing in for the agency's case studies it was very
             * nearly honest. It is not any more: `workGridBlock` is where a
             * card that goes somewhere lives, and what is left here is a wall
             * of pictures. A photograph that rises under the pointer and does
             * nothing when pressed is the smallest possible lie a page can
             * tell, and it is still one.
             */
            children: [
              item.photo
                ? photo({
                    ...item.photo,
                    // Square off the bottom: the card's own radius clips it,
                    // and a rounded photo inside a rounded card leaves a
                    // sliver of border showing at each corner.
                    styles: { ...radius('0px'), aspectRatio: ratioOf(item) },
                  })
                : frame('Thumbnail', [], {
                    width: '100%',
                    aspectRatio: ratioOf(item),
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
          /*
           * `start`, so a card is as tall as its own contents.
           *
           * Grid stretches by default, and in a mixed-width gallery that is
           * wrong in a way that looks like a bug: a double-width card at the
           * same aspect ratio is roughly twice as tall as its neighbour, and
           * stretching makes the neighbour a tall empty box with its caption
           * stranded at the top. Exact height matching is not available —
           * whatever ratio pairs at three columns is wrong at two, because the
           * wide card's share of the row changes and the narrow one's does not
           * — so the honest arrangement is ragged bottoms and cards that are
           * the size of what is in them.
           */
          { gap: '20px', alignItems: 'start' }
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
            {
              gap: '24px 40px',
              // The same measure `feedBlock` takes, for the same reason: one
              // column across the full content width leaves a left-aligned
              // list sitting off to one side of its own centred title, with
              // every row's meta stranded at the far edge.
              ...(columns === 1
                ? {
                    maxWidth: 'var(--w-narrow)',
                    width: '100%',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                  }
                : {}),
            },
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
  /**
   * Which fields a row reads. The defaults are an essay's; a list of projects
   * calls the same three things by different names, and renaming the *fields*
   * to suit the block would be the design dictating the content model.
   */
  fields?: { title?: string; meta?: string; summary?: string };
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
  fields = {},
  columns = 2,
  paginate,
  surface = false,
}: FeedOptions): NodeSpec {
  const titleField = fields.title ?? 'title';
  const metaField = fields.meta ?? 'readingTime';
  const summaryField = fields.summary ?? 'excerpt';

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
            bind: { text: titleField },
          },
          {
            ...text('12 min', {
              fontSize: '15px',
              fontWeight: '580',
              color: 'var(--c-primary)',
              whiteSpace: 'nowrap',
            }),
            bind: { text: metaField },
          },
        ],
        { gap: '16px', alignItems: 'baseline', width: '100%' }
      ),
      {
        ...body('The essay’s opening line.', { fontSize: '14.5px' }),
        bind: { text: summaryField },
      },
    ],
  };

  return section(
    name,
    [
      container(
        [
          sectionHeader(undefined, title, intro),
          {
            ...grid(
              'Essays',
              [card],
              columns,
              {
                gap: '8px 40px',
                /*
                 * One column is a different shape, not a narrower two.
                 *
                 * Each row puts its title at the left edge and its meta at the
                 * right, which works across a card and falls apart across a
                 * container: at full content width the date ends up four
                 * hundred pixels from the title it belongs to and the eye
                 * cannot pair them. Two columns already halve the distance, so
                 * only the single-column case needs the measure.
                 */
                // Centred with it, because `sectionHeader` is centred and a
                // capped list left in place sits off to one side of its own
                // title.
                ...(columns === 1
                  ? {
                      maxWidth: 'var(--w-narrow)',
                      width: '100%',
                      marginLeft: 'auto',
                      marginRight: 'auto',
                    }
                  : {}),
              },
              { mobile: { gridTemplateColumns: '1fr' } }
            ),
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

export interface WorkGridOptions {
  /** Names the section, so a nav can jump to it and a page can anchor it. */
  name?: string;
  title: string;
  intro?: string;
  collection: string;
  /** The page one record opens on. A `pageRef`, resolved once pages have ids. */
  detail: string;
  /** Which fields the card reads. Defaults suit a portfolio of work. */
  fields?: { image?: string; alt?: string; title?: string; meta?: string };
  /** The words on the affordance. Not a control — see below. */
  cue?: string;
  columns?: number;
  ratio?: string;
}

/**
 * A gallery of work, one card per record, each card a link to its own page.
 *
 * The first place in the library where a *layout box* is the thing you click.
 * Until containers could carry a destination this had to be a link element
 * wrapping a picture and a caption, or a card with a "View case study" button
 * stuck in the corner — the second being what a builder makes you do and the
 * reason "make the whole card clickable" is the request it is.
 *
 * The card holds an image and three lines of text and nothing operable, which
 * is what makes it legal: a control inside a clickable card is markup the
 * parser rearranges, and `canReparent` refuses it now. The last of those lines
 * is why the affordance is *text* — a card that goes somewhere should say so,
 * and the moment it says so with a button the card can no longer be the link.
 *
 * Uniformly one shape per record, deliberately. `galleryBlock` can hand one
 * item a double-width span because each of its cards is its own node; a
 * repeater draws one node many times, and per-record layout would need a
 * binding that reaches a style property, which is not a thing yet. Told
 * plainly here so the next person reaching for a bento over a collection finds
 * the reason rather than the omission.
 */
export function workGridBlock({
  name = 'Gallery',
  title,
  intro,
  collection,
  detail,
  fields = {},
  cue = 'View case study',
  columns = 3,
  ratio = '4 / 3',
}: WorkGridOptions): NodeSpec {
  const imageField = fields.image ?? 'image';
  /*
   * Its own field, not the title.
   *
   * Binding `alt` to whatever the card already says is the easy shortcut and
   * it produces a page where a screen reader reads every heading twice — the
   * picture announcing the words printed underneath it. A record that carries
   * a picture carries a description of the picture, which is the same rule
   * `photo` applies to a designer and there is no reason it should relax for
   * content.
   */
  const altField = fields.alt ?? 'alt';
  const titleField = fields.title ?? 'title';
  const metaField = fields.meta ?? 'discipline';

  const card: NodeSpec = {
    type: 'frame',
    name: 'Case card',
    props: { href: detail },
    styles: {
      ...pad('0px'),
      gap: '0px',
      ...radius('var(--r-lg)'),
      overflow: 'hidden',
      ...border('1px', 'var(--c-border)'),
      backgroundColor: 'var(--c-background)',
      transition: 'transform 220ms ease, box-shadow 220ms ease',
      appear: 'rise',
    },
    states: { hover: { transform: 'translateY(-3px)', boxShadow: 'var(--sh-lg)' } },
    children: [
      {
        ...photo({
          seed: 'ff-case',
          alt: 'A piece of work',
          width: 900,
          height: 675,
          // Squared off: the card clips it, and a rounded picture inside a
          // rounded card leaves a sliver of border at each corner.
          styles: { ...radius('0px'), aspectRatio: ratio },
        }),
        bind: { src: imageField, alt: altField },
      },
      stack(
        'Caption',
        [
          {
            ...text('Project', {
              fontSize: '15.5px',
              fontWeight: '580',
              color: 'var(--c-text)',
            }),
            bind: { text: titleField },
          },
          {
            ...text('Discipline · Year', { fontSize: '13px', color: 'var(--c-muted)' }),
            bind: { text: metaField },
          },
          /*
           * Static, and the card's lift is the whole hover response.
           *
           * The obvious flourish — the arrow sliding right as the pointer
           * enters the card — is not expressible and should not be faked. A
           * `pointer` condition joins the element's *own* compound, so a hover
           * declared on this line fires on these three words and not on the
           * nine tenths of the card that actually triggers it. Faking it there
           * would ship a cue that ignores most of its own target.
           */
          /*
           * `auto`, not a fixed gap. Grid stretches the cards in a row to one
           * height, so a card whose title fits on one line has slack in it
           * somewhere — and with a fixed margin the slack lands under the cue,
           * leaving the six cues on a row at two different heights. Pushing
           * the top margin to `auto` moves the slack above the cue instead, so
           * every cue sits the same distance off the bottom edge whatever the
           * title above it did. `paddingTop` is the floor for the case where
           * there is no slack at all.
           */
          text(`${cue} →`, {
            fontSize: '13px',
            fontWeight: '560',
            color: 'var(--c-primary)',
            marginTop: 'auto',
            paddingTop: '10px',
          }),
        ],
        {
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '4px',
          ...pad('16px', '18px'),
          backgroundColor: 'var(--c-background)',
          width: '100%',
          // Takes what the picture leaves, so the `auto` margin above has
          // something to distribute.
          flexGrow: '1',
        }
      ),
    ],
  };

  return section(name, [
    container(
      [
        ...(title ? [sectionHeader(undefined, title, intro)] : []),
        {
          ...grid('Work grid', [card], columns, { gap: '20px' }),
          repeat: { collection },
        },
      ],
      { gap: '52px' }
    ),
  ]);
}

export interface CaseStudyOptions {
  /** Where the back link goes — the index this record was reached from. */
  back: string;
  backLabel?: string;
  /** Which fields it reads. Only `title` and `body` are required of a record. */
  fields?: {
    title?: string;
    eyebrow?: string;
    summary?: string;
    image?: string;
    alt?: string;
    body?: string;
  };
  /** Named pairs down the side: `label` is fixed, `field` varies per record. */
  facts?: { label: string; field: string }[];
  /**
   * A hero picture. On by default, off for a site that has no photography.
   *
   * A boolean and not a nullable field name, because the question is not which
   * field holds the picture — that is `fields.image` — but whether this kind of
   * record has one at all. A designer's portfolio of software has screenshots;
   * a writer's list of projects often has nothing to photograph, and a block
   * that insists leaves a grey rectangle where the record's silence was.
   */
  picture?: boolean;
  /** The hero's shape. Landscape suits work; a product wants its own. */
  ratio?: string;
  /**
   * A ceiling on how wide the hero gets, and therefore on how tall.
   *
   * Needed the moment the ratio stops being landscape. A 16/9 hero across the
   * content width is about five hundred pixels tall and reads as a header; the
   * same width at 1/1 is eight hundred, which is a screen and a half of
   * photograph with the price underneath it. Capping the width rather than the
   * height because a square product shot cropped to a letterbox loses the top
   * and the bottom of the object, which on a carafe is the object.
   */
  pictureWidth?: string;
}

/**
 * One record of work, laid out to be looked at.
 *
 * `articleBlock`'s sibling, and separate rather than a flag on it: an essay is
 * a column of prose and a case study is a picture with a column of prose under
 * it and a short table of facts beside it. Trying to be both would have been a
 * block with three layout switches, which is how a library of blocks becomes a
 * library of options.
 *
 * The facts are the reason this exists at all. A studio's case study answers
 * "who, what, when" before it answers anything else, and those are three
 * fields on a record rather than three sentences in the body — so the label
 * stays put in the design and only the value comes from the content.
 */
export function caseStudyBlock({
  back,
  backLabel = '← All work',
  fields = {},
  facts = [],
  picture = true,
  ratio = '16 / 9',
  pictureWidth,
}: CaseStudyOptions): NodeSpec {
  const titleField = fields.title ?? 'title';
  const eyebrowField = fields.eyebrow ?? 'client';
  const summaryField = fields.summary ?? 'summary';
  const imageField = fields.image ?? 'image';
  const altField = fields.alt ?? 'alt';
  const bodyField = fields.body ?? 'body';

  const factRow = (label: string, field: string): NodeSpec =>
    stack(
      label,
      [
        text(label, {
          fontSize: '12px',
          fontWeight: '580',
          color: 'var(--c-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }),
        { ...text('—', { fontSize: '15px', color: 'var(--c-text)' }), bind: { text: field } },
      ],
      { flexDirection: 'column', alignItems: 'flex-start', gap: '5px', width: '100%' }
    );

  return section('Case study', [
    container(
      [
        stack(
          'Masthead',
          [
            {
              type: 'link',
              name: 'Back',
              props: { text: backLabel, href: back },
              styles: { fontSize: '14px', color: 'var(--c-muted)' },
              states: { hover: { color: 'var(--c-text)' } },
            },
            {
              ...text('Client', {
                fontSize: '13px',
                fontWeight: '580',
                color: 'var(--c-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
              }),
              bind: { text: eyebrowField },
            },
            {
              ...heading(
                'The project',
                1,
                {
                  fontSize: '52px',
                  fontWeight: '600',
                  lineHeight: '1.08',
                  letterSpacing: '-0.03em',
                  maxWidth: '18ch',
                  textWrap: 'balance',
                },
                DISPLAY_RESPONSIVE
              ),
              bind: { text: titleField },
            },
            {
              ...body('What the work was.', { fontSize: '19px', maxWidth: '54ch' }),
              bind: { text: summaryField },
            },
          ],
          { flexDirection: 'column', alignItems: 'flex-start', gap: '18px', width: '100%' }
        ),
        ...(picture
          ? [
              {
                ...photo({
                  seed: 'ff-case-hero',
                  alt: 'The work',
                  width: 1600,
                  height: 900,
                  // Above the fold on this page in a way it never is in the
                  // grid, and the one image on it: worth the eager fetch.
                  priority: true,
                  styles: {
                    aspectRatio: ratio,
                    width: '100%',
                    ...(pictureWidth ? { maxWidth: pictureWidth } : {}),
                  },
                }),
                bind: { src: imageField, alt: altField },
              },
            ]
          : []),
        /*
         * Facts beside the prose on a wide screen, above it on a narrow one —
         * `flex-wrap` rather than a grid, because the two are not tracks: the
         * sidebar has a fixed comfortable width and the prose takes the rest.
         */
        stack(
          'Detail',
          [
            ...(facts.length
              ? [
                  stack(
                    'Facts',
                    facts.map((fact) => factRow(fact.label, fact.field)),
                    {
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '22px',
                      width: '196px',
                      flexGrow: '0',
                      flexShrink: '0',
                    },
                    { mobile: { width: '100%' } }
                  ),
                ]
              : []),
            {
              type: 'richtext',
              name: 'Case body',
              props: { html: '<p>The work.</p>' },
              bind: { html: bodyField },
              styles: {
                fontSize: '17.5px',
                lineHeight: '1.72',
                color: 'var(--c-text)',
                maxWidth: '66ch',
                flexGrow: '1',
                flexShrink: '1',
                flexBasis: '380px',
              },
            },
          ],
          { gap: '56px', alignItems: 'flex-start', flexWrap: 'wrap', width: '100%' },
          { mobile: { gap: '32px' } }
        ),
      ],
      { gap: '44px', alignItems: 'flex-start' }
    ),
  ]);
}

/**
 * One record, laid out to be read.
 *
 * The other half of a collection: a list is only half a blog. Everything on it
 * is bound, so the page is a template rather than a page — the publisher makes
 * one file per record from it.
 */
export interface ArticleOptions {
  backLabel?: string;
  /**
   * Which fields it reads.
   *
   * Named rather than assumed, and the reason is worth stating: a field the
   * record does not carry leaves the design-time prop alone — that is what
   * makes a half-filled record show placeholder copy rather than a row of
   * blanks. It also means a block bound to `readingTime` on a collection whose
   * records carry `date` publishes the literal words "12 min" to a real page,
   * and nothing anywhere would call that an error.
   */
  fields?: { title?: string; meta?: string; body?: string };
}

export function articleBlock(back: string, options: ArticleOptions = {}): NodeSpec {
  const { backLabel = '← All essays', fields = {} } = options;
  const titleField = fields.title ?? 'title';
  const metaField = fields.meta ?? 'readingTime';
  const bodyField = fields.body ?? 'body';

  return section('Essay', [
    {
      ...container(
        [
          {
            type: 'link',
            name: 'Back',
            props: { text: backLabel, href: back },
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
            bind: { text: titleField },
          },
          {
            ...text('12 min', {
              fontSize: '14px',
              fontWeight: '580',
              color: 'var(--c-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }),
            bind: { text: metaField },
          },
          {
            type: 'richtext',
            name: 'Essay body',
            props: { html: '<p>The essay.</p>' },
            bind: { html: bodyField },
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
                    // The footer, through the same helper as the nav. It was
                    // the last place still calling `linkHref` directly, so a
                    // footer entry naming a section fell back to `#` while the
                    // identical nav entry beside it worked.
                    ...column.links.map((link) => ({
                      type: 'link' as const,
                      name: `${linkLabel(link)} link`,
                      props: { text: linkLabel(link), ...goesTo(asLink(link)).props },
                      ...(goesTo(asLink(link)).refs ? { refs: goesTo(asLink(link)).refs } : {}),
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
