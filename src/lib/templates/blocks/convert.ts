/** Conversion — pricing and calls to action. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  EYEBROW,
  ONE_COLUMN,
  TITLE,
  TITLE_RESPONSIVE,
  badge,
  border,
  borderSide,
  bullets,
  button,
  card,
  cols,
  column,
  container,
  dataSet,
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
  switchButton,
  switchCase,
  switchGroup,
  switchSet,
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

/* --------------------------------------------------------------------------
 * Pricing with a billing switch
 * ----------------------------------------------------------------------- */

const BILLED: { name: string; monthly: string; annual: string; blurb: string; features: string[]; featured: boolean }[] = [
  {
    name: 'Starter',
    monthly: '$19',
    annual: '$15',
    blurb: 'Everything one person needs.',
    features: ['3 projects', 'Custom domain', 'Email support'],
    featured: false,
  },
  {
    name: 'Team',
    monthly: '$49',
    annual: '$39',
    blurb: 'For a small team shipping weekly.',
    features: ['Unlimited projects', 'Shared components', 'Roles and invites', 'Priority support'],
    featured: true,
  },
  {
    name: 'Business',
    monthly: '$99',
    annual: '$79',
    blurb: 'When procurement gets involved.',
    features: ['SSO and SCIM', 'Audit log', 'Uptime SLA', 'Named engineer'],
    featured: false,
  },
];

/**
 * The block that made the runtime worth writing.
 *
 * Both prices are in the markup; a generated rule hides whichever one the
 * switch is not on. So the toggle costs one attribute write, the selected pill
 * is styled from the same attribute rather than applied by a script after
 * first paint, and the whole interaction survives being screenshotted, printed
 * or read by something that never ran the script — the monthly price is simply
 * there.
 *
 * The duplication that buys all that used to be in the *document*: two price
 * blocks per tier, opposite cases, six extra rows in the layer tree and two
 * copies of one design to keep in step. `switchSet` moves it to render time.
 * One price per tier now, saying something different when the state moves, and
 * the published file still contains both strings — which is the whole point,
 * so the render suite checks for the strings rather than for the mechanism.
 */
export function pricingSwitchSpec(): NodeSpec {
  const price = (monthly: string, annual: string): NodeSpec =>
    stack(
      'Price',
      [
        switchSet(
          'annual',
          { text: annual },
          label(monthly, {
            fontSize: '38px',
            fontWeight: '640',
            letterSpacing: '-0.03em',
            color: 'var(--c-text)',
          })
        ),
        switchSet(
          'annual',
          { text: '/month, billed yearly' },
          label('/month', { fontSize: '14px', color: 'var(--c-muted)' })
        ),
      ],
      { gap: '4px', alignItems: 'baseline' }
    );

  return section('Pricing switch', [
    container(
      [
        sectionHeader(
          'Pricing',
          'Pay monthly, or save by paying yearly',
          'Same product either way. Switch whenever you like — we prorate the difference.'
        ),

        switchGroup(
          'billing',
          'monthly',
          [
            stack(
              'Billing toggle',
              [
                switchButton('Monthly', 'monthly'),
                switchButton('Yearly', 'annual'),
                switchCase(
                  'annual',
                  label('Save 20%', {
                    ...CAPTION,
                    fontWeight: '580',
                    color: 'var(--c-primary)',
                    ...pad('0px', '4px'),
                  })
                ),
              ],
              {
                gap: '4px',
                alignItems: 'center',
                width: 'fit-content',
                marginLeft: 'auto',
                marginRight: 'auto',
                ...pad('4px'),
                ...radius('var(--r-full)'),
                backgroundColor: 'var(--c-surface)',
                ...border('1px', 'var(--c-border)'),
              }
            ),

            grid(
              'Plans',
              3,
              BILLED.map((tier) =>
                card(
                  tier.name,
                  [
                    stack(
                      `${tier.name} head`,
                      [
                        heading(tier.name, 3, { fontSize: '17px', fontWeight: '600' }),
                        ...(tier.featured ? [badge('Most popular')] : []),
                      ],
                      { gap: '10px', alignItems: 'center' }
                    ),
                    paragraph(tier.blurb, { ...CAPTION, color: 'var(--c-muted)' }),
                    price(tier.monthly, tier.annual),
                    button('Start free', tier.featured ? 'primary' : 'secondary'),
                    divider(),
                    bullets(tier.features),
                  ],
                  {
                    gap: '14px',
                    ...(tier.featured
                      ? { ...border('1px', 'var(--c-primary)'), backgroundColor: tint('var(--c-primary)', 4) }
                      : {}),
                  }
                )
              ),
              { gap: '20px', marginTop: '32px' },
              ONE_COLUMN
            ),
          ],
          { gap: '0px' }
        ),
      ],
      { gap: '40px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Opening hours
 * ----------------------------------------------------------------------- */

/**
 * A strip that knows what time it is where the visitor is.
 *
 * The first block built on a **data** condition rather than on a control, and
 * the point of the mechanism: nobody clicks anything. The time is resolved in
 * the document head, before the body is parsed, so the right copy is on screen
 * at the first paint rather than swapped in after it.
 *
 * Both versions are in the published file, which is what makes this honest
 * rather than clever — a crawler reads them, a printout is right, and a
 * visitor with no scripting gets whatever the site chose to ship, coherently,
 * instead of an empty strip.
 *
 * Two rules on two different nodes, both keyed on `night`. They could not be
 * one rule: content rules on a single node must be mutually exclusive, and the
 * escape hatch for anything else is exactly this — put the second one on its
 * own element.
 */
export function openingHoursSpec(): NodeSpec {
  const dot = dataSet('time', 'night', {}, {
    type: 'frame',
    name: 'Status dot',
    styles: {
      width: '8px',
      height: '8px',
      flexShrink: '0',
      ...radius('var(--r-full)'),
      backgroundColor: 'var(--c-primary)',
    },
    rules: [],
  });
  // The dot changes colour rather than words, so its rule carries `apply`
  // instead of `set` — and lands on that variant's own class.
  dot.rules = [
    {
      id: 'd-time-night',
      when: [{ kind: 'data', source: 'time', op: 'is', values: ['night'] }],
      apply: { backgroundColor: 'var(--c-muted)' },
      set: { title: 'Closed' },
    },
  ];

  return section(
    'Opening hours',
    [
      container(
        [
          stack(
            'Hours row',
            [
              dot,
              dataSet(
                'time',
                'night',
                { text: 'Closed for the night — we open again at 9am' },
                label('Open now — the team replies in under an hour', {
                  fontSize: '14.5px',
                  fontWeight: '540',
                  color: 'var(--c-text)',
                })
              ),
              dataSet(
                'time',
                'night',
                { label: 'Leave a message' },
                {
                  ...button('Call the team', 'secondary'),
                  name: 'Contact action',
                  styles: { marginLeft: 'auto', fontSize: '14px', ...pad('9px', '16px') },
                  responsive: { mobile: { marginLeft: '0px', width: '100%' } },
                }
              ),
            ],
            { gap: '12px', alignItems: 'center', width: '100%' },
            { mobile: { flexWrap: 'wrap' } }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-wide)' }
      ),
    ],
    {
      ...pad('14px', '24px'),
      backgroundColor: 'var(--c-surface)',
      ...borderSide('Bottom'),
    },
    { mobile: { paddingLeft: '20px', paddingRight: '20px' } }
  );
}
