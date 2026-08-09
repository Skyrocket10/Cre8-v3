/** Editorial — indexes, articles and the furniture around them. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  CARD_TITLE,
  LEAD,
  LEAD_RESPONSIVE,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  TITLE,
  TITLE_RESPONSIVE,
  avatar,
  border,
  borderSide,
  card,
  chip,
  cols,
  column,
  container,
  divider,
  grid,
  heading,
  label,
  liftCard,
  media,
  pad,
  paragraph,
  radius,
  section,
  splitGrid,
  stack,
  tabs,
  textLink,
} from './kit';

const TOPICS = ['All', 'Engineering', 'Design', 'Product', 'Security', 'Company'];

const POSTS = [
  {
    topic: 'Engineering',
    title: 'How we cut cold starts to under 10ms',
    blurb: 'Three years of incremental work, and the one change that mattered more than the rest of them combined.',
    author: 'Priya Raman',
    date: '4 Aug 2026',
    read: '9 min',
  },
  {
    topic: 'Design',
    title: 'Designing for the moment after the mistake',
    blurb: 'Undo is a feature. So is the sentence that tells someone what just happened and why.',
    author: 'Tobias Lind',
    date: '28 Jul 2026',
    read: '6 min',
  },
  {
    topic: 'Security',
    title: 'What our SOC 2 audit actually changed',
    blurb: 'Most of it was paperwork. Two findings were real, and both are worth writing down.',
    author: 'Mei Chen',
    date: '19 Jul 2026',
    read: '11 min',
  },
  {
    topic: 'Product',
    title: 'Why previews replaced our staging environment',
    blurb: 'One shared staging box was a queue. Twenty ephemeral ones are not.',
    author: 'Marcus Hall',
    date: '11 Jul 2026',
    read: '7 min',
  },
  {
    topic: 'Engineering',
    title: 'Reading the p99 you actually have',
    blurb: 'Averages hide the request that lost you the customer. Here is what we measure instead.',
    author: 'Sofia Duarte',
    date: '2 Jul 2026',
    read: '8 min',
  },
  {
    topic: 'Company',
    title: 'Writing things down, three years in',
    blurb: 'Every decision has a document. Some of them are two sentences, and that is fine.',
    author: 'Ana Ferreira',
    date: '24 Jun 2026',
    read: '5 min',
  },
];

/** Author, date and reading time — the line under every headline. */
const byline = (author: string, date: string, read: string): NodeSpec =>
  stack(
    'Byline',
    [
      avatar('24px'),
      label(author, { ...CAPTION, fontWeight: '560', color: 'var(--c-text)' }),
      label('·', { ...CAPTION, color: 'var(--c-muted)' }),
      label(date, { ...CAPTION, color: 'var(--c-muted)' }),
      label('·', { ...CAPTION, color: 'var(--c-muted)' }),
      label(read, { ...CAPTION, color: 'var(--c-muted)' }),
    ],
    { gap: '7px', alignItems: 'center', flexWrap: 'wrap' }
  );

/* --------------------------------------------------------------------------
 * Blog index header
 * ----------------------------------------------------------------------- */

export function blogHeaderSpec(): NodeSpec {
  return section(
    'Blog header',
    [
      container(
        [
          column(
            'Intro',
            [
              label('Writing', {
                fontSize: '12px',
                fontWeight: '600',
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: 'var(--c-primary)',
              }),
              heading('The Northwind blog', 1, { ...TITLE, textWrap: 'balance' }, TITLE_RESPONSIVE),
              paragraph(
                'Engineering notes, design decisions and the occasional post-mortem. No launch announcements dressed up as thought leadership.',
                { ...LEAD, maxWidth: '52ch' },
                LEAD_RESPONSIVE
              ),
            ],
            { gap: '12px' }
          ),
          stack(
            'Topics',
            TOPICS.map((topic) => chip(topic, '#')),
            { gap: '8px', flexWrap: 'wrap', width: '100%' }
          ),
        ],
        { gap: '28px', alignItems: 'flex-start' }
      ),
    ],
    { paddingTop: '80px', paddingBottom: '48px' }
  );
}

/* --------------------------------------------------------------------------
 * Featured post
 * ----------------------------------------------------------------------- */

export function featuredPostSpec(): NodeSpec {
  const post = POSTS[0]!;
  return section(
    'Featured post',
    [
      container(
        [
          splitGrid(
            'Featured',
            [
              media(`Cover image for “${post.title}”`, '3 / 2', { ...radius('var(--r-lg)') }),
              column(
                'Copy',
                [
                  stack('Meta', [chip(post.topic, '#'), label('Featured', { ...CAPTION, color: 'var(--c-primary)', fontWeight: '600' })], {
                    gap: '10px',
                    alignItems: 'center',
                  }),
                  heading(
                    post.title,
                    2,
                    { ...TITLE, fontSize: '34px', maxWidth: '20ch', textWrap: 'balance' },
                    { mobile: { fontSize: '26px' } }
                  ),
                  paragraph(post.blurb, { ...BODY, maxWidth: '46ch' }, BODY_RESPONSIVE),
                  byline(post.author, post.date, post.read),
                  textLink('Read the post →', '#', {
                    fontSize: '14px',
                    fontWeight: '560',
                    color: 'var(--c-primary)',
                  }),
                ],
                { gap: '16px' }
              ),
            ],
            { gap: '48px' },
            [1.1, 0.9]
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '56px' }
  );
}

/* --------------------------------------------------------------------------
 * Post grid
 * ----------------------------------------------------------------------- */

export function postGridSpec(): NodeSpec {
  return section('Post grid', [
    container(
      [
        grid(
          'Posts',
          3,
          POSTS.map((post) =>
            liftCard(
              post.title.slice(0, 28),
              [
                media(`Cover image for “${post.title}”`, '16 / 10', {
                  ...radius('var(--r-md)'),
                  marginBottom: '4px',
                }),
                label(post.topic, {
                  ...CAPTION,
                  fontWeight: '620',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--c-primary)',
                }),
                heading(post.title, 3, CARD_TITLE),
                paragraph(post.blurb, SMALL),
                byline(post.author, post.date, post.read),
              ],
              { ...pad('18px'), gap: '10px', justifyContent: 'flex-start' }
            )
          ),
          { gap: '24px' }
        ),
      ],
      { gap: '0px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Article with a table of contents
 * ----------------------------------------------------------------------- */

const SECTIONS = [
  {
    title: 'The shape of the problem',
    body: 'A cold start is not one delay, it is four of them in a row, and until we separated them we kept optimising the smallest. Isolate creation, module evaluation, connection setup and the first query each behaved differently under load.',
  },
  {
    title: 'What we tried first',
    body: 'Pre-warming worked in benchmarks and failed in production, because traffic that arrives in bursts does not respect a warming schedule. Keeping instances alive cost more than it saved and moved the tail rather than shortening it.',
  },
  {
    title: 'The change that mattered',
    body: 'Snapshotting the isolate after module evaluation removed the second delay entirely, and the third one turned out to depend on it. Two of the four disappeared from one change, which is not how any of us expected this to go.',
  },
  {
    title: 'What is still slow',
    body: 'The first query against a cold connection pool. We know why, we know roughly what it costs, and it is the next thing on this list rather than a mystery.',
  },
];

export function articleSpec(): NodeSpec {
  return section(
    'Article',
    [
      container(
        [
          grid(
            'Article row',
            'minmax(0, 1fr) 220px',
            [
              column(
                'Body',
                [
                  stack('Meta', [chip('Engineering', '#')], { gap: '8px' }),
                  heading(
                    'How we cut cold starts to under 10ms',
                    1,
                    { ...TITLE, maxWidth: '20ch', textWrap: 'balance' },
                    TITLE_RESPONSIVE
                  ),
                  byline('Priya Raman', '4 August 2026', '9 min read'),
                  divider(),
                  paragraph(
                    'Three years of incremental work, and one change that mattered more than the rest of them combined. This is what we measured, what we got wrong, and what is still slow.',
                    { ...LEAD, maxWidth: '68ch' },
                    LEAD_RESPONSIVE
                  ),
                  ...SECTIONS.flatMap((item) => [
                    heading(item.title, 2, { ...SUBTITLE, marginTop: '16px' }, SUBTITLE_RESPONSIVE),
                    paragraph(item.body, { ...BODY, lineHeight: '1.7', maxWidth: '68ch' }, BODY_RESPONSIVE),
                  ]),
                ],
                { gap: '12px', width: '100%' }
              ),
              column(
                'Contents',
                [
                  label('On this page', {
                    ...CAPTION,
                    fontWeight: '620',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text)',
                  }),
                  ...SECTIONS.map((item, i) =>
                    textLink(item.title, '#', {
                      fontSize: '13px',
                      lineHeight: '1.45',
                      ...(i === 0 ? { color: 'var(--c-primary)', fontWeight: '560' } : {}),
                    })
                  ),
                ],
                {
                  gap: '9px',
                  position: 'sticky',
                  top: '88px',
                  alignSelf: 'start',
                  width: '100%',
                  ...pad('0px', '0px', '0px', '20px'),
                  ...borderSide('Left'),
                },
                // Sticky in a stacked layout parks the contents over the
                // article; narrow, it goes back to being an ordinary block.
                { tablet: { position: 'static', top: 'auto', paddingLeft: '0px', borderLeftWidth: '0px' } }
              ),
            ],
            { gap: '56px', alignItems: 'start' },
            { tablet: { gridTemplateColumns: cols(1), gap: '32px' } }
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Author card
 * ----------------------------------------------------------------------- */

export function authorCardSpec(): NodeSpec {
  return section(
    'Author card',
    [
      container(
        [
          card(
            'Author',
            [
              media('Portrait of the author', '1 / 1', {
                width: '96px',
                height: '96px',
                // The empty-slot floor is taller than this, and it wins over
                // `height`, so without clearing it the round portrait renders
                // as a 96x120 ellipse until a real photo is set.
                minHeight: '0px',
                flexShrink: '0',
                ...radius('var(--r-full)'),
              }),
              column(
                'Bio',
                [
                  label('Written by', { ...CAPTION, color: 'var(--c-muted)' }),
                  heading('Priya Raman', 2, { fontSize: '20px', fontWeight: '620', lineHeight: '1.3' }),
                  paragraph(
                    'CTO at Northwind. Previously spent eight years making other people’s databases faster, and is still not entirely over it.',
                    { ...SMALL, lineHeight: '1.6', maxWidth: '52ch' }
                  ),
                  stack(
                    'Links',
                    [
                      textLink('All posts →', '#', { fontSize: '13.5px', color: 'var(--c-primary)' }),
                      textLink('Contact', '#', { fontSize: '13.5px' }),
                    ],
                    { gap: '16px' }
                  ),
                ],
                { gap: '6px' }
              ),
            ],
            { ...pad('26px'), gap: '22px', flexDirection: 'row', alignItems: 'flex-start' },
            { mobile: { flexDirection: 'column', gap: '16px' } }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '48px', paddingBottom: '48px' }
  );
}

/* --------------------------------------------------------------------------
 * Related posts
 * ----------------------------------------------------------------------- */

export function relatedPostsSpec(): NodeSpec {
  return section(
    'Related posts',
    [
      container(
        [
          stack(
            'Heading row',
            [
              heading('Keep reading', 2, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
              textLink('All posts →', '#', { fontSize: '14px', color: 'var(--c-primary)' }),
            ],
            {
              gap: '16px',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              width: '100%',
              flexWrap: 'wrap',
            }
          ),
          grid(
            'Related',
            3,
            POSTS.slice(1, 4).map((post) =>
              column(
                post.title.slice(0, 28),
                [
                  media(`Cover image for “${post.title}”`, '16 / 10', { ...radius('var(--r-md)') }),
                  label(post.topic, {
                    ...CAPTION,
                    fontWeight: '620',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--c-primary)',
                  }),
                  heading(post.title, 3, { fontSize: '16px', fontWeight: '600', lineHeight: '1.35' }),
                  label(`${post.date} · ${post.read}`, { ...CAPTION, color: 'var(--c-muted)' }),
                ],
                { gap: '8px', width: '100%' }
              )
            ),
            { gap: '24px' }
          ),
        ],
        { gap: '28px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)', paddingTop: '64px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Pagination
 * ----------------------------------------------------------------------- */

export function paginationSpec(): NodeSpec {
  const page = (n: string, current = false): NodeSpec =>
    textLink(n, '#', {
      fontSize: '13.5px',
      fontWeight: current ? '600' : '450',
      color: current ? 'var(--c-on-primary)' : 'var(--c-muted)',
      backgroundColor: current ? 'var(--c-primary)' : 'transparent',
      ...pad('7px', '12px'),
      ...radius('var(--r-md)'),
      ...border('1px', current ? 'var(--c-primary)' : 'var(--c-border)'),
    });

  return section(
    'Pagination',
    [
      container(
        [
          stack(
            'Pages',
            [
              textLink('← Previous', '#', {
                fontSize: '13.5px',
                ...pad('7px', '12px'),
                ...radius('var(--r-md)'),
                ...border('1px', 'var(--c-border)'),
              }),
              stack(
                'Numbers',
                [
                  page('1', true),
                  page('2'),
                  page('3'),
                  // Not a link: an ellipsis is a gap in the sequence, not a
                  // page anyone can go to.
                  label('…', { fontSize: '13.5px', color: 'var(--c-muted)', ...pad('7px', '4px') }),
                  page('9'),
                ],
                { gap: '6px', alignItems: 'center' }
              ),
              textLink('Next →', '#', {
                fontSize: '13.5px',
                ...pad('7px', '12px'),
                ...radius('var(--r-md)'),
                ...border('1px', 'var(--c-border)'),
              }),
            ],
            {
              gap: '12px',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              flexWrap: 'wrap',
            }
          ),
        ],
        { gap: '0px', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '40px', paddingBottom: '64px' }
  );
}

/* --------------------------------------------------------------------------
 * Install command, per package manager
 * ----------------------------------------------------------------------- */

const INSTALLERS: { value: string; label: string; command: string }[] = [
  { value: 'npm', label: 'npm', command: 'npm install @northwind/cli' },
  { value: 'pnpm', label: 'pnpm', command: 'pnpm add @northwind/cli' },
  { value: 'yarn', label: 'yarn', command: 'yarn add @northwind/cli' },
  { value: 'bun', label: 'bun', command: 'bun add @northwind/cli' },
];

/**
 * The four-line block every developer tool needs and every one rebuilds.
 *
 * A real tab set, so the row is one tab stop and the arrow keys move through
 * it — which matters more here than usual, because this is a component
 * keyboard users hit constantly. All four commands are in the markup, so the
 * page still answers "how do I install this with pnpm" to a search engine
 * that never ran the script.
 */
export function installTabsSpec(): NodeSpec {
  const command = (item: (typeof INSTALLERS)[number]): NodeSpec =>
    stack(
      `${item.label} command`,
      [
        label('$', { fontFamily: 'var(--f-mono)', fontSize: '14px', color: 'var(--c-muted)' }),
        label(item.command, {
          fontFamily: 'var(--f-mono)',
          fontSize: '14px',
          color: 'var(--c-text)',
          whiteSpace: 'nowrap',
        }),
      ],
      {
        gap: '10px',
        width: '100%',
        alignItems: 'center',
        ...pad('16px', '18px'),
        ...radius('var(--r-md)'),
        backgroundColor: 'var(--c-surface)',
        ...border('1px', 'var(--c-border)'),
        // Long package names beat short phones; the box scrolls rather than
        // the page.
        overflowX: 'auto',
      }
    );

  return section(
    'Install',
    [
      container(
        [
          column(
            'Install intro',
            [
              heading('Get started in one line', 2, { ...SUBTITLE, fontSize: '26px' }, SUBTITLE_RESPONSIVE),
              paragraph('Node 20 or newer. Everything else the CLI brings with it.', SMALL),
            ],
            { gap: '6px' }
          ),
          tabs(
            'installer',
            INSTALLERS.map((item) => ({
              value: item.value,
              label: item.label,
              panel: command(item),
            })),
            { styles: { gap: '14px' } }
          ),
        ],
        { gap: '22px', alignItems: 'flex-start', maxWidth: '720px' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '64px' }
  );
}
