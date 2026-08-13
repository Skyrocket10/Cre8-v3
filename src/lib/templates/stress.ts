/**
 * Every primitive, pushed until something gives.
 *
 * The component gallery next door asks "what can the library draw?" and
 * answers it with ninety-three blocks. This asks a different and less
 * comfortable question — *what can the element model not say?* — and the way
 * to find out is to try to say hard things with it.
 *
 * So this is not a nice-looking site and is not trying to be. It is the
 * arrangement of content that breaks layouts: text with no spaces in it, a
 * heading of one word eighty characters long, a table wider than a phone, a
 * grid told to fit twelve things into three tracks, an empty string where copy
 * should be, a paragraph of nine hundred words, and every value of every
 * enumerated property side by side so a wrong one is visible rather than
 * plausible.
 *
 * ## Why it exists as a template rather than a fixture
 *
 * Because the failures worth finding are the ones a *designer* would hit, and
 * a designer hits them by opening a document and looking at it. A fixture in a
 * test file only ever gets the assertions somebody thought to write; a page
 * you can open gets your eyes, at every width, on everything at once.
 *
 * ## What it found
 *
 * Recorded in `docs/COMPONENT-LIBRARY.md` under "What the stress template
 * found", because a list of gaps is worth more than the document that produced
 * it, and it should be readable without building anything.
 *
 * Seven gaps, five of them since closed — twelve properties the vocabulary did
 * not have. That changes what several of these cases are *for*: one that used
 * to demonstrate an impossibility now demonstrates the fix, and keeps the
 * broken version beside it. A fix is only legible next to the thing it fixed,
 * and the "before" half is also what stops the "after" half passing for the
 * wrong reason if the content is ever softened.
 *
 * ## Measured, not looked at
 *
 * `tests/render/stress.mjs` generates this site and reads it back through a
 * browser: how far each page scrolls sideways at three widths, whether three
 * clamped cards come out the same height, which order five boxes are drawn in,
 * where a jump lands. Those are the numbers in the write-up. It needs no
 * Worker — it opens the generated files over `file://` — so it runs anywhere.
 */

import { pageRef, type NodeSpec } from '../document/factory';
import {
  border,
  borderSide,
  cell,
  column,
  container,
  frame,
  grid,
  heading,
  label,
  pad,
  radius,
  section,
  stack,
} from './blocks/kit';

/* --------------------------------------------------------------------------
 * The content that breaks things
 * ----------------------------------------------------------------------- */

/** No spaces. The classic column-blower, and the reason `overflow-wrap` exists. */
const UNBREAKABLE =
  'https://example.com/a/very/long/path/that/never/breaks?because=it&has=no&spaces=at&all&and=keeps#going';

/** One word, eighty characters. Narrower than a phone column and unhyphenatable. */
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosisandthensomemoreforgoodmeasure';

const LOREM =
  'A paragraph long enough to wrap many times over, which is the only way to see whether the measure holds, whether the leading is right at three lines and at thirty, and whether anything below it is pushed somewhere it should not go. ' +
  'It repeats deliberately. A single sentence proves nothing about a block of text, and most copy in a real site is a block of text rather than a single sentence. ';

/**
 * Three strings of very unequal length, and one card to put them in.
 *
 * Shared by the clamped row and the unclamped one, because the comparison is
 * only worth anything if both rows hold the same words. Two hand-written
 * copies would drift the first time somebody edited one.
 */
const CARD_COPY = [40, 300, 120].map((n) => LOREM.slice(0, n));

const card = (index: number, text: string, clamp?: string): NodeSpec =>
  column(
    `${clamp ? 'Clamped' : 'Unclamped'} ${index + 1}`,
    [
      heading(`Card ${index + 1}`, 3, { fontSize: '13px', fontWeight: '640' }),
      label(text, {
        fontSize: '12.5px',
        color: 'var(--c-muted)',
        ...(clamp ? { lineClamp: clamp } : {}),
      }),
    ],
    { gap: '4px', ...pad('10px'), ...border('1px', 'var(--c-border)'), ...radius('var(--r-sm)') }
  );

/** A link that scrolls to a named section, by reference rather than by fragment. */
const jump = (text: string, to: string): NodeSpec => ({
  type: 'link',
  name: `Jump to ${to}`,
  // `text`, not `label`: a link's words are `props.text` and a button's are
  // `props.label`, and the wrong one silently renders the element's default.
  props: { text },
  refs: { scrollTo: to },
  styles: { fontSize: '13px', color: 'var(--c-primary)', textDecoration: 'underline' },
});

/** A caption row, so a screenshot says which case is which. */
const case_ = (name: string, note: string, children: NodeSpec[]): NodeSpec =>
  column(
    `${name} case`,
    [
      heading(name, 3, {
        fontSize: '11.5px',
        fontWeight: '650',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--c-primary)',
      }),
      ...(note ? [label(note, { fontSize: '12px', color: 'var(--c-muted)' })] : []),
      /*
       * Each case scrolls inside itself rather than pushing the page.
       *
       * Several of these are *deliberately* unfittable — six fixed-width boxes
       * in a narrow column, a table with seven columns — and the point of them
       * is to see the squeeze, not to make the document scroll sideways. This
       * is also the honest demonstration: containing overflow is something the
       * style vocabulary can already say, so a case that needs it gets it.
       *
       * The text page is then the only one that still overflows, and it does so
       * because the property that would fix it does not exist. That contrast is
       * the finding.
       */
      frame(`${name} subject`, children, {
        ...pad('14px'),
        ...radius('var(--r-md)'),
        ...border('1px', 'var(--c-border)'),
        width: '100%',
        maxWidth: '100%',
        overflowX: 'auto',
        gap: '10px',
        backgroundColor: 'var(--c-background)',
      }),
    ],
    { gap: '6px', width: '100%' }
  );

/** A page's title, so every page has exactly one `h1` and the outline is sane. */
const title = (text: string, note: string): NodeSpec =>
  section(
    `${text} title`,
    [
      container(
        [
          column(
            `${text} intro`,
            [
              heading(text, 1, { fontSize: '34px', fontWeight: '680', letterSpacing: '-0.02em' }),
              label(note, { fontSize: '14px', color: 'var(--c-muted)', maxWidth: '68ch' }),
            ],
            { gap: '8px' }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '64px', paddingBottom: '16px' },
    { mobile: { paddingTop: '40px' } }
  );

/**
 * Cases laid out two-up, collapsing to one on a phone.
 *
 * The group's own `h2` is not decoration. Each case names itself with an `h3`,
 * and without something between them the outline runs `h1` → `h3` — which the
 * static suite caught on four of these five pages the first time they were
 * built, and which is the same defect the gallery had for the same reason.
 */
const cases = (name: string, children: NodeSpec[], styles = {}, anchor?: string): NodeSpec => {
  const node = section(
    name,
    [
      container(
        [
          column(
            `${name} group`,
            [
              heading(name, 2, { fontSize: '19px', fontWeight: '640' }),
              grid(`${name} grid`, 2, children, { gap: '22px' }),
            ],
            { gap: '16px' }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '24px', paddingBottom: '24px', ...borderSide('Top'), ...styles }
  );
  /*
   * An anchor is a *prop*, not a consequence of having a name, and finding that
   * out cost an afternoon. A jump reference resolves through `props.anchor`, so
   * a section with a name and no anchor is not a place a link can point at: the
   * reference resolves to nothing and the renderer *hides* the link rather than
   * pointing it at `#`. That is the right behaviour — a Next button that does
   * nothing is worse than no button — and it looks exactly like a link that
   * failed to render.
   */
  return anchor ? { ...node, props: { ...node.props, anchor } } : node;
};

/* --------------------------------------------------------------------------
 * Typography
 * ----------------------------------------------------------------------- */

export function textPage(): NodeSpec[] {
  return [
    title(
      'Text',
      'Every heading level, and the content that breaks text: no spaces, one very long word, nothing at all, and nine hundred words of something.'
    ),
    cases('Headings', [
      case_(
        'All six levels',
        'The outline a screen reader walks, and the only place h4–h6 appear anywhere in this repository.',
        ([1, 2, 3, 4, 5, 6] as const).map((n) => heading(`Heading level ${n}`, n))
      ),
      case_(
        'A heading that is one long word',
        'Seventy-four characters and nowhere to break. The first spills; the second is the same heading with Long words set to Break it.',
        [
          heading(LONG_WORD, 2, { fontSize: '28px' }),
          heading(LONG_WORD, 2, { fontSize: '28px', overflowWrap: 'anywhere' }),
        ]
      ),
    ]),
    cases('Wrapping', [
      case_(
        'A URL with no spaces in it',
        'The obvious suspect, and mostly innocent — a browser takes a break opportunity after / and ?, so a URL wraps unaided.',
        [label(UNBREAKABLE, { fontSize: '14px' })]
      ),
      /*
       * The case the whole first finding came from, kept as a pair.
       *
       * The left box is what a designer used to get and could do nothing about;
       * the right is the same content with one row set. Keeping the broken one
       * is the point — a fix is only legible beside the thing it fixed, and
       * this is the case that measured 732px of sideways scroll before there
       * was a property for it.
       */
      case_(
        'The same word in a narrow column, before and after',
        'Both 180px wide. The left one has nothing set and pushes past its box; the right one has Long words: Break it.',
        [
          stack(
            'Before and after',
            [
              frame('Spills', [label(LONG_WORD, { fontSize: '14px' })], {
                width: '180px',
                flexShrink: '0',
                ...pad('8px'),
                ...border('1px', 'var(--c-border)'),
                ...radius('var(--r-sm)'),
              }),
              frame('Wraps', [label(LONG_WORD, { fontSize: '14px', overflowWrap: 'anywhere' })], {
                width: '180px',
                flexShrink: '0',
                ...pad('8px'),
                ...border('1px', 'var(--c-primary)'),
                ...radius('var(--r-sm)'),
              }),
            ],
            { gap: '10px', alignItems: 'start' }
          ),
        ]
      ),
      case_(
        'Hyphenated, and justified',
        'Justified text with no hyphenation opens rivers between the words. The second block is the first with Hyphenate on.',
        [
          label(LOREM.slice(0, 260), { fontSize: '13px', textAlign: 'justify', maxWidth: '30ch' }),
          label(LOREM.slice(0, 260), {
            fontSize: '13px',
            textAlign: 'justify',
            maxWidth: '30ch',
            hyphens: 'auto',
          }),
        ]
      ),
      case_('Nine hundred words', 'Whether the measure holds at length.', [
        label(LOREM.repeat(4), { fontSize: '14.5px', lineHeight: '1.65', maxWidth: '62ch' }),
      ]),
      case_('Nothing at all', 'An empty string, which is what an unfilled field looks like.', [
        label('', { fontSize: '14px' }),
        label('↑ an empty text node sits above this line', {
          fontSize: '12px',
          color: 'var(--c-muted)',
        }),
      ]),
    ]),
    cases('Enumerated values, side by side', [
      case_(
        'textTransform',
        'Each value, so a wrong one is visible rather than plausible.',
        (['none', 'uppercase', 'lowercase', 'capitalize'] as const).map((v) =>
          label(`${v}: the Quick Brown Fox`, { fontSize: '13px', textTransform: v })
        )
      ),
      case_(
        'whiteSpace',
        'The one that decides whether the URL above wraps.',
        (['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'] as const).map((v) =>
          label(`${v}:  two spaces and\na newline`, { fontSize: '13px', whiteSpace: v })
        )
      ),
      case_(
        'textAlign',
        '',
        (['left', 'center', 'right', 'justify'] as const).map((v) =>
          label(`${v} — ${LOREM.slice(0, 120)}`, { fontSize: '13px', textAlign: v })
        )
      ),
      case_(
        'wordBreak',
        'The opposite question to Long words: this one breaks words that would have fitted.',
        (['normal', 'break-all', 'keep-all'] as const).map((v) =>
          label(`${v}: ${LONG_WORD}`, { fontSize: '13px', maxWidth: '22ch', wordBreak: v })
        )
      ),
      case_('Rich text', 'The one typography primitive no block in the library uses.', [
        { type: 'richtext', name: 'Rich text' },
      ]),
    ]),
    /*
     * Truncation, which a card grid needs and could not express. Three cards of
     * very unequal length: without a clamp the row is as tall as the longest,
     * which is the raggedness `workGridBlock` and `galleryBlock` had to solve
     * with alignment instead of with the property for it.
     */
    cases('Truncation', [
      case_(
        'Three cards of different lengths, clamped to two',
        'Every card the same height, without a fixed height — the row no longer depends on its longest item.',
        [grid('Clamped cards', 3, CARD_COPY.map((text, i) => card(i, text, '2')), {
          gap: '8px',
          alignItems: 'start',
        })]
      ),
      case_(
        'The same three, unclamped',
        'What the row does without it, which is the reason the row above is worth having.',
        [grid('Unclamped cards', 3, CARD_COPY.map((text, i) => card(i, text)), {
          gap: '8px',
          alignItems: 'start',
        })]
      ),
      case_(
        'One line, cut with an ellipsis',
        'The case a clamp cannot take: a table cell, whose display is what makes it a cell at all.',
        [
          {
            type: 'table',
            name: 'Trimmed table',
            props: { caption: 'Fixed column widths, with the overflowing cell trimmed' },
            styles: { tableLayout: 'fixed', width: '100%' },
            children: [
              {
                type: 'tableRow',
                name: 'Trimmed head',
                children: ['Name', 'Notes'].map((h) => cell(h, { header: true })),
              },
              {
                type: 'tableRow',
                name: 'Trimmed body',
                children: [
                  cell('Priya Raman'),
                  cell(LOREM.slice(0, 160), {
                    styles: {
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      // Ignored by a fixed table, which divides the width
                      // evenly. It is here for the auto-layout case, where a
                      // cell with a sentence in it takes the whole table
                      // instead of being trimmed.
                      maxWidth: '0px',
                    },
                  }),
                ],
              },
            ],
          },
        ]
      ),
    ]),
  ];
}

/* --------------------------------------------------------------------------
 * Layout
 * ----------------------------------------------------------------------- */

export function layoutPage(): NodeSpec[] {
  const box = (n: number, styles = {}): NodeSpec =>
    frame(`Box ${n}`, [label(String(n), { fontSize: '12px', color: 'var(--c-on-primary)' })], {
      backgroundColor: 'var(--c-primary)',
      ...pad('10px'),
      ...radius('var(--r-sm)'),
      minWidth: '34px',
      alignItems: 'center',
      justifyContent: 'center',
      ...styles,
    });

  return [
    title(
      'Layout',
      'Grids told to do awkward things, flex that has to wrap, and the three ways a thing can be taken out of flow.'
    ),
    cases('Grid', [
      case_('Twelve items, three tracks', 'Four rows, and the last one full.', [
        grid('Twelve', 3, Array.from({ length: 12 }, (_, i) => box(i + 1)), { gap: '8px' }),
      ]),
      case_('Eleven items, three tracks', 'The ragged last row, which is the common case.', [
        grid('Eleven', 3, Array.from({ length: 11 }, (_, i) => box(i + 1)), { gap: '8px' }),
      ]),
      case_('One item spanning every track', '', [
        frame(
          'Span grid',
          [box(1, { gridColumn: '1 / -1' }), box(2), box(3), box(4)],
          {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '8px',
            ...pad('0px'),
          }
        ),
      ]),
      case_('Auto-fit tracks with a minimum', 'The responsive grid that needs no breakpoint.', [
        frame('Auto fit', Array.from({ length: 7 }, (_, i) => box(i + 1)), {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
          gap: '8px',
          ...pad('0px'),
        }),
      ]),
    ]),
    cases('Flex', [
      case_('Twenty items that must wrap', '', [
        stack('Wrapping', Array.from({ length: 20 }, (_, i) => box(i + 1)), {
          gap: '6px',
          flexWrap: 'wrap',
        }),
      ]),
      case_('Grow, shrink and basis', 'Three boxes, three different rules.', [
        stack(
          'Grow row',
          [
            box(1, { flexGrow: '1' }),
            box(2, { flexGrow: '2' }),
            box(3, { flexShrink: '0', flexBasis: '120px' }),
          ],
          { gap: '8px' }
        ),
      ]),
      case_('A row that cannot fit', 'Six fixed-width boxes in a narrow box.', [
        frame(
          'Cannot fit',
          [stack('Tight', Array.from({ length: 6 }, (_, i) => box(i + 1, { minWidth: '80px' })), { gap: '8px' })],
          { width: '260px', ...pad('0px'), overflowX: 'auto' }
        ),
      ]),
    ]),
    cases('Arrangement', [
      /*
       * The gap this closes is not "boxes can be reordered" — it is that the
       * alternative was building the arrangement twice and hiding one, which
       * doubles the layer tree for a purely visual decision. Read the numbers
       * rather than the positions: they are 1 to 5 in the tree and drawn 5,
       * then 1 to 4.
       */
      case_(
        'Drawn in a different order from the layer list',
        'Box 5 carries an order of -1, so it is drawn first without moving anywhere in the tree.',
        [
          stack('Reordered', [box(1), box(2), box(3), box(4), box(5, { order: '-1' })], {
            gap: '8px',
          }),
        ]
      ),
      case_(
        'One item placed differently from the rest',
        'The grid says every cell stretches; box 3 says it sits in the middle of its own — and has to stop asking for the full width, or there is nothing to place.',
        [
          frame(
            'Self placed',
            [
              box(1),
              box(2),
              /*
               * `width: auto` beside the placement, and it is the interesting
               * half. A frame's default width is 100%, so `justify-self:
               * center` on one changes nothing at all: the item already fills
               * its track, and centring something that is already the full
               * width is a no-op. The first version of this set only the
               * placement, read correctly in the document, and measured 256px
               * in a 255.5px track.
               */
              box(3, { justifySelf: 'center', width: 'auto' }),
              box(4),
            ],
            {
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              justifyItems: 'stretch',
              gap: '8px',
              ...pad('0px'),
            }
          ),
        ]
      ),
      /*
       * Deliberately lopsided, and the only case here that is. Everything else
       * on these pages is symmetric — `pad('14px')` — which mirrors to itself
       * and proves nothing. `tests/render/stress.mjs` builds this document
       * twice, once each way round, and measures this box in both.
       */
      case_(
        'Lopsided, so it can be seen to turn around',
        'A 48px indent and a 4px rule, both on the left. Set the document to read right to left in Site settings and both move to the right — this box, and every block in the library, without a line of any of them changing.',
        [
          frame(
            'Lopsided',
            [label('Indented, with a rule down one side.', { fontSize: '13px' })],
            {
              paddingLeft: '48px',
              paddingTop: '10px',
              paddingBottom: '10px',
              paddingRight: '10px',
              ...borderSide('Left', '4px', 'var(--c-primary)'),
              textAlign: 'left',
              backgroundColor: 'var(--c-surface)',
            }
          ),
        ]
      ),
      case_(
        'The three transforms that compose',
        'Rotated, scaled and nudged as separate properties, so a rule can change one and leave the others standing.',
        [
          stack(
            'Transformed',
            [
              box(1, { rotate: '-8deg' }),
              box(2, { scale: '1.3' }),
              box(3, { translate: '0 -10px' }),
              box(4, { rotate: '12deg', scale: '1.15', translate: '0 6px' }),
            ],
            { gap: '20px', alignItems: 'center', justifyContent: 'center', height: '70px' }
          ),
        ]
      ),
      /*
       * The one case here that has to be measured rather than looked at.
       * `tests/render/stress.mjs` scrolls to the target and reads how far below
       * the top of the viewport it lands: 96px everywhere else on the site, 220
       * here. Before this property the number was 96 and unchangeable.
       */
      case_(
        'Two jumps, one of which stops further down',
        'The first target asks for 220px of clearance; the second leaves the 96px every anchor gets from the document reset. The pair is the demonstration — one number on its own says nothing about whether it was chosen.',
        [
          jump('Jump to “Stops lower than the rest”', 'Stops lower than the rest'),
          jump('Jump to “Out of flow”, which sets nothing', 'Out of flow'),
        ]
      ),
    ]),
    cases(
      'Stops lower than the rest',
      [
        case_(
          'This section sets its own jump offset',
          'Nothing to look at — the finding is where the heading above lands after the jump.',
          [label('220px, not 96.', { fontSize: '13px' })]
        ),
      ],
      { scrollMarginTop: '220px' },
      'stops-lower'
    ),
    /*
     * Last on the page on purpose, and the jump above is the reason.
     *
     * A browser cannot scroll a target further than the bottom of the document
     * allows, so an anchor at the very end lands where the page runs out rather
     * than where its `scroll-margin-top` asks: with this group above it the
     * measurement read 721px instead of 220. It is the runway. It also carries
     * an anchor of its own and sets nothing, so the default every id gets from
     * the reset is readable off a real element beside the one overriding it.
     */
    cases(
      'Out of flow',
      [
        case_('Absolute, pinned to each corner', '', [
          frame(
            'Corners',
            [
              box(1, { position: 'absolute', top: '6px', left: '6px' }),
              box(2, { position: 'absolute', top: '6px', right: '6px' }),
              box(3, { position: 'absolute', bottom: '6px', left: '6px' }),
              box(4, { position: 'absolute', bottom: '6px', right: '6px' }),
            ],
            { position: 'relative', height: '130px', ...pad('0px'), backgroundColor: 'var(--c-surface)' }
          ),
        ]),
        case_('Stacked, in the wrong order', 'Later in the document, lower on the screen.', [
          frame(
            'Stack order',
            [
              box(1, { position: 'absolute', top: '10px', left: '10px', zIndex: '3' }),
              box(2, { position: 'absolute', top: '26px', left: '34px', zIndex: '2' }),
              box(3, { position: 'absolute', top: '42px', left: '58px', zIndex: '1' }),
            ],
            { position: 'relative', height: '110px', ...pad('0px'), backgroundColor: 'var(--c-surface)' }
          ),
        ]),
        case_('Sticky inside a scroller', '', [
          frame(
            'Scroller',
            [
              frame('Sticky bar', [label('Sticky', { fontSize: '12px' })], {
                position: 'sticky',
                top: '0px',
                backgroundColor: 'var(--c-surface-2)',
                ...pad('6px', '10px'),
              }),
              ...Array.from({ length: 8 }, (_, i) => box(i + 1)),
            ],
            { height: '150px', overflowY: 'auto', gap: '6px', ...pad('0px') }
          ),
        ]),
        case_('A spacer, which nothing in the library uses', '', [
          label('above', { fontSize: '12px' }),
          { type: 'spacer', name: 'Spacer', styles: { height: '40px' } },
          label('below', { fontSize: '12px' }),
        ]),
      ],
      {},
      'out-of-flow'
    ),
  ];
}

/* --------------------------------------------------------------------------
 * Media
 * ----------------------------------------------------------------------- */

export function mediaPage(): NodeSpec[] {
  const shot = (fit: string): NodeSpec => ({
    type: 'image',
    name: `objectFit ${fit}`,
    props: {
      alt: `A placeholder photograph, drawn with object-fit ${fit}`,
      width: 900,
      height: 600,
    },
    styles: {
      width: '100%',
      aspectRatio: '1 / 1',
      objectFit: fit,
      ...radius('var(--r-sm)'),
      backgroundColor: 'var(--c-surface-2)',
    },
  });

  return [
    title(
      'Media',
      'Every fit an image can take, a video with each of its switches, and the two primitives that draw nothing at all.'
    ),
    cases('Images', [
      case_(
        'objectFit, on a square slot with a 3:2 picture',
        'The one that is wrong in every direction if the wrong value is chosen.',
        [grid('Fits', 5, ['cover', 'contain', 'fill', 'none', 'scale-down'].map(shot), { gap: '8px' })]
      ),
      case_('An image with no source', 'What an unfilled slot looks like before anybody fills it.', [
        {
          type: 'image',
          name: 'Empty slot',
          props: { alt: 'Replace this with a photograph' },
          styles: { width: '100%', aspectRatio: '16 / 9', ...radius('var(--r-sm)') },
        },
      ]),
    ]),
    cases('Video', [
      case_(
        'Every switch a video has',
        'Autoplay, loop, muted and controls — none of which any block sets.',
        [
          {
            type: 'video',
            name: 'Video',
            props: { autoplay: false, loop: true, muted: true, controls: true },
            styles: { width: '100%', aspectRatio: '16 / 9', ...radius('var(--r-sm)'), backgroundColor: 'var(--c-surface-2)' },
          },
        ]
      ),
      case_('Icons at four sizes and two weights', '', [
        stack(
          'Icon row',
          [
            { type: 'icon', name: 'Icon 16', props: { name: 'sparkles', strokeWidth: 1.5 }, styles: { width: '16px', height: '16px' } },
            { type: 'icon', name: 'Icon 24', props: { name: 'sparkles', strokeWidth: 1.75 }, styles: { width: '24px', height: '24px' } },
            { type: 'icon', name: 'Icon 40', props: { name: 'sparkles', strokeWidth: 2 }, styles: { width: '40px', height: '40px' } },
            { type: 'icon', name: 'Icon 64', props: { name: 'sparkles', strokeWidth: 2.5 }, styles: { width: '64px', height: '64px' } },
          ],
          { gap: '12px', alignItems: 'center' }
        ),
      ]),
      case_('A divider, horizontal and inside a row', '', [
        { type: 'divider', name: 'Divider' },
        stack(
          'Divided row',
          [label('left', { fontSize: '12px' }), { type: 'divider', name: 'Upright divider', styles: { width: '1px', height: '20px' } }, label('right', { fontSize: '12px' })],
          { gap: '10px', alignItems: 'center' }
        ),
      ]),
    ]),
  ];
}

/* --------------------------------------------------------------------------
 * Forms
 * ----------------------------------------------------------------------- */

export function formsPage(): NodeSpec[] {
  return [
    title(
      'Forms',
      'Every control the element model has, including the four the library barely touches, inside one real form.'
    ),
    cases('Controls', [
      case_('Text, in three shapes', '', [
        { type: 'input', name: 'Text input', props: { name: 'plain', placeholder: 'A plain text field' } },
        { type: 'input', name: 'Email input', props: { name: 'email', inputType: 'email', placeholder: 'you@example.com' } },
        { type: 'textarea', name: 'Textarea', props: { name: 'message', rows: 3, placeholder: 'Something longer' } },
      ]),
      case_('Choice, in four shapes', '', [
        { type: 'select', name: 'Select', props: { name: 'size', options: 'Small\nMedium\nLarge\nA fourth option with a much longer label than the others' } },
        { type: 'checkbox', name: 'Checkbox', props: { name: 'terms', label: 'A checkbox with a label long enough to wrap onto a second line on a narrow screen' } },
        { type: 'radio', name: 'Radio one', props: { name: 'plan', value: 'monthly', label: 'Monthly', checked: true } },
        { type: 'radio', name: 'Radio two', props: { name: 'plan', value: 'annual', label: 'Annual' } },
      ]),
      case_('The four nothing much uses', 'Range, file, progress and a fieldset around them.', [
        {
          type: 'fieldset',
          name: 'Rarely used',
          props: { legend: 'Seldom seen' },
          children: [
            { type: 'range', name: 'Range', props: { name: 'amount', min: 0, max: 100, step: 5, value: 40 } },
            { type: 'file', name: 'File', props: { name: 'attachment', accept: 'image/*', multiple: true } },
            { type: 'progress', name: 'Progress', props: { value: 60, max: 100 } },
            { type: 'progress', name: 'Progress unknown', props: { indeterminate: true } },
          ],
        },
      ]),
      case_('A whole form that submits', '', [
        {
          type: 'form',
          name: 'Real form',
          children: [
            { type: 'input', name: 'Name field', props: { name: 'name', placeholder: 'Your name', required: true } },
            { type: 'textarea', name: 'Message field', props: { name: 'message', rows: 3, placeholder: 'How can we help?' } },
            { type: 'button', name: 'Send', props: { label: 'Send', submit: true } },
          ],
          styles: { display: 'flex', flexDirection: 'column', gap: '10px', ...pad('0px') },
        },
      ]),
    ]),
  ];
}

/* --------------------------------------------------------------------------
 * Interactive and tabular
 * ----------------------------------------------------------------------- */

export function interactivePage(): NodeSpec[] {
  /*
   * The kit's `cell`, not the local one this replaces.
   *
   * That one wrote `props: { text }`, which a table cell does not have — a cell
   * holds *children*, deliberately, so the words in it can be selected and
   * edited like words anywhere else. Every cell on this page therefore rendered
   * empty, and the case that exists to prove a seven-column table will not fit
   * a phone was proving it about a table with nothing in it. Nothing said so:
   * the markup was valid, the layout was plausible, and the sideways-scroll
   * measurement passed for a reason that had nothing to do with the table.
   * Found by asking a browser how wide the text in one cell was, and being
   * told zero.
   */
  return [
    title(
      'Interactive and tabular',
      'The things that open, the things that go somewhere, and a table wider than a phone.'
    ),
    cases('Disclosure', [
      case_('Details, closed and open', 'Native, so it works with no script at all.', [
        { type: 'details', name: 'Closed', props: { summary: 'What is included?', open: false }, children: [label('The answer, hidden until asked for.', { fontSize: '13px' })] },
        { type: 'details', name: 'Open', props: { summary: 'And one that starts open', open: true }, children: [label('Visible from the first paint.', { fontSize: '13px' })] },
      ]),
      case_('A popover and the button that opens it', '', [
        { type: 'button', name: 'Open the panel', props: { label: 'Open the panel' }, refs: { popover: 'Stress panel' } },
        {
          type: 'popover',
          name: 'Stress panel',
          props: { popoverMode: 'auto', showWhileEditing: false },
          children: [label('A panel, opened by the browser rather than by a script.', { fontSize: '13px' })],
          styles: { ...pad('14px'), ...radius('var(--r-md)'), ...border('1px', 'var(--c-border)'), backgroundColor: 'var(--c-background)' },
        },
      ]),
      case_('A dialog, which one block in ninety-three uses', '', [
        { type: 'button', name: 'Open the dialog', props: { label: 'Open the dialog' }, refs: { popover: 'Stress dialog' } },
        {
          type: 'dialog',
          name: 'Stress dialog',
          props: { popoverMode: 'auto', label: 'A dialog', showWhileEditing: false },
          children: [label('Modal, and still no script.', { fontSize: '13px' })],
          styles: { ...pad('18px'), ...radius('var(--r-lg)'), backgroundColor: 'var(--c-background)' },
        },
      ]),
    ]),
    cases('Tables', [
      case_('Seven columns, which will not fit a phone', 'The scroller is the point.', [
        {
          type: 'table',
          name: 'Wide table',
          props: { caption: 'A table with more columns than a phone has room for' },
          children: [
            {
              type: 'tableRow',
              name: 'Head',
              children: ['Region', 'Owner', 'Opened', 'Closed', 'Median', 'p95', 'Notes'].map((h) =>
                cell(h, { header: true })
              ),
            },
            ...['Europe', 'North America', 'Asia Pacific'].map((r, i) => ({
              type: 'tableRow' as const,
              name: r,
              children: [
                cell(r),
                cell(['Priya Raman', 'Marcus Hall', 'Mei Chen'][i]!),
                cell('142'),
                cell('138'),
                cell('2.4 days'),
                cell('9.1 days'),
                cell('A notes column with a sentence in it, because notes columns always have sentences in them'),
              ],
            })),
          ],
        },
      ]),
    ]),
  ];
}

/** The pages, in the order the nav lists them. */
export const STRESS_PAGES = [
  { name: 'Text', slug: 'text', sections: textPage },
  { name: 'Layout', slug: 'layout', sections: layoutPage },
  { name: 'Media', slug: 'media', sections: mediaPage },
  { name: 'Forms', slug: 'forms', sections: formsPage },
  { name: 'Interactive', slug: 'interactive', sections: interactivePage },
];

/** Links to every stress page, for the nav and the footer. */
export const stressLinks = (): { label: string; href: string }[] =>
  STRESS_PAGES.map((p) => ({ label: p.name, href: pageRef(p.slug) }));
