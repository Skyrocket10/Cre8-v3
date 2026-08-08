/** Page chrome — the header and footer that frame everything else. */

import type { NodeSpec } from '../../document/factory';
import {
  type BlockLink,
  asLink,
  borderSide,
  container,
  divider,
  icon,
  label,
  pad,
  paragraph,
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
