/** Social proof — logos and customer quotes. */

import type { NodeSpec } from '../../document/factory';
import {
  ONE_COLUMN,
  avatar,
  card,
  column,
  container,
  grid,
  icon,
  label,
  paragraph,
  section,
  sectionHeader,
  stack,
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
