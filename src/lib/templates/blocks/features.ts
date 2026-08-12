/** Feature explanation. */

import type { NodeSpec } from '../../document/factory';
import type { ResponsiveStyles, StyleDecl } from '../../document/types';
import {
  BODY,
  BODY_RESPONSIVE,
  CARD_TITLE,
  LEAD,
  LEAD_RESPONSIVE,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TITLE,
  TITLE_RESPONSIVE,
  TWO_TO_ONE,
  bullets,
  button,
  card,
  chip,
  cols,
  column,
  container,
  frame,
  grid,
  heading,
  icon,
  iconBadge,
  label,
  liftCard,
  media,
  pad,
  paragraph,
  radius,
  section,
  sectionHeader,
  splitGrid,
  stack,
  step,
  tabs,
} from './kit';

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
          sectionHeader(
            'Platform',
            'Everything you need after the first commit',
            'One integrated surface instead of nine subscriptions that almost talk to each other.'
          ),
          grid(
            'Feature grid',
            3,
            FEATURES.map((feature) =>
              liftCard(feature.title, [
                iconBadge(feature.icon),
                heading(feature.title, 3, CARD_TITLE),
                paragraph(feature.body, { ...SMALL, lineHeight: '1.6' }),
              ])
            )
          ),
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Alternating rows
 * ----------------------------------------------------------------------- */

const ALTERNATING = [
  {
    eyebrow: 'Previews',
    title: 'Review the real thing, not a screenshot',
    body: 'Every branch gets a URL the moment it is pushed. Share it with anyone — no VPN, no build steps, no “works on my machine”.',
    points: ['A URL per branch', 'Comments pinned to the page', 'Expires when the branch merges'],
  },
  {
    eyebrow: 'Observability',
    title: 'Know what changed and what it cost',
    body: 'Each deploy is measured against the last, so a regression shows up as a number before it shows up as a complaint.',
    points: ['Per-deploy performance budgets', 'Traces linked to the commit', 'Alerts that name the change'],
  },
];

export function alternatingFeaturesSpec(): NodeSpec {
  return section(
    'Alternating features',
    [
      container(
        ALTERNATING.map((item, i) => {
          // Reversed rows are placed, not reordered. Grid placement moves the
          // image to the left column without touching document order, so when
          // the row stacks the copy still comes first — swapping the children
          // instead would put a screenshot above the sentence explaining it.
          const flipped = i % 2 === 1;
          const place = (col: 1 | 2): StyleDecl =>
            flipped ? { gridColumn: String(col), gridRow: '1' } : {};
          const unplace: ResponsiveStyles = flipped
            ? { tablet: { gridColumn: 'auto', gridRow: 'auto' } }
            : {};

          const copy = column(
            item.title.slice(0, 24),
            [
              label(item.eyebrow, {
                fontSize: '12px',
                fontWeight: '600',
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: 'var(--c-primary)',
              }),
              heading(item.title, 2, { ...TITLE, maxWidth: '18ch', textWrap: 'balance' }, TITLE_RESPONSIVE),
              paragraph(item.body, { ...LEAD, maxWidth: '46ch' }, LEAD_RESPONSIVE),
              bullets(item.points, 'check', 'Points'),
            ],
            { gap: '18px', ...place(2) },
            unplace
          );

          const shot = media(
            `Screenshot showing ${item.title.toLowerCase()}`,
            '4 / 3',
            { boxShadow: 'var(--sh-lg)', ...place(1) },
            unplace
          );

          return grid(
            `Row ${i + 1}`,
            cols(1, 1),
            [copy, shot],
            { gap: '64px', alignItems: 'center', width: '100%' },
            { tablet: { gridTemplateColumns: cols(1), gap: '32px' } }
          );
        }),
        { gap: '96px' },
        { mobile: { gap: '56px' } }
      ),
    ]
  );
}

/* --------------------------------------------------------------------------
 * Bento grid
 * ----------------------------------------------------------------------- */

/**
 * Four cards over a 3×3, and the second axis is the new part.
 *
 * This block was already a bento in the loose sense — cards of unequal width in
 * one row of a grid. What it could not do was be unequal *downward*, because
 * `gridRow` had no way of being written: the block library could have reached
 * it in TypeScript and never did, and the inspector had no row for it at all
 * until M4, so nothing in the codebase had ever set one. A bento that varies
 * only by width is a row of wide and narrow cards, which is a fair description
 * of what this was.
 *
 * Nine cells, and every one filled: the opener covers 2×2, the two small cards
 * stack in the third column beside it, and the last card takes the full width
 * underneath. `rows` and the narrow-layout spans are stated per item rather
 * than derived, because the arrangement only works as a whole and a reader
 * should be able to count it.
 */
const BENTO: {
  icon: string;
  title: string;
  body: string;
  span: number;
  rows?: number;
  /** What it covers once the grid drops to two columns. */
  tablet: number;
}[] = [
  { icon: 'gauge', title: 'Sub-second builds', body: 'Incremental everywhere, so a one-line change ships in the time it takes to switch tabs.', span: 2, rows: 2, tablet: 2 },
  { icon: 'globe', title: '310 edge locations', body: 'Served from wherever your users are.', span: 1, tablet: 1 },
  { icon: 'lock', title: 'SOC 2 and HIPAA', body: 'Controls switched on by default.', span: 1, tablet: 1 },
  { icon: 'git-branch', title: 'Preview every branch', body: 'A real URL per pull request, torn down on merge.', span: 3, tablet: 2 },
];

export function bentoFeaturesSpec(): NodeSpec {
  return section(
    'Bento features',
    [
      container(
        [
          sectionHeader(
            'Why teams switch',
            'The parts nobody wants to build twice',
            'Infrastructure work that is necessary, undifferentiated, and never quite finished.'
          ),
          grid(
            'Bento',
            3,
            BENTO.map((item) =>
              liftCard(
                item.title,
                [
                  iconBadge(item.icon),
                  heading(item.title, 3, SUBTITLE, SUBTITLE_RESPONSIVE),
                  paragraph(item.body, SMALL),
                ],
                {
                  ...pad('28px'),
                  gap: '16px',
                  gridColumn: `span ${item.span}`,
                  ...(item.rows ? { gridRow: `span ${item.rows}` } : {}),
                  justifyContent: 'flex-end',
                  minHeight: '210px',
                  // Arrives as it is scrolled to, and costs the page nothing to
                  // execute: the timeline is the scrollport, so a page with the
                  // block on it still ships zero scripts.
                  appear: 'rise',
                },
                {
                  /*
                   * Both spans have to be *restated*, not dropped. A narrower
                   * breakpoint that omits one inherits the wider value, and a
                   * card still asking for three columns inside a two-column
                   * grid makes the browser invent a third — so the phone gets a
                   * sideways scrollbar rather than a stack. The row span is the
                   * quieter half of the same mistake: nothing spills, the card
                   * is simply twice as tall as it needs to be.
                   */
                  tablet: { gridColumn: `span ${item.tablet}`, gridRow: 'auto' },
                  mobile: { gridColumn: 'auto', gridRow: 'auto', minHeight: '0px' },
                }
              )
            ),
            { gap: '16px' },
            {
              // Two columns still reads as a bento: a full-width card, then two
              // narrow ones beside each other, then another full-width one.
              tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
              mobile: { gridTemplateColumns: cols(1) },
            }
          ),
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Icon checklist
 * ----------------------------------------------------------------------- */

const CHECKLIST = [
  { title: 'Zero-downtime deploys', body: 'Traffic shifts once the new version is healthy, never before.' },
  { title: 'Instant rollback', body: 'Every build stays addressable, so reverting is a click rather than a rebuild.' },
  { title: 'Secrets that stay secret', body: 'Scoped per environment, never printed in a log, rotatable without a redeploy.' },
  { title: 'Deterministic builds', body: 'The same commit produces the same artefact, today and in a year.' },
  { title: 'Real staging', body: 'A full copy of production, seeded on demand and thrown away after.' },
  { title: 'Audit everything', body: 'Who deployed what, when, and what it changed — exportable.' },
];

export function checklistSpec(): NodeSpec {
  return section('Checklist', [
    container(
      [
        sectionHeader(
          'Included',
          'Everything in every plan',
          'No feature gates on the things that keep a production site up.',
          'start'
        ),
        grid(
          'Checklist items',
          2,
          CHECKLIST.map((item) =>
            stack(
              item.title.slice(0, 24),
              [
                icon('circle-check', {
                  width: '19px',
                  height: '19px',
                  color: 'var(--c-primary)',
                  flexShrink: '0',
                  marginTop: '2px',
                }),
                column(
                  'Copy',
                  [
                    heading(item.title, 3, { fontSize: '16px', fontWeight: '600', lineHeight: '1.35' }),
                    paragraph(item.body, { ...SMALL, lineHeight: '1.6' }),
                  ],
                  { gap: '5px' }
                ),
              ],
              { gap: '12px', alignItems: 'flex-start' }
            )
          ),
          { gap: '28px 48px' }
        ),
      ],
      { gap: '48px', alignItems: 'flex-start' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Process steps
 * ----------------------------------------------------------------------- */

const STEPS = [
  { title: 'Connect the repository', body: 'Point Northwind at GitHub, GitLab or Bitbucket. Read-only until you say otherwise.' },
  { title: 'Pick a region', body: 'Or several. Data residency rules are enforced at the edge, not by policy documents.' },
  { title: 'Push', body: 'The first build starts immediately and a preview URL appears in the pull request.' },
  { title: 'Promote', body: 'When it looks right, ship it. Rollback stays one click away for ninety days.' },
];

export function processStepsSpec(): NodeSpec {
  return section(
    'Process',
    [
      container(
        [
          sectionHeader(
            'Getting started',
            'Live in four steps',
            'Most teams are serving production traffic the same afternoon they sign up.'
          ),
          grid(
            'Steps',
            4,
            STEPS.map((item, i) => step(i + 1, item.title, item.body)),
            { gap: '32px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '56px' }
      ),
    ]
  );
}

/* --------------------------------------------------------------------------
 * Timeline
 * ----------------------------------------------------------------------- */

const MILESTONES = [
  { when: 'Shipped', title: 'Edge functions in 310 regions', body: 'Run code next to your users without managing a fleet.' },
  { when: 'Shipped', title: 'Realtime collaboration', body: 'Multiple people in one project, with presence and conflict-free saves.' },
  { when: 'In beta', title: 'Managed Postgres', body: 'Branching databases that fork with your preview environments.' },
  { when: 'Next', title: 'Background jobs', body: 'Durable queues and schedules, wired to the same deploy pipeline.' },
];

export function timelineSpec(): NodeSpec {
  return section(
    'Timeline',
    [
      container(
        [
          sectionHeader(
            'Roadmap',
            'What we shipped, and what is next',
            'Published openly, updated when it changes rather than when it is convenient.',
            'start'
          ),
          column(
            'Milestones',
            MILESTONES.map((item, i) =>
              stack(
                item.title.slice(0, 24),
                [
                  // The rail: a dot per entry, joined by a line on all but the
                  // last, so the column reads as one thread rather than four
                  // unrelated rows.
                  column(
                    'Rail',
                    [
                      frame('Dot', [], {
                        width: '11px',
                        height: '11px',
                        ...radius('var(--r-full)'),
                        backgroundColor: i < 2 ? 'var(--c-primary)' : 'var(--c-border)',
                        ...pad('0px'),
                        flexShrink: '0',
                      }),
                      ...(i < MILESTONES.length - 1
                        ? [
                            frame('Line', [], {
                              width: '1px',
                              flexGrow: '1',
                              minHeight: '34px',
                              backgroundColor: 'var(--c-border)',
                              ...pad('0px'),
                            }),
                          ]
                        : []),
                    ],
                    { gap: '6px', alignItems: 'center', alignSelf: 'stretch' }
                  ),
                  column(
                    'Entry',
                    [
                      label(item.when, {
                        fontSize: '11px',
                        fontWeight: '650',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: i < 2 ? 'var(--c-primary)' : 'var(--c-muted)',
                      }),
                      heading(item.title, 3, { fontSize: '18px', fontWeight: '600', lineHeight: '1.3' }),
                      paragraph(item.body, { ...SMALL, maxWidth: '54ch' }),
                    ],
                    { gap: '6px', paddingBottom: '28px' }
                  ),
                ],
                { gap: '18px', alignItems: 'stretch', width: '100%' }
              )
            ),
            { gap: '0px', width: '100%' }
          ),
        ],
        { gap: '48px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Integrations directory
 * ----------------------------------------------------------------------- */

const INTEGRATIONS = [
  { icon: 'code', name: 'GitHub' },
  { icon: 'message-circle', name: 'Slack' },
  { icon: 'palette', name: 'Figma' },
  { icon: 'database', name: 'Postgres' },
  { icon: 'bell', name: 'PagerDuty' },
  { icon: 'chart-column', name: 'Datadog' },
  { icon: 'credit-card', name: 'Stripe' },
  { icon: 'mail', name: 'Resend' },
  { icon: 'shield-check', name: 'Okta' },
  { icon: 'box', name: 'S3' },
  { icon: 'workflow', name: 'Linear' },
  { icon: 'terminal', name: 'CLI' },
];

export function integrationsSpec(): NodeSpec {
  return section('Integrations', [
    container(
      [
        sectionHeader(
          'Integrations',
          'Fits the tools you already run',
          'Two-way where it matters, so state does not drift between systems.'
        ),
        grid(
          'Integration grid',
          6,
          INTEGRATIONS.map((item) =>
            card(
              item.name,
              [
                icon(item.icon, { width: '22px', height: '22px', color: 'var(--c-text)' }),
                label(item.name, { fontSize: '13px', fontWeight: '560', color: 'var(--c-text)' }),
              ],
              {
                ...pad('18px', '12px'),
                gap: '10px',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }
            )
          ),
          { gap: '12px' },
          {
            tablet: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
            mobile: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
          }
        ),
        stack(
          'Directory link',
          [chip('View all 90 integrations', '#'), button('Request one', 'secondary')],
          { gap: '12px', justifyContent: 'center', flexWrap: 'wrap', width: '100%' }
        ),
      ],
      { gap: '48px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Tabbed features
 * ----------------------------------------------------------------------- */

const TABBED: { value: string; label: string; title: string; body: string; points: string[] }[] = [
  {
    value: 'design',
    label: 'Design',
    title: 'Draw it the way you mean it',
    body: 'A canvas that renders the real thing, at the real width, with the real type. What you approve is what ships.',
    points: ['Container-query breakpoints', 'Real fonts and tokens', 'Nothing approximated'],
  },
  {
    value: 'build',
    label: 'Build',
    title: 'Components that stay in step',
    body: 'Change the main copy of a component and every instance follows. Detach one when it needs to go its own way.',
    points: ['Shared components', 'Design tokens', 'Reusable blocks'],
  },
  {
    value: 'ship',
    label: 'Ship',
    title: 'Static files, on the edge',
    body: 'Publishing writes HTML and CSS. No build step to wait on, nothing to keep running, nothing to patch.',
    points: ['Publishes in seconds', 'Own domain or ours', 'Nothing to execute'],
  },
];

/**
 * The switch, wearing the semantics that make it a tab set.
 *
 * Same state machine as the pricing toggle underneath — a generated CSS rule
 * hides the panels that are not current — with the roles, the tab-to-panel
 * pairing, one tab stop for the whole row and arrow keys added by the runtime.
 * All three panels are in the markup, so the copy in the two that are closed
 * is still read by a crawler and still there when the page is printed.
 */
export function tabbedFeaturesSpec(): NodeSpec {
  const panel = (item: (typeof TABBED)[number]): NodeSpec =>
    splitGrid(
      `${item.label} panel`,
      [
        column(
          `${item.label} copy`,
          [
            heading(item.title, 3, { ...SUBTITLE, fontSize: '30px' }, SUBTITLE_RESPONSIVE),
            paragraph(item.body, BODY, BODY_RESPONSIVE),
            bullets(item.points),
          ],
          { gap: '18px' }
        ),
        media(`A screenshot of the ${item.label.toLowerCase()} experience`, '4 / 3', {
          ...radius('var(--r-lg)'),
          boxShadow: 'var(--sh-lg)',
        }),
      ],
      { gap: '48px' }
    );

  return section('Tabbed features', [
    container(
      [
        sectionHeader(
          'How it works',
          'Three steps, one tool',
          'Most of what slows a site down is the handoff between these. There is not one.'
        ),
        tabs(
          'stage',
          TABBED.map((item) => ({ value: item.value, label: item.label, panel: panel(item) })),
          { listStyles: { marginLeft: 'auto', marginRight: 'auto' } }
        ),
      ],
      { gap: '44px' }
    ),
  ]);
}
