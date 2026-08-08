/** Trust and reassurance — questions, people, policy. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  LEAD,
  LEAD_RESPONSIVE,
  ONE_COLUMN,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TITLE,
  TITLE_RESPONSIVE,
  TWO_TO_ONE,
  borderSide,
  column,
  container,
  frame,
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
  textLink,
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

/* --------------------------------------------------------------------------
 * FAQ accordion
 * ----------------------------------------------------------------------- */

export function faqAccordionSpec(): NodeSpec {
  return section('FAQ accordion', [
    container(
      [
        sectionHeader(
          'FAQ',
          'Questions, answered',
          'Open the ones you need. Everything else stays out of the way.'
        ),
        column(
          'Questions',
          FAQS.map((item, i) => ({
            // A native <details>. No script, no state to manage, keyboard and
            // screen-reader behaviour supplied by the browser — and it works
            // identically on the canvas and in the published file because it
            // is the same element in both.
            type: 'details' as const,
            name: item.q.slice(0, 28),
            props: { summary: item.q, open: i === 0 },
            styles: {
              width: '100%',
              ...pad('18px', '0px'),
              ...borderSide('Bottom'),
              display: 'block',
            },
            children: [
              paragraph(item.a, { ...SMALL, lineHeight: '1.62', maxWidth: '62ch', marginTop: '10px' }),
            ],
          })),
          { gap: '0px', width: '100%' }
        ),
      ],
      { gap: '48px', maxWidth: 'var(--w-content)' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Team grid
 * ----------------------------------------------------------------------- */

const TEAM = [
  { name: 'Ana Ferreira', role: 'Chief Executive' },
  { name: 'Marcus Hall', role: 'Head of Product' },
  { name: 'Priya Raman', role: 'Chief Technology Officer' },
  { name: 'Tobias Lind', role: 'Head of Design' },
  { name: 'Sofia Duarte', role: 'Engineering Lead' },
  { name: 'Jonah Adeyemi', role: 'Head of Support' },
  { name: 'Mei Chen', role: 'Security Lead' },
  { name: 'Ruth Kelleher', role: 'Head of Finance' },
];

export function teamSpec(): NodeSpec {
  return section('Team', [
    container(
      [
        sectionHeader(
          'Team',
          'The people who answer when you write in',
          'Small enough that the person who built a thing is the one who supports it.'
        ),
        grid(
          'People',
          4,
          TEAM.map((person) =>
            column(
              person.name,
              [
                media(`Portrait of ${person.name}`, '1 / 1', { ...radius('var(--r-lg)') }),
                column(
                  'Name',
                  [
                    label(person.name, { fontSize: '15px', fontWeight: '600', color: 'var(--c-text)' }),
                    label(person.role, { ...CAPTION, color: 'var(--c-muted)' }),
                  ],
                  { gap: '2px' }
                ),
              ],
              { gap: '12px', width: '100%' }
            )
          ),
          { gap: '28px 20px' },
          {
            tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
            mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
          }
        ),
      ],
      { gap: '56px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Open roles
 * ----------------------------------------------------------------------- */

const ROLES = [
  { title: 'Senior Platform Engineer', team: 'Infrastructure', place: 'Remote — Europe' },
  { title: 'Product Designer', team: 'Design', place: 'Lisbon or remote' },
  { title: 'Developer Advocate', team: 'Growth', place: 'Remote — Americas' },
  { title: 'Support Engineer', team: 'Support', place: 'Remote — Europe' },
  { title: 'Security Engineer', team: 'Security', place: 'Lisbon' },
];

export function rolesSpec(): NodeSpec {
  return section(
    'Open roles',
    [
      container(
        [
          sectionHeader(
            'Careers',
            'Open roles',
            'We hire slowly and write everything down. Interviews are four conversations, no take-home.',
            'start'
          ),
          column(
            'Roles',
            // A frame, not a link. `link` is container: false — it renders
            // its text prop and drops anything nested inside, so a row built
            // out of one comes out empty. The title carries the link instead,
            // which is also the better target: wrapping a whole two-column row
            // in one anchor gives screen readers a single unreadable label.
            ROLES.map((role, i) =>
              frame(
                role.title,
                [
                  column(
                    'Role',
                    [
                      heading(
                        role.title,
                        3,
                        { fontSize: '17px', fontWeight: '600', lineHeight: '1.3' }
                      ),
                      label(role.team, { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '3px' }
                  ),
                  stack(
                    'Apply',
                    [
                      label(role.place, { fontSize: '13.5px', color: 'var(--c-muted)' }),
                      textLink('Apply →', '#', {
                        fontSize: '13.5px',
                        fontWeight: '560',
                        color: 'var(--c-primary)',
                      }),
                    ],
                    { gap: '16px', alignItems: 'center' }
                  ),
                ],
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '20px',
                  width: '100%',
                  ...pad('20px', '4px'),
                  // A rule between rows rather than around them: the list reads
                  // as one table, and the first row gets no stray line above it.
                  ...(i > 0 ? borderSide('Top') : {}),
                },
                { mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } }
              )
            ),
            { gap: '0px', width: '100%' }
          ),
        ],
        { gap: '40px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ]
  );
}

/* --------------------------------------------------------------------------
 * Prose / legal
 * ----------------------------------------------------------------------- */

export function proseSpec(): NodeSpec {
  const clause = (title: string, body: string): NodeSpec[] => [
    heading(title, 2, { ...SUBTITLE, marginTop: '18px' }, SUBTITLE_RESPONSIVE),
    paragraph(body, { ...BODY, lineHeight: '1.7' }, BODY_RESPONSIVE),
  ];

  return section(
    'Prose',
    [
      container(
        [
          column(
            'Document',
            [
              heading('Privacy policy', 1, TITLE, TITLE_RESPONSIVE),
              label('Last updated 8 August 2026', { ...CAPTION, color: 'var(--c-muted)' }),
              paragraph(
                'This policy describes what we collect, why we collect it, and what you can ask us to delete. It is written to be read rather than to be defensible.',
                { ...LEAD, marginTop: '10px' },
                LEAD_RESPONSIVE
              ),
              ...clause(
                'What we collect',
                'Your account details, the projects you create, and request logs retained for thirty days. We do not use third-party analytics on the dashboard, and we never sell anything to anyone.'
              ),
              ...clause(
                'Where it is stored',
                'In the region you choose when the project is created. Data does not leave that region for processing, including backups, and we will tell you before that ever changes.'
              ),
              ...clause(
                'What you can ask for',
                'A copy of everything we hold, or its deletion. Both are self-service in workspace settings; if you would rather write to us, we answer within five working days.'
              ),
              ...clause(
                'Sub-processors',
                'We publish the full list, with the region each one runs in and what it is used for. Changes are announced thirty days before they take effect.'
              ),
            ],
            // A measure, not a width: long-form text past about 70 characters
            // a line gets measurably harder to read.
            { gap: '10px', maxWidth: '68ch', width: '100%' }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '72px', paddingBottom: '88px' }
  );
}

/* --------------------------------------------------------------------------
 * Gallery
 * ----------------------------------------------------------------------- */

export function gallerySpec(): NodeSpec {
  const shots = [
    'Wide shot of the studio',
    'Detail of the workspace',
    'The team mid-review',
    'Whiteboard during planning',
    'The office at dusk',
    'Close-up of a prototype',
  ];
  return section(
    'Gallery',
    [
      container(
        [
          sectionHeader(
            'Gallery',
            'Around the studio',
            'Photographs from the last six months, mostly taken on phones.'
          ),
          grid(
            'Shots',
            3,
            shots.map((alt) => media(alt, '4 / 3')),
            { gap: '16px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '48px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Masonry gallery
 * ----------------------------------------------------------------------- */

export function masonrySpec(): NodeSpec {
  // Deliberately uneven: masonry only earns its keep when the pieces differ.
  const shots: [string, string][] = [
    ['Portrait of a team member at their desk', '3 / 4'],
    ['Wide shot of the studio floor', '3 / 2'],
    ['Detail of a printed prototype', '1 / 1'],
    ['The kitchen during standup', '4 / 5'],
    ['Whiteboard covered in diagrams', '3 / 2'],
    ['Evening light through the windows', '2 / 3'],
    ['Close-up of a laptop mid-deploy', '1 / 1'],
    ['The team on the roof terrace', '3 / 2'],
  ];

  return section('Masonry', [
    container(
      [
        sectionHeader('Gallery', 'A wall of it', 'Mixed shapes, laid out by the browser.'),
        frame(
          'Masonry',
          shots.map(([alt, ratio]) =>
            media(alt, ratio, {
              // Without this a card can be split down the column boundary,
              // with half an image at the foot of one column and half at the
              // head of the next.
              breakInside: 'avoid',
              marginBottom: '16px',
            })
          ),
          { columnCount: '3', columnGap: '16px', width: '100%', ...pad('0px'), display: 'block' },
          { tablet: { columnCount: '2' }, mobile: { columnCount: '1' } }
        ),
      ],
      { gap: '48px' }
    ),
  ]);
}
