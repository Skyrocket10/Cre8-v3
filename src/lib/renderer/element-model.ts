/**
 * The single source of truth for "what HTML does this node become".
 *
 * Both renderers consume this: the React one that draws the canvas and the
 * preview, and the string one that writes published files. Keeping the mapping
 * in one framework-free function is what makes
 * `editor === preview === published` a structural guarantee rather than a
 * promise someone has to keep re-checking.
 */

import { SWITCH_SHOW_ALL, resolveTag, slug, slugList } from '../document/schema';
import type { Cre8Document, SceneNode } from '../document/types';
import { nodeClass } from './css';
import { iconMarkup } from './icons';
import {
  CASE_ATTR,
  QUIET_ATTR,
  SET_ATTR,
  SWITCH_ATTR,
  TABS_ATTR,
  VALUE_ATTR,
} from '../runtime/behaviour';

export type RenderMode = 'edit' | 'preview' | 'publish';

export interface RenderOptions {
  mode: RenderMode;
  /** Maps an internal page reference (`page:<id>`) to a real URL. */
  hrefResolver?: (href: string) => string;
  /**
   * Where a form with no action of its own should post.
   *
   * Only the publisher knows this — it is an absolute URL containing the
   * project id — so the renderer asks rather than guesses. A form left
   * unresolved keeps no action at all, which posts back to its own page and
   * does nothing, rather than silently posting somewhere wrong.
   */
  formAction?: (formId: string) => string;
}

export type AttrValue = string | number | boolean | undefined;

/**
 * Escape text that is about to become markup.
 *
 * `ElementModel.html` is documented as trusted, and for icon geometry it is.
 * Option labels and checkbox text are not — they are whatever somebody typed
 * into the inspector, and they reach both the canvas (via
 * `dangerouslySetInnerHTML`) and the published file.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ElementModel {
  tag: string;
  attrs: Record<string, AttrValue>;
  /** Plain text content; mutually exclusive with `html` and children. */
  text?: string;
  /** Trusted markup (rich text, icon geometry). */
  html?: string;
  /**
   * A first child the element owns rather than the document.
   *
   * `<details>` is meaningless without a `<summary>`, and it has to come
   * before the panel content — but the panel content is the node's real
   * children. Modelling the summary as data the element emits keeps it out of
   * the layer tree, where it would be a node a designer could delete and
   * break the disclosure.
   */
  lead?: { tag: string; text: string };
  /**
   * A tag the element's children are nested inside.
   *
   * `<table>` needs it. Rows written directly inside a table are conforming
   * markup, but the parser inserts a `<tbody>` around them anyway, so the DOM
   * a browser builds never matches the DOM React was told to build — React
   * says so, loudly, and any code walking the published tree finds a level
   * that isn't in the document. Emitting the wrapper ourselves makes the two
   * agree, and keeps `<tbody>` out of the layer tree where it would be a node
   * a designer could delete.
   */
  wrapChildren?: string;
  /** Never receives children or a closing tag. */
  void: boolean;
  /** Whether child nodes should be rendered inside this element. */
  acceptsChildren: boolean;
  /** Editor-only: this element has directly editable text. */
  editableProp?: string;
}

/** Internal page links are stored as `page:<id>` so renaming a page can't break them. */
export const PAGE_HREF_PREFIX = 'page:';

/**
 * The DOM id a popover answers to.
 *
 * Nodes are otherwise addressed by class, because a class cannot collide with
 * anything a designer typed into `customHead`. A popover needs a real id —
 * `popovertarget` takes nothing else — so it gets one, prefixed the same way
 * the class is so it stays a valid identifier whatever the node id looks like.
 */
export function popoverDomId(nodeId: string): string {
  return `p-${nodeId}`;
}

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

/**
 * Switch wiring, which every element type can carry.
 *
 * Bolted on after the per-type description rather than repeated inside it:
 * any node can be a group, a setter or a case, and threading three attributes
 * through thirty switch arms is how one of them ends up missing.
 */
function applySwitch(model: ElementModel, node: SceneNode, mode: RenderMode): ElementModel {
  const props = node.props;
  const key = slug(props.switchKey);
  const set = slug(props.switchSet);
  const kase = slugList(props.switchCase);
  if (!key && !set && !kase) return model;

  if (key) {
    const showAll = mode === 'edit' && props.switchDesign === SWITCH_SHOW_ALL;
    if (showAll) {
      // Every case at once, for laying them out side by side. Done by
      // *renaming* the attribute rather than by overriding `display`: the
      // hiding rule is anchored on `[data-cre8-switch="…"]`, so a group that
      // does not carry it matches nothing and each case renders with its own
      // styles untouched. An override would have had to guess what `display`
      // to put back, and guessed wrong for anything that is not a flex box.
      model.attrs['data-cre8-switch-all'] = key;
    } else {
      model.attrs[SWITCH_ATTR] = key;
      // `switchDesign` is which case the designer is looking at; it never
      // reaches a published file, so choosing one to style cannot change what
      // visitors see first.
      const design = mode === 'edit' ? slug(props.switchDesign) : '';
      model.attrs[VALUE_ATTR] = design || slug(props.switchDefault);
      if (props.switchRole === 'tabs') model.attrs[TABS_ATTR] = 'true';
    }
  }
  if (set) {
    model.attrs[SET_ATTR] = set;
    // A control that moves a stepper on is not a toggle, and announcing it as
    // one ("Next, toggle button, not pressed") is worse than saying nothing.
    if (props.switchQuiet) model.attrs[QUIET_ATTR] = 'true';
  }
  if (kase) model.attrs[CASE_ATTR] = kase;
  return model;
}

export function describeElement(
  node: SceneNode,
  doc: Cre8Document,
  options: RenderOptions
): ElementModel {
  return applySwitch(describeBase(node, doc, options), node, options.mode);
}

function describeBase(
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
      // Opening a popover is the browser's job, not a script's: name the panel
      // and it handles the top layer, light dismiss, Escape and focus return.
      const popoverTarget = str(props.popoverTarget);
      if (popoverTarget && tag === 'button') {
        attrs.popovertarget = popoverDomId(popoverTarget);
        const action = str(props.popoverAction, 'toggle');
        if (action !== 'toggle') attrs.popovertargetaction = action;
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

    case 'popover':
    case 'dialog': {
      // Design time and published deliberately differ here, for the same
      // reason `<details>` does: a `[popover]` is `display: none` until it is
      // shown, and contents nobody can see are contents nobody can edit. The
      // canvas therefore drops the attribute and draws the panel in place —
      // still fixed and centred, because that positioning is the node's own
      // style rather than something the renderer invents per surface.
      const showWhileEditing = props.showWhileEditing !== false;
      const live = mode !== 'edit' || !showWhileEditing;
      const isDialog = node.type === 'dialog';
      return {
        // A real `<dialog>`, opened through the popover attribute rather than
        // `showModal()`. That keeps the page scriptless and still buys the
        // element's implicit role, so the thing is announced as a dialog
        // instead of as an anonymous box.
        tag: isDialog ? 'dialog' : 'div',
        attrs: {
          ...base,
          id: popoverDomId(node.id),
          popover: live ? str(props.popoverMode, 'auto') : undefined,
          // A dialog with no name is announced as "dialog" and nothing else.
          'aria-label': isDialog ? str(props.label) || undefined : undefined,
        },
        void: false,
        acceptsChildren: true,
      };
    }

    case 'table': {
      const caption = str(props.caption).trim();
      return {
        tag: 'table',
        attrs: base,
        ...(caption ? { lead: { tag: 'caption', text: caption } } : {}),
        wrapChildren: 'tbody',
        void: false,
        acceptsChildren: true,
      };
    }

    case 'tableRow':
      return { tag: 'tr', attrs: base, void: false, acceptsChildren: true };

    case 'tableCell': {
      const header = Boolean(props.header);
      const colSpan = Number(props.colSpan ?? 0);
      const rowSpan = Number(props.rowSpan ?? 0);
      return {
        tag: header ? 'th' : 'td',
        attrs: {
          ...base,
          // Without a scope a header cell is a bold word: the association
          // between it and the cells it describes is what a screen reader
          // reads out when it lands three rows down.
          scope: header ? str(props.scope, 'col') : undefined,
          colspan: colSpan > 1 ? colSpan : undefined,
          rowspan: rowSpan > 1 ? rowSpan : undefined,
        },
        void: false,
        acceptsChildren: true,
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

    case 'form': {
      // An action the designer typed always wins; otherwise the publisher
      // supplies one so the form reaches this project's submissions.
      const own = str(props.action);
      const action = own || options.formAction?.(str(props.formId) || node.id) || undefined;
      return {
        tag: 'form',
        attrs: {
          ...base,
          action,
          method: str(props.method, 'post'),
          // Submitting from the canvas would navigate away from the editor.
          onsubmit: mode === 'edit' ? 'return false' : undefined,
        },
        void: false,
        acceptsChildren: true,
      };
    }

    case 'details':
      return {
        tag: 'details',
        attrs: {
          ...base,
          // Forced open on the canvas. A closed disclosure hides its own
          // children, and children that cannot be seen cannot be edited —
          // the design-time state and the published state are allowed to
          // differ here precisely so the two stay editable.
          open: mode === 'edit' ? true : Boolean(props.open) || undefined,
        },
        lead: { tag: 'summary', text: str(props.summary, 'Details') },
        void: false,
        acceptsChildren: true,
      };

    case 'select': {
      const options = str(props.options)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const placeholder = str(props.placeholder);
      return {
        tag: 'select',
        attrs: { ...base, name: str(props.name) || undefined },
        // Escaped here rather than trusted: unlike icon geometry, these are
        // words somebody typed into the inspector.
        html:
          (placeholder ? `<option value="" disabled selected>${esc(placeholder)}</option>` : '') +
          options.map((option) => `<option>${esc(option)}</option>`).join(''),
        void: false,
        acceptsChildren: false,
      };
    }

    case 'checkbox':
    case 'radio': {
      // One insertable thing rather than a box the designer has to pair with a
      // text node: wrapping both in the `<label>` is what makes the words a hit
      // target, and getting that wrong is invisible until someone tries to tap
      // it on a phone.
      const inputType = node.type === 'checkbox' ? 'checkbox' : 'radio';
      const attrsList = [
        `type="${inputType}"`,
        str(props.name) ? `name="${esc(str(props.name))}"` : '',
        str(props.value) ? `value="${esc(str(props.value))}"` : '',
        props.checked ? 'checked' : '',
      ].filter(Boolean);
      return {
        tag: 'label',
        attrs: base,
        html: `<input ${attrsList.join(' ')}><span>${esc(str(props.label, ''))}</span>`,
        void: false,
        acceptsChildren: false,
      };
    }

    case 'range': {
      const num = (key: string, fallback: number): number => {
        const value = Number(props[key]);
        return Number.isFinite(value) ? value : fallback;
      };
      return {
        tag: 'input',
        attrs: {
          ...base,
          type: 'range',
          name: str(props.name) || undefined,
          min: num('min', 0),
          max: num('max', 100),
          step: num('step', 1),
          value: num('value', 50),
          // A slider jumps to wherever it is pressed, so a click meant to
          // select the node would also change its value — and then lose the
          // change on the next render, because the document never heard about
          // it. Cancelling the default leaves the click to the canvas.
          onpointerdown: mode === 'edit' ? 'cancel' : undefined,
          tabindex: mode === 'edit' ? -1 : undefined,
        },
        void: true,
        acceptsChildren: false,
      };
    }

    case 'file':
      return {
        tag: 'input',
        attrs: {
          ...base,
          type: 'file',
          name: str(props.name) || undefined,
          accept: str(props.accept) || undefined,
          multiple: Boolean(props.multiple) || undefined,
          required: Boolean(props.required) || undefined,
          // Otherwise selecting the field on the canvas opens the operating
          // system's file picker over the editor.
          onclick: mode === 'edit' ? 'cancel' : undefined,
          tabindex: mode === 'edit' ? -1 : undefined,
        },
        void: true,
        acceptsChildren: false,
      };

    case 'progress': {
      const max = Number(props.max);
      const value = Number(props.value);
      return {
        tag: 'progress',
        attrs: {
          ...base,
          // No `value` at all is what makes a progress bar indeterminate;
          // there is no attribute that says so.
          value: props.indeterminate ? undefined : Number.isFinite(value) ? value : 0,
          max: Number.isFinite(max) ? max : 100,
        },
        void: true,
        acceptsChildren: false,
      };
    }

    case 'fieldset':
      return {
        tag: 'fieldset',
        attrs: base,
        lead: { tag: 'legend', text: str(props.legend, 'Options') },
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
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  popovertarget: 'popoverTarget',
  popovertargetaction: 'popoverTargetAction',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

/**
 * Handlers the canvas needs so a live control does not act on a click that was
 * meant to select it.
 *
 * Written as attributes rather than as React props so `describeElement` stays
 * framework-free — the string renderer never sees them, because they are only
 * ever set in edit mode. Each cancels the default and nothing else: the event
 * still reaches the canvas, which is what does the selecting.
 */
const CANCEL_HANDLERS: Record<string, string> = {
  onsubmit: 'onSubmit',
  onclick: 'onClick',
  onpointerdown: 'onPointerDown',
};

/**
 * Form controls whose `value` React reads as a controlled binding.
 *
 * `<input value>` without an `onChange` makes React declare the field
 * read-only and warn about it. The document is the source of truth and the
 * canvas is not a form, so the value is an initial one — which is exactly
 * what `defaultValue` means. `<progress value>` is not a form control and
 * keeps the plain attribute.
 */
const CONTROLLED_TAGS = new Set(['input', 'textarea', 'select']);

export function toReactAttrs(
  attrs: Record<string, AttrValue>,
  tag?: string
): Record<string, unknown> {
  const controlled = tag !== undefined && CONTROLLED_TAGS.has(tag);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    const handler = CANCEL_HANDLERS[key];
    if (handler) {
      out[handler] = (e: { preventDefault: () => void }) => e.preventDefault();
      continue;
    }
    if (controlled && (key === 'value' || key === 'checked')) {
      out[key === 'value' ? 'defaultValue' : 'defaultChecked'] = value;
      continue;
    }
    out[REACT_ATTR_MAP[key] ?? key] = value;
  }
  return out;
}
