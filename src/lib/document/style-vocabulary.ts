/**
 * What every style property is called, and what kind of control edits it.
 *
 * The audit that produced this file found the same thing in three places: the
 * *engine* is general — `declarationsToCss` kebab-cases anything and both
 * surfaces render it identically, so a new property costs one line in
 * `StyleDecl` — while the *editor* is hand-carved, one written row at a time.
 * Thirty-two of a hundred properties had no control anywhere, and nothing said
 * so. The gap was only findable by grepping the panel source for each name in
 * turn, which is archaeology rather than a guarantee.
 *
 * So the vocabulary is declared, and `Record<StyleProp, StyleEntry>` is what
 * makes it total: adding a property to `StyleDecl` without a word for it and a
 * place to live is a compile error rather than a quiet hole somebody finds a
 * year later. That is the audit, turned into the type system's problem.
 *
 * The compiler cannot check the half that matters most — whether the entry is
 * *reached* — so the static suite does: every property with a control here is
 * rendered by a section, and every one marked `bespoke` still has the
 * hand-written row it is deferring to.
 *
 * ## Why this is data and not components
 *
 * Three readers, only one of which is a panel:
 *
 *   • the panel, which renders a row from an entry;
 *   • the row's right-click menu, which needs a *name* for a declaration;
 *   • the expression panel's effect picker, which offers a property by name
 *     and — before this file existed — printed `sets backgroundColor`.
 *
 * Two of those had their own private spelling of the same words, and the third
 * had none. One table is what stops them disagreeing.
 *
 * ## `bespoke`
 *
 * A control marked `bespoke` is one a hand-written row already owns, and owns
 * for a reason: the box model is a diagram, sizing is Fill/Hug/Fixed rather
 * than a length, a colour is a swatch with tokens behind it. Those are not the
 * long tail and turning them into table rows would make the panel worse. They
 * are still declared here, because the *words* are shared even when the control
 * is not, and because coverage has to mean coverage.
 */

import type { ElementType, StyleProp } from './types';

/** Which inspector section a row belongs in. */
export type StyleSection =
  | 'layout'
  | 'size'
  | 'spacing'
  | 'typography'
  | 'fill'
  | 'border'
  | 'effects'
  | 'motion'
  | 'position'
  | 'parent'
  | 'content'
  | 'table'
  | 'advanced';

export interface StyleChoice {
  value: string;
  label: string;
  /** Longer text for a tooltip, where the label has to stay short. */
  title?: string;
}

/**
 * How a value is edited.
 *
 * Deliberately few. A control kind is a promise that every property using it
 * behaves the same way, and a vocabulary with a kind per property is just the
 * hand-written panel again with extra steps.
 */
export type StyleControl =
  /** A hand-written row owns this. Declared for its words and for coverage. */
  | { kind: 'bespoke' }
  /** One of a fixed set. Renders as a menu, or as a segmented row when short. */
  | { kind: 'choice'; options: StyleChoice[]; segmented?: boolean }
  /** On or off, where "off" means the declaration is absent rather than a value. */
  | { kind: 'switch'; on: string; label: string }
  /** A number with a unit. Pass no units for a bare count. */
  | { kind: 'length'; units: string[]; placeholder?: string }
  /**
   * How many grid tracks an item covers.
   *
   * Its own kind because the *value* is `span 2` and the question is "how many
   * columns?", and a text field asking for the former is the reason a bento
   * layout was unbuildable here: every grid in all eight templates is a uniform
   * `repeat(n, 1fr)`, not because anybody chose that but because a child could
   * not be told to cover two cells.
   */
  | { kind: 'span'; max: number }
  /**
   * Free text, for the values that genuinely are open-ended.
   *
   * Five of them, and each is a value with no useful finite set: a gradient, a
   * shadow, a clip shape, a grid track list. A menu of guesses would be worse
   * than a field, and a field is honest about being one.
   */
  | { kind: 'text'; placeholder?: string };

export interface StyleEntry {
  /** Row label, and the name the row's right-click menu uses. */
  label: string;
  /**
   * The same property said as the object of a sentence, for the one panel that
   * needs one: `… and it sets ⟨the background⟩`.
   *
   * Separate from `label` because the grammar genuinely differs — a row is
   * headed *Decoration* and a sentence says *sets the underline*, and neither
   * reads as the other. Present only on the handful the effect picker offers;
   * a property with no phrase cannot be offered there, which is the constraint
   * the picker wants anyway.
   */
  asEffect?: string;
  /** Tooltip. Says what it is *for*, not what it is called again. */
  hint?: string;
  section: StyleSection;
  control: StyleControl;
  /**
   * Offered only on these element types. Absent means every type.
   *
   * `objectPosition` on a paragraph is not a feature, it is a row somebody has
   * to read past on every element for the sake of the two it applies to.
   */
  only?: ElementType[];
  /**
   * Offered only while a sibling declaration holds one of these values.
   *
   * The grid properties are the reason: eight rows that mean nothing in a flex
   * container, shown against every element, would cost more legibility than
   * they buy. Evaluated against the *effective* value, so a grid set on desktop
   * still shows its rows while editing mobile.
   */
  when?: { prop: StyleProp; is: string[] };
}

const LENGTH = ['px', 'rem', '%', 'em', 'vw', 'vh'];

/* --------------------------------------------------------------------------
 * The vocabulary
 * ----------------------------------------------------------------------- */

export const STYLE_VOCABULARY: Record<StyleProp, StyleEntry> = {
  /* ------------------------------------------------------------- layout -- */
  display: { label: 'Type', section: 'layout', control: { kind: 'bespoke' } },
  flexDirection: { label: 'Direction', section: 'layout', control: { kind: 'bespoke' } },
  alignItems: { label: 'Align', section: 'layout', control: { kind: 'bespoke' } },
  justifyContent: { label: 'Distribute', section: 'layout', control: { kind: 'bespoke' } },
  flexWrap: { label: 'Wrap', section: 'layout', control: { kind: 'bespoke' } },
  gap: { label: 'Gap', section: 'layout', control: { kind: 'bespoke' } },
  rowGap: {
    label: 'Row gap',
    hint: 'Overrides the gap between rows only',
    section: 'layout',
    control: { kind: 'length', units: LENGTH },
  },
  columnGap: {
    label: 'Column gap',
    hint: 'Overrides the gap between columns only',
    section: 'layout',
    control: { kind: 'length', units: LENGTH },
  },
  columnCount: {
    label: 'Text columns',
    hint: 'Flows content into columns that balance themselves — a masonry wall',
    section: 'layout',
    control: { kind: 'length', units: [], placeholder: '1' },
  },
  breakInside: {
    label: 'Keep together',
    hint: 'Stops a card being split across a column boundary',
    section: 'layout',
    control: { kind: 'switch', on: 'avoid', label: 'Never split this' },
  },
  gridTemplateColumns: { label: 'Columns', section: 'layout', control: { kind: 'bespoke' } },
  gridTemplateRows: {
    label: 'Rows',
    hint: 'Fixed row heights, e.g. auto 1fr auto',
    section: 'layout',
    control: { kind: 'text', placeholder: 'auto' },
    when: { prop: 'display', is: ['grid', 'inline-grid'] },
  },
  gridAutoFlow: {
    label: 'Flow',
    hint: 'How items that were not placed by hand fill the grid',
    section: 'layout',
    control: {
      kind: 'choice',
      options: [
        { value: 'row', label: 'Rows' },
        { value: 'column', label: 'Columns' },
        { value: 'row dense', label: 'Fill gaps', title: 'Backfills holes left by a spanning item' },
      ],
    },
    when: { prop: 'display', is: ['grid', 'inline-grid'] },
  },
  gridAutoRows: {
    label: 'Row height',
    hint: 'Height of rows the grid creates on its own',
    section: 'layout',
    control: { kind: 'text', placeholder: 'auto' },
    when: { prop: 'display', is: ['grid', 'inline-grid'] },
  },
  gridColumn: {
    label: 'Spans across',
    hint: 'How many of the parent grid’s columns this covers',
    section: 'parent',
    control: { kind: 'span', max: 12 },
  },
  gridRow: {
    label: 'Spans down',
    hint: 'How many of the parent grid’s rows this covers',
    section: 'parent',
    control: { kind: 'span', max: 12 },
  },
  placeItems: {
    label: 'Place items',
    hint: 'Aligns every cell’s contents at once',
    section: 'layout',
    control: {
      kind: 'choice',
      options: [
        { value: 'stretch', label: 'Stretch' },
        { value: 'start', label: 'Start' },
        { value: 'center', label: 'Centre' },
        { value: 'end', label: 'End' },
      ],
    },
    when: { prop: 'display', is: ['grid', 'inline-grid'] },
  },

  /* ----------------------------------------------------------- position -- */
  position: { label: 'Position', section: 'position', control: { kind: 'bespoke' } },
  top: { label: 'Top', section: 'position', control: { kind: 'bespoke' } },
  right: { label: 'Right', section: 'position', control: { kind: 'bespoke' } },
  bottom: { label: 'Bottom', section: 'position', control: { kind: 'bespoke' } },
  left: { label: 'Left', section: 'position', control: { kind: 'bespoke' } },
  inset: { label: 'Inset', section: 'position', control: { kind: 'bespoke' } },
  zIndex: { label: 'Layer', section: 'position', control: { kind: 'bespoke' } },
  positionArea: { label: 'Aligned', section: 'content', control: { kind: 'bespoke' } },
  positionTryFallbacks: { label: 'Near an edge', section: 'content', control: { kind: 'bespoke' } },
  overflow: { label: 'Overflow', section: 'position', control: { kind: 'bespoke' } },
  overflowX: {
    label: 'Sideways',
    hint: 'A row that scrolls horizontally — a carousel, a strip of chips',
    section: 'position',
    control: {
      kind: 'choice',
      options: [
        { value: 'visible', label: 'Spills out' },
        { value: 'auto', label: 'Scrolls' },
        { value: 'hidden', label: 'Clipped' },
      ],
    },
  },
  overflowY: {
    label: 'Up and down',
    hint: 'A panel that scrolls vertically inside a fixed height',
    section: 'position',
    control: {
      kind: 'choice',
      options: [
        { value: 'visible', label: 'Spills out' },
        { value: 'auto', label: 'Scrolls' },
        { value: 'hidden', label: 'Clipped' },
      ],
    },
  },
  visibility: {
    label: 'Visible',
    hint: 'Hidden empties the box but keeps its space, so nothing else moves',
    section: 'position',
    control: { kind: 'switch', on: 'hidden', label: 'Keep its space, but empty' },
  },

  /* --------------------------------------------------------------- size -- */
  width: { label: 'Width', section: 'size', control: { kind: 'bespoke' } },
  height: { label: 'Height', section: 'size', control: { kind: 'bespoke' } },
  minWidth: { label: 'Min width', section: 'size', control: { kind: 'bespoke' } },
  maxWidth: { label: 'Max width', section: 'size', control: { kind: 'bespoke' } },
  minHeight: { label: 'Min height', section: 'size', control: { kind: 'bespoke' } },
  maxHeight: { label: 'Max height', section: 'size', control: { kind: 'bespoke' } },
  aspectRatio: { label: 'Ratio', section: 'size', control: { kind: 'bespoke' } },
  flexGrow: { label: 'Grow', section: 'parent', control: { kind: 'bespoke' } },
  flexShrink: {
    label: 'Shrink',
    hint: 'Off is what stops a sidebar collapsing when the row runs out of room',
    section: 'parent',
    control: { kind: 'switch', on: '0', label: 'Never shrink' },
  },
  flexBasis: {
    label: 'Starts at',
    hint: 'The size it grows or shrinks from, before either happens',
    section: 'parent',
    control: { kind: 'length', units: LENGTH, placeholder: 'auto' },
  },
  alignSelf: { label: 'Align self', section: 'parent', control: { kind: 'bespoke' } },

  /* ------------------------------------------------------------ spacing -- */
  paddingTop: { label: 'Padding top', section: 'spacing', control: { kind: 'bespoke' } },
  paddingRight: { label: 'Padding right', section: 'spacing', control: { kind: 'bespoke' } },
  paddingBottom: { label: 'Padding bottom', section: 'spacing', control: { kind: 'bespoke' } },
  paddingLeft: { label: 'Padding left', section: 'spacing', control: { kind: 'bespoke' } },
  marginTop: { label: 'Margin top', section: 'spacing', control: { kind: 'bespoke' } },
  marginRight: { label: 'Margin right', section: 'spacing', control: { kind: 'bespoke' } },
  marginBottom: { label: 'Margin bottom', section: 'spacing', control: { kind: 'bespoke' } },
  marginLeft: { label: 'Margin left', section: 'spacing', control: { kind: 'bespoke' } },

  /* --------------------------------------------------------- typography -- */
  fontFamily: { label: 'Font', section: 'typography', control: { kind: 'bespoke' } },
  fontSize: { label: 'Size', section: 'typography', control: { kind: 'bespoke' } },
  fontWeight: { label: 'Weight', section: 'typography', control: { kind: 'bespoke' } },
  fontStyle: {
    label: 'Italic',
    section: 'typography',
    control: { kind: 'switch', on: 'italic', label: 'Italic' },
  },
  lineHeight: { label: 'Line height', section: 'typography', control: { kind: 'bespoke' } },
  letterSpacing: { label: 'Letter spacing', section: 'typography', control: { kind: 'bespoke' } },
  textAlign: { label: 'Align', section: 'typography', control: { kind: 'bespoke' } },
  textTransform: { label: 'Case', section: 'typography', control: { kind: 'bespoke' } },
  textDecoration: {
    label: 'Decoration',
    asEffect: 'the underline',
    section: 'typography',
    control: { kind: 'bespoke' },
  },
  textWrap: { label: 'Wrapping', section: 'typography', control: { kind: 'bespoke' } },
  whiteSpace: {
    label: 'Line breaks',
    hint: 'Whether text may wrap, and whether written line breaks are kept',
    section: 'typography',
    control: {
      kind: 'choice',
      options: [
        { value: 'normal', label: 'Wrap' },
        { value: 'nowrap', label: 'One line' },
        { value: 'pre-wrap', label: 'Keep breaks', title: 'Wraps, and honours line breaks in the text' },
        { value: 'pre-line', label: 'Breaks only', title: 'Honours line breaks, collapses runs of spaces' },
      ],
    },
  },
  fontVariantNumeric: {
    label: 'Figures',
    hint: 'Same-width figures stop a column of numbers jittering as it changes',
    section: 'typography',
    control: { kind: 'switch', on: 'tabular-nums', label: 'Same width' },
  },
  color: {
    label: 'Colour',
    asEffect: 'the text colour',
    section: 'typography',
    control: { kind: 'bespoke' },
  },
  textGradient: {
    label: 'Gradient text',
    hint: 'Fills the letters themselves, e.g. linear-gradient(90deg, #6366f1, #ec4899)',
    section: 'typography',
    control: { kind: 'text', placeholder: 'linear-gradient(…)' },
  },

  /* --------------------------------------------------------------- fill -- */
  backgroundColor: {
    label: 'Colour',
    asEffect: 'the background',
    section: 'fill',
    control: { kind: 'bespoke' },
  },
  backgroundImage: { label: 'Image', section: 'fill', control: { kind: 'bespoke' } },
  backgroundSize: { label: 'Size', section: 'fill', control: { kind: 'bespoke' } },
  backgroundPosition: { label: 'Position', section: 'fill', control: { kind: 'bespoke' } },
  backgroundRepeat: {
    /*
     * "Tiling", not "Repeat". The Data section already has a row called Repeat
     * — the one that turns a container into a repeater — and two rows with one
     * name in a 280px panel is a question the reader has to answer by looking
     * at which section they are in. It is also what a browser check found by
     * clicking the wrong menu, which is the cheaper way to learn it.
     */
    label: 'Tiling',
    hint: 'Tiles a small image instead of stretching one',
    section: 'fill',
    control: {
      kind: 'choice',
      options: [
        { value: 'no-repeat', label: 'Once' },
        { value: 'repeat', label: 'Tile' },
        { value: 'repeat-x', label: 'Across' },
        { value: 'repeat-y', label: 'Down' },
      ],
    },
  },
  backgroundAttachment: {
    label: 'Scrolls',
    hint: 'Fixed holds the image still while the page moves over it',
    section: 'fill',
    control: { kind: 'switch', on: 'fixed', label: 'Hold still while scrolling' },
  },

  /* ------------------------------------------------------------- border -- */
  borderStyle: { label: 'Style', section: 'border', control: { kind: 'bespoke' } },
  borderTopWidth: { label: 'Border top', section: 'border', control: { kind: 'bespoke' } },
  borderRightWidth: { label: 'Border right', section: 'border', control: { kind: 'bespoke' } },
  borderBottomWidth: { label: 'Border bottom', section: 'border', control: { kind: 'bespoke' } },
  borderLeftWidth: { label: 'Border left', section: 'border', control: { kind: 'bespoke' } },
  borderColor: {
    label: 'Colour',
    asEffect: 'the border colour',
    section: 'border',
    control: { kind: 'bespoke' },
  },
  borderTopLeftRadius: { label: 'Radius top left', section: 'border', control: { kind: 'bespoke' } },
  borderTopRightRadius: { label: 'Radius top right', section: 'border', control: { kind: 'bespoke' } },
  borderBottomRightRadius: {
    label: 'Radius bottom right',
    section: 'border',
    control: { kind: 'bespoke' },
  },
  borderBottomLeftRadius: {
    label: 'Radius bottom left',
    section: 'border',
    control: { kind: 'bespoke' },
  },

  /* ------------------------------------------------------------ effects -- */
  boxShadow: { label: 'Shadow', section: 'effects', control: { kind: 'bespoke' } },
  textShadow: {
    label: 'Text shadow',
    hint: 'A shadow on the letters, e.g. 0 1px 2px rgba(0,0,0,.4)',
    section: 'effects',
    control: { kind: 'text', placeholder: '0 1px 2px …' },
  },
  opacity: {
    label: 'Opacity',
    asEffect: 'how see-through it is',
    section: 'effects',
    control: { kind: 'bespoke' },
  },
  filter: { label: 'Blur', section: 'effects', control: { kind: 'bespoke' } },
  backdropFilter: { label: 'Backdrop', section: 'effects', control: { kind: 'bespoke' } },
  mixBlendMode: {
    label: 'Blend',
    hint: 'How this element’s colours mix with what is behind it',
    section: 'effects',
    control: {
      kind: 'choice',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'difference', label: 'Difference' },
        { value: 'luminosity', label: 'Luminosity' },
      ],
    },
  },
  clipPath: {
    label: 'Clip',
    hint: 'Clips the box to a shape, e.g. inset(0 0 0 50%)',
    section: 'effects',
    control: { kind: 'text', placeholder: 'inset(…)' },
  },

  /* ------------------------------------------------------------- motion -- */
  transform: { label: 'Transform', section: 'motion', control: { kind: 'bespoke' } },
  transformOrigin: {
    label: 'Anchored at',
    hint: 'The point a scale or rotation happens around',
    section: 'motion',
    control: {
      kind: 'choice',
      options: [
        { value: 'center', label: 'Centre' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'top left', label: 'Top left' },
        { value: 'top right', label: 'Top right' },
        { value: 'bottom left', label: 'Bottom left' },
        { value: 'bottom right', label: 'Bottom right' },
      ],
    },
  },
  transition: { label: 'Eases', section: 'motion', control: { kind: 'bespoke' } },
  appear: {
    label: 'Appears',
    hint: 'How it arrives as it scrolls into view',
    section: 'motion',
    control: {
      kind: 'choice',
      options: [
        { value: 'fade', label: 'Fades in' },
        { value: 'rise', label: 'Fades and rises' },
        { value: 'zoom', label: 'Fades and grows' },
        { value: 'left', label: 'Slides in from the left' },
        { value: 'right', label: 'Slides in from the right' },
      ],
    },
  },

  /* -------------------------------------------------------------- media -- */
  objectFit: { label: 'Fit', section: 'content', control: { kind: 'bespoke' }, only: ['image', 'video'] },
  objectPosition: {
    label: 'Focal point',
    hint: 'Which part of the picture survives a crop',
    section: 'content',
    only: ['image', 'video'],
    control: {
      kind: 'choice',
      options: [
        { value: 'center', label: 'Centre' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'top left', label: 'Top left' },
        { value: 'top right', label: 'Top right' },
        { value: 'bottom left', label: 'Bottom left' },
        { value: 'bottom right', label: 'Bottom right' },
      ],
    },
  },

  /* ------------------------------------------------------------- tables -- */
  borderCollapse: {
    label: 'Borders',
    section: 'table',
    only: ['table'],
    control: {
      kind: 'choice',
      segmented: true,
      options: [
        { value: 'collapse', label: 'Shared' },
        { value: 'separate', label: 'Separate' },
      ],
    },
  },
  borderSpacing: {
    label: 'Cell gap',
    hint: 'Only applies while borders are separate',
    section: 'table',
    only: ['table'],
    control: { kind: 'length', units: ['px', 'rem'] },
    when: { prop: 'borderCollapse', is: ['separate'] },
  },
  tableLayout: {
    label: 'Widths',
    hint: 'Fixed sizes columns from the first row instead of from the content',
    section: 'table',
    only: ['table'],
    control: {
      kind: 'choice',
      segmented: true,
      options: [
        { value: 'auto', label: 'From content' },
        { value: 'fixed', label: 'Even' },
      ],
    },
  },
  captionSide: {
    label: 'Caption',
    section: 'table',
    only: ['table'],
    control: {
      kind: 'choice',
      segmented: true,
      options: [
        { value: 'top', label: 'Above' },
        { value: 'bottom', label: 'Below' },
      ],
    },
  },
  verticalAlign: {
    label: 'Vertically',
    hint: 'Where the contents sit in a cell that is taller than they are',
    section: 'table',
    only: ['tableCell', 'tableRow'],
    control: {
      kind: 'choice',
      segmented: true,
      options: [
        { value: 'top', label: 'Top' },
        { value: 'middle', label: 'Middle' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
  },

  /* --------------------------------------------------------------- misc -- */
  accentColor: { label: 'Accent', section: 'content', control: { kind: 'bespoke' } },
  cursor: {
    label: 'Cursor',
    hint: 'What the pointer turns into over this element',
    section: 'effects',
    control: {
      kind: 'choice',
      options: [
        { value: 'pointer', label: 'Hand' },
        { value: 'default', label: 'Arrow' },
        { value: 'text', label: 'Text' },
        { value: 'move', label: 'Move' },
        { value: 'grab', label: 'Grab' },
        { value: 'not-allowed', label: 'Not allowed' },
        { value: 'wait', label: 'Busy' },
      ],
    },
  },
  pointerEvents: {
    label: 'Clickable',
    hint: 'Off lets clicks pass straight through to whatever is behind',
    section: 'effects',
    control: { kind: 'switch', on: 'none', label: 'Let clicks pass through' },
  },
  /*
   * The escape hatch, and `bespoke` because it is the one entry that is not a
   * property with a control — it is a field for the properties that have none.
   * A table of controls needs a way to admit it does not cover something, or
   * the coverage it claims is only true of the list it wrote itself.
   */
  custom: {
    label: 'Custom CSS',
    hint: 'Declarations for anything the panel has no control for',
    section: 'advanced',
    control: { kind: 'bespoke' },
  },
  listStyleType: {
    label: 'Bullets',
    section: 'typography',
    control: {
      kind: 'choice',
      options: [
        { value: 'disc', label: 'Dots' },
        { value: 'decimal', label: 'Numbers' },
        { value: 'circle', label: 'Rings' },
        { value: 'square', label: 'Squares' },
        { value: 'none', label: 'None' },
      ],
    },
  },
};

/* --------------------------------------------------------------------------
 * Reading it
 * ----------------------------------------------------------------------- */

/**
 * Every property a section renders from the table, in declaration order.
 *
 * Order is the vocabulary's, not the caller's, so two sections cannot disagree
 * about where a row goes and a new property lands in a predictable place rather
 * than at the bottom of whichever list somebody edited last.
 *
 * No totality check beside this: `Record<StyleProp, StyleEntry>` already means
 * every property has an entry, and a runtime function re-checking the compiler
 * is a test that can only ever pass.
 */
export function tabled(section: StyleSection): StyleProp[] {
  return (Object.entries(STYLE_VOCABULARY) as [StyleProp, StyleEntry][])
    .filter(([, entry]) => entry.section === section && entry.control.kind !== 'bespoke')
    .map(([prop]) => prop);
}

/** The properties the effect picker may offer: the ones with a phrase for it. */
export function effectProps(): [prop: StyleProp, phrase: string][] {
  return (Object.entries(STYLE_VOCABULARY) as [StyleProp, StyleEntry][])
    .filter((pair): pair is [StyleProp, StyleEntry & { asEffect: string }] =>
      Boolean(pair[1].asEffect)
    )
    .map(([prop, entry]) => [prop, entry.asEffect]);
}
