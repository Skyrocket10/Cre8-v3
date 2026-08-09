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
  CARD_TITLE,
  EYEBROW,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TWO_TO_ONE,
  avatar,
  badge,
  border,
  borderSide,
  card,
  cell,
  checkbox,
  cols,
  column,
  container,
  dialog,
  divider,
  dropdown,
  fieldset,
  fileField,
  frame,
  grid,
  heading,
  icon,
  label,
  pad,
  media,
  paragraph,
  popover,
  popoverButton,
  progress,
  radio,
  radius,
  section,
  slider,
  stack,
  switchButton,
  switchCase,
  switchGroup,
  switchStep,
  table,
  tableRow,
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

/**
 * Built on real table markup rather than a stack of grids.
 *
 * The two look identical. Only one of them tells a screen reader that "1 TB"
 * is the Team plan's bandwidth — a grid of boxes reads out as a list of
 * disconnected values, and the meaning of a comparison table is entirely in
 * the connections.
 */
export function comparisonSpec(): NodeSpec {
  const centred = { textAlign: 'center' as const };

  return section(
    'Comparison',
    [
      container(
        [
          heading('Compare plans', 2, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
          table(
            'Plan comparison',
            [
              tableRow(
                'Header row',
                [
                  cell('', { header: true }),
                  ...PLANS.map((plan) =>
                    cell(plan, {
                      header: true,
                      styles: { ...centred, fontSize: '14px', fontWeight: '620' },
                    })
                  ),
                ],
                { ...borderSide('Bottom') }
              ),
              ...FEATURES.map(([name, ...values]) =>
                tableRow(
                  name,
                  [
                    // `scope: 'row'` is what pairs the feature name with the
                    // three values beside it.
                    cell(name, {
                      header: true,
                      scope: 'row',
                      styles: { fontSize: '13.5px', fontWeight: '580', width: '40%' },
                    }),
                    ...values.map((value) =>
                      cell(value, { styles: { ...centred, fontSize: '13.5px' } })
                    ),
                  ],
                  { ...borderSide('Bottom') }
                )
              ),
            ],
            { minWidth: '520px' }
          ),
        ],
        { gap: '24px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Data table
 * ----------------------------------------------------------------------- */

const ORDERS: { id: string; customer: string; status: string; tone: string; total: string }[] = [
  { id: '#4021', customer: 'Ines García', status: 'Paid', tone: 'var(--c-primary)', total: '£248.00' },
  { id: '#4020', customer: 'Marcus Bell', status: 'Pending', tone: 'var(--c-muted)', total: '£62.00' },
  { id: '#4019', customer: 'Aiko Tanaka', status: 'Paid', tone: 'var(--c-primary)', total: '£1,140.00' },
  {
    id: '#4018',
    customer: 'Tom Okafor',
    status: 'Refunded',
    tone: 'var(--c-danger, #dc2626)',
    total: '£89.00',
  },
  { id: '#4017', customer: 'Priya Raman', status: 'Paid', tone: 'var(--c-primary)', total: '£415.00' },
];

export function dataTableSpec(): NodeSpec {
  const status = (text: string, tone: string): NodeSpec =>
    frame(
      `${text} pill`,
      [label(text, { fontSize: '12px', fontWeight: '560', color: tone })],
      {
        ...pad('4px', '10px'),
        ...radius('var(--r-full)'),
        backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)`,
        alignItems: 'center',
        width: 'fit-content',
      }
    );

  return section(
    'Data table',
    [
      container(
        [
          column(
            'Head',
            [
              heading('Recent orders', 1, { ...SUBTITLE, fontSize: '24px' }, SUBTITLE_RESPONSIVE),
              paragraph('Everything that came through in the last seven days.', SMALL),
            ],
            { gap: '4px' }
          ),
          table(
            'Orders',
            [
              tableRow(
                'Header row',
                [
                  cell('Order', { header: true }),
                  cell('Customer', { header: true }),
                  cell('Status', { header: true }),
                  cell('Total', { header: true, styles: { textAlign: 'right' } }),
                ],
                {
                  backgroundColor: 'var(--c-surface)',
                  ...borderSide('Bottom'),
                }
              ),
              ...ORDERS.map((order) =>
                tableRow(
                  order.id,
                  [
                    cell(order.id, {
                      header: true,
                      scope: 'row',
                      styles: { fontSize: '13.5px', fontWeight: '560' },
                    }),
                    cell(order.customer, { styles: { color: 'var(--c-text)' } }),
                    cell(status(order.status, order.tone)),
                    cell(order.total, {
                      styles: {
                        textAlign: 'right',
                        color: 'var(--c-text)',
                        fontVariantNumeric: 'tabular-nums',
                      },
                    }),
                  ],
                  { ...borderSide('Bottom') }
                )
              ),
            ],
            { caption: 'Orders placed in the last seven days', minWidth: '560px' }
          ),
        ],
        { gap: '20px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Command menu
 * ----------------------------------------------------------------------- */

const COMMANDS: { icon: string; label: string; hint: string }[] = [
  { icon: 'plus', label: 'New project', hint: 'P' },
  { icon: 'users', label: 'Invite a teammate', hint: 'I' },
  { icon: 'settings', label: 'Workspace settings', hint: ',' },
  { icon: 'file-text', label: 'Read the docs', hint: '?' },
];

/**
 * A panel the browser opens, closes and focuses on its own.
 *
 * Everything a hand-built command palette has to get right — stacking above
 * the page, Escape, a click outside, returning focus to the trigger — is what
 * `[popover]` already is, and the published page carries no script for any of
 * it. It opens centred because that is where the top layer puts a panel with
 * no anchor, which happens to be exactly where a command menu belongs.
 */
export function commandMenuSpec(): NodeSpec {
  const command = (item: { icon: string; label: string; hint: string }): NodeSpec =>
    stack(
      item.label,
      [
        icon(item.icon, { width: '15px', height: '15px', color: 'var(--c-muted)' }),
        label(item.label, { fontSize: '14px', color: 'var(--c-text)' }),
        label(item.hint, {
          ...CAPTION,
          color: 'var(--c-muted)',
          marginLeft: 'auto',
          ...pad('2px', '6px'),
          ...radius('var(--r-sm)'),
          backgroundColor: 'var(--c-surface)',
        }),
      ],
      {
        gap: '10px',
        width: '100%',
        alignItems: 'center',
        ...pad('9px', '10px'),
        ...radius('var(--r-sm)'),
      }
    );

  return section(
    'Command menu',
    [
      container(
        [
          card(
            'Toolbar',
            [
              stack(
                'Toolbar row',
                [
                  column(
                    'Toolbar copy',
                    [
                      heading('Northwind', 3, { ...CARD_TITLE, fontSize: '17px' }),
                      label('Everything, one keystroke away.', { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '2px' }
                  ),
                  {
                    ...popoverButton('Search', 'Command menu'),
                    name: 'Open command menu',
                    styles: {
                      marginLeft: 'auto',
                      fontSize: '13.5px',
                      ...pad('8px', '14px'),
                      backgroundColor: 'transparent',
                      color: 'var(--c-muted)',
                      ...border('1px', 'var(--c-border)'),
                    },
                  },
                ],
                { gap: '16px', width: '100%', alignItems: 'center' }
              ),
            ],
            { gap: '0px' }
          ),

          popover(
            'Command menu',
            [
              label('Jump to', { ...EYEBROW, fontSize: '11px' }),
              column('Commands', COMMANDS.map(command), { gap: '2px', width: '100%' }),
              divider(),
              stack(
                'Menu footer',
                [
                  label('Esc closes it, and so does a click outside.', {
                    ...CAPTION,
                    color: 'var(--c-muted)',
                  }),
                  {
                    ...popoverButton('Close', 'Command menu', { action: 'hide', variant: 'ghost' }),
                    name: 'Close menu',
                    styles: {
                      marginLeft: 'auto',
                      fontSize: '13px',
                      ...pad('6px', '10px'),
                      backgroundColor: 'transparent',
                      color: 'var(--c-muted)',
                    },
                  },
                ],
                { gap: '12px', width: '100%', alignItems: 'center' }
              ),
            ],
            { styles: { gap: '10px' }, responsive: { mobile: { width: 'calc(100% - 24px)' } } }
          ),
        ],
        { gap: '20px', alignItems: 'stretch', maxWidth: 'var(--w-content)' }
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

/* --------------------------------------------------------------------------
 * Filter panel
 * ----------------------------------------------------------------------- */

/**
 * The sidebar of a catalogue, built from real controls.
 *
 * Three `<fieldset>`s, because "Availability" is a question and the two
 * checkboxes under it are its answers — a screen reader reads the legend
 * before each one, and without it the words arrive with nothing attached.
 * Every control here is native, so the whole panel is keyboard-operable and
 * the published page carries no script.
 */
export function filterPanelSpec(): NodeSpec {
  return section(
    'Filters',
    [
      container(
        [
          grid(
            'Filter layout',
            cols(1, 2.4),
            [
              {
                type: 'form',
                name: 'Filter form',
                styles: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' },
                children: [
                  stack(
                    'Filter head',
                    [
                      heading('Filters', 2, { ...CARD_TITLE, fontSize: '16px' }),
                      textLink('Clear all', '#', { fontSize: '13px', marginLeft: 'auto' }),
                    ],
                    { gap: '12px', width: '100%', alignItems: 'center' }
                  ),

                  fieldset(
                    'Price',
                    [
                      slider('price', { min: 0, max: 500, step: 10, value: 220 }),
                      stack(
                        'Price ends',
                        [
                          label('£0', { ...CAPTION, color: 'var(--c-muted)' }),
                          label('£500', {
                            ...CAPTION,
                            color: 'var(--c-muted)',
                            marginLeft: 'auto',
                          }),
                        ],
                        { gap: '8px', width: '100%' }
                      ),
                    ],
                    { gap: '8px' }
                  ),

                  fieldset(
                    'Availability',
                    [
                      checkbox('In stock', 'availability', true),
                      checkbox('Ships today', 'availability'),
                      checkbox('Made to order', 'availability'),
                    ],
                    { gap: '9px' }
                  ),

                  fieldset(
                    'Condition',
                    [
                      radio('Any', 'condition', 'any', true),
                      radio('New', 'condition', 'new'),
                      radio('Refurbished', 'condition', 'refurbished'),
                    ],
                    { gap: '9px' }
                  ),

                  column(
                    'Sort',
                    [
                      label('Sort by', {
                        ...CAPTION,
                        fontSize: '13px',
                        fontWeight: '560',
                        color: 'var(--c-text)',
                      }),
                      dropdown('sort', ['Most relevant', 'Price, low to high', 'Newest'], undefined, {
                        fontSize: '14px',
                      }),
                    ],
                    { gap: '6px', width: '100%' }
                  ),

                  {
                    type: 'button',
                    name: 'Apply filters',
                    props: { label: 'Apply filters', href: '' },
                    styles: { width: '100%', ...pad('11px', '18px'), fontSize: '14px' },
                    states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                  },
                ],
              },

              column(
                'Results',
                [
                  stack(
                    'Results head',
                    [
                      heading('124 results', 1, { ...SUBTITLE, fontSize: '22px' }, SUBTITLE_RESPONSIVE),
                      label('Showing 1–12', {
                        ...CAPTION,
                        color: 'var(--c-muted)',
                        marginLeft: 'auto',
                      }),
                    ],
                    { gap: '12px', width: '100%', alignItems: 'baseline' }
                  ),
                  grid(
                    'Result grid',
                    2,
                    RESULTS.map((item) =>
                      card(
                        item.name,
                        [
                          media('A product photograph', '4 / 3', {
                            ...radius('var(--r-sm)'),
                            marginBottom: '4px',
                          }),
                          label(item.name, {
                            fontSize: '14.5px',
                            fontWeight: '560',
                            color: 'var(--c-text)',
                          }),
                          label(item.price, { ...CAPTION, color: 'var(--c-muted)' }),
                        ],
                        { gap: '8px', ...pad('12px') }
                      )
                    ),
                    { gap: '16px' },
                    { mobile: { gridTemplateColumns: cols(1) } }
                  ),
                ],
                { gap: '16px', width: '100%' }
              ),
            ],
            { gap: '36px', alignItems: 'start' },
            { tablet: { gridTemplateColumns: cols(1), gap: '28px' } }
          ),
        ],
        { gap: '20px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

const RESULTS = [
  { name: 'Field Notebook', price: '£18' },
  { name: 'Brass Ruler', price: '£24' },
  { name: 'Desk Mat', price: '£62' },
  { name: 'Ink Refill Set', price: '£12' },
];

/* --------------------------------------------------------------------------
 * Upload
 * ----------------------------------------------------------------------- */

const UPLOADS: { name: string; note: string; done: number | null }[] = [
  { name: 'brand-assets.zip', note: '18.4 MB · uploading', done: 68 },
  { name: 'photography/', note: '212 files · queued', done: null },
  { name: 'typeface-licence.pdf', note: '340 KB · done', done: 100 },
];

/**
 * A real `<input type="file">` and real `<progress>` bars.
 *
 * The drop-zone look is on the input itself rather than on a div behind it,
 * so the whole panel is the hit target and the keyboard reaches it — a styled
 * div with a hidden input beside it looks the same and is unusable without a
 * mouse.
 */
export function uploadSpec(): NodeSpec {
  return section(
    'Upload',
    [
      container(
        [
          column(
            'Head',
            [
              heading('Import your assets', 1, { ...SUBTITLE, fontSize: '24px' }, SUBTITLE_RESPONSIVE),
              paragraph('Drag a folder in, or pick the files you want to bring across.', SMALL),
            ],
            { gap: '4px' }
          ),

          {
            type: 'form',
            name: 'Upload form',
            styles: { display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' },
            children: [
              fileField('assets', {
                accept: 'image/*,.pdf,.zip',
                multiple: true,
                styles: { ...pad('22px', '20px'), fontSize: '14px' },
              }),

              column(
                'Queue',
                UPLOADS.map((item) =>
                  column(
                    item.name,
                    [
                      stack(
                        'Row',
                        [
                          icon(item.done === 100 ? 'check' : 'file-text', {
                            width: '15px',
                            height: '15px',
                            color: item.done === 100 ? 'var(--c-primary)' : 'var(--c-muted)',
                            flexShrink: '0',
                          }),
                          label(item.name, {
                            fontSize: '14px',
                            fontWeight: '540',
                            color: 'var(--c-text)',
                          }),
                          label(item.note, {
                            ...CAPTION,
                            color: 'var(--c-muted)',
                            marginLeft: 'auto',
                            flexShrink: '0',
                          }),
                        ],
                        { gap: '10px', width: '100%', alignItems: 'center' }
                      ),
                      progress(`${item.name} progress`, item.done, {
                        styles: {
                          width: '100%',
                          height: '6px',
                          color:
                            item.done === 100 ? 'var(--c-primary)' : 'var(--c-secondary)',
                          backgroundColor: 'var(--c-surface)',
                        },
                      }),
                    ],
                    { gap: '8px', width: '100%', ...pad('12px', '2px') }
                  )
                ),
                { gap: '0px', width: '100%' }
              ),

              divider(),

              stack(
                'Upload actions',
                [
                  {
                    type: 'button',
                    name: 'Start import',
                    props: { label: 'Start import', href: '' },
                    styles: { ...pad('11px', '18px'), fontSize: '14px' },
                    states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                  },
                  {
                    type: 'button',
                    name: 'Cancel upload',
                    props: { label: 'Cancel', href: '' },
                    styles: {
                      ...pad('11px', '18px'),
                      fontSize: '14px',
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
        { gap: '20px', alignItems: 'flex-start', maxWidth: '720px' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Confirm dialog
 * ----------------------------------------------------------------------- */

/**
 * The one interaction every application needs and nobody enjoys building.
 *
 * A real `<dialog>`, so it is announced as a dialog and read out by its
 * label. Opened and closed by the same `popovertarget` wiring the menu uses,
 * which means the published page carries no script — Escape cancels, a click
 * outside cancels, and focus goes back to the button that opened it.
 *
 * Cancel comes before Delete in the DOM so the safe choice is the first thing
 * a keyboard reaches, and the destructive one carries the danger token rather
 * than being the same button in a different colour.
 */
export function confirmDialogSpec(): NodeSpec {
  return section(
    'Confirm dialog',
    [
      container(
        [
          card(
            'Danger zone',
            [
              column(
                'Danger copy',
                [
                  heading('Delete this project', 3, { ...CARD_TITLE, fontSize: '16px' }),
                  paragraph(
                    'Everything in it goes: pages, assets, and every published version.',
                    { ...CAPTION, color: 'var(--c-muted)' }
                  ),
                ],
                { gap: '4px' }
              ),
              {
                ...popoverButton('Delete project…', 'Confirm delete'),
                name: 'Open confirm',
                styles: {
                  marginLeft: 'auto',
                  flexShrink: '0',
                  fontSize: '13.5px',
                  ...pad('9px', '14px'),
                  backgroundColor: 'transparent',
                  color: 'var(--c-danger, #dc2626)',
                  ...border('1px', 'var(--c-danger, #dc2626)'),
                },
                states: {
                  hover: {
                    backgroundColor: 'color-mix(in srgb, var(--c-danger, #dc2626) 10%, transparent)',
                  },
                },
              },
            ],
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: '20px',
              ...border('1px', 'color-mix(in srgb, var(--c-danger, #dc2626) 35%, transparent)'),
            },
            { mobile: { flexDirection: 'column', alignItems: 'flex-start' } }
          ),

          dialog(
            'Confirm delete',
            'Delete this project?',
            [
              stack(
                'Dialog head',
                [
                  frame(
                    'Warning glyph',
                    [
                      icon('circle-alert', {
                        width: '17px',
                        height: '17px',
                        color: 'var(--c-danger, #dc2626)',
                      }),
                    ],
                    {
                      width: '34px',
                      height: '34px',
                      ...pad('0px'),
                      ...radius('var(--r-full)'),
                      backgroundColor:
                        'color-mix(in srgb, var(--c-danger, #dc2626) 12%, transparent)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: '0',
                    }
                  ),
                  heading('Delete this project?', 3, { ...CARD_TITLE, fontSize: '17px' }),
                ],
                { gap: '12px', width: '100%', alignItems: 'center' }
              ),
              paragraph(
                'This cannot be undone. Type of thing worth reading twice — every page, asset and published version goes with it.',
                { ...SMALL, color: 'var(--c-muted)' }
              ),
              divider(),
              stack(
                'Dialog actions',
                [
                  // Cancel first in the DOM, so the safe choice is the one a
                  // keyboard reaches first.
                  {
                    ...popoverButton('Cancel', 'Confirm delete', { action: 'hide' }),
                    name: 'Cancel',
                    styles: {
                      marginLeft: 'auto',
                      fontSize: '13.5px',
                      ...pad('9px', '15px'),
                      backgroundColor: 'transparent',
                      color: 'var(--c-text)',
                      ...border('1px', 'var(--c-border)'),
                    },
                  },
                  {
                    ...popoverButton('Delete', 'Confirm delete', { action: 'hide' }),
                    name: 'Confirm delete button',
                    styles: {
                      fontSize: '13.5px',
                      ...pad('9px', '15px'),
                      backgroundColor: 'var(--c-danger, #dc2626)',
                      color: 'var(--c-on-primary)',
                    },
                    states: {
                      hover: {
                        backgroundColor:
                          'color-mix(in srgb, var(--c-danger, #dc2626) 85%, black)',
                      },
                    },
                  },
                ],
                { gap: '9px', width: '100%', alignItems: 'center' },
                { mobile: { flexDirection: 'column-reverse', alignItems: 'stretch' } }
              ),
            ],
            { responsive: { mobile: { width: 'calc(100% - 24px)' } } }
          ),
        ],
        { gap: '20px', alignItems: 'stretch', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Stepper
 * ----------------------------------------------------------------------- */

const STEPS: { value: string; n: string; label: string; heading: string; fields: string[] }[] = [
  {
    value: 'account',
    n: '1',
    label: 'Account',
    heading: 'Who is this for?',
    fields: ['Full name', 'Work email'],
  },
  {
    value: 'workspace',
    n: '2',
    label: 'Workspace',
    heading: 'Name your workspace',
    fields: ['Workspace name', 'Web address'],
  },
  {
    value: 'invite',
    n: '3',
    label: 'Invite',
    heading: 'Bring the team in',
    fields: ['Email addresses'],
  },
];

/**
 * A three-step flow, one step on screen at a time.
 *
 * Two kinds of control, and the difference matters. The numbered markers are
 * a switch — pressed or not, and clickable, because a half-filled form is
 * something people go back to. Back and Next are not: they move the flow on,
 * and calling them toggles ("Next, toggle button, not pressed") would
 * describe something the button is not. `switchStep` is that distinction.
 *
 * Every step's fields are in the markup the whole time, which is what makes
 * this work with one attribute write and no re-render — and also means the
 * form posts everything at once, rather than needing state kept between
 * screens.
 */
export function stepperSpec(): NodeSpec {
  const marker = (step: (typeof STEPS)[number]): NodeSpec => ({
    ...switchButton(`${step.n}. ${step.label}`, step.value, {
      fontSize: '13.5px',
      ...pad('8px', '14px'),
      ...radius('var(--r-full)'),
      whiteSpace: 'nowrap',
    }),
    name: `${step.label} marker`,
  });

  const panel = (step: (typeof STEPS)[number], index: number): NodeSpec =>
    switchCase(
      step.value,
      column(
        `${step.label} step`,
        [
          heading(step.heading, 2, { ...SUBTITLE, fontSize: '22px' }, SUBTITLE_RESPONSIVE),
          ...step.fields.map((name) => field(name)),
          divider(),
          stack(
            `${step.label} actions`,
            [
              ...(index > 0
                ? [switchStep('Back', STEPS[index - 1]!.value, 'secondary', { marginRight: 'auto' })]
                : []),
              ...(index < STEPS.length - 1
                ? [switchStep('Continue', STEPS[index + 1]!.value, 'primary', { marginLeft: 'auto' })]
                : [
                    {
                      type: 'button' as const,
                      name: 'Finish',
                      props: { label: 'Finish setup', href: '' },
                      styles: { marginLeft: 'auto', fontSize: '14px', ...pad('10px', '18px') },
                      states: { hover: { backgroundColor: 'var(--c-secondary)' } },
                    },
                  ]),
            ],
            { gap: '10px', width: '100%', alignItems: 'center' }
          ),
        ],
        { gap: '18px', width: '100%' }
      )
    );

  return section(
    'Stepper',
    [
      container(
        [
          switchGroup(
            'step',
            'account',
            [
              stack('Steps', STEPS.map(marker), {
                gap: '6px',
                flexWrap: 'wrap',
                marginBottom: '26px',
                width: '100%',
              }),
              {
                type: 'form',
                name: 'Setup form',
                styles: { display: 'flex', flexDirection: 'column', width: '100%' },
                children: STEPS.map(panel),
              },
            ],
            { gap: '0px' }
          ),
        ],
        { gap: '20px', alignItems: 'flex-start', maxWidth: '620px' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}
