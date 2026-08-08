/** Page chrome — the header and footer that frame everything else. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  EYEBROW,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TITLE,
  TITLE_RESPONSIVE,
  type BlockLink,
  asLink,
  badge,
  border,
  borderSide,
  cols,
  column,
  container,
  divider,
  frame,
  grid,
  heading,
  icon,
  label,
  pad,
  paragraph,
  radius,
  section,
  stack,
  textLink,
  tint,
} from './kit';

const DEFAULT_NAV_LINKS: (string | BlockLink)[] = ['Product', 'Features', 'Pricing', 'Docs'];

/** The wordmark, shared by the navbar and the footer so they never disagree. */
const brand = (size: '22px' | '26px'): NodeSpec =>
  stack(
    'Brand',
    [
      icon('bolt', { width: size, height: size, color: 'var(--c-primary)' }),
      label('Northwind', {
        fontSize: size === '26px' ? '17px' : '16px',
        fontWeight: '640',
        letterSpacing: '-0.02em',
        color: 'var(--c-text)',
      }),
    ],
    { gap: size === '26px' ? '9px' : '8px' }
  );

export function navbarSpec(links: (string | BlockLink)[] = DEFAULT_NAV_LINKS): NodeSpec {
  return {
    type: 'section',
    name: 'Navbar',
    styles: {
      ...pad('16px', '24px'),
      position: 'sticky',
      top: '0px',
      zIndex: '50',
      backgroundColor: tint('var(--c-background)', 82),
      backdropFilter: 'saturate(180%) blur(14px)',
      ...borderSide('Bottom'),
    },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      container(
        [
          brand('26px'),

          {
            type: 'navigation',
            name: 'Nav links',
            styles: { gap: '30px' },
            responsive: { mobile: { display: 'none' } },
            children: links
              .map(asLink)
              .map(({ label: text, href }) => textLink(text, href ?? '#')),
          },

          stack(
            'Nav actions',
            [
              {
                ...textLink('Sign in'),
                name: 'Sign in',
                responsive: { mobile: { display: 'none' } },
              },
              {
                type: 'button',
                name: 'Start free button',
                props: { label: 'Start free', href: '#' },
                styles: { fontSize: '14px', ...pad('9px', '16px') },
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

const FOOTER_COLUMNS: { title: string; links: (string | BlockLink)[] }[] = [
  { title: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Status'] },
  { title: 'Developers', links: ['Documentation', 'API reference', 'Examples', 'Community'] },
  { title: 'Company', links: ['About', 'Careers', 'Blog', 'Contact'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Security', 'DPA'] },
];

export function footerSpec(
  columns: { title: string; links: (string | BlockLink)[] }[] = FOOTER_COLUMNS
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
              // Brand column is wider, then one track per link column.
              gridTemplateColumns: `1.6fr repeat(${columns.length}, minmax(0, 1fr))`,
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
                  brand('22px'),
                  paragraph('The platform layer for product teams that ship weekly.', {
                    fontSize: '13.5px',
                    maxWidth: '30ch',
                  }),
                ],
              },
              ...columns.map((column) => ({
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
                  ...column.links
                    .map(asLink)
                    .map(({ label: text, href }) =>
                      textLink(text, href ?? '#', { fontSize: '13.5px' })
                    ),
                ],
              })),
            ],
          },
          divider(),
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
      ...borderSide('Top'),
    }
  );
}

/* --------------------------------------------------------------------------
 * Announcement bar
 * ----------------------------------------------------------------------- */

export function announcementSpec(): NodeSpec {
  return {
    type: 'section',
    name: 'Announcement bar',
    styles: {
      ...pad('11px', '24px'),
      backgroundColor: 'var(--c-inverse)',
      gap: '0px',
    },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      stack(
        'Announcement',
        [
          badge('New'),
          label('Managed Postgres is out of beta, with branching databases.', {
            fontSize: '13.5px',
            color: tint('var(--c-on-inverse)', 82),
          }),
          textLink('Read the announcement →', '#', {
            fontSize: '13.5px',
            fontWeight: '560',
            color: 'var(--c-on-inverse)',
          }),
        ],
        {
          gap: '10px',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          width: '100%',
        },
        { mobile: { textAlign: 'center' } }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Breadcrumbs
 * ----------------------------------------------------------------------- */

export function breadcrumbsSpec(): NodeSpec {
  const trail = ['Docs', 'Deployments', 'Preview environments'];
  return {
    type: 'section',
    name: 'Breadcrumbs',
    styles: { ...pad('16px', '24px'), gap: '0px', ...borderSide('Bottom') },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      container(
        [
          {
            type: 'navigation',
            name: 'Breadcrumb trail',
            styles: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
            children: trail.flatMap((crumb, i) => [
              ...(i > 0
                ? [
                    icon('chevron-right', {
                      width: '13px',
                      height: '13px',
                      color: 'var(--c-muted)',
                      flexShrink: '0',
                    }),
                  ]
                : []),
              // The last crumb is where you already are, so it is text rather
              // than a link — a link to the current page is a dead control.
              i === trail.length - 1
                ? label(crumb, { ...CAPTION, fontSize: '13px', color: 'var(--c-text)', fontWeight: '560' })
                : textLink(crumb, '#', { fontSize: '13px' }),
            ]),
          },
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Sub-navigation
 * ----------------------------------------------------------------------- */

export function subNavSpec(): NodeSpec {
  const tabs = [
    { label: 'Overview', current: true },
    { label: 'Pricing', current: false },
    { label: 'Security', current: false },
    { label: 'Changelog', current: false },
    { label: 'Docs', current: false },
  ];
  return {
    type: 'section',
    name: 'Sub navigation',
    styles: { ...pad('0px', '24px'), gap: '0px', ...borderSide('Bottom') },
    responsive: { mobile: { paddingLeft: '20px', paddingRight: '20px' } },
    children: [
      container(
        [
          {
            type: 'navigation',
            name: 'Tabs',
            styles: { gap: '26px', alignItems: 'stretch', overflow: 'auto' },
            children: tabs.map((tab) => ({
              type: 'link' as const,
              name: tab.label,
              props: { text: tab.label, href: '#' },
              styles: {
                fontSize: '14px',
                fontWeight: tab.current ? '580' : '450',
                color: tab.current ? 'var(--c-text)' : 'var(--c-muted)',
                ...pad('16px', '0px'),
                whiteSpace: 'nowrap',
                // The active tab is marked by the rule it sits on, so the row
                // never shifts as the selection moves.
                ...borderSide('Bottom', '2px', tab.current ? 'var(--c-primary)' : 'transparent'),
              },
              states: { hover: { color: 'var(--c-text)' } },
            })),
          },
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Docs layout
 * ----------------------------------------------------------------------- */

const DOC_SECTIONS = [
  { title: 'Getting started', links: ['Introduction', 'Quickstart', 'CLI'] },
  { title: 'Deployments', links: ['Builds', 'Preview environments', 'Rollbacks'] },
  { title: 'Reference', links: ['Configuration', 'Environment variables', 'API'] },
];

export function docsLayoutSpec(): NodeSpec {
  return section(
    'Docs layout',
    [
      container(
        [
          grid(
            'Docs row',
            '240px minmax(0, 1fr)',
            [
              column(
                'Sidebar',
                DOC_SECTIONS.map((group) =>
                  column(
                    group.title,
                    [
                      label(group.title, {
                        ...CAPTION,
                        fontWeight: '620',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: 'var(--c-text)',
                      }),
                      ...group.links.map((link, i) =>
                        textLink(link, '#', {
                          fontSize: '13.5px',
                          // One item is current, marked the same way the tabs are.
                          ...(group.title === 'Deployments' && i === 1
                            ? { color: 'var(--c-primary)', fontWeight: '560' }
                            : {}),
                        })
                      ),
                    ],
                    { gap: '8px', width: '100%' }
                  )
                ),
                {
                  gap: '26px',
                  position: 'sticky',
                  top: '88px',
                  alignSelf: 'start',
                  width: '100%',
                },
                // Sticky inside a stacked layout pins the nav over the prose,
                // so it goes back to being an ordinary block when narrow.
                { tablet: { position: 'static', top: 'auto' } }
              ),
              column(
                'Article',
                [
                  label('Deployments', EYEBROW),
                  heading('Preview environments', 1, { ...TITLE, textWrap: 'balance' }, TITLE_RESPONSIVE),
                  paragraph(
                    'Every branch gets its own URL as soon as it is pushed. Previews are full deployments — the same build, the same runtime and the same edge network as production.',
                    { ...BODY, maxWidth: '68ch' },
                    BODY_RESPONSIVE
                  ),
                  heading('How they are created', 2, { ...SUBTITLE, marginTop: '12px' }, SUBTITLE_RESPONSIVE),
                  paragraph(
                    'A preview is created on the first push to a branch and updated on every push after it. Nothing needs to be configured; the branch name becomes the subdomain.',
                    { ...BODY, maxWidth: '68ch' },
                    BODY_RESPONSIVE
                  ),
                  frame(
                    'Code',
                    [
                      label('$ northwind deploy --preview', {
                        fontFamily: 'var(--f-mono)',
                        fontSize: '13px',
                        color: 'var(--c-text)',
                      }),
                    ],
                    {
                      ...pad('16px', '18px'),
                      ...radius('var(--r-md)'),
                      ...border('1px', 'var(--c-border)'),
                      backgroundColor: 'var(--c-surface)',
                      width: '100%',
                      // Same measure as the prose it belongs to; a code block
                      // running twice the width of the paragraph above it
                      // reads as a different document.
                      maxWidth: '68ch',
                    }
                  ),
                  heading('Lifetime', 2, { ...SUBTITLE, marginTop: '12px' }, SUBTITLE_RESPONSIVE),
                  paragraph(
                    'Previews are torn down when the branch is deleted or merged. Deployments stay addressable for ninety days so a rollback never depends on a rebuild.',
                    { ...BODY, maxWidth: '68ch' },
                    BODY_RESPONSIVE
                  ),
                ],
                { gap: '14px', width: '100%' }
              ),
            ],
            { gap: '56px', alignItems: 'start' },
            { tablet: { gridTemplateColumns: cols(1), gap: '36px' } }
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '80px' }
  );
}

/* --------------------------------------------------------------------------
 * Minimal footer
 * ----------------------------------------------------------------------- */

export function minimalFooterSpec(): NodeSpec {
  return section(
    'Minimal footer',
    [
      container(
        [
          stack(
            'Footer row',
            [
              brand('22px'),
              {
                type: 'navigation',
                name: 'Footer links',
                styles: { gap: '22px', flexWrap: 'wrap', alignItems: 'center' },
                children: ['Pricing', 'Docs', 'Changelog', 'Privacy', 'Terms'].map((text) =>
                  textLink(text, '#', { fontSize: '13.5px' })
                ),
              },
              stack(
                'Social',
                ['globe', 'send', 'git-branch'].map((name) =>
                  icon(name, { width: '16px', height: '16px', color: 'var(--c-muted)' })
                ),
                { gap: '14px' }
              ),
            ],
            {
              gap: '24px',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              width: '100%',
            },
            { mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '20px' } }
          ),
          divider(),
          stack(
            'Footer base',
            [
              label('© 2026 Northwind Labs, Inc.', { ...CAPTION, color: 'var(--c-muted)' }),
              // An anchor, not a script: the browser already knows how to
              // return to the top of a document.
              textLink('Back to top ↑', '#top', { fontSize: '12.5px' }),
            ],
            {
              gap: '16px',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              width: '100%',
            }
          ),
        ],
        { gap: '22px' }
      ),
    ],
    {
      paddingTop: '40px',
      paddingBottom: '36px',
      backgroundColor: 'var(--c-surface)',
      ...borderSide('Top'),
    }
  );
}
