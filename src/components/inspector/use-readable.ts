'use client';

/**
 * What a Test can read from here.
 *
 * Three lists — the record's fields, the named controls inside this element,
 * and the controls anywhere on the page — which are exactly the three operand
 * kinds `Value` has and exactly what `testSentence` asks for. They were three
 * private walks in `section-data.tsx`, which was right while one panel wrote
 * Tests and wrong the moment two did.
 *
 * Two panels disagreeing about what is readable is not a cosmetic bug. A
 * comparison against a field that is not really in scope compiles to an
 * attribute nothing ever sets, and the panel that offered it says the design is
 * finished. So the offer is answered once, here, and both callers get the same
 * answer by construction rather than by staying in step.
 *
 * Subscribed by value rather than by reference, which is the same arrangement
 * the action list itself uses. Three walks over `doc.nodes` returning fresh
 * arrays would re-render the panel on every edit to every node in the
 * document — and the press list is on screen for every element, not only the
 * ones inside a collection.
 */

import { useMemo } from 'react';
import { activeRootId, useEditor, type EditorStore } from '@/lib/editor/store';
import { slug } from '@/lib/document/schema';
import { elementsRead } from '@/lib/renderer/test';
import type { Field, SceneNode, Test } from '@/lib/document/types';
import { collectionInScope } from './section-data';

/** What a Test may compare against, in the words the sentence builder wants. */
export interface Readable {
  /** The record's fields, empty when this element is not inside one. */
  fields: Field[];
  /** Named form controls inside this element, by name. */
  controls: string[];
  /** Controls elsewhere on the page, by node. */
  elements: { id: string; name: string }[];
}

const NOTHING: Readable = { fields: [], controls: [], elements: [] };
const NO_TESTS: Test[] = [];

const READABLE_TYPES = new Set([
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'range',
  'file',
]);

/**
 * @param node The element the Test is being written on.
 * @param reading Tests already written here, so an element one of them names is
 *   nameable even when it is no longer on offer. See `alsoAlreadyRead`.
 */
export function useReadableValues(
  node: SceneNode | undefined,
  reading: Test[] = NO_TESTS
): Readable {
  const id = node?.id;
  const encoded = useEditor((s) => JSON.stringify(gather(s, id, reading)));
  return useMemo(() => JSON.parse(encoded) as Readable, [encoded]);
}

function gather(state: EditorStore, id: string | undefined, reading: Test[]): Readable {
  const nodes = state.doc.nodes;
  const node = id ? nodes[id] : undefined;
  if (!node) return NOTHING;
  /*
   * The same walk the canvas does and by the same function, because a panel
   * that disagreed with the canvas about which record is in scope would be
   * worse than no panel at all.
   */
  const page = state.doc.pages.find((one) => one.id === state.activePageId);
  const scope = state.doc.collections?.length
    ? collectionInScope(nodes, node, state.doc.collections, page?.dynamic?.collection)
    : null;
  return {
    fields: scope?.fields ?? [],
    controls: namedControlsInside(nodes, node),
    elements: alsoAlreadyRead(
      controlsOnPage(nodes, activeRootId(state) ?? undefined, node),
      reading,
      nodes
    ),
  };
}

/**
 * Form controls inside this node, by name.
 *
 * Inside, because that is the scope the interaction model gives a rule: it
 * evaluates against the node that owns it, and descendants react to the
 * resulting state. So the way to light up a submit button when a field is
 * filled is to put the rule on the form and style the button through the
 * state — not to reach across the page from the button, which is the arbitrary
 * targeting the model defers.
 *
 * By name rather than by node, which is the lighter thing to reach for when the
 * control really is a child: it is one string in the document, and the runtime
 * finds it with a `[name=…]` query inside the element that owns the rule.
 */
function namedControlsInside(nodes: Record<string, SceneNode>, root: SceneNode): string[] {
  const found: string[] = [];
  const walk = (id: string, depth: number): void => {
    if (depth > 40) return;
    const child = nodes[id];
    if (!child) return;
    const name = slug(child.props.name);
    if (name && !found.includes(name)) found.push(name);
    for (const grandchild of child.children) walk(grandchild, depth + 1);
  };
  for (const child of root.children) walk(child, 0);
  return found;
}

/**
 * Every control on the page, whether or not it is inside this node.
 *
 * The other half of the source list, and the one that could not exist before
 * references did: a control here is offered by *node*, so the rule survives the
 * field being renamed and is cleared when the field is deleted. Named controls
 * inside the node stay on offer beside them.
 */
function controlsOnPage(
  nodes: Record<string, SceneNode>,
  rootId: string | undefined,
  exclude: SceneNode
): { id: string; name: string }[] {
  if (!rootId) return [];
  const inside = new Set<string>();
  const mark = (id: string, depth: number): void => {
    if (depth > 60) return;
    inside.add(id);
    for (const child of nodes[id]?.children ?? []) mark(child, depth + 1);
  };
  mark(exclude.id, 0);

  const out: { id: string; name: string }[] = [];
  const walk = (id: string, depth: number): void => {
    if (depth > 60) return;
    const node = nodes[id];
    if (!node) return;
    // Not the ones already offered as "what is typed" — the same control twice
    // under two spellings is a menu nobody can choose from.
    if (READABLE_TYPES.has(node.type) && !inside.has(id)) out.push({ id, name: node.name });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(rootId, 0);
  return out;
}

/**
 * Those, plus any element the Tests already read that is not among them.
 *
 * Because what is worth *offering* and what has to be *named* are different
 * questions, and `controlsOnPage` answers the first. It leaves out the node's
 * own descendants on purpose — they are offered as "what is typed" instead — so
 * a control that was picked from the page and has since been dragged inside
 * this node is a live, working reference that the offer list cannot label. Ask
 * the offer list to do the naming and that rule renders as unset and then gets
 * reported as broken, which is two lies about a rule that works.
 *
 * After this, a reference the sentence cannot name is one whose node is
 * genuinely not in the document — the same thing `danglingReads` reports, which
 * is what lets the chip and the warning underneath agree.
 */
function alsoAlreadyRead(
  offered: { id: string; name: string }[],
  reading: Test[],
  nodes: Record<string, SceneNode>
): { id: string; name: string }[] {
  const out = [...offered];
  for (const test of reading) {
    for (const id of elementsRead(test)) {
      if (out.some((one) => one.id === id)) continue;
      const found = nodes[id];
      if (found) out.push({ id, name: found.name });
    }
  }
  return out;
}
