/**
 * Element registry.
 *
 * Every element in Cre8 is described here rather than implemented as its own
 * bespoke component. The renderer, the insert panel, the layer tree, the
 * inspector and the static publisher all read from this one table, so adding
 * an element type means adding a row — not touching six subsystems.
 */

import type { ElementType, NodeProps, StateStyles, StyleDecl, StyleRule } from './types';

export type InsertCategory =
  | 'layout'
  | 'typography'
  | 'media'
  | 'forms'
  | 'navigation'
  | 'interactive'
  | 'structure'
  | 'components';

export const INSERT_CATEGORIES: { id: InsertCategory; label: string }[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'typography', label: 'Typography' },
  { id: 'media', label: 'Media' },
  { id: 'interactive', label: 'Interactive' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'forms', label: 'Forms' },
  { id: 'structure', label: 'Structure' },
  { id: 'components', label: 'Components' },
];

export interface ElementDefinition {
  type: ElementType;
  label: string;
  description: string;
  category: InsertCategory;
  /** Key into the icon map in `@/components/ui/element-icon`. */
  icon: string;
  /** Default HTML tag used by the renderer and the static publisher. */
  tag: string;
  /** Can hold children. Drives drop targeting and the layer tree. */
  container: boolean;
  /**
   * Interactive content, in the HTML sense: something a person can operate.
   *
   * Recorded because `<a>` and `<button>` may not contain any of it. That is
   * not a style rule — the parser lifts the inner control out of the link, so
   * a button inside a link renders perfectly on the canvas and arrives beside
   * the link in the published file.
   */
  interactive?: boolean;
  /**
   * Child types this element may hold, when the browser is fussy about it.
   *
   * Almost nothing needs this — a `div` takes anything. Tables do: the HTML
   * parser will not let a `<div>` sit between a `<table>` and its `<tr>`, and
   * rather than erroring it *foster-parents* the stray element out in front of
   * the table. The published page then shows content the canvas drew inside a
   * cell floating above the whole thing, and nothing anywhere reported a
   * problem. Undefined means "anything".
   */
  allowedChildren?: ElementType[];
  /**
   * The mirror: parent types this element may sit inside.
   *
   * A `<td>` outside a table context is not merely misplaced — the parser
   * discards the token, so the element and everything in it vanish from the
   * published page while still rendering perfectly on the canvas.
   */
  allowedParents?: ElementType[];
  /** Has directly editable text content. */
  textual: boolean;
  /** Which prop holds that text. */
  textProp?: string;
  /** Void element — never emits children or a closing tag. */
  void?: boolean;
  /** Which axes the canvas may resize. */
  resize: { x: boolean; y: boolean };
  defaultName: string;
  defaultProps: NodeProps;
  defaultStyles: StyleDecl;
  /**
   * Variant styles a fresh node ships with.
   *
   * A dialog with no backdrop is a box floating over a page that still looks
   * live, and "add a backdrop" is not a step anyone should have to know to
   * take. Deep-copied on insert, or every dialog in the document would share
   * one object and editing any of them would edit all.
   */
  defaultStates?: StateStyles;
  /** Not offered in the insert panel (page root, component instances). */
  internal?: boolean;
  /**
   * RESERVED — the events this element will expose once the behaviour layer
   * exists. Declared now so the insert panel and inspector can grow an
   * "Interactions" tab without a document migration.
   */
  events?: string[];
}

const TEXT_COLOR = 'var(--c-text)';
const MUTED_COLOR = 'var(--c-muted)';

export const ELEMENTS: Record<ElementType, ElementDefinition> = {
  /* ---------------------------------------------------------------- root -- */
  page: {
    type: 'page',
    label: 'Page',
    description: 'The page root.',
    category: 'layout',
    icon: 'page',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: false, y: false },
    defaultName: 'Page',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      minHeight: '100vh',
      backgroundColor: 'var(--c-background)',
      color: TEXT_COLOR,
      fontFamily: 'var(--f-body)',
    },
    internal: true,
  },

  /* -------------------------------------------------------------- layout -- */
  section: {
    type: 'section',
    label: 'Section',
    description: 'Full-width band of the page.',
    category: 'layout',
    icon: 'section',
    tag: 'section',
    container: true,
    textual: false,
    resize: { x: false, y: true },
    defaultName: 'Section',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      paddingTop: '96px',
      paddingBottom: '96px',
      paddingLeft: '24px',
      paddingRight: '24px',
      position: 'relative',
    },
  },
  container: {
    type: 'container',
    label: 'Container',
    description: 'Centred, max-width content well.',
    category: 'layout',
    icon: 'container',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Container',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      maxWidth: 'var(--w-content)',
      marginLeft: 'auto',
      marginRight: 'auto',
      gap: '24px',
    },
  },
  frame: {
    type: 'frame',
    label: 'Frame',
    description: 'Generic box you can style and nest.',
    category: 'layout',
    icon: 'frame',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Frame',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      paddingTop: '24px',
      paddingRight: '24px',
      paddingBottom: '24px',
      paddingLeft: '24px',
      width: '100%',
      position: 'relative',
    },
  },
  stack: {
    type: 'stack',
    label: 'Stack',
    description: 'Row or column with even spacing.',
    category: 'layout',
    icon: 'stack',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Stack',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '16px',
    },
  },
  grid: {
    type: 'grid',
    label: 'Grid',
    description: 'Responsive column grid.',
    category: 'layout',
    icon: 'grid',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Grid',
    defaultProps: {},
    defaultStyles: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '24px',
      width: '100%',
    },
  },

  /* ---------------------------------------------------------- typography -- */
  heading: {
    type: 'heading',
    label: 'Heading',
    description: 'Titles, H1 through H6.',
    category: 'typography',
    icon: 'heading',
    tag: 'h2',
    container: false,
    textual: true,
    textProp: 'text',
    resize: { x: true, y: false },
    defaultName: 'Heading',
    defaultProps: { text: 'Heading', level: 2 },
    defaultStyles: {
      fontFamily: 'var(--f-heading)',
      fontSize: '40px',
      fontWeight: '600',
      lineHeight: '1.12',
      letterSpacing: '-0.022em',
      color: TEXT_COLOR,
      textWrap: 'balance',
    },
  },
  paragraph: {
    type: 'paragraph',
    label: 'Paragraph',
    description: 'Body copy.',
    category: 'typography',
    icon: 'paragraph',
    tag: 'p',
    container: false,
    textual: true,
    textProp: 'text',
    resize: { x: true, y: false },
    defaultName: 'Paragraph',
    defaultProps: {
      text: 'Write something worth reading. Paragraphs are for the sentences that carry your idea.',
    },
    defaultStyles: {
      fontFamily: 'var(--f-body)',
      fontSize: '17px',
      lineHeight: '1.62',
      color: MUTED_COLOR,
      textWrap: 'pretty',
    },
  },
  text: {
    type: 'text',
    label: 'Text',
    description: 'Short inline label.',
    category: 'typography',
    icon: 'text',
    tag: 'span',
    container: false,
    textual: true,
    textProp: 'text',
    resize: { x: true, y: false },
    defaultName: 'Text',
    defaultProps: { text: 'Text' },
    defaultStyles: {
      fontFamily: 'var(--f-body)',
      fontSize: '14px',
      lineHeight: '1.5',
      color: TEXT_COLOR,
    },
  },
  richtext: {
    type: 'richtext',
    label: 'Rich Text',
    description: 'Multi-paragraph formatted content.',
    category: 'typography',
    icon: 'richtext',
    tag: 'div',
    container: false,
    textual: true,
    textProp: 'html',
    resize: { x: true, y: false },
    defaultName: 'Rich Text',
    defaultProps: {
      html: '<h3>A rich text block</h3><p>Supports headings, <strong>bold</strong>, <em>italic</em> and lists.</p><ul><li>First item</li><li>Second item</li></ul>',
    },
    defaultStyles: {
      fontFamily: 'var(--f-body)',
      fontSize: '17px',
      lineHeight: '1.62',
      color: MUTED_COLOR,
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    },
  },

  /* --------------------------------------------------------------- media -- */
  image: {
    type: 'image',
    label: 'Image',
    description: 'Photo, screenshot or illustration.',
    category: 'media',
    icon: 'image',
    tag: 'img',
    container: false,
    textual: false,
    void: true,
    resize: { x: true, y: true },
    defaultName: 'Image',
    defaultProps: { src: '', alt: '' },
    defaultStyles: {
      width: '100%',
      height: 'auto',
      objectFit: 'cover',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      display: 'block',
    },
  },
  video: {
    type: 'video',
    label: 'Video',
    description: 'Self-hosted or embedded video.',
    category: 'media',
    icon: 'video',
    tag: 'video',
    container: false,
    interactive: true,
    textual: false,
    void: true,
    resize: { x: true, y: true },
    defaultName: 'Video',
    defaultProps: { src: '', poster: '', autoplay: false, loop: true, muted: true, controls: true },
    defaultStyles: {
      width: '100%',
      aspectRatio: '16 / 9',
      objectFit: 'cover',
      backgroundColor: 'var(--c-surface)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      display: 'block',
    },
  },
  icon: {
    type: 'icon',
    label: 'Icon',
    description: 'Vector icon from the built-in set.',
    category: 'media',
    icon: 'icon',
    tag: 'span',
    container: false,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Icon',
    defaultProps: { name: 'sparkles', strokeWidth: 1.75 },
    defaultStyles: {
      width: '24px',
      height: '24px',
      color: 'var(--c-primary)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },

  /* --------------------------------------------------------- interactive -- */
  button: {
    type: 'button',
    label: 'Button',
    description: 'Primary call to action.',
    category: 'interactive',
    icon: 'button',
    tag: 'a',
    container: true,
    interactive: true,
    textual: true,
    textProp: 'label',
    resize: { x: true, y: true },
    defaultName: 'Button',
    defaultProps: { label: 'Get started', href: '#', target: '_self' },
    defaultStyles: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      paddingTop: '12px',
      paddingBottom: '12px',
      paddingLeft: '22px',
      paddingRight: '22px',
      backgroundColor: 'var(--c-primary)',
      color: 'var(--c-on-primary)',
      fontFamily: 'var(--f-body)',
      fontSize: '15px',
      fontWeight: '550',
      lineHeight: '1.2',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      textDecoration: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease',
    },
    events: ['onClick'],
  },
  link: {
    type: 'link',
    label: 'Link',
    description: 'Inline text link.',
    category: 'interactive',
    icon: 'link',
    tag: 'a',
    container: true,
    interactive: true,
    textual: true,
    textProp: 'text',
    resize: { x: true, y: false },
    defaultName: 'Link',
    defaultProps: { text: 'Learn more', href: '#', target: '_self' },
    defaultStyles: {
      fontFamily: 'var(--f-body)',
      fontSize: '15px',
      color: 'var(--c-muted)',
      textDecoration: 'none',
      cursor: 'pointer',
      transition: 'color 140ms ease',
    },
    events: ['onClick'],
  },
  navigation: {
    type: 'navigation',
    label: 'Navigation',
    description: 'Row of navigation links.',
    category: 'navigation',
    icon: 'navigation',
    tag: 'nav',
    container: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Navigation',
    defaultProps: {},
    defaultStyles: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '28px',
    },
  },

  /* ----------------------------------------------------------- structure -- */
  divider: {
    type: 'divider',
    label: 'Divider',
    description: 'Horizontal rule.',
    category: 'structure',
    icon: 'divider',
    tag: 'div',
    container: false,
    textual: false,
    void: true,
    resize: { x: true, y: false },
    defaultName: 'Divider',
    defaultProps: {},
    defaultStyles: {
      width: '100%',
      height: '1px',
      backgroundColor: 'var(--c-border)',
      flexShrink: '0',
    },
  },
  spacer: {
    type: 'spacer',
    label: 'Spacer',
    description: 'Fixed vertical gap.',
    category: 'structure',
    icon: 'spacer',
    tag: 'div',
    container: false,
    textual: false,
    void: true,
    resize: { x: false, y: true },
    defaultName: 'Spacer',
    defaultProps: {},
    defaultStyles: { width: '100%', height: '48px', flexShrink: '0' },
  },

  /* --------------------------------------------------------------- forms -- */
  form: {
    type: 'form',
    label: 'Form',
    description: 'Groups inputs and a submit button.',
    category: 'forms',
    icon: 'form',
    tag: 'form',
    container: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Form',
    defaultProps: { action: '', method: 'post' },
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      width: '100%',
    },
    events: ['onSubmit'],
  },
  input: {
    type: 'input',
    label: 'Input',
    description: 'Single-line text field.',
    category: 'forms',
    icon: 'input',
    tag: 'input',
    container: false,
    interactive: true,
    textual: false,
    void: true,
    resize: { x: true, y: true },
    defaultName: 'Input',
    defaultProps: { placeholder: 'you@company.com', inputType: 'email', name: 'email' },
    defaultStyles: {
      width: '100%',
      paddingTop: '12px',
      paddingBottom: '12px',
      paddingLeft: '14px',
      paddingRight: '14px',
      fontFamily: 'var(--f-body)',
      fontSize: '15px',
      color: TEXT_COLOR,
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
    },
  },
  /* ------------------------------------------------------------ disclosure -- */
  details: {
    type: 'details',
    label: 'Disclosure',
    description: 'Summary that opens to reveal its contents.',
    category: 'structure',
    icon: 'details',
    tag: 'details',
    container: true,
    interactive: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Disclosure',
    // `open` is the published default. The canvas always shows it open —
    // otherwise the contents are unreachable to edit.
    defaultProps: { summary: 'What is included?', open: false },
    defaultStyles: {
      width: '100%',
      paddingTop: '14px',
      paddingBottom: '14px',
      borderStyle: 'solid',
      borderBottomWidth: '1px',
      borderColor: 'var(--c-border)',
      display: 'block',
    },
  },

  /* ------------------------------------------------------------- popover -- */
  /**
   * A panel the browser puts in the top layer, opened by a button.
   *
   * `[popover]` is the whole of a menu, a cookie notice or a mobile nav sheet
   * with no script at all: the browser handles the top layer, light dismiss,
   * Escape, and returning focus to the invoker. Every one of those is a thing
   * hand-rolled dropdowns get wrong.
   */
  popover: {
    type: 'popover',
    label: 'Popover',
    description: 'Panel a button opens, over everything else.',
    category: 'interactive',
    icon: 'popover',
    tag: 'div',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Popover',
    defaultProps: { popoverMode: 'auto' },
    // Fixed and centred, which is what the user-agent sheet already does for
    // `[popover]`. Stating it here means the node's own styles say where it
    // sits, so the canvas and the top layer agree without the renderer having
    // to invent anything.
    defaultStyles: {
      position: 'fixed',
      inset: '0px',
      marginTop: 'auto',
      marginRight: 'auto',
      marginBottom: 'auto',
      marginLeft: 'auto',
      width: 'min(420px, calc(100% - 32px))',
      height: 'fit-content',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      paddingTop: '18px',
      paddingRight: '18px',
      paddingBottom: '18px',
      paddingLeft: '18px',
      backgroundColor: 'var(--c-background)',
      color: TEXT_COLOR,
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-lg)',
      borderTopRightRadius: 'var(--r-lg)',
      borderBottomRightRadius: 'var(--r-lg)',
      borderBottomLeftRadius: 'var(--r-lg)',
      boxShadow: '0 24px 60px -12px rgba(15, 18, 28, 0.28)',
      zIndex: '50',
    },
  },

  /**
   * A dialog.
   *
   * A real `<dialog>` rather than a `div` that looks like one, because the
   * difference is the whole point: assistive technology announces "dialog"
   * and reads the label, where a styled box announces nothing at all.
   *
   * Opened the same way a popover is — the `popovertarget` on a button — so
   * the published page still carries no script. That buys the top layer, a
   * `::backdrop`, Escape, and focus returning to the button. What it does not
   * buy is *modality*: `showModal()` is the only thing that makes the page
   * behind inert and traps the keyboard, and there is no attribute for it.
   * That waits for the behaviour runtime rather than being faked here, and
   * the inspector says so where a designer will read it.
   */
  dialog: {
    type: 'dialog',
    label: 'Dialog',
    description: 'Announced as a dialog, over a dimmed page.',
    category: 'interactive',
    icon: 'dialog',
    tag: 'dialog',
    container: true,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Dialog',
    defaultProps: { popoverMode: 'auto', label: 'Dialog', showWhileEditing: true },
    defaultStyles: {
      position: 'fixed',
      inset: '0px',
      marginTop: 'auto',
      marginRight: 'auto',
      marginBottom: 'auto',
      marginLeft: 'auto',
      width: 'min(460px, calc(100% - 32px))',
      height: 'fit-content',
      maxHeight: 'calc(100% - 48px)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      paddingTop: '22px',
      paddingRight: '22px',
      paddingBottom: '22px',
      paddingLeft: '22px',
      backgroundColor: 'var(--c-background)',
      color: TEXT_COLOR,
      borderTopLeftRadius: 'var(--r-lg)',
      borderTopRightRadius: 'var(--r-lg)',
      borderBottomRightRadius: 'var(--r-lg)',
      borderBottomLeftRadius: 'var(--r-lg)',
      boxShadow: '0 30px 70px -14px rgba(15, 18, 28, 0.38)',
      zIndex: '60',
    },
    // A dialog that does not dim the page behind it is a box floating in the
    // middle of a live-looking document. `black` rather than a theme colour
    // on purpose: a scrim darkens what is behind it, which is not a brand
    // decision and reads wrong when a dark theme inverts it.
    defaultStates: {
      backdrop: {
        backgroundColor: 'color-mix(in srgb, black 46%, transparent)',
        backdropFilter: 'blur(2px)',
      },
    },
  },

  /* --------------------------------------------------------------- table -- */
  /**
   * Real tabular data, in real table markup.
   *
   * A grid of divs looks identical and tells a screen reader nothing: no row
   * and column relationships, no header association, no "row 3 of 12". The
   * three types below exist so that a comparison table is announced as one.
   */
  table: {
    type: 'table',
    label: 'Table',
    description: 'Rows and columns of real tabular data.',
    category: 'structure',
    icon: 'table',
    tag: 'table',
    container: true,
    textual: false,
    allowedChildren: ['tableRow'],
    resize: { x: true, y: false },
    defaultName: 'Table',
    defaultProps: { caption: '' },
    defaultStyles: {
      width: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'auto',
      fontFamily: 'var(--f-body)',
      fontSize: '14px',
      color: TEXT_COLOR,
      textAlign: 'left',
    },
  },
  tableRow: {
    type: 'tableRow',
    label: 'Table row',
    description: 'One row of cells.',
    category: 'structure',
    icon: 'tableRow',
    tag: 'tr',
    container: true,
    textual: false,
    allowedChildren: ['tableCell'],
    allowedParents: ['table'],
    resize: { x: false, y: false },
    defaultName: 'Row',
    defaultProps: {},
    defaultStyles: {
      borderStyle: 'solid',
      borderBottomWidth: '1px',
      borderColor: 'var(--c-border)',
    },
  },
  tableCell: {
    type: 'tableCell',
    label: 'Table cell',
    description: 'One cell. Header cells name their row or column.',
    category: 'structure',
    icon: 'tableCell',
    tag: 'td',
    container: true,
    textual: false,
    allowedParents: ['tableRow'],
    resize: { x: false, y: false },
    defaultName: 'Cell',
    defaultProps: { header: false, scope: 'col' },
    defaultStyles: {
      paddingTop: '11px',
      paddingRight: '14px',
      paddingBottom: '11px',
      paddingLeft: '14px',
      verticalAlign: 'middle',
      fontSize: '14px',
      lineHeight: '1.5',
      color: MUTED_COLOR,
    },
  },

  select: {
    type: 'select',
    label: 'Select',
    description: 'Native dropdown of options.',
    category: 'forms',
    icon: 'select',
    tag: 'select',
    container: false,
    interactive: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Select',
    // Newline-separated so the inspector can edit them in a plain textarea;
    // an options array would need a bespoke editor to be worth anything.
    defaultProps: {
      name: 'choice',
      options: 'Small\nMedium\nLarge',
      placeholder: 'Choose one…',
    },
    defaultStyles: {
      width: '100%',
      paddingTop: '12px',
      paddingBottom: '12px',
      paddingLeft: '14px',
      paddingRight: '14px',
      fontFamily: 'var(--f-body)',
      fontSize: '15px',
      color: TEXT_COLOR,
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      cursor: 'pointer',
    },
  },

  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    description: 'Tick box with its label.',
    category: 'forms',
    icon: 'checkbox',
    tag: 'label',
    container: false,
    interactive: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Checkbox',
    defaultProps: { label: 'Subscribe to the newsletter', name: 'subscribe', checked: false },
    defaultStyles: {
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
      fontFamily: 'var(--f-body)',
      fontSize: '14.5px',
      color: TEXT_COLOR,
      cursor: 'pointer',
    },
  },

  radio: {
    type: 'radio',
    label: 'Radio',
    description: 'One choice from a named group.',
    category: 'forms',
    icon: 'radio',
    tag: 'label',
    container: false,
    interactive: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Radio',
    defaultProps: { label: 'Monthly', name: 'plan', value: 'monthly', checked: false },
    defaultStyles: {
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
      fontFamily: 'var(--f-body)',
      fontSize: '14.5px',
      color: TEXT_COLOR,
      cursor: 'pointer',
    },
  },

  /**
   * A slider.
   *
   * Themed with `accent-color`, which is the whole of it: the alternative is
   * `appearance: none` plus a different vendor pseudo-element per browser for
   * the track and the thumb, and a control rebuilt that way stops being
   * keyboard-operable unless every part is rebuilt too.
   */
  range: {
    type: 'range',
    label: 'Slider',
    description: 'Pick a number by dragging.',
    category: 'forms',
    icon: 'range',
    tag: 'input',
    container: false,
    interactive: true,
    textual: false,
    void: true,
    resize: { x: true, y: false },
    defaultName: 'Slider',
    defaultProps: { name: 'amount', min: 0, max: 100, step: 1, value: 50 },
    defaultStyles: {
      width: '100%',
      accentColor: 'var(--c-primary)',
      cursor: 'pointer',
    },
  },

  file: {
    type: 'file',
    label: 'File upload',
    description: 'Choose a file to send with the form.',
    category: 'forms',
    icon: 'file',
    tag: 'input',
    container: false,
    interactive: true,
    textual: false,
    void: true,
    resize: { x: true, y: false },
    defaultName: 'File upload',
    defaultProps: { name: 'attachment', accept: '', multiple: false },
    defaultStyles: {
      width: '100%',
      fontFamily: 'var(--f-body)',
      fontSize: '14px',
      color: MUTED_COLOR,
      paddingTop: '10px',
      paddingBottom: '10px',
      paddingLeft: '12px',
      paddingRight: '12px',
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'dashed',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      cursor: 'pointer',
    },
  },

  /**
   * A progress bar.
   *
   * The reset strips the user-agent look so the two colours a progress bar
   * has become ordinary node styles: `background-color` is the track,
   * `color` is the fill. That is worth the four lines of reset — otherwise
   * the fill is only reachable through a vendor pseudo-element the inspector
   * has no way to address.
   */
  progress: {
    type: 'progress',
    label: 'Progress',
    description: 'How far through something is.',
    category: 'forms',
    icon: 'progress',
    tag: 'progress',
    container: false,
    textual: false,
    void: true,
    resize: { x: true, y: true },
    defaultName: 'Progress',
    defaultProps: { value: 60, max: 100, indeterminate: false },
    defaultStyles: {
      width: '100%',
      height: '8px',
      backgroundColor: 'var(--c-surface)',
      color: 'var(--c-primary)',
      borderTopLeftRadius: 'var(--r-full)',
      borderTopRightRadius: 'var(--r-full)',
      borderBottomRightRadius: 'var(--r-full)',
      borderBottomLeftRadius: 'var(--r-full)',
      overflow: 'hidden',
    },
  },

  /**
   * A named group of controls.
   *
   * The only way to tell a screen reader that four radios are one question:
   * without the `<legend>`, "Monthly" is announced with no idea what it is an
   * answer to.
   */
  fieldset: {
    type: 'fieldset',
    label: 'Field group',
    description: 'Names a set of controls that belong together.',
    category: 'forms',
    icon: 'fieldset',
    tag: 'fieldset',
    container: true,
    textual: false,
    resize: { x: true, y: false },
    defaultName: 'Field group',
    defaultProps: { legend: 'Options' },
    defaultStyles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      width: '100%',
      paddingTop: '14px',
      paddingRight: '16px',
      paddingBottom: '16px',
      paddingLeft: '16px',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
      fontFamily: 'var(--f-body)',
      fontSize: '13px',
      fontWeight: '580',
      color: TEXT_COLOR,
    },
  },

  textarea: {
    type: 'textarea',
    label: 'Text Area',
    description: 'Multi-line text field.',
    category: 'forms',
    icon: 'textarea',
    tag: 'textarea',
    container: false,
    interactive: true,
    textual: false,
    void: true,
    resize: { x: true, y: true },
    defaultName: 'Text Area',
    defaultProps: { placeholder: 'Tell us what you need…', name: 'message', rows: 4 },
    defaultStyles: {
      width: '100%',
      minHeight: '120px',
      paddingTop: '12px',
      paddingBottom: '12px',
      paddingLeft: '14px',
      paddingRight: '14px',
      fontFamily: 'var(--f-body)',
      fontSize: '15px',
      color: TEXT_COLOR,
      backgroundColor: 'var(--c-surface)',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderColor: 'var(--c-border)',
      borderTopLeftRadius: 'var(--r-md)',
      borderTopRightRadius: 'var(--r-md)',
      borderBottomRightRadius: 'var(--r-md)',
      borderBottomLeftRadius: 'var(--r-md)',
    },
  },

  /* --------------------------------------------------------- composition -- */
  instance: {
    type: 'instance',
    label: 'Component',
    description: 'An instance of a reusable component.',
    category: 'components',
    icon: 'component',
    tag: 'div',
    container: false,
    textual: false,
    resize: { x: true, y: true },
    defaultName: 'Component',
    defaultProps: { componentId: '' },
    defaultStyles: { display: 'contents' },
    internal: true,
  },
};

export function getElement(type: ElementType): ElementDefinition {
  return ELEMENTS[type] ?? ELEMENTS.frame;
}

/**
 * May a child of this type live inside a parent of that type?
 *
 * The one place the answer is decided, so drag-and-drop on the canvas, the
 * layer tree and the block linter cannot disagree. Both directions are
 * consulted: a `<table>` states what it takes, a `<td>` states where it can
 * go, and either alone would leave half the illegal pairs allowed.
 */
export function canContain(parentType: ElementType, childType: ElementType): boolean {
  const parent = getElement(parentType);
  if (!parent.container) return false;
  if (parent.allowedChildren && !parent.allowedChildren.includes(childType)) return false;
  const child = getElement(childType);
  if (child.allowedParents && !child.allowedParents.includes(parentType)) return false;
  /*
   * A link or a button may hold anything except another control.
   *
   * The same class of failure the table rules exist for, and just as invisible:
   * the parser does not reject a `<button>` inside an `<a>`, it re-parents it
   * out, so the canvas shows a button inside a link and the published page
   * shows them side by side with nothing reporting a problem.
   */
  if ((parentType === 'link' || parentType === 'button') && child.interactive) return false;
  return true;
}

/** Elements offered in the insert panel, grouped by category. */
export const INSERTABLE: ElementDefinition[] = Object.values(ELEMENTS).filter((e) => !e.internal);

/** Heading levels change the rendered tag; everything else uses `tag`. */
/**
 * Tags a layout box may take instead of `div`.
 *
 * Landmarks and list semantics are most of what a page needs to be navigable
 * with a screen reader, and they are a tag name away — a `nav` is a `div` that
 * announced itself. Allowlisted rather than free text: an arbitrary string here
 * reaches the published markup, and `<script>` is also a tag name.
 */
export const SEMANTIC_TAGS = [
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'figure',
  'figcaption',
  'blockquote',
  'ul',
  'ol',
  'li',
  'address',
] as const;

/** Which element types offer the choice. */
const RETAGGABLE = new Set<ElementType>(['frame', 'section', 'container', 'stack', 'grid']);

/**
 * Narrow a designer's string to something safe to put in markup and in a
 * selector.
 *
 * Switch keys and case values reach both — the attribute in the HTML and the
 * `[data-cre8-switch="…"]` in the generated stylesheet. A value containing a
 * quote would close the selector early and turn the rest of the rule into
 * something nobody wrote, so the allowlist is the whole defence rather than
 * escaping at each of the four places it lands.
 */
export function slug(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * The fragment a section answers to, from whatever the designer typed.
 *
 * Lowercase where `slug` preserves case, because this one ends up in the
 * address bar: `#Pricing` and `#pricing` are different fragments, and a
 * visitor who types the obvious one gets nothing. Case is the designer's
 * business in a state name and the visitor's business in a URL.
 *
 * Kept to what a fragment may hold with no escaping at all, so the same string
 * is safe as an `id`, as the tail of an `href` and inside `getElementById`.
 */
export function anchorId(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Split a link into where it goes and which part of it.
 *
 * Every resolver in the app has to do this now that a link can name a page
 * *and* a section of it — `page:<id>#faq` is one href with two answers in it,
 * and three separate places were about to learn the same trick. The fragment
 * comes back with its `#` so re-attaching is concatenation rather than another
 * conditional.
 */
export function splitFragment(href: string): [target: string, fragment: string] {
  const at = href.indexOf('#');
  return at === -1 ? [href, ''] : [href.slice(0, at), href.slice(at)];
}

/**
 * The design-time value that means "show every case at once".
 *
 * Not a case value — a case named `all` is an ordinary thing a filter has, so
 * the sentinel has to be something `slug` would never produce. Checked before
 * slugging, and it never reaches a published file because `switchDesign`
 * never does.
 */
export const SWITCH_SHOW_ALL = '*';

/**
 * The same, for a value that may name more than one case.
 *
 * A filter needs an "All" that shows everything, which means an item has to
 * be able to belong to two cases at once — its own and the catch-all. Spelled
 * as a space-separated list because that is what `[attr~="v"]` already
 * understands, in CSS and in `querySelector` alike.
 */
export function slugList(value: unknown): string {
  const seen: string[] = [];
  for (const part of String(value ?? '').split(/[\s,]+/)) {
    const one = slug(part);
    if (one && !seen.includes(one)) seen.push(one);
  }
  return seen.join(' ');
}

/* --------------------------------------------------------------------------
 * Visibility
 * ----------------------------------------------------------------------- */

/**
 * When an element is on screen — in the terms the rest of the app thinks in.
 *
 * Hiding is now just a rule like any other, and the generator needs to know
 * nothing else about it. But three things do still care specifically about
 * *being a case of a state*: the runtime pairs a tab to its panel, the layer
 * tree marks rows that are on another case, and selecting a node has to bring
 * its case forward. All three want the same four facts, so they are read out
 * of the rule in one place.
 *
 * Note the flip. A rule stores the literal — *when this, hide* — while this
 * reads as the intent, *shown when this*. `negated` therefore means the rule
 * said `is` and `!negated` means it said `isn't`.
 */
export interface Visibility {
  /** The state this depends on. Empty means the nearest one above. */
  state: string;
  /** The values it answers to. */
  values: string[];
  /** `isn't` rather than `is`. */
  negated: boolean;
  /** Hiding leaves the element's space behind instead of removing it. */
  keepSpace: boolean;
}

/** Whether a rule's changes amount to "not on screen". */
function hides(rule: StyleRule): boolean {
  return rule.apply.display === 'none' || rule.apply.visibility === 'hidden';
}

/**
 * The rule that makes a node a case of a state, or `null` when it has none.
 *
 * Deliberately narrow. A node can carry any number of rules and several of
 * them may hide it, but only one shape means *this element belongs to that
 * case*: a single state condition, hiding, at every width, on the element
 * itself. A hide that only applies on mobile is a responsive choice, and a
 * hide behind two conditions is not something a tab can be paired with — both
 * still work, they simply are not a case.
 *
 * The first match wins, which is also the one that migration produces, so a
 * document that came from the old props reads back exactly as it did before.
 */
export function readCase(rules: StyleRule[] | undefined): Visibility | null {
  for (const rule of rules ?? []) {
    if (rule.part || rule.breakpoint || rule.when.length !== 1 || !hides(rule)) continue;
    const condition = rule.when[0]!;
    if (condition.kind !== 'state' || condition.values.length === 0) continue;
    return {
      state: condition.key,
      values: condition.values,
      negated: condition.op === 'is',
      keepSpace: rule.apply.display !== 'none',
    };
  }
  return null;
}

/**
 * The same reading, from the props it used to live in.
 *
 * Only `migrate.ts` calls this. It exists because documents saved before the
 * rule model still say `whenIs` and `switchCase`, and it should acquire no
 * other callers — anything asking "is this a case" wants `readCase`.
 */
export function readLegacyVisibility(props: NodeProps): Visibility | null {
  const raw = props.whenIs ?? props.switchCase;
  const values = slugList(raw);
  if (!values) return null;
  return {
    state: slug(props.whenState),
    values: values.split(' '),
    negated: Boolean(props.whenNot),
    keepSpace: props.hideMode === 'keep',
  };
}

/**
 * @param opts `opensPopover` cannot be read off props any more: what a button
 *   opens is a `Ref`, and props hold primitives. The caller that knows passes
 *   it; the two that call this for a heading or a plain container do not care.
 */
export function resolveTag(
  type: ElementType,
  props: NodeProps,
  opts: { opensPopover?: boolean } = {}
): string {
  if (type === 'heading') {
    const level = Number(props.level ?? 2);
    return `h${Math.min(6, Math.max(1, Number.isFinite(level) ? level : 2))}`;
  }
  if (type === 'button' || type === 'link') {
    // A popover invoker has to be a `<button>` — `popovertarget` does nothing
    // on an anchor — so opening a panel and going somewhere are exclusive.
    // A switch setter is a button for a plainer reason: it does not navigate,
    // and an anchor that goes nowhere is a link a screen reader announces and
    // a keyboard user follows into nothing. Submitting is the same story: no
    // element but `<button>` submits a form.
    return props.href && !opts.opensPopover && !props.switchSet && !props.submit
      ? 'a'
      : 'button';
  }
  if (type === 'tableCell') return props.header ? 'th' : 'td';
  if (RETAGGABLE.has(type)) {
    const requested = String(props.tag ?? '');
    if ((SEMANTIC_TAGS as readonly string[]).includes(requested)) return requested;
  }
  return getElement(type).tag;
}
