/**
 * The single source of truth for "what HTML does this node become".
 *
 * Both renderers consume this: the React one that draws the canvas and the
 * preview, and the string one that writes published files. Keeping the mapping
 * in one framework-free function is what makes
 * `editor === preview === published` a structural guarantee rather than a
 * promise someone has to keep re-checking.
 */

import { SWITCH_SHOW_ALL, anchorId, resolveTag, slug, splitFragment } from '../document/schema';
import {
  BREAKPOINT_DEFS,
  type CollectionRecord,
  type Cre8Document,
  type NodeProps,
  type SceneNode,
} from '../document/types';
import { needsRuntime, publishedValues, stateFrom } from './test';
import { varsFor } from './values';
import { caseOf, variantsOf, type Variant } from './variants';
import { iconMarkup } from './icons';
import {
  CASE_ATTR,
  DRIVE_ATTR,
  ELSE_ATTR,
  NOT_ATTR,
  QUIET_ATTR,
  RANGE_ATTR,
  RANGE_VAR_PREFIX,
  SET_ATTR,
  SWITCH_ATTR,
  TABS_ATTR,
  TEST_ATTR,
  VALUES_ATTR,
  VALUE_ATTR,
} from '../runtime/behaviour';

export type RenderMode = 'edit' | 'preview' | 'publish';

export interface RenderOptions {
  mode: RenderMode;
  /** Maps an internal page reference (`page:<id>`) to a real URL. */
  hrefResolver?: (href: string, record: CollectionRecord | null) => string;
  /**
   * The record in scope, for links that only mean something with one.
   *
   * A card inside a repeater that links to "the Post page" means *its* post,
   * and the resolver cannot know which without being told.
   */
  record?: CollectionRecord | null;
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

/**
 * The name that ties a panel to the thing that opens it.
 *
 * Named after the **panel**, on both elements, and that is the load-bearing
 * choice rather than an arbitrary one. The button knows its target, so it can
 * mint this; the panel knows itself, so it can mint the same string — and
 * neither has to look the other up. The canvas renderer is deliberately handed
 * an empty document and memoised per node, so a lookup in either direction
 * would work in the publisher and return nothing on the canvas, which is the
 * class of bug that puts a menu in the right place in the file and the wrong
 * place in the editor.
 *
 * Two buttons pointing at one panel both claim the name. CSS resolves that to
 * the last in tree order, so the panel follows the lower button — worth
 * knowing, not worth forbidding: a panel with two invokers has to pick one.
 */
export function anchorNameFor(panelNodeId: string): string {
  return `--cre8-a-${panelNodeId}`;
}

/**
 * Marks a panel whose position depends on `position-area` resolving.
 *
 * The reset uses it for the one rule that cannot be expressed on the node: in
 * a browser without anchor positioning, `position-area` is dropped and a fixed
 * panel with `inset: auto` lands wherever its static position happens to be.
 * `@supports not` turns those panels into a sheet under the top edge instead —
 * the same shape the mobile menu already uses, which is a menu rather than an
 * accident.
 */
export const ANCHORED_ATTR = 'data-cre8-anchor';

export function resolveHref(doc: Cre8Document, href: string | undefined, mode: RenderMode): string {
  if (!href) return mode === 'publish' ? '#' : '#';
  // A fragment on its own is a scroll on this page and needs no resolving.
  const [target, fragment] = splitFragment(href);
  if (!target.startsWith(PAGE_HREF_PREFIX)) return href;

  const pageId = target.slice(PAGE_HREF_PREFIX.length);
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return '#';
  // The editor does not navigate, so a page link is inert there — but the
  // fragment still names something on the page being drawn when the link
  // points at that page, and dropping it would make the canvas disagree with
  // the file about where the link goes.
  if (page.isHome || page.slug === '') return mode === 'publish' ? `/${fragment}` : fragment || '#';
  return mode === 'publish' ? `/${page.slug}${fragment}` : fragment || '#';
}

function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

/**
 * How wide the image will actually be laid out, as a media list.
 *
 * `srcset` is only half the mechanism: it tells the browser which files exist,
 * and `sizes` tells it how much room the image will occupy — which it has to
 * know *before* the stylesheet has been applied, so it cannot simply measure.
 * Get it wrong and the browser confidently fetches the wrong file.
 *
 * The document already holds the answer for the common case. A node with a
 * fixed pixel width, and different fixed widths at narrower breakpoints, is
 * exactly the media list `sizes` takes, so it is written out directly.
 *
 * Everything else — a percentage, a flex child, anything the cascade decides —
 * gets `auto`, which asks the browser to use the size it eventually lays out.
 * Where that is unsupported it falls back to `100vw`: over-fetching on a
 * narrow image, never under-fetching on a wide one. `auto` also requires
 * `loading="lazy"`, so an eager image takes the honest guess instead.
 */
function sizesFor(node: SceneNode, priority: boolean): string {
  const fixed = (value: unknown): string | null => {
    const raw = typeof value === 'string' ? value.trim() : '';
    return /^\d+(\.\d+)?px$/.test(raw) ? raw : null;
  };

  const desktop = fixed(node.styles.desktop?.width);
  if (!desktop) return priority ? '100vw' : 'auto';

  // Narrow first, because `sizes` takes the first condition that matches and a
  // mobile width would otherwise never be reached.
  const parts: string[] = [];
  for (const bp of ['mobile', 'tablet'] as const) {
    const width = fixed(node.styles[bp]?.width);
    const max = BREAKPOINT_DEFS[bp].maxWidth;
    if (width && max) parts.push(`(max-width: ${max}px) ${width}`);
  }
  parts.push(desktop);
  return parts.join(', ');
}

/**
 * Switch wiring, which every element type can carry.
 *
 * Bolted on after the per-type description rather than repeated inside it:
 * any node can be a group, a setter or a case, and threading three attributes
 * through thirty switch arms is how one of them ends up missing.
 */
function applySwitch(
  model: ElementModel,
  node: SceneNode,
  variant: Variant,
  options: RenderOptions
): ElementModel {
  const mode = options.mode;
  const props = node.props;
  const key = slug(props.switchKey);
  const set = slug(props.switchSet);
  // Hiding is the stylesheet's job — these attributes exist so the *runtime*
  // can tell a tab's panel from a price that happens to answer to the same
  // value, which it cannot read out of a rule.
  const when = caseOf(node, variant);
  if (!key && !set && !when) return model;

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
      /*
       * Then whatever the node's Tests decide, and only then the declared
       * default. Folding happens here rather than in the publisher because
       * there are three surfaces and only one of them has a publish step: the
       * canvas draws against the record being designed against, and it has to
       * reach the same answer by the same function or "editor ≈ preview ≈
       * published" stops being true the moment a Test exists.
       *
       * The default is the fallback the execution model requires, and it was
       * already here doing that job — it is what ships in the file and what a
       * visitor sees for ever with no scripting.
       */
      const assigned = stateFrom(node, options.record ?? null);
      const settled = assigned || slug(props.switchDefault);
      model.attrs[VALUE_ATTR] = design || settled;

      /*
       * And, when something on this node cannot be answered until somebody
       * types: a pointer into the page's shared Test table, the raw values
       * this instance's Tests read, and the answer to fall back to.
       *
       * `settled` is that fallback, and it is everything that *was* knowable —
       * a record rule that folded still counts. So a visitor with no scripting
       * gets the publish-time answer rather than the designer's default, and
       * the runtime restores exactly that when no live Test holds.
       */
      if (needsRuntime(node)) {
        model.attrs[TEST_ATTR] = node.id;
        model.attrs[ELSE_ATTR] = settled;
        const values = publishedValues(node, options.record ?? null);
        if (values) model.attrs[VALUES_ATTR] = JSON.stringify(values);
      }
      if (props.switchRole === 'tabs') model.attrs[TABS_ATTR] = 'true';
    }
  }
  if (set) {
    model.attrs[SET_ATTR] = set;
    // A control that moves a stepper on is not a toggle, and announcing it as
    // one ("Next, toggle button, not pressed") is worse than saying nothing.
    if (props.switchQuiet) model.attrs[QUIET_ATTR] = 'true';
  }
  /*
   * Only a condition on the *nearest* state gets an attribute, and only these
   * two, because between them they are all the runtime reads: which value an
   * element answers to, and whether it answers by appearing or by disappearing.
   *
   * A condition that names a state explicitly reaches past the group it sits
   * inside — a card in a filtered grid keyed on the section's billing switch.
   * Announcing that as a case of the enclosing group is not merely redundant,
   * it is wrong: a tab set pairs the first case holding a tab's value, and it
   * would happily adopt an element that answers to a different state entirely.
   * Hiding it is the stylesheet's job either way, so it says nothing.
   *
   * Two attributes used to be written here that nothing ever read — the state's
   * name, and whether hiding keeps the element's space. Both are decided
   * entirely in CSS. They cost bytes on every conditional element and, worse,
   * read as load-bearing.
   */
  if (when && !when.state) {
    model.attrs[CASE_ATTR] = when.values.join(' ');
    if (when.negated) model.attrs[NOT_ATTR] = 'true';
  }
  return model;
}

/**
 * @param variant Which of the node's elements to describe. Omitted means the
 *   node renders as one element, which is the usual case.
 */
export function describeElement(
  node: SceneNode,
  doc: Cre8Document,
  options: RenderOptions,
  variant: Variant = variantsOf(node)[0]!
): ElementModel {
  return applyVars(
    applyRange(
      applySwitch(describeBase(node, variant, doc, options), node, variant, options),
      node
    ),
    node,
    options.record ?? null
  );
}

/**
 * Continuous values: the group that holds one, and the control that moves it.
 *
 * Two attributes and an inline custom property, which between them are the
 * whole feature on the markup side. Everything visible is done by rules the
 * designer wrote against `var(--cre8-<key>)`; see `runtime/behaviour.ts` for
 * why the number is unscaled and why the control is a native range.
 *
 * The number appears twice — as the group's custom property and as the driving
 * slider's `value` — because with no script running those are two different
 * elements that both have to be right: the page shows the split the designer
 * chose *and* the handle sits on it.
 *
 * Nothing is looked up here to make that true, and that is deliberate. The
 * canvas hands this function an empty document on purpose — the element model
 * is memoised per node, and depending on the real one would invalidate every
 * memo on every edit — so a walk up the tree finds nothing on one surface and
 * the right answer on the other. It was written that way first, and the canvas
 * went white.
 *
 * So the two are kept in step in the *document* instead, by `setRangeValue`,
 * and a static check asserts they agree for every block in the registry. A
 * disagreement fails the build rather than shipping a handle in the wrong
 * place.
 */
function applyRange(model: ElementModel, node: SceneNode): ElementModel {
  const key = slug(node.props.rangeKey);
  if (key) {
    const value = Number(node.props.rangeValue);
    model.attrs[RANGE_ATTR] = key;
    model.attrs.style = mergeStyle(
      model.attrs.style,
      `${RANGE_VAR_PREFIX}${key}:${Number.isFinite(value) ? value : 50}`
    );
  }

  const drives = slug(node.props.drives);
  if (drives && node.type === 'range') model.attrs[DRIVE_ATTR] = drives;
  return model;
}

/**
 * Numbers from the record, as custom properties on this element.
 *
 * The same shape `applyRange` writes above, from a record instead of a
 * control — which is the point: the drawing is already done by rules the
 * designer wrote against `var(--cre8-…)`, and neither the generator nor the
 * runtime learns anything. One rule, a number per row.
 */
function applyVars(
  model: ElementModel,
  node: SceneNode,
  record: CollectionRecord | null
): ElementModel {
  if (!node.vars) return model;
  for (const [property, value] of Object.entries(varsFor(node, record))) {
    model.attrs.style = mergeStyle(model.attrs.style, `${property}:${value}`);
  }
  return model;
}

/** Inline declarations, kept as a string so both surfaces get the same one. */
function mergeStyle(existing: AttrValue, addition: string): string {
  const before = typeof existing === 'string' && existing.trim() ? existing.trim() : '';
  if (!before) return addition;
  return `${before.replace(/;$/, '')};${addition}`;
}

function describeBase(
  node: SceneNode,
  variant: Variant,
  doc: Cre8Document,
  options: RenderOptions
): ElementModel {
  const { mode } = options;
  const props: NodeProps = variant.props;
  const base: Record<string, AttrValue> = { class: variant.className };

  /*
   * A named section is a place a link can point at, so it needs a real id —
   * the same reason a popover has one. Written here rather than in a per-type
   * arm because "somewhere to scroll to" is not a property of being a section:
   * a one-page site's nav points at whatever holds the content, which is as
   * often a frame or a stack.
   *
   * `describeBase`'s callers spread `base` first, so the popover arm's own id
   * still wins where a node is both.
   *
   * Two nodes given the same anchor collide, and nothing here can see the
   * other one — the Semantics panel can, and warns. What neither catches is an
   * anchor on a node inside a *component master* used twice, or inside a
   * repeater: the document holds one node and the page draws several. Left
   * rather than suppressed, because the signal that would suppress it —
   * "there is an override scope" — is also true of a component used once,
   * where the anchor is exactly right. A browser scrolls to the first match,
   * so the failure is a link that lands on the wrong copy rather than a page
   * that breaks.
   */
  const anchor = anchorId(props.anchor);
  if (anchor) base.id = anchor;

  /*
   * "A panel is positioned against me."
   *
   * Stored on this element rather than on the panel, which is the opposite of
   * how a person says it — and the reason is that this is the element that has
   * to carry `anchor-name`, and it can only emit what it holds. A panel naming
   * its anchor would need a reverse lookup, and the canvas renderer is handed
   * an empty document and memoised per node: the lookup would work in the
   * publisher and find nothing in the editor, which is a menu in the right
   * place in the file and the wrong place on the canvas.
   *
   * The inspector does the one scan needed to show it the way round somebody
   * means it. It has the document, and it is not in a render loop.
   */
  const anchorFor = node.refs?.anchorFor?.node;
  if (anchorFor) {
    base.style = mergeStyle(base.style, `anchor-name:${anchorNameFor(anchorFor)}`);
  }

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
      const srcset = str(props.srcset);
      return {
        tag: 'img',
        attrs: {
          ...base,
          src,
          alt: str(props.alt),
          srcset: srcset || undefined,
          sizes: srcset ? sizesFor(node, Boolean(props.priority)) : undefined,
          // The largest image above the fold is usually the one a visitor is
          // waiting for, and deferring *that* is a regression rather than an
          // optimisation — hence a control rather than a blanket `lazy`.
          loading: props.priority ? undefined : 'lazy',
          // Eager images are also worth decoding on the main thread: `async`
          // lets the browser paint the page around a hero that has not
          // finished, which is the opposite of what is wanted for the one
          // element the page is judged on.
          decoding: props.priority ? 'sync' : 'async',
          // Without these the page reflows when each image arrives. They are
          // the *intrinsic* pixels, not the laid-out size — the browser wants
          // the ratio, and CSS still decides how big it ends up.
          width: props.width ? Number(props.width) : undefined,
          height: props.height ? Number(props.height) : undefined,
          ...(props.priority ? { fetchpriority: 'high' } : {}),
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
      // Node-level, not per-variant: what a button opens is structure, and a
      // variant that changed it would be a different element rather than the
      // same one saying something else.
      const popoverTarget = node.refs?.popover?.node ?? '';
      const tag = resolveTag(node.type, props, { opensPopover: Boolean(popoverTarget) });
      const target = str(props.target, '_self');
      const attrs: Record<string, AttrValue> = { ...base };
      if (tag === 'a') {
        const resolved = options.hrefResolver
          ? options.hrefResolver(rawHref, options.record ?? null)
          : resolveHref(doc, rawHref, mode);
        if (resolved === '') {
          /*
           * A link with nowhere to go, which is a real state rather than a
           * mistake: `series:next` on the last page of a paginated index. It
           * is hidden rather than pointed at `#`, because a Next button that
           * does nothing is worse than no button — and `hidden` needs no
           * stylesheet and no script to be true.
           */
          attrs.hidden = true;
        } else {
          attrs.href = resolved;
        }
        if (target && target !== '_self') {
          attrs.target = target;
          attrs.rel = 'noopener noreferrer';
        }
      } else {
        /*
         * `type` is not optional on a button inside a form: the HTML default
         * is `submit`, so a decorative button would post the form, and a
         * button meant to post it needs to say so. Everything the app makes
         * was a `<button type="button">` — including the Send button on every
         * contact form it shipped, which therefore did nothing at all. The
         * `forms` suite passed throughout, because it submitted the form
         * itself rather than pressing the thing a visitor presses.
         */
        attrs.type = props.submit ? 'submit' : 'button';
      }
      // Opening a popover is the browser's job, not a script's: name the panel
      // and it handles the top layer, light dismiss, Escape and focus return.
      if (popoverTarget && tag === 'button') {
        attrs.popovertarget = popoverDomId(popoverTarget);
        const action = str(props.popoverAction, 'toggle');
        if (action !== 'toggle') attrs.popovertargetaction = action;
      }
      /*
       * Children win over the text prop, and that is the whole of the
       * compatibility story.
       *
       * Both renderers short-circuit on `text` and ignore children, so a
       * button that has none behaves exactly as it always did — every existing
       * document renders byte-identically. Add a child and the label steps
       * aside, which is what lets a button hold an icon beside its words, a
       * link wrap an image, and a whole card become clickable.
       *
       * Inline text editing follows the same rule: there is no text to edit
       * once the element is showing a subtree.
       */
      const textProp = node.type === 'button' ? 'label' : 'text';
      const empty = node.children.length === 0;
      return {
        tag,
        attrs,
        text: empty ? str(props[textProp]) : undefined,
        void: false,
        acceptsChildren: true,
        ...(empty ? { editableProp: textProp } : {}),
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
      /*
       * A panel that follows its button rather than sitting in the middle.
       *
       * Only the *link* is written here — the placement is `position-area` in
       * the node's own styles, because "below, aligned left" is a design
       * decision somebody changes and an inline style would outrank every rule
       * they wrote. What the renderer owns is the name, which has to be minted
       * identically at both ends and cannot be typed by hand.
       */
      const anchored = str(props.anchorTo);
      const attrs: Record<string, AttrValue> = {
        ...base,
        id: popoverDomId(node.id),
        popover: live ? str(props.popoverMode, 'auto') : undefined,
        // A dialog with no name is announced as "dialog" and nothing else.
        'aria-label': isDialog ? str(props.label) || undefined : undefined,
      };
      if (anchored) {
        attrs[ANCHORED_ATTR] = true;
        attrs.style = mergeStyle(attrs.style, `position-anchor:${anchorNameFor(node.id)}`);
      }
      return {
        // A real `<dialog>`, opened through the popover attribute rather than
        // `showModal()`. That keeps the page scriptless and still buys the
        // element's implicit role, so the thing is announced as a dialog
        // instead of as an anonymous box.
        tag: isDialog ? 'dialog' : 'div',
        attrs,
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
      /*
       * A switch is a checkbox that says so.
       *
       * `role="switch"` changes nothing about how it works and everything
       * about how it is announced: "on" and "off" rather than "checked" and
       * "not checked", which is what a person expects of a setting that takes
       * effect immediately. Only meaningful on a checkbox — a radio is one of
       * several, and a group of switches is not a thing.
       */
      const isSwitch = node.type === 'checkbox' && str(props.role) === 'switch';
      const attrsList = [
        `type="${inputType}"`,
        isSwitch ? 'role="switch"' : '',
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
          // A slider that drives a continuous value is a control rather than a
          // field, and it is often the only thing describing itself — a
          // comparison handle *is* the divider, so there is nowhere to put a
          // visible label.
          'aria-label': str(props.ariaLabel) || undefined,
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
  srcset: 'srcSet',
  fetchpriority: 'fetchPriority',
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
    /*
     * The one attribute the two surfaces cannot share verbatim.
     *
     * `ElementModel.attrs` is a string map because that is what the publisher
     * writes into a file, and React refuses a string `style` outright. Parsed
     * here rather than modelled as an object, so the published bytes stay the
     * thing the model actually holds and only the surface that needs a
     * different shape pays for it. Custom properties are passed through
     * unchanged, which React supports precisely because it does not try to
     * understand them.
     */
    if (key === 'style' && typeof value === 'string') {
      const declarations: Record<string, string> = {};
      for (const part of value.split(';')) {
        const at = part.indexOf(':');
        if (at <= 0) continue;
        declarations[part.slice(0, at).trim()] = part.slice(at + 1).trim();
      }
      out.style = declarations;
      continue;
    }
    out[REACT_ATTR_MAP[key] ?? key] = value;
  }
  return out;
}
