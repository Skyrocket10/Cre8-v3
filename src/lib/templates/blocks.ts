/**
 * Section blocks.
 *
 * These are plain `NodeSpec` trees — the exact same structure the editor
 * produces when you build something by hand. There is no privileged "template
 * element": a template is data, which is what will let an AI emit one later.
 *
 * Every block carries tablet and mobile overrides, so anything inserted from
 * here is responsive from the moment it lands on the page.
 */

import type { NodeSpec } from '../document/factory';
import type { ResponsiveStyles, StyleDecl } from '../document/types';

/* --------------------------------------------------------------------------
 * Small helpers
 * ----------------------------------------------------------------------- */

const pad = (top: string, right = top, bottom = top, left = right): StyleDecl => ({
  paddingTop: top,
  paddingRight: right,
  paddingBottom: bottom,
  paddingLeft: left,
});

const radius = (r: string): StyleDecl => ({
  borderTopLeftRadius: r,
  borderTopRightRadius: r,
  borderBottomRightRadius: r,
  borderBottomLeftRadius: r,
});

const border = (width = '1px', color = 'var(--c-border)'): StyleDecl => ({
  borderStyle: 'solid',
  borderTopWidth: width,
  borderRightWidth: width,
  borderBottomWidth: width,
  borderLeftWidth: width,
  borderColor: color,
});

const section = (
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

const container = (
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'container',
  name: 'Container',
  styles: { gap: '48px', ...styles },
  responsive,
  children,
});

const stack = (
  name: string,
  children: NodeSpec[],
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({ type: 'stack', name, styles, responsive, children });

const heading = (
  text: string,
  level: number,
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'heading',
  name: text.slice(0, 28),
  props: { text, level },
  styles: { color: 'var(--c-text)', ...styles },
  responsive,
});

const paragraph = (
  text: string,
  styles: StyleDecl = {},
  responsive: ResponsiveStyles = {}
): NodeSpec => ({
  type: 'paragraph',
  name: 'Paragraph',
  props: { text },
  styles: { color: 'var(--c-muted)', ...styles },
  responsive,
});

const label = (text: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'text',
  name: text.slice(0, 24) || 'Text',
  props: { text },
  styles,
});

const button = (
  text: string,
  variant: 'primary' | 'secondary' = 'primary',
  href = '#'
): NodeSpec => ({
  type: 'button',
  name: `${text} button`,
  props: { label: text, href },
  styles:
    variant === 'primary'
      ? {}
      : {
          backgroundColor: 'transparent',
          color: 'var(--c-text)',
          ...border('1px', 'var(--c-border)'),
        },
  states:
    variant === 'primary'
      ? { hover: { backgroundColor: 'var(--c-secondary)' } }
      : { hover: { backgroundColor: 'var(--c-surface)' } },
});

const icon = (name: string, styles: StyleDecl = {}): NodeSpec => ({
  type: 'icon',
  name: `${name} icon`,
  props: { name, strokeWidth: 1.75 },
  styles,
});

const EYEBROW: StyleDecl = {
  fontSize: '12px',
  fontWeight: '600',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--c-primary)',
};

const DISPLAY: StyleDecl = {
  fontSize: '64px',
  fontWeight: '620',
  lineHeight: '1.04',
  letterSpacing: '-0.033em',
};

const DISPLAY_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '48px' },
  mobile: { fontSize: '34px', letterSpacing: '-0.022em' },
};

const TITLE: StyleDecl = {
  fontSize: '40px',
  fontWeight: '600',
  lineHeight: '1.14',
  letterSpacing: '-0.026em',
};

const TITLE_RESPONSIVE: ResponsiveStyles = {
  tablet: { fontSize: '34px' },
  mobile: { fontSize: '27px' },
};

const ONE_COLUMN: ResponsiveStyles = { mobile: { gridTemplateColumns: '1fr' } };
const TWO_TO_ONE: ResponsiveStyles = {
  tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  mobile: { gridTemplateColumns: '1fr' },
};

/* --------------------------------------------------------------------------
 * Navbar
 * ----------------------------------------------------------------------- */

export function navbarSpec(): NodeSpec {
  return {
    type: 'section',
    name: 'Navbar',
    styles: {
      ...pad('16px', '24px'),
      position: 'sticky',
      top: '0px',
      zIndex: '50',
      backgroundColor: 'color-mix(in srgb, var(--c-background) 82%, transparent)',
      backdropFilter: 'saturate(180%) blur(14px)',
      borderStyle: 'solid',
      borderBottomWidth: '1px',
      borderColor: 'var(--c-border)',
    },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      container(
        [
          stack('Brand', [
            icon('bolt', {
              width: '26px',
              height: '26px',
              color: 'var(--c-primary)',
            }),
            label('Northwind', {
              fontSize: '17px',
              fontWeight: '640',
              letterSpacing: '-0.02em',
              color: 'var(--c-text)',
            }),
          ], { gap: '9px' }),

          {
            type: 'navigation',
            name: 'Nav links',
            styles: { gap: '30px' },
            responsive: { mobile: { display: 'none' } },
            children: ['Product', 'Features', 'Pricing', 'Docs'].map((text) => ({
              type: 'link' as const,
              name: text,
              props: { text, href: '#' },
              styles: { fontSize: '14.5px', color: 'var(--c-muted)' },
              states: { hover: { color: 'var(--c-text)' } },
            })),
          },

          stack(
            'Nav actions',
            [
              {
                type: 'link',
                name: 'Sign in',
                props: { text: 'Sign in', href: '#' },
                styles: { fontSize: '14.5px', color: 'var(--c-muted)' },
                states: { hover: { color: 'var(--c-text)' } },
                responsive: { mobile: { display: 'none' } },
              },
              {
                type: 'button',
                name: 'Start free button',
                props: { label: 'Start free', href: '#' },
                styles: {
                  fontSize: '14px',
                  paddingTop: '9px',
                  paddingBottom: '9px',
                  paddingLeft: '16px',
                  paddingRight: '16px',
                },
                states: { hover: { backgroundColor: 'var(--c-secondary)' } },
              },
            ],
            { gap: '20px' }
          ),
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

export function heroSectionSpec(): NodeSpec {
  return section(
    'Hero',
    [
      container(
        [
          stack(
            'Hero copy',
            [
              stack(
                'Announcement',
                [
                  label('New', {
                    fontSize: '11px',
                    fontWeight: '650',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--c-primary)',
                    backgroundColor: 'color-mix(in srgb, var(--c-primary) 12%, transparent)',
                    ...pad('3px', '8px'),
                    ...radius('var(--r-full)'),
                  }),
                  label('Realtime collaboration is live', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                  icon('arrow-right', { width: '14px', height: '14px', color: 'var(--c-muted)' }),
                ],
                {
                  gap: '8px',
                  ...pad('5px', '14px', '5px', '5px'),
                  ...radius('var(--r-full)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundColor: 'var(--c-surface)',
                }
              ),

              heading('Ship your product, not your infrastructure.', 1, {
                ...DISPLAY,
                maxWidth: '21ch',
                textWrap: 'balance',
              }, DISPLAY_RESPONSIVE),

              paragraph(
                'Northwind gives product teams a single place to plan, build and launch — with the deploy pipeline, analytics and on-call rotation already wired up.',
                { fontSize: '19px', lineHeight: '1.58', maxWidth: '52ch' },
                { mobile: { fontSize: '16.5px' } }
              ),

              stack(
                'Hero actions',
                [button('Start building free'), button('Book a demo', 'secondary')],
                { gap: '12px', marginTop: '8px' },
                { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
              ),

              stack(
                'Hero note',
                [
                  icon('circle-check', {
                    width: '15px',
                    height: '15px',
                    color: 'var(--c-primary)',
                  }),
                  label('Free for 14 days · No credit card required', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                ],
                { gap: '8px', marginTop: '4px' }
              ),
            ],
            { flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center' }
          ),

          productShotSpec(),
        ],
        { gap: '64px', alignItems: 'center', maxWidth: 'var(--w-wide)' },
        { mobile: { gap: '40px' } }
      ),
    ],
    {
      paddingTop: '96px',
      paddingBottom: '112px',
      backgroundImage:
        'radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--c-primary) 13%, transparent) 0%, transparent 62%)',
    },
    { mobile: { paddingTop: '52px' } }
  );
}

/** A browser chrome built from primitives — no placeholder image required. */
function productShotSpec(): NodeSpec {
  const dot = (color: string): NodeSpec => ({
    type: 'frame',
    name: 'Dot',
    styles: {
      width: '9px',
      height: '9px',
      ...radius('var(--r-full)'),
      backgroundColor: color,
      ...pad('0px'),
      flexShrink: '0',
    },
  });

  const bar = (width: string, opacity = '1'): NodeSpec => ({
    type: 'frame',
    name: 'Bar',
    styles: {
      width,
      height: '9px',
      ...radius('var(--r-full)'),
      backgroundColor: 'var(--c-border)',
      opacity,
      ...pad('0px'),
      flexShrink: '0',
    },
  });

  const sidebarRow = (width: string, active = false): NodeSpec => ({
    type: 'stack',
    name: 'Nav item',
    styles: {
      gap: '8px',
      alignItems: 'center',
      width: '100%',
      ...pad('7px', '9px'),
      ...radius('var(--r-sm)'),
      backgroundColor: active
        ? 'color-mix(in srgb, var(--c-primary) 12%, transparent)'
        : 'transparent',
    },
    children: [
      {
        type: 'frame',
        name: 'Glyph',
        styles: {
          width: '11px',
          height: '11px',
          ...radius('3px'),
          backgroundColor: active ? 'var(--c-primary)' : 'var(--c-border)',
          ...pad('0px'),
          flexShrink: '0',
        },
      },
      bar(width, active ? '1' : '0.75'),
    ],
  });

  const metric = (title: string, value: string, tone: string): NodeSpec => ({
    type: 'frame',
    name: `${title} card`,
    styles: {
      ...pad('16px'),
      ...radius('var(--r-md)'),
      ...border('1px', 'var(--c-border)'),
      backgroundColor: 'var(--c-background)',
      gap: '7px',
      width: '100%',
    },
    children: [
      label(title, { fontSize: '11.5px', color: 'var(--c-muted)' }),
      label(value, {
        fontSize: '23px',
        fontWeight: '620',
        letterSpacing: '-0.02em',
        color: 'var(--c-text)',
      }),
      {
        type: 'frame',
        name: 'Trend',
        styles: {
          width: '100%',
          height: '4px',
          ...radius('var(--r-full)'),
          backgroundColor: tone,
          ...pad('0px'),
        },
      },
    ],
  });

  return {
    type: 'frame',
    name: 'Product screenshot',
    styles: {
      width: '100%',
      maxWidth: '1000px',
      ...pad('0px'),
      ...radius('var(--r-lg)'),
      ...border('1px', 'var(--c-border)'),
      backgroundColor: 'var(--c-background)',
      boxShadow: 'var(--sh-xl)',
      overflow: 'hidden',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    children: [
      stack(
        'Browser bar',
        [
          stack('Traffic lights', [dot('#ff5f57'), dot('#febc2e'), dot('#28c840')], { gap: '6px' }),
          {
            type: 'frame',
            name: 'Address',
            styles: {
              flexGrow: '1',
              height: '22px',
              ...radius('var(--r-full)'),
              backgroundColor: 'var(--c-surface-2)',
              ...pad('0px'),
              maxWidth: '260px',
              marginLeft: 'auto',
              marginRight: 'auto',
            },
          },
        ],
        {
          gap: '12px',
          alignItems: 'center',
          width: '100%',
          ...pad('12px', '14px'),
          backgroundColor: 'var(--c-surface)',
          borderStyle: 'solid',
          borderBottomWidth: '1px',
          borderColor: 'var(--c-border)',
        }
      ),
      stack(
        'App body',
        [
          {
            type: 'frame',
            name: 'Sidebar',
            styles: {
              width: '190px',
              flexShrink: '0',
              gap: '5px',
              ...pad('16px', '12px'),
              backgroundColor: 'var(--c-surface)',
              alignSelf: 'stretch',
            },
            responsive: { mobile: { display: 'none' } },
            children: [
              sidebarRow('58px', true),
              sidebarRow('72px'),
              sidebarRow('46px'),
              sidebarRow('64px'),
              sidebarRow('52px'),
            ],
          },
          {
            type: 'frame',
            name: 'Main',
            styles: { flexGrow: '1', gap: '16px', ...pad('22px'), minWidth: '0px' },
            children: [
              stack(
                'Toolbar',
                [bar('120px'), bar('64px', '0.6')],
                { gap: '10px', alignItems: 'center' }
              ),
              {
                type: 'grid',
                name: 'Metrics',
                styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' },
                responsive: { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
                children: [
                  metric('Deploys', '1,284', 'var(--c-primary)'),
                  metric('P95 latency', '84ms', 'var(--c-accent)'),
                  metric('Uptime', '99.99%', '#22c55e'),
                ],
              },
              {
                type: 'frame',
                name: 'Chart',
                styles: {
                  width: '100%',
                  height: '150px',
                  ...radius('var(--r-md)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundImage:
                    'linear-gradient(180deg, color-mix(in srgb, var(--c-primary) 16%, transparent) 0%, transparent 100%)',
                  ...pad('0px'),
                },
                responsive: { mobile: { height: '96px' } },
              },
            ],
          },
        ],
        { gap: '0px', alignItems: 'stretch', width: '100%' }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Logo cloud
 * ----------------------------------------------------------------------- */

export function logoCloudSpec(): NodeSpec {
  const names = ['Vercount', 'Lumen', 'Basewave', 'Orbital', 'Kettle', 'Halcyon'];
  return section(
    'Logos',
    [
      container(
        [
          label('Trusted by fast-moving teams at', {
            fontSize: '12.5px',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--c-muted)',
            textAlign: 'center',
          }),
          {
            type: 'stack',
            name: 'Logo row',
            styles: {
              gap: '52px',
              justifyContent: 'center',
              flexWrap: 'wrap',
              width: '100%',
            },
            responsive: { mobile: { gap: '26px' } },
            children: names.map((name) =>
              label(name, {
                fontSize: '19px',
                fontWeight: '600',
                letterSpacing: '-0.018em',
                color: 'var(--c-text)',
                opacity: '0.42',
              })
            ),
          },
        ],
        { gap: '28px', alignItems: 'center' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '56px' }
  );
}

/* --------------------------------------------------------------------------
 * Features
 * ----------------------------------------------------------------------- */

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: 'rocket',
    title: 'Deploy in seconds',
    body: 'Every push builds, previews and ships to the edge. Rollbacks are one click and never lose state.',
  },
  {
    icon: 'chart-column',
    title: 'Analytics built in',
    body: 'Product and performance metrics in the same place, without stitching together four dashboards.',
  },
  {
    icon: 'shield-check',
    title: 'Secure by default',
    body: 'SSO, audit logs, scoped tokens and SOC 2 controls come switched on rather than sold separately.',
  },
  {
    icon: 'workflow',
    title: 'Automate the boring parts',
    body: 'Rules react to deploys, incidents and reviews so your team stops copying links between tools.',
  },
  {
    icon: 'users',
    title: 'Made for teams',
    body: 'Shared environments, per-branch previews and comments that live next to the work itself.',
  },
  {
    icon: 'git-branch',
    title: 'Works with your stack',
    body: 'First-class support for the frameworks and runtimes you already use. No rewrites required.',
  },
];

export function featureSectionSpec(): NodeSpec {
  return section(
    'Features',
    [
      container(
        [
          sectionHeaderSpec(
            'Platform',
            'Everything you need after the first commit',
            'One integrated surface instead of nine subscriptions that almost talk to each other.'
          ),
          {
            type: 'grid',
            name: 'Feature grid',
            styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' },
            responsive: TWO_TO_ONE,
            children: FEATURES.map((feature) => ({
              type: 'frame' as const,
              name: feature.title,
              styles: {
                ...pad('26px'),
                gap: '14px',
                ...radius('var(--r-lg)'),
                ...border('1px', 'var(--c-border)'),
                backgroundColor: 'var(--c-background)',
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
                {
                  type: 'frame',
                  name: 'Icon badge',
                  styles: {
                    width: '38px',
                    height: '38px',
                    ...pad('0px'),
                    ...radius('var(--r-md)'),
                    backgroundColor: 'color-mix(in srgb, var(--c-primary) 11%, transparent)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: '0',
                  },
                  children: [
                    icon(feature.icon, {
                      width: '19px',
                      height: '19px',
                      color: 'var(--c-primary)',
                    }),
                  ],
                },
                heading(feature.title, 3, {
                  fontSize: '17.5px',
                  fontWeight: '600',
                  letterSpacing: '-0.014em',
                  lineHeight: '1.3',
                }),
                paragraph(feature.body, { fontSize: '14.5px', lineHeight: '1.6' }),
              ],
            })),
          },
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

function sectionHeaderSpec(eyebrow: string, title: string, body: string): NodeSpec {
  return stack(
    'Section header',
    [
      label(eyebrow, EYEBROW),
      heading(title, 2, { ...TITLE, maxWidth: '24ch', textWrap: 'balance' }, TITLE_RESPONSIVE),
      paragraph(body, { fontSize: '17.5px', maxWidth: '58ch' }, { mobile: { fontSize: '16px' } }),
    ],
    {
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: '16px',
      width: '100%',
    }
  );
}

/* --------------------------------------------------------------------------
 * Pricing
 * ----------------------------------------------------------------------- */

const TIERS = [
  {
    name: 'Hobby',
    price: '$0',
    cadence: '/month',
    blurb: 'For side projects and prototypes.',
    features: ['1 project', 'Community support', '10 GB bandwidth', 'Preview deploys'],
    featured: false,
  },
  {
    name: 'Team',
    price: '$28',
    cadence: '/user / month',
    blurb: 'For teams shipping to production.',
    features: [
      'Unlimited projects',
      'Priority support',
      '1 TB bandwidth',
      'SSO & audit logs',
      'Rollbacks and alerts',
    ],
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    blurb: 'For organisations with compliance needs.',
    features: [
      'Dedicated regions',
      'Named support engineer',
      'Custom contracts',
      'On-prem connectors',
    ],
    featured: false,
  },
];

export function pricingSpec(): NodeSpec {
  return section('Pricing', [
    container(
      [
        sectionHeaderSpec(
          'Pricing',
          'Simple pricing that scales with you',
          'Start free. Upgrade when your team does. No per-seat surprises at renewal.'
        ),
        {
          type: 'grid',
          name: 'Plans',
          styles: {
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '20px',
            alignItems: 'start',
          },
          responsive: ONE_COLUMN,
          children: TIERS.map((tier) => ({
            type: 'frame' as const,
            name: `${tier.name} plan`,
            styles: {
              ...pad('28px'),
              gap: '20px',
              ...radius('var(--r-lg)'),
              ...border(tier.featured ? '1.5px' : '1px', tier.featured ? 'var(--c-primary)' : 'var(--c-border)'),
              backgroundColor: 'var(--c-background)',
              boxShadow: tier.featured ? 'var(--sh-lg)' : 'none',
              position: 'relative',
            },
            children: [
              stack(
                'Plan header',
                [
                  stack(
                    'Plan name row',
                    [
                      label(tier.name, {
                        fontSize: '15px',
                        fontWeight: '620',
                        color: 'var(--c-text)',
                      }),
                      ...(tier.featured
                        ? [
                            label('Most popular', {
                              fontSize: '10.5px',
                              fontWeight: '650',
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              color: 'var(--c-on-primary)',
                              backgroundColor: 'var(--c-primary)',
                              ...pad('3px', '8px'),
                              ...radius('var(--r-full)'),
                            }),
                          ]
                        : []),
                    ],
                    { gap: '10px', alignItems: 'center', justifyContent: 'space-between', width: '100%' }
                  ),
                  stack(
                    'Price',
                    [
                      label(tier.price, {
                        fontSize: '42px',
                        fontWeight: '620',
                        letterSpacing: '-0.032em',
                        lineHeight: '1',
                        color: 'var(--c-text)',
                      }),
                      ...(tier.cadence
                        ? [label(tier.cadence, { fontSize: '13.5px', color: 'var(--c-muted)' })]
                        : []),
                    ],
                    { gap: '6px', alignItems: 'baseline' }
                  ),
                  paragraph(tier.blurb, { fontSize: '14.5px' }),
                ],
                { flexDirection: 'column', alignItems: 'flex-start', gap: '12px', width: '100%' }
              ),
              { type: 'divider', name: 'Divider', styles: {} },
              {
                type: 'stack',
                name: 'Plan features',
                styles: { flexDirection: 'column', alignItems: 'flex-start', gap: '11px', width: '100%' },
                children: tier.features.map((text) =>
                  stack(
                    text.slice(0, 24),
                    [
                      icon('check', {
                        width: '15px',
                        height: '15px',
                        color: 'var(--c-primary)',
                        flexShrink: '0',
                      }),
                      label(text, { fontSize: '14.5px', color: 'var(--c-muted)' }),
                    ],
                    { gap: '9px', alignItems: 'center' }
                  )
                ),
              },
              {
                type: 'button',
                name: `${tier.name} CTA`,
                props: { label: tier.featured ? 'Start free trial' : 'Get started', href: '#' },
                styles: {
                  width: '100%',
                  ...(tier.featured
                    ? {}
                    : {
                        backgroundColor: 'transparent',
                        color: 'var(--c-text)',
                        ...border('1px', 'var(--c-border)'),
                      }),
                },
                states: tier.featured
                  ? { hover: { backgroundColor: 'var(--c-secondary)' } }
                  : { hover: { backgroundColor: 'var(--c-surface)' } },
              },
            ],
          })),
        },
      ],
      { gap: '56px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Testimonials
 * ----------------------------------------------------------------------- */

const QUOTES = [
  {
    quote:
      'We replaced four tools with Northwind in a week. Our deploy frequency doubled and nobody had to learn a new mental model.',
    name: 'Ana Ferreira',
    role: 'VP Engineering, Lumen',
  },
  {
    quote:
      'The previews alone paid for it. Design reviews now happen on the real thing instead of a screenshot in a doc.',
    name: 'Marcus Hall',
    role: 'Head of Product, Basewave',
  },
  {
    quote:
      'Audit logs and SSO were configured in an afternoon. Our security review went from six weeks to two days.',
    name: 'Priya Raman',
    role: 'CTO, Orbital',
  },
];

export function testimonialsSpec(): NodeSpec {
  return section(
    'Testimonials',
    [
      container(
        [
          sectionHeaderSpec(
            'Customers',
            'Teams ship faster on Northwind',
            'Thousands of engineering and product teams run their release process here.'
          ),
          {
            type: 'grid',
            name: 'Quotes',
            styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' },
            responsive: ONE_COLUMN,
            children: QUOTES.map((item) => ({
              type: 'frame' as const,
              name: item.name,
              styles: {
                ...pad('26px'),
                gap: '20px',
                ...radius('var(--r-lg)'),
                ...border('1px', 'var(--c-border)'),
                backgroundColor: 'var(--c-background)',
                justifyContent: 'space-between',
                height: '100%',
              },
              children: [
                stack(
                  'Stars',
                  Array.from({ length: 5 }, () =>
                    icon('star', { width: '14px', height: '14px', color: '#f5a623' })
                  ),
                  { gap: '3px' }
                ),
                paragraph(item.quote, {
                  fontSize: '15.5px',
                  lineHeight: '1.6',
                  color: 'var(--c-text)',
                }),
                stack(
                  'Author',
                  [
                    {
                      type: 'frame',
                      name: 'Avatar',
                      styles: {
                        width: '34px',
                        height: '34px',
                        ...pad('0px'),
                        ...radius('var(--r-full)'),
                        backgroundImage:
                          'linear-gradient(135deg, var(--c-primary), var(--c-accent))',
                        flexShrink: '0',
                      },
                    },
                    stack(
                      'Author text',
                      [
                        label(item.name, {
                          fontSize: '14px',
                          fontWeight: '580',
                          color: 'var(--c-text)',
                        }),
                        label(item.role, { fontSize: '12.5px', color: 'var(--c-muted)' }),
                      ],
                      { flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }
                    ),
                  ],
                  { gap: '11px', alignItems: 'center' }
                ),
              ],
            })),
          },
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * FAQ
 * ----------------------------------------------------------------------- */

const FAQS = [
  {
    q: 'How does the free trial work?',
    a: 'Every workspace starts on a 14-day Team trial with all features enabled. No card required, and nothing is deleted when the trial ends.',
  },
  {
    q: 'Can I bring my own cloud?',
    a: 'Enterprise workspaces can deploy into your own AWS, GCP or Cloudflare account while keeping the same control plane.',
  },
  {
    q: 'What happens if we exceed our bandwidth?',
    a: 'Nothing breaks. We notify you at 80% and bill overage at a flat rate, or you can set a hard cap in workspace settings.',
  },
  {
    q: 'Do you offer discounts for startups?',
    a: 'Yes — companies under two years old with fewer than 20 people get 50% off Team for the first year.',
  },
];

export function faqSpec(): NodeSpec {
  return section('FAQ', [
    container(
      [
        sectionHeaderSpec('FAQ', 'Questions, answered', 'Still unsure? Talk to the team any time.'),
        {
          type: 'grid',
          name: 'Questions',
          styles: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px 40px' },
          responsive: ONE_COLUMN,
          children: FAQS.map((item) => ({
            type: 'frame' as const,
            name: item.q.slice(0, 28),
            styles: { ...pad('0px'), gap: '9px' },
            children: [
              heading(item.q, 3, {
                fontSize: '16.5px',
                fontWeight: '600',
                letterSpacing: '-0.012em',
                lineHeight: '1.35',
              }),
              paragraph(item.a, { fontSize: '14.5px', lineHeight: '1.62' }),
            ],
          })),
        },
      ],
      { gap: '56px', maxWidth: 'var(--w-content)' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Call to action
 * ----------------------------------------------------------------------- */

export function ctaSpec(): NodeSpec {
  return section('Call to action', [
    container(
      [
        {
          type: 'frame',
          name: 'CTA card',
          styles: {
            ...pad('64px', '48px'),
            gap: '20px',
            alignItems: 'center',
            textAlign: 'center',
            ...radius('var(--r-xl)'),
            backgroundColor: 'var(--c-inverse)',
            backgroundImage:
              'radial-gradient(90% 140% at 50% 0%, color-mix(in srgb, var(--c-primary) 45%, transparent) 0%, transparent 70%)',
            width: '100%',
          },
          responsive: {
            mobile: { paddingTop: '40px', paddingBottom: '40px', paddingLeft: '24px', paddingRight: '24px' },
          },
          children: [
            heading('Start shipping this afternoon', 2, {
              ...TITLE,
              color: 'var(--c-on-inverse)',
              maxWidth: '16ch',
              textWrap: 'balance',
            }, TITLE_RESPONSIVE),
            paragraph(
              'Import a repository, pick a region, and your first preview is live in under three minutes.',
              { fontSize: '17px', color: 'color-mix(in srgb, var(--c-on-inverse) 74%, transparent)', maxWidth: '48ch' }
            ),
            stack(
              'CTA actions',
              [
                {
                  type: 'button',
                  name: 'Primary CTA',
                  props: { label: 'Start building free', href: '#' },
                  styles: {
                    backgroundColor: 'var(--c-on-inverse)',
                    color: 'var(--c-inverse)',
                  },
                  states: { hover: { opacity: '0.9' } },
                },
                {
                  type: 'button',
                  name: 'Secondary CTA',
                  props: { label: 'Talk to sales', href: '#' },
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
                },
              ],
              { gap: '12px', marginTop: '6px' },
              { mobile: { flexDirection: 'column', width: '100%', alignItems: 'stretch' } }
            ),
          ],
        },
      ],
      { gap: '0px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Footer
 * ----------------------------------------------------------------------- */

const FOOTER_COLUMNS: { title: string; links: string[] }[] = [
  { title: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Status'] },
  { title: 'Developers', links: ['Documentation', 'API reference', 'Examples', 'Community'] },
  { title: 'Company', links: ['About', 'Careers', 'Blog', 'Contact'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Security', 'DPA'] },
];

export function footerSpec(): NodeSpec {
  return section(
    'Footer',
    [
      container(
        [
          {
            type: 'grid',
            name: 'Footer columns',
            styles: {
              gridTemplateColumns: '1.6fr repeat(4, minmax(0, 1fr))',
              gap: '40px',
              width: '100%',
            },
            responsive: {
              tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
              mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '32px 20px' },
            },
            children: [
              {
                type: 'frame',
                name: 'Footer brand',
                styles: { ...pad('0px'), gap: '12px' },
                children: [
                  stack('Brand', [
                    icon('bolt', { width: '22px', height: '22px', color: 'var(--c-primary)' }),
                    label('Northwind', {
                      fontSize: '16px',
                      fontWeight: '640',
                      letterSpacing: '-0.02em',
                      color: 'var(--c-text)',
                    }),
                  ], { gap: '8px' }),
                  paragraph('The platform layer for product teams that ship weekly.', {
                    fontSize: '13.5px',
                    maxWidth: '30ch',
                  }),
                ],
              },
              ...FOOTER_COLUMNS.map((column) => ({
                type: 'frame' as const,
                name: column.title,
                styles: { ...pad('0px'), gap: '11px' },
                children: [
                  label(column.title, {
                    fontSize: '12px',
                    fontWeight: '620',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text)',
                  }),
                  ...column.links.map((text) => ({
                    type: 'link' as const,
                    name: text,
                    props: { text, href: '#' },
                    styles: { fontSize: '13.5px', color: 'var(--c-muted)' },
                    states: { hover: { color: 'var(--c-text)' } },
                  })),
                ],
              })),
            ],
          },
          { type: 'divider', name: 'Divider', styles: {} },
          stack(
            'Footer base',
            [
              label('© 2026 Northwind Labs, Inc.', { fontSize: '12.5px', color: 'var(--c-muted)' }),
              stack(
                'Social',
                ['globe', 'send', 'git-branch'].map((name) =>
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
      paddingTop: '64px',
      paddingBottom: '48px',
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderColor: 'var(--c-border)',
    }
  );
}

/* --------------------------------------------------------------------------
 * Registry — surfaced in the Insert panel
 * ----------------------------------------------------------------------- */

export interface BlockDefinition {
  id: string;
  name: string;
  description: string;
  build: () => NodeSpec;
}

export const BLOCKS: BlockDefinition[] = [
  { id: 'navbar', name: 'Navbar', description: 'Sticky header with links and a CTA', build: navbarSpec },
  { id: 'hero', name: 'Hero', description: 'Headline, subtext, buttons and a product shot', build: heroSectionSpec },
  { id: 'logos', name: 'Logo cloud', description: 'Social proof row', build: logoCloudSpec },
  { id: 'features', name: 'Feature grid', description: 'Three-column feature cards', build: featureSectionSpec },
  { id: 'pricing', name: 'Pricing', description: 'Three-tier pricing table', build: pricingSpec },
  { id: 'testimonials', name: 'Testimonials', description: 'Customer quotes with avatars', build: testimonialsSpec },
  { id: 'faq', name: 'FAQ', description: 'Two-column question list', build: faqSpec },
  { id: 'cta', name: 'Call to action', description: 'Full-width conversion panel', build: ctaSpec },
  { id: 'footer', name: 'Footer', description: 'Link columns and legal line', build: footerSpec },
];
