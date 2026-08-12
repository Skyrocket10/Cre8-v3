/** Social proof — logos and customer quotes. */

import type { NodeSpec } from '../../document/factory';
import {
  CAPTION,
  ONE_COLUMN,
  SMALL,
  TITLE,
  TWO_TO_ONE,
  avatar,
  border,
  bullets,
  card,
  column,
  container,
  frame,
  grid,
  heading,
  icon,
  label,
  cols,
  media,
  pad,
  paragraph,
  radius,
  section,
  sectionHeader,
  splitGrid,
  stack,
  textLink,
  tint,
} from './kit';

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
          sectionHeader(
            'Customers',
            'Teams ship faster on Northwind',
            'Thousands of engineering and product teams run their release process here.'
          ),
          grid(
            'Quotes',
            3,
            QUOTES.map((item) =>
              card(
                item.name,
                [
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
                      avatar('34px'),
                      column(
                        'Author text',
                        [
                          label(item.name, {
                            fontSize: '14px',
                            fontWeight: '580',
                            color: 'var(--c-text)',
                          }),
                          label(item.role, { fontSize: '12.5px', color: 'var(--c-muted)' }),
                        ],
                        { gap: '2px' }
                      ),
                    ],
                    { gap: '11px', alignItems: 'center' }
                  ),
                ],
                { gap: '20px', justifyContent: 'space-between', height: '100%' }
              )
            ),
            {},
            ONE_COLUMN
          ),
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Bordered logo grid
 * ----------------------------------------------------------------------- */

export function logoGridSpec(): NodeSpec {
  const names = ['Vercount', 'Lumen', 'Basewave', 'Orbital', 'Kettle', 'Halcyon', 'Northpoint', 'Ardent'];
  return section(
    'Logo grid',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('Trusted where uptime is the product', 2, { ...TITLE, fontSize: '30px', textWrap: 'balance' }, { mobile: { fontSize: '24px' } }),
              paragraph('From seed-stage teams to companies serving nine figures of requests a month.', SMALL),
            ],
            { gap: '8px', alignItems: 'center', textAlign: 'center', width: '100%' }
          ),
          grid(
            'Logo cells',
            4,
            names.map((name) =>
              frame(
                name,
                [
                  label(name, {
                    fontSize: '17px',
                    fontWeight: '600',
                    letterSpacing: '-0.018em',
                    color: 'var(--c-text)',
                    opacity: '0.55',
                  }),
                ],
                {
                  ...pad('26px', '16px'),
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--c-background)',
                }
              )
            ),
            // A hairline lattice: the 1px gap lets the container's colour show
            // between opaque cells, so each interior rule is drawn once. Giving
            // the cells their own border as well would double every one of them.
            { gap: '1px', backgroundColor: 'var(--c-border)', ...border('1px', 'var(--c-border)') },
            {
              tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
              mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
            }
          ),
        ],
        { gap: '36px' }
      ),
    ],
    { paddingTop: '72px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Stats band
 * ----------------------------------------------------------------------- */

const STATS = [
  { value: '99.99%', label: 'Uptime across all regions, measured externally' },
  { value: '84ms', label: 'Median response time at the edge' },
  { value: '12,400', label: 'Deploys shipped by customers last week' },
  { value: '4.9/5', label: 'Average support rating over 2,000 tickets' },
];

export function statsSpec(): NodeSpec {
  return section(
    'Stats',
    [
      container(
        [
          grid(
            'Stats',
            4,
            STATS.map((stat) =>
              column(
                stat.value,
                [
                  label(stat.value, {
                    fontSize: '44px',
                    fontWeight: '620',
                    letterSpacing: '-0.032em',
                    lineHeight: '1',
                    color: 'var(--c-primary)',
                  }),
                  paragraph(stat.label, { ...SMALL, maxWidth: '26ch' }),
                ],
                { gap: '10px' }
              )
            ),
            { gap: '32px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '72px', paddingBottom: '72px', backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Single pull quote
 * ----------------------------------------------------------------------- */

export function pullQuoteSpec(): NodeSpec {
  return section('Pull quote', [
    container(
      [
        icon('quote', { width: '34px', height: '34px', color: tint('var(--c-primary)', 45) }),
        paragraph(
          'We had four vendors, three dashboards and a spreadsheet explaining which was authoritative. Now there is one place, and the spreadsheet is gone.',
          {
            fontSize: '30px',
            lineHeight: '1.4',
            letterSpacing: '-0.02em',
            color: 'var(--c-text)',
            textAlign: 'center',
            textWrap: 'balance',
            maxWidth: '30ch',
          },
          { mobile: { fontSize: '22px' } }
        ),
        stack(
          'Attribution',
          [
            avatar('44px'),
            column(
              'Who',
              [
                label('Ana Ferreira', { fontSize: '15px', fontWeight: '600', color: 'var(--c-text)' }),
                label('VP Engineering, Lumen', { ...CAPTION, color: 'var(--c-muted)' }),
              ],
              { gap: '2px' }
            ),
          ],
          { gap: '12px', alignItems: 'center', marginTop: '8px' }
        ),
      ],
      { gap: '20px', alignItems: 'center', maxWidth: 'var(--w-content)' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Quote with portrait
 * ----------------------------------------------------------------------- */

export function portraitQuoteSpec(): NodeSpec {
  return section(
    'Portrait quote',
    [
      container(
        [
          splitGrid(
            'Quote row',
            [
              media('Portrait of the person quoted', '4 / 5', {
                ...radius('var(--r-lg)'),
                maxWidth: '380px',
              }),
              column(
                'Quote',
                [
                  stack(
                    'Stars',
                    Array.from({ length: 5 }, () =>
                      icon('star', { width: '15px', height: '15px', color: '#f5a623' })
                    ),
                    { gap: '3px' }
                  ),
                  paragraph(
                    'The migration took an afternoon. The part I still tell people about is that nothing broke — not the domains, not the certificates, not one redirect.',
                    {
                      fontSize: '22px',
                      lineHeight: '1.5',
                      letterSpacing: '-0.014em',
                      color: 'var(--c-text)',
                      maxWidth: '34ch',
                    },
                    { mobile: { fontSize: '18px' } }
                  ),
                  column(
                    'Who',
                    [
                      label('Marcus Hall', { fontSize: '15px', fontWeight: '600', color: 'var(--c-text)' }),
                      label('Head of Product, Basewave', { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '2px' }
                  ),
                  textLink('Read the case study →', '#', { fontSize: '14px', color: 'var(--c-primary)' }),
                ],
                { gap: '18px' }
              ),
            ],
            { gap: '56px' },
            [0.85, 1.15]
          ),
        ],
        { maxWidth: 'var(--w-content)' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Case study cards
 * ----------------------------------------------------------------------- */

const CASES = [
  { company: 'Lumen', metric: '4×', result: 'increase in deploy frequency', body: 'Consolidated four tools and cut release overhead to minutes.' },
  { company: 'Basewave', metric: '−62%', result: 'time to first review', body: 'Preview URLs moved design review off screenshots.' },
  { company: 'Orbital', metric: '2 days', result: 'to pass security review', body: 'SSO and audit logs were configured in an afternoon.' },
];

export function caseStudiesSpec(): NodeSpec {
  return section('Case studies', [
    container(
      [
        sectionHeader(
          'Case studies',
          'What changed, measured',
          'Numbers customers published themselves, not ones we modelled.'
        ),
        grid(
          'Cases',
          3,
          CASES.map((item) =>
            /*
             * Not a link card, and it could not be one: "Read the story" is
             * inside it, and a control inside a clickable card is markup the
             * parser rearranges. The link is the affordance; the card lifting
             * as well was two offers for one destination.
             */
            card(
              item.company,
              [
                label(item.company, {
                  fontSize: '13px',
                  fontWeight: '640',
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--c-muted)',
                }),
                label(item.metric, {
                  fontSize: '46px',
                  fontWeight: '620',
                  letterSpacing: '-0.034em',
                  lineHeight: '1',
                  color: 'var(--c-primary)',
                }),
                heading(item.result, 3, { fontSize: '16px', fontWeight: '600', lineHeight: '1.35' }),
                paragraph(item.body, SMALL),
                textLink('Read the story →', '#', { fontSize: '13.5px', color: 'var(--c-primary)' }),
              ],
              { ...pad('28px'), gap: '10px' }
            )
          )
        ),
      ],
      { gap: '56px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Rating badges
 * ----------------------------------------------------------------------- */

const RATINGS = [
  { source: 'G2', score: '4.9', detail: '482 reviews', stars: true },
  { source: 'Capterra', score: '4.8', detail: '310 reviews', stars: true },
  { source: 'Product Hunt', score: '#1', detail: 'Product of the Day', stars: false },
  { source: 'SOC 2', score: 'Type II', detail: 'Audited annually', stars: false },
];

export function ratingsSpec(): NodeSpec {
  return section(
    'Ratings',
    [
      container(
        [
          grid(
            'Badges',
            4,
            RATINGS.map((item) =>
              card(
                item.source,
                [
                  label(item.source, { ...CAPTION, fontWeight: '620', color: 'var(--c-muted)' }),
                  stack(
                    'Score',
                    [
                      label(item.score, {
                        fontSize: '26px',
                        fontWeight: '620',
                        letterSpacing: '-0.024em',
                        lineHeight: '1',
                        color: 'var(--c-text)',
                      }),
                      // Only where a star means something: beside "Type II" it
                      // claims a rating that badge does not carry.
                      ...(item.stars
                        ? [icon('star', { width: '15px', height: '15px', color: '#f5a623' })]
                        : []),
                    ],
                    { gap: '6px', alignItems: 'center' }
                  ),
                  label(item.detail, { ...CAPTION, color: 'var(--c-muted)' }),
                ],
                { ...pad('20px'), gap: '8px', alignItems: 'center', textAlign: 'center' }
              )
            ),
            { gap: '12px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '64px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Video testimonial
 * ----------------------------------------------------------------------- */

/**
 * The clip, and the quote for everyone who will not press play.
 *
 * Most people will not. So the pull quote beside the player is not a caption —
 * it is the testimonial, written out, doing the whole job on its own; the
 * video is the corroboration for the minority who want to see somebody say it.
 * A block that put the words only inside the clip would be a block whose
 * content is invisible to search engines, to anyone on a metered connection,
 * and to anyone who cannot hear it.
 *
 * `controls` and no autoplay, deliberately. A face and a voice starting
 * unbidden is the single most disliked thing a marketing page does, and an
 * autoplaying video is also the one element that can make a page fail a
 * reduced-motion preference no stylesheet can catch.
 */
export function videoTestimonialSpec(): NodeSpec {
  return section(
    'Video testimonial',
    [
      container(
        [
          {
            type: 'grid',
            name: 'Testimonial columns',
            styles: { gridTemplateColumns: cols(1.15, 1), gap: '52px', width: '100%', alignItems: 'center' },
            responsive: { tablet: { gridTemplateColumns: cols(1), gap: '32px' } },
            children: [
              frame(
                'Player',
                [
                  {
                    type: 'video',
                    name: 'Customer interview',
                    // A poster is the frame somebody sees before they press,
                    // and it is left empty on purpose: whatever is put here has
                    // to be a real still from the real clip, and a stand-in
                    // would be a picture of a person who never said this.
                    props: { controls: true, poster: '' },
                    styles: {
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      ...pad('0px'),
                    },
                  },
                ],
                {
                  width: '100%',
                  ...pad('0px'),
                  ...radius('var(--r-lg)'),
                  ...border('1px', 'var(--c-border)'),
                  overflow: 'hidden',
                  backgroundColor: 'var(--c-surface-2)',
                  boxShadow: 'var(--sh-lg)',
                }
              ),
              column(
                'Testimonial copy',
                [
                  icon('quote', { width: '26px', height: '26px', color: 'var(--c-primary)' }),
                  paragraph(
                    'We moved eleven services across in a fortnight. The part I did not expect was that the on-call rota got quieter — there is simply less of it to page anyone about.',
                    {
                      fontSize: '23px',
                      lineHeight: '1.42',
                      letterSpacing: '-0.014em',
                      color: 'var(--c-text)',
                      maxWidth: '30ch',
                      textWrap: 'pretty',
                    },
                    { mobile: { fontSize: '19px' } }
                  ),
                  stack(
                    'Attribution',
                    [
                      avatar('40px'),
                      column(
                        'Speaker',
                        [
                          label('Dara Tkachenko', {
                            fontSize: '14.5px',
                            fontWeight: '600',
                            color: 'var(--c-text)',
                          }),
                          label('Head of Platform, Northbank', { ...CAPTION, color: 'var(--c-muted)' }),
                        ],
                        { gap: '2px' }
                      ),
                    ],
                    { gap: '12px', alignItems: 'center' }
                  ),
                  bullets(['3 min 40', 'Recorded March 2026'], 'play', 'Clip detail', {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: '8px 22px',
                    marginTop: '4px',
                  }),
                ],
                { gap: '18px', alignItems: 'flex-start' }
              ),
            ],
          },
        ],
        { gap: '0px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}
