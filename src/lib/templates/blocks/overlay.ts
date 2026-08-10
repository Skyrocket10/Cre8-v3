/**
 * Overlays — the things that open on top of the page.
 *
 * Every one of these is a control a library would ship as a component with a
 * hundred lines of JavaScript behind it: a drawer, a tooltip, a lightbox, a
 * mega menu, an account menu. Here they are `[popover]` and `<dialog>`, so the
 * published page ships nothing at all for them.
 *
 * That is not thrift for its own sake. Stacking above the rest of the page,
 * closing on Escape, closing on a click outside, returning focus to the button
 * afterwards — a hand-rolled version reimplements all of it and gets some of
 * it wrong, and none of it would survive a page opened from a ZIP with
 * scripting off. The browser's version behaves the same on the canvas, in
 * preview and in the file, which is the fidelity claim this project is built
 * on, obtained for free.
 *
 * The one thing this cannot do is make the page behind a modal unreachable by
 * keyboard — only `showModal()` does that, and it needs a script. Where that
 * matters the comment says so rather than the block pretending otherwise.
 */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  CARD_TITLE,
  EYEBROW,
  SMALL,
  SUBTITLE,
  SUBTITLE_RESPONSIVE,
  avatar,
  border,
  borderSide,
  button,
  column,
  container,
  divider,
  frame,
  grid,
  heading,
  media,
  pad,
  paragraph,
  popover,
  popoverButton,
  radius,
  section,
  stack,
  textLink,
} from './kit';

/** The surface every overlay in this file sits on. */
const PANEL = {
  backgroundColor: 'var(--c-surface)',
  ...border('1px', 'var(--c-border)'),
  ...radius('var(--r-lg)'),
  boxShadow: 'var(--s-lg)',
};

/* --------------------------------------------------------------------------
 * Drawer
 * ----------------------------------------------------------------------- */

/**
 * A panel that comes in from the side.
 *
 * A `<dialog>` rather than a `[popover]` on a div, because it is announced as
 * a dialog and read out by its label. Pinned to the right edge with `inset`
 * rather than positioned, so it stays put while the page behind it scrolls.
 */
export function drawerSpec(): NodeSpec {
  return section(
    'Drawer',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('Filters, settings, a basket — anything that can wait', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              paragraph(
                'Opens over the page and closes on Escape or a click outside. No script on the published page.',
                { ...BODY, color: 'var(--c-muted)', maxWidth: '58ch' },
                BODY_RESPONSIVE
              ),
              {
                ...popoverButton('Open the drawer', 'Drawer panel', { variant: 'primary' }),
                name: 'Open drawer',
              },
            ],
            { gap: '18px' }
          ),

          {
            ...popover(
              'Drawer panel',
              [
                stack(
                  'Drawer header',
                  [
                    heading('Refine', 3, { ...CARD_TITLE, color: 'var(--c-text)' }),
                    {
                      ...popoverButton('Close', 'Drawer panel', {
                        action: 'hide',
                        variant: 'ghost',
                      }),
                      name: 'Close drawer',
                      styles: { marginLeft: 'auto', ...SMALL, ...pad('6px', '10px') },
                    },
                  ],
                  { width: '100%', alignItems: 'center', gap: '12px' }
                ),
                divider(),
                column(
                  'Drawer body',
                  [
                    paragraph('Availability', { ...SMALL, color: 'var(--c-muted)' }),
                    paragraph('In stock only', { ...BODY, color: 'var(--c-text)' }),
                    paragraph('Delivery', { ...SMALL, color: 'var(--c-muted)' }),
                    paragraph('Next day', { ...BODY, color: 'var(--c-text)' }),
                  ],
                  { gap: '10px', width: '100%' }
                ),
                { ...button('Apply', 'primary'), name: 'Apply', styles: { width: '100%' } },
              ],
              {
                styles: {
                  ...PANEL,
                  ...pad('22px'),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px',
                  width: '340px',
                  maxWidth: '100%',
                  top: '0px',
                  bottom: '0px',
                  right: '0px',
                  left: 'auto',
                  borderTopRightRadius: '0px',
                  borderBottomRightRadius: '0px',
                },
              }
            ),
            responsive: { mobile: { width: '100%' } },
          },
        ],
        { flexDirection: 'column', alignItems: 'flex-start' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/* --------------------------------------------------------------------------
 * Tooltip
 * ----------------------------------------------------------------------- */

/**
 * A small explanation, on demand.
 *
 * Deliberately a click rather than a hover: a hover-only tooltip is
 * unreachable by keyboard and unreachable on a phone, and `[popover]` gives
 * both for nothing. The trigger stays a button so it is in the tab order.
 */
export function tooltipSpec(): NodeSpec {
  return section(
    'Tooltip',
    [
      container(
        [
          column(
            'Row',
            [
              heading('A word that needs a footnote', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              stack(
                'Definition',
                [
                  paragraph('Monthly recurring revenue', { ...BODY, color: 'var(--c-text)' }, BODY_RESPONSIVE),
                  {
                    ...popoverButton('?', 'Tooltip bubble', { variant: 'ghost' }),
                    name: 'What is MRR',
                    styles: {
                      ...pad('0px'),
                      width: '20px',
                      height: '20px',
                      ...radius('999px'),
                      ...border('1px', 'var(--c-border)'),
                      ...CAPTION,
                      color: 'var(--c-muted)',
                      backgroundColor: 'transparent',
                    },
                  },
                ],
                { alignItems: 'center', gap: '8px' }
              ),
              popover(
                'Tooltip bubble',
                [
                  paragraph(
                    'The part of revenue that arrives again next month without anybody signing anything.',
                    { ...SMALL, color: 'var(--c-text)' }
                  ),
                ],
                {
                  styles: {
                    ...PANEL,
                    ...radius('var(--r-md)'),
                    ...pad('10px', '13px'),
                    maxWidth: '260px',
                  },
                }
              ),
            ],
            { gap: '14px' }
          ),
        ],
        { flexDirection: 'column', alignItems: 'flex-start' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/* --------------------------------------------------------------------------
 * Lightbox
 * ----------------------------------------------------------------------- */

const SHOTS = [
  { alt: 'A studio desk with a laptop and a notebook', label: 'The studio' },
  { alt: 'Two people reviewing printed layouts on a wall', label: 'Review' },
  { alt: 'A close crop of a printed colour swatch book', label: 'Swatches' },
];

/**
 * Thumbnails that open full size.
 *
 * One dialog per image rather than one dialog reused, because reusing it needs
 * a script to swap the source — and three dialogs of markup cost less than the
 * runtime that would avoid them.
 */
export function lightboxSpec(): NodeSpec {
  return section(
    'Lightbox',
    [
      container(
        [
          heading('Gallery', 2, { ...SUBTITLE, color: 'var(--c-text)' }, SUBTITLE_RESPONSIVE),
          grid(
            'Thumbnails',
            3,
            SHOTS.map((shot, index) => ({
              ...popoverButton(shot.label, `Shot ${index + 1}`, { variant: 'ghost' }),
              name: `Open ${shot.label.toLowerCase()}`,
              styles: {
                ...pad('0px'),
                display: 'block',
                width: '100%',
                overflow: 'hidden',
                ...radius('var(--r-md)'),
                ...border('1px', 'var(--c-border)'),
                backgroundColor: 'var(--c-surface)',
                cursor: 'pointer',
              },
              children: [
                media(`${shot.label} thumbnail`, shot.alt, {
                  width: '100%',
                  aspectRatio: '4 / 3',
                  objectFit: 'cover',
                }),
                paragraph(shot.label, {
                  ...SMALL,
                  color: 'var(--c-muted)',
                  ...pad('10px', '12px'),
                  textAlign: 'left',
                }),
              ],
            })),
            { gap: '18px' }
          ),

          ...SHOTS.map((shot, index) =>
            popover(
              `Shot ${index + 1}`,
              [
                media(`${shot.label} full size`, shot.alt, {
                  width: '100%',
                  aspectRatio: '3 / 2',
                  objectFit: 'cover',
                  ...radius('var(--r-md)'),
                }),
                stack(
                  `Shot ${index + 1} footer`,
                  [
                    paragraph(shot.alt, { ...SMALL, color: 'var(--c-muted)' }),
                    {
                      ...popoverButton('Close', `Shot ${index + 1}`, {
                        action: 'hide',
                        variant: 'ghost',
                      }),
                      name: `Close ${shot.label.toLowerCase()}`,
                      styles: { marginLeft: 'auto', ...SMALL, ...pad('6px', '10px') },
                    },
                  ],
                  { width: '100%', alignItems: 'center', gap: '12px' }
                ),
              ],
              {
                styles: {
                  ...PANEL,
                  ...pad('14px'),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  width: '720px',
                  maxWidth: '92vw',
                },
              }
            )
          ),
        ],
        { flexDirection: 'column', alignItems: 'stretch', gap: '28px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/* --------------------------------------------------------------------------
 * Mega menu
 * ----------------------------------------------------------------------- */

const MENU: { heading: string; items: string[] }[] = [
  { heading: 'Product', items: ['Overview', 'Integrations', 'Changelog'] },
  { heading: 'Solutions', items: ['Agencies', 'In-house teams', 'Education'] },
  { heading: 'Resources', items: ['Documentation', 'Guides', 'Community'] },
];

/**
 * A navigation panel wide enough to need columns.
 *
 * The trigger is a button and the panel is a popover, so it opens on click and
 * closes on Escape. Hover-to-open is deliberately not attempted: it cannot be
 * done without a script, it is unusable on a touch screen, and it opens menus
 * at people who were on their way somewhere else.
 */
export function megaMenuSpec(): NodeSpec {
  return frame(
    'Mega menu',
    [
      container(
        [
          stack(
            'Bar',
            [
              heading('Northbound', 3, {
                ...CARD_TITLE,
                color: 'var(--c-text)',
                fontSize: '17px',
              }),
              {
                ...popoverButton('Explore', 'Mega panel', { variant: 'ghost' }),
                name: 'Open menu',
                styles: { ...SMALL, color: 'var(--c-text)', backgroundColor: 'transparent' },
              },
              textLink('Pricing', '#', { ...SMALL, color: 'var(--c-muted)' }),
              {
                ...button('Get started', 'primary'),
                name: 'Get started',
                styles: { marginLeft: 'auto', ...SMALL, ...pad('9px', '16px') },
              },
            ],
            { width: '100%', alignItems: 'center', gap: '22px' },
            { mobile: { flexWrap: 'wrap', gap: '12px' } }
          ),

          popover(
            'Mega panel',
            [
              grid(
                'Menu columns',
                3,
                MENU.map((group) =>
                  column(
                    group.heading,
                    [
                      paragraph(group.heading, {
                        ...EYEBROW,
                        color: 'var(--c-muted)',
                      }),
                      ...group.items.map((item) =>
                        textLink(item, '#', { ...SMALL, color: 'var(--c-text)' })
                      ),
                    ],
                    { gap: '9px' }
                  )
                ),
                { gap: '32px' }
              ),
            ],
            {
              styles: {
                ...PANEL,
                ...pad('24px'),
                width: '640px',
                maxWidth: '92vw',
              },
              responsive: { mobile: { width: '100%', paddingLeft: '18px', paddingRight: '18px' } },
            }
          ),
        ],
        { flexDirection: 'column', alignItems: 'stretch', gap: '0px' }
      ),
    ],
    {
      ...pad('14px', '24px'),
      backgroundColor: 'var(--c-surface)',
      ...borderSide('Bottom', '1px', 'var(--c-border)'),
    },
    { mobile: { paddingLeft: '18px', paddingRight: '18px' } }
  );
}

/* --------------------------------------------------------------------------
 * Account menu
 * ----------------------------------------------------------------------- */

/** The avatar in the corner, and what is under it. */
export function userMenuSpec(): NodeSpec {
  return frame(
    'Account menu',
    [
      stack(
        'Bar',
        [
          paragraph('Dashboard', { ...SMALL, color: 'var(--c-muted)' }),
          {
            ...popoverButton('Ines García', 'Account panel', { variant: 'ghost' }),
            name: 'Open account menu',
            styles: {
              marginLeft: 'auto',
              ...SMALL,
              color: 'var(--c-text)',
              backgroundColor: 'transparent',
              ...pad('5px', '10px', '5px', '5px'),
              ...radius('999px'),
              ...border('1px', 'var(--c-border)'),
              gap: '9px',
            },
            children: [
              avatar('26px'),
              paragraph('Ines García', { ...SMALL, color: 'var(--c-text)' }),
            ],
          },

          popover(
            'Account panel',
            [
              column(
                'Who',
                [
                  paragraph('Ines García', { ...SMALL, color: 'var(--c-text)' }),
                  paragraph('ines@northbound.studio', { ...CAPTION, color: 'var(--c-muted)' }),
                ],
                { gap: '3px' }
              ),
              divider(),
              column(
                'Items',
                [
                  textLink('Account settings', '#', { ...SMALL, color: 'var(--c-text)' }),
                  textLink('Billing', '#', { ...SMALL, color: 'var(--c-text)' }),
                  textLink('Team members', '#', { ...SMALL, color: 'var(--c-text)' }),
                ],
                { gap: '9px', width: '100%' }
              ),
              divider(),
              textLink('Sign out', '#', { ...SMALL, color: 'var(--c-muted)' }),
            ],
            {
              styles: {
                ...PANEL,
                ...pad('14px'),
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '248px',
                maxWidth: '92vw',
              },
            }
          ),
        ],
        { width: '100%', alignItems: 'center', gap: '14px' }
      ),
    ],
    {
      ...pad('14px', '20px'),
      backgroundColor: 'var(--c-surface)',
      ...borderSide('Bottom', '1px', 'var(--c-border)'),
    },
    // The name beside the avatar is the first thing to go: on a phone the
    // avatar alone is the control, and the name is in the panel it opens.
    { mobile: { paddingLeft: '14px', paddingRight: '14px' } }
  );
}
