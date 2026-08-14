'use client';

/**
 * What the inspector can show, and when it shows it.
 *
 * The panel used to render every section it had, every time, and the length of
 * it was a description of what CSS can do rather than of what this element is.
 * Fifteen accordions, most of them holding rows nobody had set.
 *
 * The rule now is one sentence: **a section is on screen because it applies,
 * because it is essential to this kind of element, or because it is in use.**
 * Everything else is one click away behind Add, named in the same plain words.
 *
 * That is not a new idea in this panel — it is the old one, finished. Layout
 * has always been hidden on a heading and Data outside a repeater, because
 * neither can do anything there. "Cannot apply" and "is not used" are the same
 * argument at different strengths, and the panel only ever made the first.
 *
 * The declarations live here rather than in the components so that three
 * questions have one answer each: what does Add offer, what is showing, and
 * what does removing a section take away. A section that answered those in its
 * own file would answer them three different ways within a month.
 */

import { STYLE_VOCABULARY, type StyleSection } from '@/lib/document/style-vocabulary';
import { getElement, type ElementDefinition } from '@/lib/document/schema';
import type { Cre8Document, ElementType, SceneNode, StyleProp } from '@/lib/document/types';
import { danglingReads } from '@/lib/document/factory';
import { pressActionOfType } from '@/lib/document/actions';
import { stateKeyOf } from '@/lib/document/state';
import { collectionInScope } from './section-data';
import { hasOwnContent } from './section-content';

/**
 * The boxes whose Link row and tag choice are a decision rather than a given.
 *
 * A button is a link — the rows are what it *is*, so they stay in its content.
 * A frame is a frame that somebody may or may not make clickable, and printing
 * the question on every frame in the document is four accordions of noise per
 * element for the one in fifty that says yes.
 */
const LAYOUT_BOXES: ElementType[] = ['frame', 'section', 'container', 'stack', 'grid'];

/**
 * What a section needs to know about where it is being asked.
 *
 * The page comes in rather than off the node: a node does not know which page
 * it is on, and the one that matters is the page being *edited* — which is how
 * the Data section itself decides, so deciding differently here would put a
 * section in the Add menu that renders nothing when added.
 */
export interface SectionContext {
  def: ElementDefinition;
  doc: Cre8Document;
  /** The collection a dynamic page repeats over, if this page is one. */
  pageCollection?: string;
}

/** The headings Add groups its offers under. Plain words, no CSS in any of them. */
export type SectionGroup = 'Arrangement' | 'Appearance' | 'Motion' | 'Behaviour' | 'Advanced';

export const SECTION_GROUPS: SectionGroup[] = [
  'Arrangement',
  'Appearance',
  'Motion',
  'Behaviour',
  'Advanced',
];

export interface SectionSpec {
  /** Stable across renames — it is what `openSections` remembers. */
  id: string;
  /** What Add calls it. Matches the heading the section renders. */
  title: string;
  group: SectionGroup;
  /** One line under the name in the Add menu, for somebody who has not met it. */
  hint: string;
  /**
   * Declarations this section owns.
   *
   * Read from the vocabulary rather than listed here: the table already says
   * which section every property belongs to, and a second list would be a
   * second answer. Sections sharing a vocabulary section — Animation and
   * Transition both live under `motion` — name their properties directly.
   */
  props: readonly StyleProp[];
  /** Could this element ever have it? Absent means yes. */
  applies?: (node: SceneNode, ctx: SectionContext) => boolean;
  /** Shown without being asked for. Absent means no. */
  essential?: (node: SceneNode, ctx: SectionContext) => boolean;
  /**
   * In use for a reason other than a declaration — a rule, a binding, a press.
   * OR'd with the declaration check rather than replacing it.
   */
  used?: (node: SceneNode, ctx: SectionContext) => boolean;
  /**
   * Only ever about one element, so a multi-selection does not show it.
   *
   * What an element *says* is its own — two headings do not share a text
   * field — and neither is a rule, a binding or a press. "Writes declarations"
   * was the first test for this and it was wrong: Content owns five of them,
   * so a mixed selection grew a Content section belonging to whichever element
   * happened to be first.
   */
  perElement?: boolean;
  /**
   * Removing it is not offered.
   *
   * True where there is nothing to take away — Content is what the element
   * *is* — or where "empty" is not expressible: a rule is removed one rule at
   * a time, inside the section.
   */
  permanent?: boolean;
}

/** Every property the vocabulary files under one of its sections. */
function propsOf(...sections: StyleSection[]): StyleProp[] {
  return (Object.keys(STYLE_VOCABULARY) as StyleProp[]).filter((prop) =>
    sections.includes(STYLE_VOCABULARY[prop].section)
  );
}

/** A container somebody can actually put things in — not a page, not an instance. */
const holdsChildren = (def: ElementDefinition) => def.container && !def.internal;

/*
 * The essentials, and the argument for each.
 *
 * A panel that opens to nothing is honest and useless: a designer needs
 * something to push against before they know what they want. So every element
 * arrives with the handful of controls its *kind* is about, and nothing else.
 *
 *   what it says      always — an element that says nothing is not an element
 *   Layout, Spacing   containers, because arranging what is inside is the
 *                     whole reason the thing exists
 *   Size              everything except pure text, which sizes itself from its
 *                     words and is almost never given a width by hand
 *   Typography        anything with words of its own
 *
 * A button is a container with text, so it gets all four. That is right: it is
 * also the element people restyle most.
 */
export const SECTIONS: SectionSpec[] = [
  {
    id: 'content',
    perElement: true,
    title: 'Content',
    group: 'Appearance',
    hint: 'What it says and shows',
    props: propsOf('content'),
    applies: (_node, ctx) => hasOwnContent(ctx.def.type),
    essential: () => true,
    permanent: true,
  },
  {
    id: 'linkable',
    perElement: true,
    title: 'Link',
    group: 'Behaviour',
    hint: 'Make the whole box clickable — go somewhere, or open a panel',
    props: [],
    applies: (_node, ctx) => LAYOUT_BOXES.includes(ctx.def.type),
    // The panel is now a verb rather than a reference — X8's absorption — so
    // "in use" asks the action list. `href` stays a prop and stays here.
    used: (node) =>
      Boolean(node.props.href) ||
      Boolean(pressActionOfType(node, 'openPanel') || pressActionOfType(node, 'closePanel')),
  },
  {
    id: 'semantics',
    perElement: true,
    title: 'Semantics',
    group: 'Advanced',
    hint: 'What this is to a screen reader, and a name links can point at',
    props: [],
    applies: (_node, ctx) => LAYOUT_BOXES.includes(ctx.def.type),
    used: (node) => Boolean(node.props.tag) || Boolean(node.props.anchor),
  },
  {
    id: 'switch',
    perElement: true,
    title: 'Switch',
    group: 'Behaviour',
    hint: 'Give what is inside a state — tabs, a filter, a pricing toggle',
    props: [],
    applies: (_node, ctx) => holdsChildren(ctx.def),
    used: (node) => Boolean(stateKeyOf(node)),
  },
  {
    id: 'value',
    perElement: true,
    title: 'Continuous value',
    group: 'Behaviour',
    hint: 'A number the things inside can be styled by',
    props: [],
    applies: (_node, ctx) => holdsChildren(ctx.def),
    used: (node) => Boolean(node.props.rangeKey),
  },
  {
    id: 'component',
    perElement: true,
    title: 'Component',
    group: 'Behaviour',
    hint: 'Which parts of this component an instance may change',
    props: [],
    applies: (node) => Boolean(node.meta.componentId),
    essential: () => true,
    permanent: true,
  },
  {
    id: 'layout',
    title: 'Layout',
    group: 'Arrangement',
    hint: 'How the things inside are arranged',
    props: propsOf('layout'),
    applies: (_node, ctx) => holdsChildren(ctx.def),
    essential: (_node, ctx) => holdsChildren(ctx.def),
  },
  {
    id: 'size',
    title: 'Size',
    group: 'Arrangement',
    hint: 'How wide and how tall',
    props: propsOf('size'),
    essential: (_node, ctx) => !ctx.def.textual || ctx.def.container,
  },
  {
    id: 'spacing',
    title: 'Spacing',
    group: 'Arrangement',
    hint: 'Room inside it, and room around it',
    props: propsOf('spacing'),
    essential: (_node, ctx) => holdsChildren(ctx.def),
  },
  {
    id: 'placement',
    title: 'Placement',
    group: 'Arrangement',
    hint: 'Where it sits, how it is layered, and how it is turned',
    props: propsOf('position', 'parent'),
  },
  {
    id: 'typography',
    title: 'Typography',
    group: 'Appearance',
    hint: 'Typeface, size, weight and colour of the words',
    props: propsOf('typography'),
    essential: (_node, ctx) => ctx.def.textual,
  },
  {
    id: 'background',
    title: 'Background',
    group: 'Appearance',
    hint: 'A colour, a gradient or an image behind it',
    props: propsOf('fill'),
  },
  {
    id: 'border',
    title: 'Border',
    group: 'Appearance',
    hint: 'An edge, and how rounded the corners are',
    props: propsOf('border'),
  },
  {
    id: 'shadow',
    title: 'Shadow & blur',
    group: 'Appearance',
    hint: 'Depth, glow, blur and how see-through it is',
    props: propsOf('effects'),
  },
  {
    id: 'animation',
    title: 'Animation',
    group: 'Motion',
    hint: 'How it arrives as somebody scrolls to it',
    props: ['appear'],
  },
  {
    id: 'transition',
    title: 'Transition',
    group: 'Motion',
    hint: 'What eases when something about it changes',
    props: ['transition'],
  },
  {
    id: 'rules',
    perElement: true,
    /*
     * The name the panel already shows.
     *
     * This said "Rules" while `RulesSection` rendered a header reading
     * "States & conditions", so the Add menu offered one thing and produced a
     * section headed another — and the remove button, which takes its label
     * from here, offered to remove something the designer could not see. The
     * two names are independent by construction: a renderer supplies its own
     * `<Section title>` and nothing compares it to this. The visible one wins,
     * because it is the one somebody has already learned.
     */
    title: 'States & conditions',
    group: 'Behaviour',
    hint: 'Look different when hovered, ticked, unavailable, or while a switch is on',
    props: [],
    used: (node) => Boolean(node.rules?.length),
    permanent: false,
  },
  {
    id: 'data',
    perElement: true,
    title: 'Data',
    group: 'Behaviour',
    hint: 'Repeat over a list, or fill this in from a record',
    props: [],
    applies: (node, ctx) => {
      if (!ctx.doc.collections?.length) return false;
      // The same two gates the section itself uses: a container can start
      // repeating, and anything inside a repeater can read the record.
      if (holdsChildren(ctx.def)) return true;
      return Boolean(
        collectionInScope(ctx.doc.nodes, node, ctx.doc.collections, ctx.pageCollection)
      );
    },
    /*
     * Repeating, bound — or carrying something this section is the only place
     * to hear about.
     *
     * The panel reports a rule reading an element that is no longer there, and
     * it reports it here. Hide the section because nothing is bound and the
     * warning goes with it: the rule still cannot work, the element still does
     * nothing, and now nothing anywhere says so. A section holding a problem
     * is in use by definition.
     */
    used: (node, ctx) =>
      Boolean(node.repeat) ||
      Object.keys(node.bind ?? {}).length > 0 ||
      Boolean(node.assign?.length) ||
      danglingReads(ctx.doc.nodes).some((read) => read.node.id === node.id),
  },
  {
    id: 'actions',
    perElement: true,
    title: 'When pressed',
    group: 'Behaviour',
    hint: 'Set a switch, copy something, open a panel, go somewhere',
    props: [],
    used: (node) => Boolean(node.events?.length),
  },
  {
    id: 'advanced',
    title: 'Custom CSS',
    group: 'Advanced',
    hint: 'A property this panel has no control for',
    props: propsOf('advanced'),
  },
];

export const SECTION_BY_ID = new Map(SECTIONS.map((section) => [section.id, section]));

/**
 * Does this element hold a value for any of a section's properties?
 *
 * Every layer, not just the base: a shadow that only exists on mobile, or only
 * while hovered, is still a shadow this element has — and a panel that hid the
 * section would leave it uneditable and invisible at once. The most common way
 * to lose work in an editor is for the editor to forget it is there.
 */
export function holdsAnyOf(node: SceneNode, props: readonly StyleProp[]): boolean {
  if (!props.length) return false;
  const layers = [
    ...Object.values(node.styles ?? {}),
    ...(node.rules ?? []).map((rule) => rule.apply),
  ];
  return layers.some(
    (layer) => layer && props.some((prop) => (layer as Record<string, unknown>)[prop] !== undefined)
  );
}

export interface SectionState {
  /** In the order the panel draws them. */
  showing: SectionSpec[];
  /** Everything Add can still offer, in group order. */
  offered: SectionSpec[];
}

/**
 * Which sections are on screen for this element, and which Add can still offer.
 *
 * `opened` is what the designer asked for during this selection and has not
 * filled in yet. It is deliberately not persisted: a section added and left
 * empty has said nothing about the element, so coming back to it later and
 * finding it gone is the panel keeping its own promise.
 */
export function sectionsFor(
  node: SceneNode,
  doc: Cre8Document,
  opened: readonly string[],
  pageCollection?: string
): SectionState {
  const ctx: SectionContext = { def: getElement(node.type), doc, pageCollection };
  const showing: SectionSpec[] = [];
  const offered: SectionSpec[] = [];

  for (const section of SECTIONS) {
    if (section.applies && !section.applies(node, ctx)) continue;
    const inUse =
      holdsAnyOf(node, section.props) ||
      Boolean(section.used?.(node, ctx)) ||
      opened.includes(section.id);
    if (section.essential?.(node, ctx) || inUse) showing.push(section);
    else offered.push(section);
  }

  offered.sort(
    (a, b) => SECTION_GROUPS.indexOf(a.group) - SECTION_GROUPS.indexOf(b.group)
  );
  return { showing, offered };
}

/**
 * The same question for several elements at once.
 *
 * Only the sections that are not `perElement`: what an element *says* is its
 * own, so Content, Data and the rest have nothing to offer a mixed selection —
 * which is also why the panel drops to style controls when more than one thing
 * is picked.
 *
 * "Applies" and "essential" are asked of *any* selected element rather than the
 * first. Reading the first hid Layout whenever a selection happened to start
 * with a heading, even though the frames beside it were exactly what somebody
 * had selected them all to lay out — a bug this panel has had before, and one
 * that only shows up when the order of a selection changes.
 */
export function bulkSectionsFor(
  nodes: SceneNode[],
  doc: Cre8Document,
  opened: readonly string[],
  pageCollection?: string
): SectionState {
  const contexts: SectionContext[] = nodes.map((node) => ({
    def: getElement(node.type),
    doc,
    pageCollection,
  }));
  const showing: SectionSpec[] = [];
  const offered: SectionSpec[] = [];

  const pairs = nodes.map((node, i) => [node, contexts[i]] as const);
  for (const section of SECTIONS) {
    if (section.perElement) continue;
    if (section.applies && !pairs.some(([node, ctx]) => ctx && section.applies!(node, ctx))) continue;
    const inUse =
      nodes.some((node) => holdsAnyOf(node, section.props)) || opened.includes(section.id);
    const essential = pairs.some(([node, ctx]) => ctx && section.essential?.(node, ctx));
    (essential || inUse ? showing : offered).push(section);
  }

  offered.sort((a, b) => SECTION_GROUPS.indexOf(a.group) - SECTION_GROUPS.indexOf(b.group));
  return { showing, offered };
}
