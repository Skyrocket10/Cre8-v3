/**
 * One subtree, more than once.
 *
 * `variants.ts` made one node into several *elements*. This is the same idea a
 * level up — one node into several *subtrees* — and the thing it adds is a
 * record in scope for everything below.
 *
 * Two properties are worth stating before any of the code, because they are
 * what make the feature affordable:
 *
 *   > **The stylesheet does not grow.** Every copy of a repeated subtree
 *   > carries the same classes, because it *is* the same node. A hundred
 *   > products are a hundred DOM subtrees and zero extra rules. Variants
 *   > needed a class each because each could be styled differently; repeats
 *   > cannot, which is exactly what makes them repeats.
 *
 *   > **Nothing runs in the browser.** Records are read when the site is
 *   > published and the rows are real elements in the file — indexed,
 *   > printable, correct with scripting off, correct opened from a ZIP.
 *
 * Both renderers call the functions here, so a bound list has the same shape
 * on the canvas as in the published file. The only deliberate difference is
 * the template row `repeatRows` adds in edit mode: an empty collection would
 * otherwise be an empty box, and a designer cannot lay out a card they cannot
 * see.
 */

import { LIMITS } from '../document/types';
import type {
  CollectionRecord,
  NodeProps,
  RecordFilter,
  RepeatSpec,
  SceneNode,
} from '../document/types';
import { isSettable } from './variants';

/** Every record a page might need, keyed by collection id. */
export type RecordSet = Record<string, CollectionRecord[] | undefined>;

/** What a record's field holds once read out of `data`. */
type FieldValue = string | number | boolean | null | undefined;

/* --------------------------------------------------------------------------
 * Choosing the rows
 * ----------------------------------------------------------------------- */

/**
 * The records one repeater shows: published, filtered, sorted, clamped.
 *
 * Runs in the editor and in the publisher, over the same array, so what the
 * canvas draws and what the file contains cannot drift. Every step is total
 * and deterministic — no locale comparison, no `Date.now()`, no reliance on
 * the order D1 happened to return — because D3 wants the Worker's output to be
 * byte-identical to the browser's, and a sort that disagrees across two
 * JavaScript engines would quietly break that.
 */
export function recordsFor(
  repeat: RepeatSpec,
  pool: CollectionRecord[] | undefined
): CollectionRecord[] {
  if (!pool?.length) return [];

  // Unpublished is not "draft mode" — it is off the site, everywhere, so the
  // canvas is never showing rows the published page will not have.
  const rows = pool.filter(
    (record) => record.published && (repeat.filter ?? []).every((test) => passes(record, test))
  );

  rows.sort(compareWith(repeat.sort));

  const ceiling = LIMITS.recordsPerRepeat;
  const limit = repeat.limit === undefined ? ceiling : Math.min(repeat.limit, ceiling);
  return limit >= rows.length ? rows : rows.slice(0, Math.max(0, limit));
}

function passes(record: CollectionRecord, test: RecordFilter): boolean {
  const value = text(fieldOf(record, test.field));
  const wanted = test.value;
  switch (test.op) {
    case 'is':
      return value === wanted;
    case 'isNot':
      return value !== wanted;
    // Case-insensitive because the person typing the filter is typing prose,
    // not a key: "featured" should match "Featured".
    case 'has':
      return value.toLowerCase().includes(wanted.toLowerCase());
    default:
      return true;
  }
}

/**
 * A total order, whatever the field holds.
 *
 * `position` then `id` break every tie, so two records never swap places
 * between one publish and the next — the sort is stable in V8 but not by
 * specification, and "the diff is empty" is a property D6 depends on.
 */
function compareWith(sort: RepeatSpec['sort']) {
  const sign = sort?.direction === 'desc' ? -1 : 1;
  return (a: CollectionRecord, b: CollectionRecord): number => {
    if (sort) {
      const ranked = compare(fieldOf(a, sort.field), fieldOf(b, sort.field)) * sign;
      if (ranked !== 0) return ranked;
    }
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function compare(a: FieldValue, b: FieldValue): number {
  // Absent sorts last in either direction's natural reading: a record with no
  // date is not "the oldest", it is one that has not said.
  const aEmpty = a === undefined || a === null || a === '';
  const bEmpty = b === undefined || b === null || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);

  const left = String(a);
  const right = String(b);
  // Deliberately not `localeCompare`: it consults ICU data that differs
  // between a browser and a Worker, which is precisely the kind of "works on
  // my machine" the byte-identical gate exists to catch.
  return left < right ? -1 : left > right ? 1 : 0;
}

function fieldOf(record: CollectionRecord, field: string): FieldValue {
  return field ? record.data[field] : undefined;
}

function text(value: FieldValue): string {
  return value === undefined || value === null ? '' : String(value);
}

/* --------------------------------------------------------------------------
 * Reading a record into props
 * ----------------------------------------------------------------------- */

/**
 * The node's props with the record's fields written over them.
 *
 * The result becomes the *base* a variant is built from, which is what makes
 * the documented order — base → bind → set — fall out of the existing code
 * rather than needing a third merge step. A condition still wins over a bound
 * value, because "when out of stock, say Sold out" has to beat the price the
 * record carries.
 *
 * Restricted to the same props `set` may touch. Structure — `switchKey`,
 * `level`, `popoverTarget` — would make each row a different *element* rather
 * than the same element saying something else, and two of them would then
 * fight over one DOM id.
 */
export function boundProps(node: SceneNode, record: CollectionRecord | null): NodeProps {
  const bind = node.bind;
  if (!record || !bind) return node.props;

  let out: NodeProps | null = null;
  for (const [prop, field] of Object.entries(bind)) {
    if (!isSettable(prop)) continue;
    // A field the record does not carry leaves the design-time prop alone.
    // That is what makes a half-filled record show placeholder copy instead of
    // a row of blanks — and what stops a renamed field from emptying the page
    // before anybody notices. Present-but-empty is different: the record has
    // said, and what it said is nothing.
    if (!(field in record.data)) continue;

    out ??= { ...node.props };
    out[prop] = record.data[field];

    /*
     * An uploaded image ships a `srcset` alongside its `src`, and intrinsic
     * `width`/`height` with it — all three describing the file that was
     * uploaded. Bind a different image into `src` and every one of them is
     * about the wrong picture. `srcset` is the dangerous one: it outranks
     * `src`, so the placeholder is what a visitor actually sees.
     *
     * A record carries a URL, not a ladder and not a size, so the honest thing
     * is to drop them rather than ship numbers about another image. That does
     * cost the layout-shift protection an uploaded image gets — and the fix
     * for that is `aspectRatio` on the node, which is a design decision the
     * designer makes once for the whole list, not a number to be guessed here.
     */
    if (prop === 'src') {
      delete out.srcset;
      delete out.width;
      delete out.height;
    }
  }
  return out ?? node.props;
}

/* --------------------------------------------------------------------------
 * What the canvas draws when there is nothing to draw
 * ----------------------------------------------------------------------- */

/**
 * The rows a surface renders, including the design-time empty case.
 *
 * A repeater over an empty collection publishes nothing — an empty list is the
 * truthful output, and inventing rows would be lying in a file somebody
 * serves. On the canvas it renders its subtree once, unbound, because a card
 * you cannot see is a card you cannot lay out. `preview` sides with `publish`:
 * preview's whole job is to be the published page.
 *
 * `null` means "no record in scope", which is exactly the state a subtree
 * outside any repeater is in — so the template row goes down the same path as
 * everything else rather than needing one of its own.
 */
export function repeatRows(
  repeat: RepeatSpec,
  pool: CollectionRecord[] | undefined,
  mode: 'edit' | 'preview' | 'publish'
): (CollectionRecord | null)[] {
  const rows = recordsFor(repeat, pool);
  if (rows.length) return rows;
  return mode === 'edit' ? [TEMPLATE_ROW] : [];
}

/** What `repeatRows` yields for the design-time row: no record in scope. */
const TEMPLATE_ROW = null;

/** Collection ids the given nodes repeat over, for prefetching. */
export function collectionsUsedBy(
  nodes: Record<string, SceneNode>,
  nodeIds: Iterable<string>
): string[] {
  const found = new Set<string>();
  for (const id of nodeIds) {
    const collection = nodes[id]?.repeat?.collection;
    if (collection) found.add(collection);
  }
  return [...found];
}
