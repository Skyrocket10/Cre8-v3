/** Conversion — pricing and calls to action. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  EYEBROW,
  ONE_COLUMN,
  TITLE,
  TITLE_RESPONSIVE,
  badge,
  border,
  bullets,
  button,
  card,
  cols,
  column,
  container,
  divider,
  grid,
  heading,
  label,
  media,
  pad,
  paragraph,
  radius,
  section,
  sectionHeader,
  stack,
  tint,
} from './kit';

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
        sectionHeader(
          'Pricing',
          'Simple pricing that scales with you',
          'Start free. Upgrade when your team does. No per-seat surprises at renewal.'
        ),
        grid(
          'Plans',
          3,
          TIERS.map((tier) =>
            card(
              `${tier.name} plan`,
              [
                column(
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
                        ...(tier.featured ? [badge('Most popular')] : []),
                      ],
                      {
                        gap: '10px',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                      }
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
                  { gap: '12px', width: '100%' }
                ),
                divider(),
                bullets(tier.features, 'check', 'Plan features'),
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
              {
                ...pad('28px'),
                gap: '20px',
                // The featured tier reads as chosen: heavier rule, real shadow.
                ...border(tier.featured ? '1.5px' : '1px',
                  tier.featured ? 'var(--c-primary)' : 'var(--c-border)'),
                boxShadow: tier.featured ? 'var(--sh-lg)' : 'none',
                position: 'relative',
              }
            )
          ),
          { alignItems: 'start' },
          ONE_COLUMN
        ),
      ],
      { gap: '56px' }
    ),
  ]);
}

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
            backgroundImage: `radial-gradient(90% 140% at 50% 0%, ${tint('var(--c-primary)', 45)} 0%, transparent 70%)`,
            width: '100%',
          },
          responsive: {
            mobile: {
              paddingTop: '40px',
              paddingBottom: '40px',
              paddingLeft: '24px',
              paddingRight: '24px',
            },
          },
          children: [
            heading(
              'Start shipping this afternoon',
              2,
              { ...TITLE, color: 'var(--c-on-inverse)', maxWidth: '16ch', textWrap: 'balance' },
              TITLE_RESPONSIVE
            ),
            paragraph(
              'Import a repository, pick a region, and your first preview is live in under three minutes.',
              {
                fontSize: '17px',
                color: tint('var(--c-on-inverse)', 74),
                maxWidth: '48ch',
              }
            ),
            stack(
              'CTA actions',
              [
                {
                  type: 'button',
                  name: 'Primary CTA',
                  props: { label: 'Start building free', href: '#' },
                  styles: { backgroundColor: 'var(--c-on-inverse)', color: 'var(--c-inverse)' },
                  states: { hover: { opacity: '0.9' } },
                },
                {
                  type: 'button',
                  name: 'Secondary CTA',
                  props: { label: 'Talk to sales', href: '#' },
                  styles: {
                    backgroundColor: 'transparent',
                    color: 'var(--c-on-inverse)',
                    ...border('1px', tint('var(--c-on-inverse)', 30)),
                  },
                  states: { hover: { backgroundColor: tint('var(--c-on-inverse)', 10) } },
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
 * Split call to action
 * ----------------------------------------------------------------------- */

export function ctaSplitSpec(): NodeSpec {
  return section('Split CTA', [
    container(
      [
        {
          type: 'grid',
          name: 'CTA panel',
          styles: {
            gridTemplateColumns: cols(1.05, 0.95),
            gap: '0px',
            width: '100%',
            ...radius('var(--r-xl)'),
            ...border('1px', 'var(--c-border)'),
            backgroundColor: 'var(--c-surface)',
            overflow: 'hidden',
            alignItems: 'stretch',
          },
          responsive: { tablet: { gridTemplateColumns: cols(1) } },
          children: [
            column(
              'CTA copy',
              [
                label('Get started', EYEBROW),
                heading(
                  'Move your first project across this week',
                  2,
                  { ...TITLE, fontSize: '34px', maxWidth: '18ch', textWrap: 'balance' },
                  { mobile: { fontSize: '26px' } }
                ),
                paragraph(
                  'Import from GitHub, keep your domains, and roll back to the old host at any point. Migrations take an afternoon, not a quarter.',
                  { ...BODY, maxWidth: '44ch' },
                  BODY_RESPONSIVE
                ),
                bullets(
                  ['Guided import', 'DNS handled for you', 'No contract until you are live'],
                  'check',
                  'Assurances'
                ),
                stack(
                  'CTA actions',
                  [button('Start a migration'), button('Talk to an engineer', 'secondary')],
                  { gap: '12px', marginTop: '6px', flexWrap: 'wrap' },
                  { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
                ),
              ],
              { ...pad('56px', '48px'), gap: '18px', justifyContent: 'center' },
              { mobile: { paddingTop: '36px', paddingBottom: '36px', paddingLeft: '24px', paddingRight: '24px' } }
            ),
            media(
              'Replace with a photo of your team or product in use',
              // No ratio at desktop: the panel's height comes from the copy,
              // and a ratio here would fight it for width.
              'auto',
              {
                height: '100%',
                minHeight: '340px',
                borderTopLeftRadius: '0px',
                borderTopRightRadius: '0px',
                borderBottomRightRadius: '0px',
                borderBottomLeftRadius: '0px',
              },
              // Releasing the min-height matters more than the ratio: stacked, a
              // 340px-tall 16/9 box demands 600px of width and drags the panel
              // past the viewport with it.
              { tablet: { aspectRatio: '16 / 9', minHeight: '0px' } }
            ),
          ],
        },
      ],
      { gap: '0px' }
    ),
  ]);
}
