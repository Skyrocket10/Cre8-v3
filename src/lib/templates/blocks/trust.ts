/** Trust and reassurance — questions, people, policy. */

import type { NodeSpec } from '../../document/factory';
import {
  ONE_COLUMN,
  SMALL,
  container,
  frame,
  grid,
  heading,
  pad,
  paragraph,
  section,
  sectionHeader,
} from './kit';

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
        sectionHeader('FAQ', 'Questions, answered', 'Still unsure? Talk to the team any time.'),
        grid(
          'Questions',
          2,
          FAQS.map((item) =>
            frame(
              item.q.slice(0, 28),
              [
                heading(item.q, 3, {
                  fontSize: '16.5px',
                  fontWeight: '600',
                  letterSpacing: '-0.012em',
                  lineHeight: '1.35',
                }),
                paragraph(item.a, { ...SMALL, lineHeight: '1.62' }),
              ],
              { ...pad('0px'), gap: '9px' }
            )
          ),
          { gap: '20px 40px' },
          ONE_COLUMN
        ),
      ],
      { gap: '56px', maxWidth: 'var(--w-content)' }
    ),
  ]);
}
