/** Hero sections. */

import type { NodeSpec } from '../../document/factory';
import type { NodeSpec as Spec } from '../../document/factory';
import {
  DISPLAY,
  DISPLAY_RESPONSIVE,
  LEAD,
  LEAD_RESPONSIVE,
  border,
  button,
  container,
  grid,
  heading,
  icon,
  label,
  pad,
  paragraph,
  radius,
  section,
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
