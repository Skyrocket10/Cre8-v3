/**
 * The single source of truth for "what HTML does this node become".
 *
 * Both renderers consume this: the React one that draws the canvas and the
 * preview, and the string one that writes published files. Keeping the mapping
 * in one framework-free function is what makes
 * `editor === preview === published` a structural guarantee rather than a
 * promise someone has to keep re-checking.
 */

import { resolveTag } from '../document/schema';
import type { Cre8Document, SceneNode } from '../document/types';
import { nodeClass } from './css';
import { iconMarkup } from './icons';

export type RenderMode = 'edit' | 'preview' | 'publish';

export interface RenderOptions {
  mode: RenderMode;
  /** Maps an internal page reference (`page:<id>`) to a real URL. */
  hrefResolver?: (href: string) => string;
}

export type AttrValue = string | number | boolean | undefined;

export interface ElementModel {
  tag: string;
  attrs: Record<string, AttrValue>;
  /** Plain text content; mutually exclusive with `html` and children. */
  text?: string;
  /** Trusted markup (rich text, icon geometry). */
  html?: string;
  /** Never receives children or a closing tag. */
  void: boolean;
  /** Whether child nodes should be rendered inside this element. */
  acceptsChildren: boolean;
  /** Editor-only: this element has directly editable text. */
  editableProp?: string;
}

/** Internal page links are stored as `page:<id>` so renaming a page can't break them. */
export const PAGE_HREF_PREFIX = 'page:';

export function resolveHref(doc: Cre8Document, href: string | undefined, mode: RenderMode): string {
  if (!href) return mode === 'publish' ? '#' : '#';
  if (!href.startsWith(PAGE_HREF_PREFIX)) return href;

  const pageId = href.slice(PAGE_HREF_PREFIX.length);
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return '#';
  if (page.isHome || page.slug === '') return mode === 'publish' ? '/' : '#';
  return mode === 'publish' ? `/${page.slug}` : '#';
}

function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function describeElement(
  node: SceneNode,
  doc: Cre8Document,
  options: RenderOptions
): ElementModel {
  const { mode } = options;
  const props = node.props;
  const base: Record<string, AttrValue> = { class: nodeClass(node.id) };

  switch (node.type) {
    case 'heading':
      return {
        tag: resolveTag('heading', props),
        attrs: base,
        text: str(props.text),
        void: false,
        acceptsChildren: false,
        editableProp: 'text',
      };

    case 'paragraph':
    case 'text':
      return {
        tag: node.type === 'paragraph' ? 'p' : 'span',
        attrs: base,
        text: str(props.text),
        void: false,
        acceptsChildren: false,
        editableProp: 'text',
      };

    case 'richtext':
      return {
        tag: 'div',
        attrs: base,
        html: str(props.html),
        void: false,
        acceptsChildren: false,
      };

    case 'image': {
      const src = str(props.src);
      if (!src) {
        // A placeholder rather than a broken image: the canvas should never
        // show a layout that the finished page won't reproduce.
        return {
          tag: 'div',
          attrs: { ...base, 'data-cre8-placeholder': true },
          text: 'Image',
          void: false,
          acceptsChildren: false,
        };
      }
      return {
        tag: 'img',
        attrs: {
          ...base,
          src,
          alt: str(props.alt),
          loading: props.priority ? undefined : 'lazy',
          decoding: 'async',
          width: props.width ? Number(props.width) : undefined,
          height: props.height ? Number(props.height) : undefined,
        },
        void: true,
        acceptsChildren: false,
      };
    }

    case 'video': {
      const src = str(props.src);
      if (!src) {
        return {
          tag: 'div',
          attrs: { ...base, 'data-cre8-placeholder': true },
          text: 'Video',
          void: false,
          acceptsChildren: false,
        };
      }
      // Autoplay is suppressed in the editor so the canvas stays calm.
      const autoplay = Boolean(props.autoplay) && mode !== 'edit';
      return {
        tag: 'video',
        attrs: {
          ...base,
          src,
          poster: str(props.poster) || undefined,
          controls: Boolean(props.controls) || undefined,
          autoplay: autoplay || undefined,
          loop: Boolean(props.loop) || undefined,
          muted: Boolean(props.muted) || undefined,
          playsinline: true,
        },
        void: true,
        acceptsChildren: false,
      };
    }

    case 'icon': {
      const name = str(props.name, 'sparkles');
      const strokeWidth = Number(props.strokeWidth ?? 1.75);
      return {
        tag: 'svg',
        attrs: {
          ...base,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': Number.isFinite(strokeWidth) ? strokeWidth : 1.75,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        },
        html: iconMarkup(name),
        void: false,
        acceptsChildren: false,
      };
    }

    case 'button':
    case 'link': {
      const rawHref = str(props.href);
      const tag = resolveTag(node.type, props);
      const target = str(props.target, '_self');
      const attrs: Record<string, AttrValue> = { ...base };
      if (tag === 'a') {
        attrs.href = options.hrefResolver
          ? options.hrefResolver(rawHref)
          : resolveHref(doc, rawHref, mode);
        if (target && target !== '_self') {
          attrs.target = target;
          attrs.rel = 'noopener noreferrer';
        }
      } else {
        attrs.type = 'button';
      }
      const textProp = node.type === 'button' ? 'label' : 'text';
      return {
        tag,
        attrs,
        text: str(props[textProp]),
        void: false,
        acceptsChildren: false,
        editableProp: textProp,
      };
    }

    case 'input':
      return {
        tag: 'input',
        attrs: {
          ...base,
          type: str(props.inputType, 'text'),
          name: str(props.name) || undefined,
          placeholder: str(props.placeholder) || undefined,
          required: Boolean(props.required) || undefined,
          // A live text field inside the canvas would steal the caret.
          readonly: mode === 'edit' ? true : undefined,
          tabindex: mode === 'edit' ? -1 : undefined,
        },
        void: true,
        acceptsChildren: false,
      };

    case 'textarea':
      return {
        tag: 'textarea',
        attrs: {
          ...base,
          name: str(props.name) || undefined,
          placeholder: str(props.placeholder) || undefined,
          rows: props.rows ? Number(props.rows) : undefined,
          readonly: mode === 'edit' ? true : undefined,
          tabindex: mode === 'edit' ? -1 : undefined,
        },
        void: true,
        acceptsChildren: false,
      };

    case 'form':
      return {
        tag: 'form',
        attrs: {
          ...base,
          action: str(props.action) || undefined,
          method: str(props.method, 'post'),
          // Submitting from the canvas would navigate away from the editor.
          onsubmit: mode === 'edit' ? 'return false' : undefined,
        },
        void: false,
        acceptsChildren: true,
      };

    case 'divider':
    case 'spacer':
      return {
        tag: 'div',
        attrs: { ...base, 'aria-hidden': 'true' },
        void: true,
        acceptsChildren: false,
      };

    case 'page':
      return {
        tag: 'div',
        attrs: { ...base, 'data-cre8-root': true },
        void: false,
        acceptsChildren: true,
      };

    default: {
      // Every remaining type is a plain container: frame, section, container,
      // stack, grid, navigation.
      const tag = resolveTag(node.type, props);
      return { tag, attrs: base, void: false, acceptsChildren: true };
    }
  }
}

/** Attribute name differences between the DOM and React. */
const REACT_ATTR_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  readonly: 'readOnly',
  tabindex: 'tabIndex',
  playsinline: 'playsInline',
  autoplay: 'autoPlay',
  onsubmit: 'onSubmit',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

export function toReactAttrs(attrs: Record<string, AttrValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'onsubmit') {
      out.onSubmit = (e: { preventDefault: () => void }) => e.preventDefault();
      continue;
    }
    out[REACT_ATTR_MAP[key] ?? key] = value;
  }
  return out;
}
