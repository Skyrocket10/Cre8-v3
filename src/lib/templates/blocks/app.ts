/**
 * Application blocks.
 *
 * The parts of a product that are not the marketing site: forms, tables of
 * numbers, the shell everything sits in. All of it static — anything that
 * needs to open, close, sort or dismiss is waiting on the behaviour runtime,
 * and faking those states here would put a control on the page that does
 * nothing when clicked.
 */

import type { NodeSpec } from '../../document/factory';
import {
  CAPTION,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TWO_TO_ONE,
  avatar,
  badge,
  border,
  borderSide,
  card,
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

/* --------------------------------------------------------------------------
 * Shared field furniture
 * ----------------------------------------------------------------------- */

interface FieldOptions {
  help?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  multiline?: boolean;
}

/**
 * Label, control, and the line underneath.
 *
 * The label is a real `label` element so clicking it focuses the field, and
 * the help text sits below rather than beside, where it survives being
 * narrow.
 */
const field = (name: string, options: FieldOptions = {}): NodeSpec =>
  column(
    name,
    [
      label(name, { ...CAPTION, fontSize: '13px', fontWeight: '560', color: 'var(--c-text)' }),
      options.multiline
        ? {
            type: 'textarea',
            name: `${name} input`,
            props: { placeholder: options.placeholder ?? '', name: name.toLowerCase(), rows: 4 },
            styles: { width: '100%' },
          }
        : {
            type: 'input',
            name: `${name} input`,
            props: {
              placeholder: options.placeholder ?? '',
              inputType: options.type ?? 'text',
              name: name.toLowerCase().replace(/\s+/g, '-'),
            },
            styles: { width: '100%' },
          },
      ...(options.error
        ? [label(options.error, { ...CAPTION, color: 'var(--c-danger, #dc2626)' })]
        : options.help
          ? [label(options.help, { ...CAPTION, color: 'var(--c-muted)' })]
          : []),
    ],
    { gap: '6px', width: '100%' }
  );

/* --------------------------------------------------------------------------
 * Form
 * ----------------------------------------------------------------------- */

export function formSpec(): NodeSpec {
  return section(
    'Form',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('Create a project', 1, { ...SUBTITLE, fontSize: '28px' }, SUBTITLE_RESPONSIVE),
              paragraph('Everything here can be changed later.', SMALL),
            ],
            { gap: '4px' }
          ),
          {
            type: 'form',
            name: 'Project form',
            styles: { display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' },
            children: [
              grid(
                'Name row',
                cols(1, 1),
                [
                  field('Project name', { placeholder: 'Northwind marketing' }),
                  field('Slug', { placeholder: 'northwind-marketing', help: 'Used in preview URLs.' }),
                ],
                { gap: '18px' },
                { mobile: { gridTemplateColumns: cols(1) } }
              ),
              field('Repository', {
                placeholder: 'github.com/acme/northwind',
                error: 'We could not reach that repository.',
              }),
              field('Description', { multiline: true, placeholder: 'What is this project for?' }),
              divider(),
              stack(
                'Actions',
                [
                  {
                    type: 'button',
                    name: 'Create project',
                    props: { label: 'Create project', href: '' },
                    styles: {},
                    states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                  },
                  {
                    type: 'button',
                    name: 'Cancel',
                    props: { label: 'Cancel', href: '' },
                    styles: {
                      backgroundColor: 'transparent',
                      color: 'var(--c-text)',
                      ...border('1px', 'var(--c-border)'),
                    },
                    states: { hover: { backgroundColor: 'var(--c-surface)' } },
                  },
                ],
                { gap: '10px' },
                { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
              ),
            ],
            responsive: { mobile: { gap: '14px' } },
          },
        ],
        { gap: '28px', alignItems: 'flex-start', maxWidth: '640px' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Search and filter bar
 * ----------------------------------------------------------------------- */

export function searchBarSpec(): NodeSpec {
  return section(
    'Search bar',
    [
      container(
        [
          stack(
            'Bar',
            [
              frame(
                'Search',
                [
                  icon('search', { width: '15px', height: '15px', color: 'var(--c-muted)', flexShrink: '0' }),
                  {
                    type: 'input',
                    name: 'Search input',
                    props: { placeholder: 'Search projects…', inputType: 'search', name: 'q' },
                    styles: {
                      width: '100%',
                      backgroundColor: 'transparent',
                      borderTopWidth: '0px',
                      borderRightWidth: '0px',
                      borderBottomWidth: '0px',
                      borderLeftWidth: '0px',
                      ...pad('0px'),
                    },
                  },
                ],
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '9px',
                  flexGrow: '1',
                  minWidth: '0px',
                  ...pad('10px', '14px'),
                  ...radius('var(--r-md)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundColor: 'var(--c-surface)',
                }
              ),
              stack(
                'Controls',
                [
                  textLink('All projects', '#', {
                    fontSize: '13.5px',
                    color: 'var(--c-text)',
                    ...pad('9px', '13px'),
                    ...radius('var(--r-md)'),
                    ...border('1px', 'var(--c-border)'),
                    whiteSpace: 'nowrap',
                  }),
                  textLink('Newest', '#', {
                    fontSize: '13.5px',
                    color: 'var(--c-text)',
                    ...pad('9px', '13px'),
                    ...radius('var(--r-md)'),
                    ...border('1px', 'var(--c-border)'),
                    whiteSpace: 'nowrap',
                  }),
                ],
                { gap: '8px', flexShrink: '0' }
              ),
            ],
            // No wrapping at width: the field grows to fill the row, so a
            // wrapping row hands it the whole line and drops the controls
            // underneath it. They stack deliberately on a phone instead.
            { gap: '10px', alignItems: 'center', width: '100%' },
            { mobile: { flexDirection: 'column', alignItems: 'stretch' } }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '32px', paddingBottom: '32px' }
  );
}

/* --------------------------------------------------------------------------
 * Settings section
 * ----------------------------------------------------------------------- */

export function settingsSpec(): NodeSpec {
  const row = (title: string, body: string, control: NodeSpec, last = false): NodeSpec =>
    stack(
      title,
      [
        column(
          'Copy',
          [
            heading(title, 2, { fontSize: '15px', fontWeight: '600', lineHeight: '1.35' }),
            paragraph(body, { ...CAPTION, maxWidth: '52ch' }),
          ],
          { gap: '3px' }
        ),
        control,
      ],
      {
        gap: '24px',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        ...pad('18px', '0px'),
        ...(last ? {} : borderSide('Bottom')),
      },
      { mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '10px' } }
    );

  const pill = (text: string): NodeSpec =>
    textLink(text, '#', {
      fontSize: '13px',
      color: 'var(--c-text)',
      ...pad('7px', '13px'),
      ...radius('var(--r-md)'),
      ...border('1px', 'var(--c-border)'),
      whiteSpace: 'nowrap',
      flexShrink: '0',
    });

  return section(
    'Settings',
    [
      container(
        [
          column(
            'Head',
            [
              heading('General', 1, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
              paragraph('Applies to every project in this workspace.', SMALL),
            ],
            { gap: '4px' }
          ),
          card(
            'Settings card',
            [
              row('Workspace name', 'Shown in the sidebar and on invitations.', pill('Rename')),
              row('Default region', 'Where new projects are created unless overridden.', pill('eu-west')),
              row('Two-factor authentication', 'Required for every member of this workspace.', pill('Manage')),
              row('Delete workspace', 'Removes every project and cannot be undone.', pill('Delete'), true),
            ],
            { ...pad('4px', '24px'), gap: '0px', width: '100%' },
            { mobile: { paddingLeft: '18px', paddingRight: '18px' } }
          ),
        ],
        { gap: '24px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Stat cards
 * ----------------------------------------------------------------------- */

const METRICS = [
  { label: 'Requests', value: '4.82M', delta: '+12.4%', up: true },
  { label: 'P95 latency', value: '84ms', delta: '−6.1%', up: true },
  { label: 'Error rate', value: '0.02%', delta: '+0.01pp', up: false },
  { label: 'Deploys', value: '38', delta: '+9', up: true },
];

export function statCardsSpec(): NodeSpec {
  return section(
    'Stat cards',
    [
      container(
        [
          grid(
            'Metrics',
            4,
            METRICS.map((metric) =>
              card(
                metric.label,
                [
                  label(metric.label, { ...CAPTION, color: 'var(--c-muted)' }),
                  label(metric.value, {
                    fontSize: '28px',
                    fontWeight: '620',
                    letterSpacing: '-0.024em',
                    lineHeight: '1',
                    color: 'var(--c-text)',
                  }),
                  stack(
                    'Delta',
                    [
                      icon(metric.up ? 'trending-up' : 'activity', {
                        width: '13px',
                        height: '13px',
                        color: metric.up ? 'var(--c-primary)' : 'var(--c-muted)',
                      }),
                      label(metric.delta, {
                        ...CAPTION,
                        color: metric.up ? 'var(--c-primary)' : 'var(--c-muted)',
                      }),
                      label('vs last week', { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '5px', alignItems: 'center' }
                  ),
                ],
                { ...pad('20px'), gap: '9px' }
              )
            ),
            { gap: '16px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '40px' }
  );
}

/* --------------------------------------------------------------------------
 * Badges and tags
 * ----------------------------------------------------------------------- */

export function badgesSpec(): NodeSpec {
  const tone = (text: string, colour: string): NodeSpec =>
    label(text, {
      fontSize: '12px',
      fontWeight: '580',
      color: colour,
      backgroundColor: tint(colour, 12),
      ...pad('4px', '10px'),
      ...radius('var(--r-full)'),
      ...border('1px', tint(colour, 28)),
    });

  const group = (title: string, children: NodeSpec[]): NodeSpec =>
    column(
      title,
      [
        label(title, {
          ...CAPTION,
          fontWeight: '620',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--c-muted)',
        }),
        stack('Row', children, { gap: '8px', flexWrap: 'wrap' }),
      ],
      { gap: '10px', width: '100%' }
    );

  return section(
    'Badges',
    [
      container(
        [
          grid(
            'Badge groups',
            3,
            [
              group('Status', [
                tone('Live', 'var(--c-primary)'),
                tone('Building', 'var(--c-accent)'),
                tone('Paused', 'var(--c-muted)'),
              ]),
              group('Plan', [badge('Pro'), badge('Trial', 'subtle'), badge('Enterprise', 'subtle')]),
              group('Labels', [
                label('frontend', {
                  ...CAPTION,
                  color: 'var(--c-muted)',
                  backgroundColor: 'var(--c-surface)',
                  ...pad('4px', '9px'),
                  ...radius('var(--r-sm)'),
                  ...border('1px', 'var(--c-border)'),
                }),
                label('needs-review', {
                  ...CAPTION,
                  color: 'var(--c-muted)',
                  backgroundColor: 'var(--c-surface)',
                  ...pad('4px', '9px'),
                  ...radius('var(--r-sm)'),
                  ...border('1px', 'var(--c-border)'),
                }),
              ]),
            ],
            { gap: '28px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '40px', backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Member list
 * ----------------------------------------------------------------------- */

const MEMBERS = [
  { name: 'Ana Ferreira', email: 'ana@northwind.dev', role: 'Owner' },
  { name: 'Marcus Hall', email: 'marcus@northwind.dev', role: 'Admin' },
  { name: 'Priya Raman', email: 'priya@northwind.dev', role: 'Member' },
  { name: 'Tobias Lind', email: 'tobias@northwind.dev', role: 'Viewer' },
];

export function membersSpec(): NodeSpec {
  return section(
    'Members',
    [
      container(
        [
          stack(
            'Head',
            [
              column(
                'Title',
                [
                  heading('Members', 1, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
                  paragraph('Four people, plus two pending invitations.', SMALL),
                ],
                { gap: '4px' }
              ),
              stack(
                'Avatars',
                [
                  ...MEMBERS.map((_, i) =>
                    avatar('30px', {
                      ...border('2px', 'var(--c-background)'),
                      // Overlapped into a stack: a row of four separate
                      // circles reads as four things, one cluster reads as a
                      // team.
                      marginLeft: i === 0 ? '0px' : '-9px',
                    })
                  ),
                  label('+2', {
                    ...CAPTION,
                    fontWeight: '600',
                    color: 'var(--c-muted)',
                    marginLeft: '8px',
                  }),
                ],
                { gap: '0px', alignItems: 'center' }
              ),
            ],
            {
              gap: '20px',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              flexWrap: 'wrap',
            }
          ),
          card(
            'Member list',
            MEMBERS.flatMap((member, i) => [
              ...(i > 0 ? [divider()] : []),
              stack(
                member.name,
                [
                  avatar('34px'),
                  column(
                    'Who',
                    [
                      label(member.name, { fontSize: '14px', fontWeight: '580', color: 'var(--c-text)' }),
                      label(member.email, { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '2px' }
                  ),
                  label(member.role, {
                    ...CAPTION,
                    color: 'var(--c-muted)',
                    marginLeft: 'auto',
                    ...pad('5px', '10px'),
                    ...radius('var(--r-sm)'),
                    ...border('1px', 'var(--c-border)'),
                    whiteSpace: 'nowrap',
                  }),
                ],
                { gap: '12px', alignItems: 'center', width: '100%' }
              ),
            ]),
            { ...pad('18px'), gap: '14px', width: '100%' }
          ),
        ],
        { gap: '24px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Empty state
 * ----------------------------------------------------------------------- */

export function emptyStateSpec(): NodeSpec {
  return section(
    'Empty state',
    [
      container(
        [
          frame(
            'Empty',
            [
              frame('Glyph', [icon('folder', { width: '24px', height: '24px', color: 'var(--c-muted)' })], {
                width: '52px',
                height: '52px',
                ...pad('0px'),
                ...radius('var(--r-full)'),
                backgroundColor: 'var(--c-surface-2)',
                alignItems: 'center',
                justifyContent: 'center',
              }),
              heading('No projects yet', 2, { ...SUBTITLE, fontSize: '20px' }),
              paragraph(
                'Import a repository or start from a template. Either takes about a minute.',
                { ...SMALL, maxWidth: '38ch', textAlign: 'center' }
              ),
              stack(
                'Actions',
                [
                  {
                    type: 'button',
                    name: 'Import',
                    props: { label: 'Import a repository', href: '#' },
                    styles: {},
                    states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                  },
                  textLink('Browse templates', '#', { fontSize: '13.5px', color: 'var(--c-primary)' }),
                ],
                { gap: '14px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }
              ),
            ],
            {
              ...pad('56px', '32px'),
              gap: '12px',
              alignItems: 'center',
              width: '100%',
              ...radius('var(--r-lg)'),
              borderStyle: 'dashed',
              borderTopWidth: '1px',
              borderRightWidth: '1px',
              borderBottomWidth: '1px',
              borderLeftWidth: '1px',
              borderColor: 'var(--c-border)',
            }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '48px', paddingBottom: '48px' }
  );
}

/* --------------------------------------------------------------------------
 * Skeleton
 * ----------------------------------------------------------------------- */

export function skeletonSpec(): NodeSpec {
  const bar = (width: string, height = '11px'): NodeSpec =>
    frame('Bar', [], {
      width,
      height,
      ...pad('0px'),
      ...radius('var(--r-full)'),
      backgroundColor: 'var(--c-border)',
    });

  return section(
    'Skeleton',
    [
      container(
        [
          grid(
            'Loading cards',
            3,
            [1, 2, 3].map((n) =>
              card(
                `Placeholder ${n}`,
                [
                  frame('Shot', [], {
                    width: '100%',
                    aspectRatio: '16 / 10',
                    ...pad('0px'),
                    ...radius('var(--r-md)'),
                    backgroundColor: 'var(--c-surface)',
                  }),
                  bar('40%', '9px'),
                  bar('90%', '14px'),
                  bar('70%'),
                  stack('Foot', [bar('24px', '24px'), bar('45%')], {
                    gap: '9px',
                    alignItems: 'center',
                    marginTop: '4px',
                  }),
                ],
                { ...pad('18px'), gap: '10px' }
              )
            )
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '40px' }
  );
}

/* --------------------------------------------------------------------------
 * Alerts
 * ----------------------------------------------------------------------- */

const ALERTS: { icon: string; title: string; body: string; colour: string }[] = [
  {
    icon: 'circle-check',
    title: 'Deployed to production',
    body: 'Build 4,281 is live in all regions. Rollback stays available for ninety days.',
    colour: 'var(--c-primary)',
  },
  {
    icon: 'circle-alert',
    title: 'Bandwidth at 82%',
    body: 'You will be notified again at 95%. Set a hard cap in workspace settings.',
    colour: 'var(--c-accent)',
  },
  {
    icon: 'life-buoy',
    title: 'Scheduled maintenance on Sunday',
    body: 'Ten minutes of read-only mode in eu-west, 02:00–02:10 UTC.',
    colour: 'var(--c-muted)',
  },
];

export function alertsSpec(): NodeSpec {
  return section(
    'Alerts',
    [
      container(
        [
          column(
            'Alerts',
            ALERTS.map((alert) =>
              stack(
                alert.title.slice(0, 24),
                [
                  icon(alert.icon, {
                    width: '18px',
                    height: '18px',
                    color: alert.colour,
                    flexShrink: '0',
                    marginTop: '1px',
                  }),
                  column(
                    'Copy',
                    [
                      label(alert.title, { fontSize: '14px', fontWeight: '600', color: 'var(--c-text)' }),
                      paragraph(alert.body, { ...CAPTION, lineHeight: '1.55', maxWidth: '62ch' }),
                    ],
                    { gap: '3px' }
                  ),
                ],
                {
                  gap: '12px',
                  alignItems: 'flex-start',
                  width: '100%',
                  ...pad('14px', '16px'),
                  ...radius('var(--r-md)'),
                  ...border('1px', tint(alert.colour, 30)),
                  backgroundColor: tint(alert.colour, 7),
                }
              )
            ),
            { gap: '12px', width: '100%' }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '40px' }
  );
}

/* --------------------------------------------------------------------------
 * Notification list
 * ----------------------------------------------------------------------- */

const NOTIFICATIONS = [
  { who: 'Marcus Hall', what: 'commented on', target: 'Preview environments', when: '4m', unread: true },
  { who: 'CI', what: 'finished a build for', target: 'feat/edge-cache', when: '22m', unread: true },
  { who: 'Priya Raman', what: 'approved', target: 'Bump runtime to 2.4', when: '1h', unread: false },
  { who: 'Sofia Duarte', what: 'invited you to', target: 'northwind-labs', when: 'Yesterday', unread: false },
];

export function notificationsSpec(): NodeSpec {
  return section(
    'Notifications',
    [
      container(
        [
          card(
            'Notifications',
            [
              stack(
                'Head',
                [
                  heading('Notifications', 2, { fontSize: '15px', fontWeight: '620', lineHeight: '1.3' }),
                  textLink('Mark all read', '#', { fontSize: '12.5px' }),
                ],
                {
                  gap: '12px',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  ...pad('0px', '0px', '12px', '0px'),
                  ...borderSide('Bottom'),
                }
              ),
              ...NOTIFICATIONS.map((item) =>
                stack(
                  item.target.slice(0, 24),
                  [
                    // The unread marker is a dot in the gutter, not a
                    // background wash — a tinted row at four-in-a-row reads as
                    // a table someone forgot to finish styling.
                    frame('Dot', [], {
                      width: '7px',
                      height: '7px',
                      marginTop: '7px',
                      ...pad('0px'),
                      ...radius('var(--r-full)'),
                      backgroundColor: item.unread ? 'var(--c-primary)' : 'transparent',
                      flexShrink: '0',
                    }),
                    avatar('28px'),
                    column(
                      'Copy',
                      [
                        paragraph(`${item.who} ${item.what} ${item.target}`, {
                          fontSize: '13.5px',
                          lineHeight: '1.45',
                          color: 'var(--c-text)',
                        }),
                        label(item.when, { ...CAPTION, color: 'var(--c-muted)' }),
                      ],
                      { gap: '2px' }
                    ),
                  ],
                  { gap: '10px', alignItems: 'flex-start', width: '100%', ...pad('10px', '0px') }
                )
              ),
            ],
            { ...pad('18px'), gap: '2px', width: '100%' }
          ),
        ],
        { gap: '0px', maxWidth: '520px', alignItems: 'flex-start' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '48px', backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * App shell
 * ----------------------------------------------------------------------- */

const NAV_GROUPS = [
  { title: 'Workspace', items: [['layout-grid', 'Overview', true], ['box', 'Projects', false], ['activity', 'Analytics', false]] },
  { title: 'Operate', items: [['server', 'Deployments', false], ['bell', 'Alerts', false], ['database', 'Storage', false]] },
  { title: 'Manage', items: [['users', 'Members', false], ['settings', 'Settings', false]] },
] as const;

export function appShellSpec(): NodeSpec {
  // A link cannot hold children, so the glyph and the label sit in a row and
  // the row is what gets the background; the label carries the link.
  const navItem = (glyph: string, text: string, current: boolean): NodeSpec =>
    stack(
      text,
      [
        icon(glyph, {
          width: '15px',
          height: '15px',
          color: current ? 'var(--c-primary)' : 'var(--c-muted)',
          flexShrink: '0',
        }),
        textLink(text, '#', {
          fontSize: '13.5px',
          fontWeight: current ? '560' : '450',
          color: current ? 'var(--c-primary)' : 'var(--c-muted)',
        }),
      ],
      {
        gap: '9px',
        alignItems: 'center',
        width: '100%',
        ...pad('8px', '10px'),
        ...radius('var(--r-sm)'),
        backgroundColor: current ? tint('var(--c-primary)', 10) : 'transparent',
      }
    );

  return section(
    'App shell',
    [
      // The bordered shell is an inner frame, not the section itself. A
      // block-level box is already `width: 100%`, so horizontal margins on it
      // add to that width rather than insetting it — the page then scrolls by
      // exactly the margin, at every breakpoint.
      grid(
        'Shell',
        '232px minmax(0, 1fr)',
        [
          column(
            'Sidebar',
            [
              stack(
                'Brand',
                [
                  icon('bolt', { width: '20px', height: '20px', color: 'var(--c-primary)' }),
                  label('Northwind', {
                    fontSize: '15px',
                    fontWeight: '640',
                    letterSpacing: '-0.018em',
                    color: 'var(--c-text)',
                  }),
                ],
                { gap: '8px', alignItems: 'center', ...pad('0px', '0px', '18px', '0px') }
              ),
              ...NAV_GROUPS.map((group) =>
                column(
                  group.title,
                  [
                    label(group.title, {
                      ...CAPTION,
                      fontSize: '11px',
                      fontWeight: '620',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--c-muted)',
                      ...pad('0px', '10px', '4px', '10px'),
                    }),
                    ...group.items.map(([glyph, text, current]) => navItem(glyph, text, current)),
                  ],
                  { gap: '2px', width: '100%' }
                )
              ),
            ],
            {
              gap: '18px',
              width: '100%',
              ...pad('22px', '16px'),
              backgroundColor: 'var(--c-surface)',
              ...borderSide('Right'),
              alignSelf: 'stretch',
            },
            // Below the split the sidebar becomes an ordinary band above the
            // content; a 232px rail on a phone is most of the screen.
            { tablet: { borderRightWidth: '0px', ...borderSide('Bottom') } }
          ),
          column(
            'Main',
            [
              stack(
                'Topbar',
                [
                  column(
                    'Title',
                    [
                      heading('Overview', 1, { fontSize: '21px', fontWeight: '620', lineHeight: '1.25' }),
                      label('Last deployed 12 minutes ago', { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '2px' }
                  ),
                  stack(
                    'Topbar actions',
                    [
                      textLink('Invite', '#', {
                        fontSize: '13px',
                        color: 'var(--c-text)',
                        ...pad('8px', '12px'),
                        ...radius('var(--r-md)'),
                        ...border('1px', 'var(--c-border)'),
                      }),
                      avatar('30px'),
                    ],
                    { gap: '10px', alignItems: 'center' }
                  ),
                ],
                {
                  gap: '16px',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  flexWrap: 'wrap',
                }
              ),
              grid(
                'Cards',
                3,
                METRICS.slice(0, 3).map((metric) =>
                  card(
                    metric.label,
                    [
                      label(metric.label, { ...CAPTION, color: 'var(--c-muted)' }),
                      label(metric.value, {
                        fontSize: '24px',
                        fontWeight: '620',
                        letterSpacing: '-0.022em',
                        lineHeight: '1',
                        color: 'var(--c-text)',
                      }),
                    ],
                    { ...pad('16px'), gap: '7px' }
                  )
                ),
                { gap: '12px' }
              ),
              frame(
                'Chart',
                [],
                {
                  width: '100%',
                  height: '190px',
                  ...radius('var(--r-md)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundImage: `linear-gradient(180deg, ${tint('var(--c-primary)', 14)} 0%, transparent 100%)`,
                  ...pad('0px'),
                },
                { mobile: { height: '130px' } }
              ),
            ],
            { gap: '20px', width: '100%', ...pad('24px') },
            { mobile: { paddingLeft: '18px', paddingRight: '18px' } }
          ),
        ],
        {
          gap: '0px',
          alignItems: 'stretch',
          width: '100%',
          ...border('1px', 'var(--c-border)'),
          ...radius('var(--r-lg)'),
          overflow: 'hidden',
        },
        { tablet: { gridTemplateColumns: cols(1) } }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '40px' }
  );
}

/* --------------------------------------------------------------------------
 * Auth screen
 * ----------------------------------------------------------------------- */

export function authSpec(): NodeSpec {
  return section(
    'Sign in',
    [
      container(
        [
          card(
            'Sign in card',
            [
              stack(
                'Brand',
                [
                  icon('bolt', { width: '22px', height: '22px', color: 'var(--c-primary)' }),
                  label('Northwind', {
                    fontSize: '16px',
                    fontWeight: '640',
                    letterSpacing: '-0.02em',
                    color: 'var(--c-text)',
                  }),
                ],
                { gap: '8px', alignItems: 'center' }
              ),
              column(
                'Head',
                [
                  heading('Sign in', 1, { ...SUBTITLE, fontSize: '24px' }),
                  paragraph('Pick up where your team left off.', SMALL),
                ],
                { gap: '3px' }
              ),
              {
                type: 'form',
                name: 'Sign in form',
                styles: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' },
                children: [
                  field('Email', { type: 'email', placeholder: 'you@company.com' }),
                  field('Password', { type: 'password', placeholder: '••••••••' }),
                  {
                    type: 'button',
                    name: 'Sign in button',
                    props: { label: 'Sign in', href: '' },
                    styles: { width: '100%' },
                    states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                  },
                ],
              },
              divider(),
              stack(
                'Foot',
                [
                  label('New here?', { ...CAPTION, color: 'var(--c-muted)' }),
                  textLink('Create an account', '#', { fontSize: '12.5px', color: 'var(--c-primary)' }),
                ],
                { gap: '6px', justifyContent: 'center', width: '100%' }
              ),
            ],
            { ...pad('32px'), gap: '18px', width: '100%', maxWidth: '400px' },
            { mobile: { paddingLeft: '22px', paddingRight: '22px' } }
          ),
        ],
        { gap: '0px', alignItems: 'center' }
      ),
    ],
    { paddingTop: '72px', paddingBottom: '80px', backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Pricing comparison table
 * ----------------------------------------------------------------------- */

const PLANS = ['Hobby', 'Team', 'Enterprise'];
const FEATURES: [string, string, string, string][] = [
  ['Projects', '1', 'Unlimited', 'Unlimited'],
  ['Bandwidth', '10 GB', '1 TB', 'Custom'],
  ['Preview environments', '✓', '✓', '✓'],
  ['SSO and audit logs', '—', '✓', '✓'],
  ['Dedicated regions', '—', '—', '✓'],
  ['Support', 'Community', 'Priority', 'Named engineer'],
];

export function comparisonSpec(): NodeSpec {
  const cell = (text: string, strong = false): NodeSpec =>
    label(text, {
      fontSize: '13.5px',
      fontWeight: strong ? '580' : '450',
      color: strong ? 'var(--c-text)' : 'var(--c-muted)',
      textAlign: strong ? 'left' : 'center',
    });

  return section(
    'Comparison',
    [
      container(
        [
          heading('Compare plans', 2, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
          column(
            'Table',
            [
              grid(
                'Header row',
                cols(1.6, 1, 1, 1),
                [cell('', true), ...PLANS.map((plan) => cell(plan, false))].map((node, i) =>
                  i === 0
                    ? node
                    : { ...node, styles: { ...node.styles, fontWeight: '620', color: 'var(--c-text)' } }
                ),
                { gap: '12px', ...pad('0px', '4px', '12px', '4px'), ...borderSide('Bottom'), width: '100%' },
                { mobile: { gridTemplateColumns: cols(1.4, 1, 1, 1), gap: '8px' } }
              ),
              ...FEATURES.map(([name, ...values], i) =>
                grid(
                  name,
                  cols(1.6, 1, 1, 1),
                  [cell(name, true), ...values.map((value) => cell(value))],
                  {
                    gap: '12px',
                    ...pad('12px', '4px'),
                    width: '100%',
                    ...(i < FEATURES.length - 1 ? borderSide('Bottom') : {}),
                  },
                  { mobile: { gridTemplateColumns: cols(1.4, 1, 1, 1), gap: '8px' } }
                )
              ),
            ],
            { gap: '0px', width: '100%' }
          ),
        ],
        { gap: '24px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * File / resource list
 * ----------------------------------------------------------------------- */

const FILES = [
  { icon: 'file-text', name: 'brand-guidelines.pdf', meta: '2.4 MB · 12 Jul' },
  { icon: 'image', name: 'hero-shot@2x.png', meta: '840 KB · 9 Jul' },
  { icon: 'folder', name: 'Press kit', meta: '14 items · 2 Jul' },
  { icon: 'file-text', name: 'security-whitepaper.pdf', meta: '1.1 MB · 28 Jun' },
];

export function fileListSpec(): NodeSpec {
  return section(
    'File list',
    [
      container(
        [
          column(
            'Head',
            [
              heading('Shared files', 1, { ...SUBTITLE, fontSize: '24px' }, SUBTITLE_RESPONSIVE),
              paragraph('Everything the team has uploaded to this project.', SMALL),
            ],
            { gap: '4px' }
          ),
          column(
            'Files',
            FILES.map((file, i) =>
              stack(
                file.name,
                [
                  frame('Glyph', [icon(file.icon, { width: '16px', height: '16px', color: 'var(--c-muted)' })], {
                    width: '36px',
                    height: '36px',
                    ...pad('0px'),
                    ...radius('var(--r-sm)'),
                    backgroundColor: 'var(--c-surface)',
                    ...border('1px', 'var(--c-border)'),
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: '0',
                  }),
                  column(
                    'Meta',
                    [
                      label(file.name, { fontSize: '14px', fontWeight: '560', color: 'var(--c-text)' }),
                      label(file.meta, { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '2px' }
                  ),
                  textLink('Download', '#', { fontSize: '13px', marginLeft: 'auto', flexShrink: '0' }),
                ],
                {
                  gap: '12px',
                  alignItems: 'center',
                  width: '100%',
                  ...pad('12px', '4px'),
                  ...(i > 0 ? borderSide('Top') : {}),
                }
              )
            ),
            { gap: '0px', width: '100%' }
          ),
        ],
        { gap: '20px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '48px', paddingBottom: '56px' }
  );
}
