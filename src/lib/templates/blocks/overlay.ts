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
import type { StyleDecl } from '../../document/types';
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
  fieldset,
  media,
  pad,
  paragraph,
  popover,
  popoverButton,
  progress,
  radio,
  radius,
  section,
  stack,
  switchButton,
  switchCase,
  switchGroup,
  switchStep,
  textLink,
  toggle,
  valueSlider,
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

/* --------------------------------------------------------------------------
 * Controls
 *
 * Two of these are a native element and an attribute. They are here rather
 * than in `app.ts` because they belong with the overlays for the same reason
 * the overlays belong together: the browser already does the work, and the
 * value of the block is knowing that and not reaching for a library.
 * ----------------------------------------------------------------------- */

/**
 * Progress, in the element called progress.
 *
 * A `div` with a coloured child looks the same and says nothing: `<progress>`
 * is announced with its value and its maximum, and it is the difference
 * between "sixty percent" and a rectangle. The indeterminate one carries no
 * value at all, which is the honest state for work whose end is unknown.
 */
export function progressSpec(): NodeSpec {
  const row = (label: string, note: string, value: number | null): NodeSpec =>
    column(
      label,
      [
        stack(
          `${label} row`,
          [
            paragraph(label, { ...SMALL, color: 'var(--c-text)' }),
            paragraph(note, { ...CAPTION, color: 'var(--c-muted)', marginLeft: 'auto' }),
          ],
          { width: '100%', alignItems: 'center', gap: '12px' }
        ),
        progress(`${label} bar`, value, { styles: { width: '100%', height: '8px' } }),
      ],
      { gap: '8px', width: '100%' }
    );

  return section(
    'Progress',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('Where things are up to', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              paragraph(
                'Announced with its value, not just drawn as a rectangle.',
                { ...BODY, color: 'var(--c-muted)' },
                BODY_RESPONSIVE
              ),
            ],
            { gap: '10px' }
          ),
          column(
            'Bars',
            [
              row('Photographs', '18 of 24', 75),
              row('Captions', '6 of 24', 25),
              row('Publishing', 'still going', null),
            ],
            { gap: '22px', width: '100%' }
          ),
        ],
        { flexDirection: 'column', alignItems: 'stretch', gap: '30px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/**
 * A segmented control, which is a radio group wearing a different coat.
 *
 * Not buttons. Radios in a named `<fieldset>` are one stop on the tab key,
 * arrow-navigable, announced as "two of three", and they submit with a form —
 * all of which a row of buttons would have to be given back one at a time.
 * The legend is the whole point: without it a screen reader reads "Monthly"
 * with no idea what question it answers.
 */
export function segmentedSpec(): NodeSpec {
  return section(
    'Segmented control',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('One of a few, and only one', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              paragraph(
                'A radio group, so the arrow keys work and the answer travels with the form.',
                { ...BODY, color: 'var(--c-muted)' },
                BODY_RESPONSIVE
              ),
            ],
            { gap: '10px' }
          ),
          fieldset(
            'Billing period',
            [
              stack(
                'Options',
                [
                  radio('Monthly', 'billing', 'monthly', true),
                  radio('Yearly', 'billing', 'yearly'),
                  radio('Pay as you go', 'billing', 'metered'),
                ],
                { gap: '18px', flexWrap: 'wrap' }
              ),
            ],
            {
              ...pad('16px', '18px'),
              ...border('1px', 'var(--c-border)'),
              ...radius('var(--r-lg)'),
              backgroundColor: 'var(--c-surface)',
              width: 'fit-content',
              maxWidth: '100%',
            },
            { mobile: { width: '100%' } }
          ),
        ],
        { flexDirection: 'column', alignItems: 'flex-start', gap: '26px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/* --------------------------------------------------------------------------
 * Switch-driven
 *
 * These need the state machine rather than a native element, and the trade is
 * worth naming: about thirty lines of script reach the published page, once,
 * shared by every switch on it. What they buy is that the *shown* slide is
 * decided by a generated CSS rule keyed on the group's value — so the first
 * paint is already correct, and a page with scripting off shows slide one
 * rather than all of them at once or none.
 * ----------------------------------------------------------------------- */

const SLIDES = [
  {
    value: 'one',
    title: 'Drawn in the studio',
    body: 'Every layout starts on paper, which is faster to throw away.',
    alt: 'A desk covered in printed layout sketches',
  },
  {
    value: 'two',
    title: 'Built in the browser',
    body: 'The canvas runs the real page, so there is nothing to hand over.',
    alt: 'A laptop showing a page being edited',
  },
  {
    value: 'three',
    title: 'Published as files',
    body: 'Static HTML on a CDN. Serving one costs a read, not a render.',
    alt: 'A rack of servers lit from below',
  },
];

/**
 * A carousel, and an honest one.
 *
 * The slide on screen is chosen by a CSS rule on the group's value, not by a
 * script moving a transform — so it is right on the first paint and it is
 * right with scripting off. The dots are the controls; the arrows are marked
 * quiet, because "Next" is not a toggle and announcing it as one is worse
 * than announcing nothing.
 *
 * What this deliberately is not is a swipeable, auto-advancing, infinitely
 * looping carousel. Each of those needs real script, and two of them are
 * things people ask you to turn off.
 */
export function carouselSpec(): NodeSpec {
  return section(
    'Carousel',
    [
      container(
        [
          switchGroup(
            'slide',
            'one',
            [
              ...SLIDES.map((slide) =>
                switchCase(
                  slide.value,
                  grid(
                    slide.title,
                    2,
                    [
                      media(`${slide.title} image`, slide.alt, {
                        width: '100%',
                        aspectRatio: '4 / 3',
                        objectFit: 'cover',
                        ...radius('var(--r-lg)'),
                      }),
                      column(
                        `${slide.title} copy`,
                        [
                          heading(slide.title, 2, {
                            ...SUBTITLE,
                            color: 'var(--c-text)',
                          }, SUBTITLE_RESPONSIVE),
                          paragraph(slide.body, {
                            ...BODY,
                            color: 'var(--c-muted)',
                          }, BODY_RESPONSIVE),
                        ],
                        { gap: '12px', justifyContent: 'center' }
                      ),
                    ],
                    { gap: '36px', alignItems: 'center' }
                  )
                )
              ),
              stack(
                'Controls',
                [
                  switchStep('Back', SLIDES[0]!.value, 'secondary'),
                  ...SLIDES.map((slide, index) =>
                    switchButton(`${index + 1}`, slide.value, {
                      width: '30px',
                      ...pad('7px', '0px'),
                      textAlign: 'center',
                    })
                  ),
                  switchStep('Next', SLIDES[SLIDES.length - 1]!.value, 'secondary'),
                ],
                { gap: '8px', alignItems: 'center', justifyContent: 'center', width: '100%' },
                { mobile: { flexWrap: 'wrap' } }
              ),
            ],
            { display: 'flex', flexDirection: 'column', gap: '32px' }
          ),
        ],
        { flexDirection: 'column', alignItems: 'stretch' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

const TOASTS = [
  { value: 'saved', title: 'Draft saved', body: 'Everything since your last edit is stored.' },
  { value: 'published', title: 'Site published', body: 'Three files written, four left alone.' },
  { value: 'failed', title: 'Could not publish', body: 'Two pages want the same address.' },
];

/**
 * Messages that arrive and can be sent away.
 *
 * A toast that dismisses itself after a few seconds needs a timer, and a timer
 * needs script that this page does not have — so these are dismissed by the
 * person instead, which is the accessible behaviour anyway: a message that
 * vanishes on its own is one a slow reader never finished.
 *
 * Each is its own switch, so dismissing one leaves the others alone.
 */
export function toastSpec(): NodeSpec {
  /*
   * The group is also the case, which is the idiom the dismissible notice
   * established and which two things recommend.
   *
   * Structurally: dismissing takes the whole group out of the flow, where
   * hiding only the contents would leave an empty box and its gap behind in
   * the column. And for the model: a value that nothing names reads as a typo
   * unless some condition is satisfied by "anything else" — a group hiding
   * itself is exactly that, and the static rule knows it. Written the other
   * way round, `Dismiss` looked like a button wired to nothing.
   */
  const toast = (item: (typeof TOASTS)[number], tone: string): NodeSpec =>
    switchCase('shown', {
      ...stack(
        item.title,
        [
          frame('Mark', [], {
            width: '4px',
            alignSelf: 'stretch',
            backgroundColor: tone,
            ...radius('var(--r-full)'),
          }),
          column(
            `${item.title} copy`,
            [
              paragraph(item.title, { ...SMALL, color: 'var(--c-text)' }),
              paragraph(item.body, { ...CAPTION, color: 'var(--c-muted)' }),
            ],
            { gap: '3px' }
          ),
          {
            ...switchButton('Dismiss', 'gone', {
              marginLeft: 'auto',
              ...CAPTION,
              color: 'var(--c-muted)',
              alignSelf: 'flex-start',
            }),
            name: `Dismiss ${item.title.toLowerCase()}`,
          },
        ],
        {
          ...PANEL,
          ...pad('13px', '14px'),
          gap: '12px',
          width: '100%',
          alignItems: 'flex-start',
        }
      ),
      props: { switchKey: `toast-${item.value}`, switchDefault: 'shown' },
    });

  return section(
    'Toasts',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('It happened, and here is what', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              paragraph(
                'Dismissed by the reader rather than by a timer — a message that vanishes on its own is one a slow reader never finished.',
                { ...BODY, color: 'var(--c-muted)', maxWidth: '54ch' },
                BODY_RESPONSIVE
              ),
            ],
            { gap: '10px' }
          ),
          column(
            'Stack',
            [
              toast(TOASTS[0]!, 'var(--c-primary)'),
              toast(TOASTS[1]!, 'var(--c-primary)'),
              toast(TOASTS[2]!, 'var(--c-danger)'),
            ],
            { gap: '12px', width: '100%', maxWidth: '420px' },
            { mobile: { maxWidth: '100%' } }
          ),
        ],
        { flexDirection: 'column', alignItems: 'flex-start', gap: '28px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/**
 * Settings that take effect the moment they move.
 *
 * A switch is a checkbox wearing `role="switch"`, which changes nothing about
 * how it works and everything about how it is announced: "on" and "off"
 * rather than "checked" and "not checked". That is the right reading for a
 * setting with no Save button, and the wrong one for a checkbox in a form
 * you submit — which is why this is a separate block rather than a style.
 *
 * The row it sits in lights up when it is on, and that is a `checked` rule
 * rather than script. It could not be written at all until the generator
 * learned that the class is on the `<label>` while the state is on the
 * `<input>` inside it.
 */
export function switchesSpec(): NodeSpec {
  /*
   * Labels only, no sub-copy. A `<label>` announces everything it contains,
   * so a note inside one turns "Email digest, on" into a sentence nobody
   * wanted read out — and a note outside it is a paragraph floating beside a
   * control it is not associated with. Where a setting genuinely needs
   * explaining, the explanation belongs above the group.
   */
  return section(
    'Switches',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('Settings that apply as you touch them', 2, {
                ...SUBTITLE,
                color: 'var(--c-text)',
              }, SUBTITLE_RESPONSIVE),
              paragraph(
                'Announced as on and off, keyboard-operable, and submitted with the form — a checkbox underneath, with no script over the top.',
                { ...BODY, color: 'var(--c-muted)', maxWidth: '56ch' },
                BODY_RESPONSIVE
              ),
            ],
            { gap: '10px' }
          ),
          column(
            'Settings',
            [
              toggle('Weekly email digest', 'digest', true),
              toggle('Notify me when somebody mentions me', 'mentions', true),
              toggle('Occasional product news', 'news', false),
            ],
            { gap: '10px', width: '100%', maxWidth: '460px' },
            { mobile: { maxWidth: '100%' } }
          ),
        ],
        { flexDirection: 'column', alignItems: 'flex-start', gap: '26px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}

/* --------------------------------------------------------------------------
 * Before / after
 * ----------------------------------------------------------------------- */

/**
 * The block `COMPONENT-LIBRARY.md` §5.7 recorded as *not buildable as
 * described* — and the reason it now is.
 *
 * The switch is a state machine over named values, and a divider dragged
 * across a photograph produces a continuous one. The document said what it
 * would take: "pointer position written to a custom property, or a native
 * control whose value CSS can read". It got the first, driven by the second.
 *
 * The whole thing is one number, `--cre8-split`, held on the frame. The upper
 * image is clipped to it; the handle is positioned by it; a native range
 * writes it. CSS does the drawing, as everywhere else here — the runtime's
 * only contribution is one `setProperty` per pointer move.
 *
 * What that buys, and why the native control rather than a drag handler:
 *
 *   • It works with no script at all. The number is in the markup, so a page
 *     opened from a ZIP shows the comparison frozen at the chosen split rather
 *     than showing one image and a dead handle.
 *   • Keyboard and touch come from the platform, correctly, including `step`
 *     and the arrow keys.
 *   • A screen reader announces a slider with a value, which is what it is.
 */
export function beforeAfterSpec(): NodeSpec {
  const KEY = 'split';
  const START = 50;
  const SPLIT = `calc(var(--cre8-${KEY}) * 1%)`;

  const layer = (alt: string, styles: StyleDecl = {}): NodeSpec =>
    media(alt, '16 / 10', {
      position: 'absolute',
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      borderTopLeftRadius: '0px',
      borderTopRightRadius: '0px',
      borderBottomRightRadius: '0px',
      borderBottomLeftRadius: '0px',
      ...styles,
    });

  const caption = (text: string, side: 'left' | 'right'): NodeSpec =>
    paragraph(text, {
      position: 'absolute',
      bottom: '12px',
      [side]: '12px',
      ...CAPTION,
      // An opaque chip rather than a translucent scrim. A scrim needs a
      // literal colour — it has to stay dark whatever the theme does, because
      // what it sits on is a photograph rather than the page — and a literal
      // colour is exactly what the token rule refuses, rightly: a block that
      // brings its own palette is a block that stops matching the site it was
      // dropped into. The chip is legible over anything for the same reason a
      // caption card is, and it is made of the same two tokens as the handle.
      color: 'var(--c-text)',
      backgroundColor: 'var(--c-surface)',
      ...pad('4px', '9px'),
      ...radius('var(--r-sm)'),
      boxShadow: 'var(--s-md)',
      pointerEvents: 'none',
    });

  return section(
    'Before and after',
    [
      container(
        [
          column(
            'Intro',
            [
              heading('See the difference', 2, { ...SUBTITLE, color: 'var(--c-text)' }, SUBTITLE_RESPONSIVE),
              paragraph(
                'Drag the handle. It works with the keyboard, and it still shows the comparison with scripting switched off.',
                { ...BODY, color: 'var(--c-muted)', maxWidth: '58ch' },
                BODY_RESPONSIVE
              ),
            ],
            { gap: '10px' }
          ),

          {
            ...frame('Comparison', [], {
              position: 'relative',
              width: '100%',
              aspectRatio: '16 / 10',
              overflow: 'hidden',
              ...radius('var(--r-lg)'),
            }),
            // The box that holds the number. Everything below reads it, so it
            // has to be an ancestor of all of them — which is also what the
            // runtime's `closest()` walks to when the slider moves.
            props: { rangeKey: KEY, rangeValue: START },
            children: [
            layer('After — the edited photograph'),
            // Clipped from the left by the split, so what shows through is the
            // "before" image up to the divider. One property, no wrapper, and
            // it moves smoothly because nothing is being laid out again.
            layer('Before — the original photograph', {
              clipPath: `inset(0 0 0 ${SPLIT})`,
            }),

            caption('Before', 'left'),
            caption('After', 'right'),

            // The divider. Drawn, not interactive: the range below is what
            // takes the pointer, and two things claiming the same gesture is
            // how a drag ends up fighting itself.
            frame('Divider', [], {
              position: 'absolute',
              top: '0px',
              left: SPLIT,
              width: '2px',
              height: '100%',
              marginLeft: '-1px',
              backgroundColor: 'var(--c-surface)',
              boxShadow: 'var(--s-md)',
              pointerEvents: 'none',
            }),
            frame('Handle', [], {
              position: 'absolute',
              top: '50%',
              left: SPLIT,
              width: '34px',
              height: '34px',
              marginTop: '-17px',
              marginLeft: '-17px',
              backgroundColor: 'var(--c-surface)',
              ...radius('999px'),
              boxShadow: 'var(--s-md)',
              pointerEvents: 'none',
            }),

            // Invisible and full-bleed: the handle a visitor sees is the box
            // above, and this is the control that actually moves. Opacity
            // rather than `display:none` or `visibility:hidden`, both of which
            // take it out of the accessibility tree along with the pointer.
            valueSlider('Split', KEY, START, {
              label: 'Reveal the original photograph',
              styles: {
                position: 'absolute',
                top: '0px',
                left: '0px',
                width: '100%',
                height: '100%',
                opacity: '0',
                cursor: 'ew-resize',
              },
            }),
            ],
          },
        ],
        { gap: '28px' }
      ),
    ],
    { backgroundColor: 'var(--c-background)' }
  );
}
