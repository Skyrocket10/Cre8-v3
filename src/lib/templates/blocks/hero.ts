/** Hero sections. */

import type { NodeSpec } from '../../document/factory';
import type { NodeSpec as Spec } from '../../document/factory';
import {
  DISPLAY,
  DISPLAY_RESPONSIVE,
  EYEBROW,
  LEAD,
  LEAD_RESPONSIVE,
  border,
  button,
  column,
  container,
  frame,
  grid,
  heading,
  icon,
  label,
  pad,
  paragraph,
  radius,
  section,
  splitGrid,
  stack,
  tint,
} from './kit';

export function heroSectionSpec(): NodeSpec {
  return section(
    'Hero',
    [
      container(
        [
          stack(
            'Hero copy',
            [
              stack(
                'Announcement',
                [
                  label('New', {
                    fontSize: '11px',
                    fontWeight: '650',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--c-primary)',
                    backgroundColor: tint('var(--c-primary)', 12),
                    ...pad('3px', '8px'),
                    ...radius('var(--r-full)'),
                  }),
                  label('Realtime collaboration is live', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                  icon('arrow-right', { width: '14px', height: '14px', color: 'var(--c-muted)' }),
                ],
                {
                  gap: '8px',
                  ...pad('5px', '14px', '5px', '5px'),
                  ...radius('var(--r-full)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundColor: 'var(--c-surface)',
                }
              ),

              heading(
                'Ship your product, not your infrastructure.',
                1,
                { ...DISPLAY, maxWidth: '21ch', textWrap: 'balance' },
                DISPLAY_RESPONSIVE
              ),

              paragraph(
                'Northwind gives product teams a single place to plan, build and launch — with the deploy pipeline, analytics and on-call rotation already wired up.',
                { ...LEAD, maxWidth: '52ch' },
                LEAD_RESPONSIVE
              ),

              stack(
                'Hero actions',
                [button('Start building free'), button('Book a demo', 'secondary')],
                { gap: '12px', marginTop: '8px' },
                { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
              ),

              stack(
                'Hero note',
                [
                  icon('circle-check', {
                    width: '15px',
                    height: '15px',
                    color: 'var(--c-primary)',
                  }),
                  label('Free for 14 days · No credit card required', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                ],
                { gap: '8px', marginTop: '4px' }
              ),
            ],
            { flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center' }
          ),

          productShotSpec(),
        ],
        { gap: '64px', alignItems: 'center', maxWidth: 'var(--w-wide)' },
        { mobile: { gap: '40px' } }
      ),
    ],
    {
      paddingTop: '96px',
      paddingBottom: '112px',
      backgroundImage: `radial-gradient(120% 90% at 50% -10%, ${tint('var(--c-primary)', 13)} 0%, transparent 62%)`,
    },
    { mobile: { paddingTop: '52px' } }
  );
}

/**
 * A browser chrome built from primitives — no placeholder image required.
 *
 * Exported because several hero variants want the same shot, and a second
 * hand-built copy would drift from this one on the first change.
 */
export function productShotSpec(): NodeSpec {
  const dot = (color: string): Spec => ({
    type: 'frame',
    name: 'Dot',
    styles: {
      width: '9px',
      height: '9px',
      ...radius('var(--r-full)'),
      backgroundColor: color,
      ...pad('0px'),
      flexShrink: '0',
    },
  });

  const bar = (width: string, opacity = '1'): Spec => ({
    type: 'frame',
    name: 'Bar',
    styles: {
      width,
      height: '9px',
      ...radius('var(--r-full)'),
      backgroundColor: 'var(--c-border)',
      opacity,
      ...pad('0px'),
      flexShrink: '0',
    },
  });

  const sidebarRow = (width: string, active = false): Spec => ({
    type: 'stack',
    name: 'Nav item',
    styles: {
      gap: '8px',
      alignItems: 'center',
      width: '100%',
      ...pad('7px', '9px'),
      ...radius('var(--r-sm)'),
      backgroundColor: active ? tint('var(--c-primary)', 12) : 'transparent',
    },
    children: [
      {
        type: 'frame',
        name: 'Glyph',
        styles: {
          width: '11px',
          height: '11px',
          ...radius('3px'),
          backgroundColor: active ? 'var(--c-primary)' : 'var(--c-border)',
          ...pad('0px'),
          flexShrink: '0',
        },
      },
      bar(width, active ? '1' : '0.75'),
    ],
  });

  const metric = (title: string, value: string, tone: string): Spec => ({
    type: 'frame',
    name: `${title} card`,
    styles: {
      ...pad('16px'),
      ...radius('var(--r-md)'),
      ...border('1px', 'var(--c-border)'),
      backgroundColor: 'var(--c-background)',
      gap: '7px',
      width: '100%',
    },
    children: [
      label(title, { fontSize: '11.5px', color: 'var(--c-muted)' }),
      label(value, {
        fontSize: '23px',
        fontWeight: '620',
        letterSpacing: '-0.02em',
        color: 'var(--c-text)',
      }),
      {
        type: 'frame',
        name: 'Trend',
        styles: {
          width: '100%',
          height: '4px',
          ...radius('var(--r-full)'),
          backgroundColor: tone,
          ...pad('0px'),
        },
      },
    ],
  });

  return {
    type: 'frame',
    name: 'Product screenshot',
    styles: {
      width: '100%',
      maxWidth: '1000px',
      ...pad('0px'),
      ...radius('var(--r-lg)'),
      ...border('1px', 'var(--c-border)'),
      backgroundColor: 'var(--c-background)',
      boxShadow: 'var(--sh-xl)',
      overflow: 'hidden',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    children: [
      stack(
        'Browser bar',
        [
          stack('Traffic lights', [dot('#ff5f57'), dot('#febc2e'), dot('#28c840')], { gap: '6px' }),
          {
            type: 'frame',
            name: 'Address',
            styles: {
              flexGrow: '1',
              height: '22px',
              ...radius('var(--r-full)'),
              backgroundColor: 'var(--c-surface-2)',
              ...pad('0px'),
              maxWidth: '260px',
              marginLeft: 'auto',
              marginRight: 'auto',
            },
          },
        ],
        {
          gap: '12px',
          alignItems: 'center',
          width: '100%',
          ...pad('12px', '14px'),
          backgroundColor: 'var(--c-surface)',
          borderStyle: 'solid',
          borderBottomWidth: '1px',
          borderColor: 'var(--c-border)',
        }
      ),
      stack(
        'App body',
        [
          {
            type: 'frame',
            name: 'Sidebar',
            styles: {
              width: '190px',
              flexShrink: '0',
              gap: '5px',
              ...pad('16px', '12px'),
              backgroundColor: 'var(--c-surface)',
              alignSelf: 'stretch',
            },
            responsive: { mobile: { display: 'none' } },
            children: [
              sidebarRow('58px', true),
              sidebarRow('72px'),
              sidebarRow('46px'),
              sidebarRow('64px'),
              sidebarRow('52px'),
            ],
          },
          {
            type: 'frame',
            name: 'Main',
            styles: { flexGrow: '1', gap: '16px', ...pad('22px'), minWidth: '0px' },
            children: [
              stack('Toolbar', [bar('120px'), bar('64px', '0.6')], {
                gap: '10px',
                alignItems: 'center',
              }),
              grid(
                'Metrics',
                3,
                [
                  metric('Deploys', '1,284', 'var(--c-primary)'),
                  metric('P95 latency', '84ms', 'var(--c-accent)'),
                  metric('Uptime', '99.99%', '#22c55e'),
                ],
                { gap: '12px' },
                { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } }
              ),
              {
                type: 'frame',
                name: 'Chart',
                styles: {
                  width: '100%',
                  height: '150px',
                  ...radius('var(--r-md)'),
                  ...border('1px', 'var(--c-border)'),
                  backgroundImage: `linear-gradient(180deg, ${tint('var(--c-primary)', 16)} 0%, transparent 100%)`,
                  ...pad('0px'),
                },
                responsive: { mobile: { height: '96px' } },
              },
            ],
          },
        ],
        { gap: '0px', alignItems: 'stretch', width: '100%' }
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Split hero
 * ----------------------------------------------------------------------- */

export function splitHeroSpec(): NodeSpec {
  return section(
    'Split hero',
    [
      container(
        [
          splitGrid(
            'Hero row',
            [
              column(
                'Hero copy',
                [
              stack(
                'Eyebrow',
                [
                  label('v4.0', {
                    fontSize: '11px',
                    fontWeight: '650',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--c-primary)',
                    backgroundColor: tint('var(--c-primary)', 12),
                    ...pad('3px', '8px'),
                    ...radius('var(--r-full)'),
                  }),
                  label('Now with managed Postgres', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                ],
                { gap: '8px', alignItems: 'center' }
              ),
              heading(
                'The platform your roadmap already assumed you had.',
                1,
                { ...DISPLAY, fontSize: '56px', maxWidth: '16ch', textWrap: 'balance' },
                { tablet: { fontSize: '44px' }, mobile: { fontSize: '33px' } }
              ),
              paragraph(
                'Deploys, previews, analytics and on-call in one place — so the work between writing code and shipping it stops being a project of its own.',
                { ...LEAD, maxWidth: '48ch' },
                LEAD_RESPONSIVE
              ),
              stack(
                'Hero actions',
                [button('Start building free'), button('Book a demo', 'secondary')],
                { gap: '12px', marginTop: '4px' },
                { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
              ),
              stack(
                'Reassurance',
                [
                  icon('circle-check', { width: '15px', height: '15px', color: 'var(--c-primary)' }),
                  label('Free for 14 days · No credit card', {
                    fontSize: '13.5px',
                    color: 'var(--c-muted)',
                  }),
                ],
                { gap: '8px' }
              ),
                ],
                { gap: '22px' }
              ),
              productShotSpec(),
            ],
            { gap: '56px' },
            [1.05, 0.95]
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '88px', paddingBottom: '96px' }
  );
}

/* --------------------------------------------------------------------------
 * Media-background hero
 * ----------------------------------------------------------------------- */

export function mediaHeroSpec(): NodeSpec {
  return section(
    'Media hero',
    [
      // Layer order matters: photo, then a scrim, then the copy. The scrim is
      // not decoration — without it the headline's contrast depends on
      // whatever image the designer drops in, which is not a promise the
      // block can keep.
      {
        type: 'image',
        name: 'Background photo',
        props: { alt: 'Replace with a wide photograph of your product or team' },
        styles: {
          position: 'absolute',
          inset: '0px',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        },
      },
      frame('Scrim', [], {
        position: 'absolute',
        inset: '0px',
        ...pad('0px'),
        // A scrim is a translucent wash of the theme's dark surface, which is
        // exactly what `tint` produces. Hard-coding a near-black would stop the
        // block themeing, and text contrast over an arbitrary photograph is the
        // one thing this layer exists to guarantee.
        backgroundImage: `linear-gradient(180deg, ${tint('var(--c-inverse)', 55)} 0%, ${tint('var(--c-inverse)', 80)} 100%)`,
      }),
      container(
        [
          heading(
            'Built for the teams behind the thing people actually use.',
            1,
            { ...DISPLAY, color: 'var(--c-on-inverse)', maxWidth: '18ch', textWrap: 'balance' },
            DISPLAY_RESPONSIVE
          ),
          paragraph(
            'One platform for the parts of shipping that nobody puts on a roadmap.',
            { ...LEAD, color: tint('var(--c-on-inverse)', 78), maxWidth: '46ch' },
            LEAD_RESPONSIVE
          ),
          stack(
            'Hero actions',
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
                props: { label: 'Watch the tour', href: '#' },
                styles: {
                  backgroundColor: 'transparent',
                  color: 'var(--c-on-inverse)',
                  ...border('1px', tint('var(--c-on-inverse)', 34)),
                },
                states: { hover: { backgroundColor: tint('var(--c-on-inverse)', 12) } },
              },
            ],
            { gap: '12px', marginTop: '8px' },
            { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
          ),
        ],
        {
          position: 'relative',
          zIndex: '1',
          gap: '20px',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: 'var(--w-content)',
        }
      ),
    ],
    {
      position: 'relative',
      overflow: 'hidden',
      paddingTop: '136px',
      paddingBottom: '136px',
      backgroundColor: 'var(--c-inverse)',
    },
    { mobile: { paddingTop: '88px', paddingBottom: '88px' } }
  );
}

/* --------------------------------------------------------------------------
 * Device hero
 * ----------------------------------------------------------------------- */

/** A phone, built from primitives, so the mock themes with the project. */
function phoneFrameSpec(): NodeSpec {
  const row = (width: string, strong = false): NodeSpec =>
    frame('Line', [], {
      width,
      height: '8px',
      ...radius('var(--r-full)'),
      backgroundColor: strong ? tint('var(--c-primary)', 55) : 'var(--c-border)',
      ...pad('0px'),
    });

  return frame(
    'Phone',
    [
      frame('Notch', [], {
        width: '86px',
        height: '18px',
        ...radius('var(--r-full)'),
        backgroundColor: 'var(--c-inverse)',
        marginLeft: 'auto',
        marginRight: 'auto',
        ...pad('0px'),
        flexShrink: '0',
      }),
      column(
        'Screen',
        [row('58%', true), row('86%'), row('72%'), row('90%'), row('44%')],
        { gap: '12px', width: '100%', paddingTop: '22px' }
      ),
    ],
    {
      width: '272px',
      height: '520px',
      ...pad('12px', '16px'),
      gap: '0px',
      ...radius('34px'),
      ...border('8px', 'var(--c-inverse)'),
      backgroundColor: 'var(--c-background)',
      boxShadow: 'var(--sh-xl)',
      flexShrink: '0',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    { mobile: { width: '232px', height: '440px' } }
  );
}

export function deviceHeroSpec(): NodeSpec {
  return section(
    'Device hero',
    [
      container(
        [
          splitGrid(
            'Hero row',
            [
              column(
                'Hero copy',
                [
              label('Mobile', EYEBROW),
              heading(
                'Your dashboard, in a pocket.',
                1,
                { ...DISPLAY, fontSize: '54px', maxWidth: '14ch', textWrap: 'balance' },
                { tablet: { fontSize: '42px' }, mobile: { fontSize: '32px' } }
              ),
              paragraph(
                'Approve a deploy from the queue at the station. Acknowledge an alert without opening a laptop.',
                { ...LEAD, maxWidth: '42ch' },
                LEAD_RESPONSIVE
              ),
              stack(
                'Store links',
                [button('App Store'), button('Google Play', 'secondary')],
                { gap: '12px', marginTop: '4px' },
                { mobile: { flexDirection: 'column', alignItems: 'stretch', width: '100%' } }
              ),
                ],
                { gap: '20px' }
              ),
              phoneFrameSpec(),
            ],
            { gap: '64px' },
            [1.1, 0.9]
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)', paddingTop: '88px', paddingBottom: '88px' }
  );
}

/* --------------------------------------------------------------------------
 * Video hero
 * ----------------------------------------------------------------------- */

export function videoHeroSpec(): NodeSpec {
  return section(
    'Video hero',
    [
      container(
        [
          column(
            'Hero copy',
            [
              heading(
                'See it deploy in ninety seconds.',
                1,
                { ...DISPLAY, fontSize: '54px', maxWidth: '16ch', textWrap: 'balance' },
                { tablet: { fontSize: '42px' }, mobile: { fontSize: '32px' } }
              ),
              paragraph(
                'No slides, no staged demo — a real repository going from commit to production.',
                { ...LEAD, maxWidth: '48ch' },
                LEAD_RESPONSIVE
              ),
            ],
            { gap: '18px', alignItems: 'center', textAlign: 'center', width: '100%' }
          ),
          frame(
            'Video frame',
            [
              {
                type: 'video',
                name: 'Product video',
                props: { controls: true, poster: '' },
                styles: { width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', ...pad('0px') },
              },
            ],
            {
              width: '100%',
              maxWidth: '940px',
              ...pad('0px'),
              ...radius('var(--r-lg)'),
              ...border('1px', 'var(--c-border)'),
              overflow: 'hidden',
              boxShadow: 'var(--sh-xl)',
              marginLeft: 'auto',
              marginRight: 'auto',
            }
          ),
        ],
        { gap: '44px', alignItems: 'center', maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '88px', paddingBottom: '96px' }
  );
}
