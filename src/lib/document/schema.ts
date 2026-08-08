/**
 * Element registry.
 *
 * Every element in Cre8 is described here rather than implemented as its own
 * bespoke component. The renderer, the insert panel, the layer tree, the
 * inspector and the static publisher all read from this one table, so adding
 * an element type means adding a row — not touching six subsystems.
 */

import type { ElementType, NodeProps, StyleDecl } from './types';

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
    container: false,
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
    container: false,
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

  select: {
    type: 'select',
    label: 'Select',
    description: 'Native dropdown of options.',
    category: 'forms',
    icon: 'select',
    tag: 'select',
    container: false,
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

  textarea: {
    type: 'textarea',
    label: 'Text Area',
    description: 'Multi-line text field.',
    category: 'forms',
    icon: 'textarea',
    tag: 'textarea',
    container: false,
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

/** Elements offered in the insert panel, grouped by category. */
export const INSERTABLE: ElementDefinition[] = Object.values(ELEMENTS).filter((e) => !e.internal);

/** Heading levels change the rendered tag; everything else uses `tag`. */
export function resolveTag(type: ElementType, props: NodeProps): string {
  if (type === 'heading') {
    const level = Number(props.level ?? 2);
    return `h${Math.min(6, Math.max(1, Number.isFinite(level) ? level : 2))}`;
  }
  if (type === 'button' || type === 'link') {
    return props.href ? 'a' : 'button';
  }
  return getElement(type).tag;
}
