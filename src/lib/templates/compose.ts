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
  links: string[];
  cta?: string;
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
            children: links.map((label) => ({
              type: 'link' as const,
              name: label,
              props: { text: label, href: '#' },
              styles: { fontSize: '14.5px', color: 'var(--c-muted)' },
              states: { hover: { color: 'var(--c-text)' } },
            })),
          },
          ...(cta
            ? [
                {
                  type: 'button' as const,
                  name: `${cta} button`,
                  props: { label: cta, href: '#' },
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

export interface GalleryItem {
  title: string;
  subtitle?: string;
  gradient: string;
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
              frame('Thumbnail', [], {
                width: '100%',
                aspectRatio: item.ratio ?? '4 / 3',
                backgroundImage: item.gradient,
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
              props: { label: buttonLabel, href: '' },
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
  columns: { title: string; links: string[] }[],
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
                    ...column.links.map((label) => ({
                      type: 'link' as const,
                      name: label,
                      props: { text: label, href: '#' },
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
