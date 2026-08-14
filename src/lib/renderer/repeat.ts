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

import { bindingFrom } from '../document/migrate';
import { LIMITS } from '../document/types';
import type {
  Collection,
  CollectionRecord,
  NodeProps,
  ProjectSettings,
  RecordFilter,
  RepeatSpec,
  SceneNode,
} from '../document/types';
import { resolveValue, type FindRecord } from '../document/schedule';
import { formatValue } from './format';
import { isSettable } from './variants';

/** Every record a page might need, keyed by collection id. */
export type RecordSet = Record<string, CollectionRecord[] | undefined>;

/**
 * The same records, by id, for a chain that follows a reference.
 *
 * Here rather than in either renderer because both need it and they must agree
 * — `docs/VALUES.md` §2 and the single-renderer rule. Across collections, in
 * one map: a record id is unique in a project, so a `follow` is a lookup and
 * the field's declared target is the editor's business rather than the
 * resolver's.
 *
 * Published rows only, the same rule `recordsFor` applies to a list.
 *
 * Written the other way round first, on the argument that a reference is not
 * *showing* the record, only reading one field of it — so a post whose author
 * is still a draft would print the name rather than the placeholder. That
 * argument is wrong, and wrong in the direction that matters: a draft is
 * content that is off the site, and "one field of it" is still that content on
 * a public page. A profile kept unpublished because it is not ready would have
 * its name published by any post that pointed at it.
 *
 * It is also the only reading that keeps the surfaces together. The Worker
 * queries `published = 1` — a leak is not something to leave to whichever
 * publisher ran — so an index that kept drafts would resolve on the canvas and
 * not in the file, which is the one thing this renderer does not trade away.
 */
export function recordIndex(records: RecordSet | undefined): FindRecord | undefined {
  if (!records) return undefined;
  const byId = new Map<string, CollectionRecord>();
  for (const rows of Object.values(records)) {
    for (const record of rows ?? []) if (record.published) byId.set(record.id, record);
  }
  return (id) => byId.get(id) ?? null;
}

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
 *
 * @param ceiling The most rows this caller may take. Defaults to what one
 *   repeater may show — a list of five thousand on a page helps nobody. A
 *   dynamic route passes its own, larger one: it is making *pages*, not rows,
 *   and the two have different reasons to stop.
 */
export function recordsFor(
  repeat: RepeatSpec,
  pool: CollectionRecord[] | undefined,
  ceiling: number = LIMITS.recordsPerRepeat
): CollectionRecord[] {
  if (!pool?.length) return [];

  // Unpublished is not "draft mode" — it is off the site, everywhere, so the
  // canvas is never showing rows the published page will not have.
  const rows = pool.filter(
    (record) => record.published && (repeat.filter ?? []).every((test) => passes(record, test))
  );

  rows.sort(compareWith(repeat.sort));

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
 *
 * @param base What to bind over. Defaults to the node's own props, and is
 *   passed by both renderers when the node sits inside a component instance
 *   that has filled some of its props in — an override is the node's props as
 *   far as everything downstream is concerned, which is what makes a record
 *   beat it. Inside a repeater it has to: every row is the same instance node,
 *   so an override that outranked the binding would print one row's text in
 *   all of them.
 */
export function boundProps(
  node: SceneNode,
  record: CollectionRecord | null,
  base: NodeProps = node.props,
  find?: FindRecord
): NodeProps {
  const bind = node.bind;
  if (!record || !bind) return base;

  let out: NodeProps | null = null;
  for (const [prop, entry] of Object.entries(bind)) {
    if (!isSettable(prop)) continue;
    /*
     * Through `bindingFrom` rather than straight off `entry.value`, because a
     * document that has not been migrated still has field names here. Every
     * production path loads through `hydrateDocument`, which migrates — but
     * this function is also reached by anything holding a document it did not
     * load, and reading `.value.key` off a string is a thrown TypeError that
     * takes the whole page down. Not defensive coding: one function knows both
     * spellings, and this is a caller of it.
     */
    const binding = bindingFrom(entry);
    /*
     * Only a record field. `Value` also covers a form control's live value,
     * which a Test can read and a binding cannot: a binding resolves when the
     * page is rendered, and there is no browser at that point to ask. The
     * picker does not offer one — *which one you are authoring is decided by
     * where you author it* — and this is the other half of that sentence.
     */
    if (binding.value.kind !== 'field') continue;
    /*
     * Through `resolveValue`, which walks the chain: `⟨Author⟩ ⟨→ the record⟩
     * ⟨Name⟩` ends on a name, and a plain `⟨Title⟩` is the same walk with no
     * steps in it. This read `record.data[key]` directly, which was the whole
     * of a `Value` while a `Value` was one leaf — and two resolvers walking one
     * chain is how the canvas and the file come to disagree.
     *
     * `null` covers three things that all mean *leave the design-time prop
     * alone*: a field the record does not carry, a reference that is not set,
     * and a reference whose record is gone. That is what makes a half-filled
     * record show placeholder copy instead of a row of blanks, what stops a
     * renamed field from emptying the page before anybody notices, and what
     * stops a deleted author from printing a record id where a name was.
     * Present-but-empty is different: the record has said, and what it said is
     * nothing.
     */
    const held = resolveValue(binding.value, record, find);
    if (!held || !held.has) continue;

    out ??= { ...base };
    // The only place a formatted value exists. `record.data` is untouched, so
    // everything that reads it — the filter and the sort above, and every Test
    // that comes later — is reading the number, never the price tag.
    out[prop] = formatValue(held.raw, binding.format);

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
  return out ?? base;
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

/**
 * The record a design surface should draw a dynamic page against.
 *
 * A page that is a template for a collection has no record of its own, and
 * drawing it with the placeholder text somebody typed once is a page they
 * cannot lay out. So the canvas picks one: whichever the designer chose, or
 * the first, or none if the collection is empty — in which case the
 * placeholder is the honest answer after all.
 *
 * A stale choice falls through to the first rather than to nothing: a record
 * can be deleted from the panel while a page is pointed at it, and the page
 * going blank would be a puzzle rather than a message.
 */
export function designRecord(
  settings: ProjectSettings,
  collectionId: string | undefined,
  pool: CollectionRecord[] | undefined
): CollectionRecord | null {
  if (!collectionId) return null;
  const rows = recordsFor({ collection: collectionId }, pool);
  if (!rows.length) return null;
  const chosen = settings.designRecord?.[collectionId];
  return rows.find((record) => record.id === chosen) ?? rows[0] ?? null;
}

/** Collection ids the given nodes repeat over, for prefetching. */
export function collectionsUsedBy(
  nodes: Record<string, SceneNode>,
  nodeIds: Iterable<string>,
  collections?: Collection[]
): string[] {
  const found = new Set<string>();
  for (const id of nodeIds) {
    const collection = nodes[id]?.repeat?.collection;
    if (collection) found.add(collection);
  }
  return collections ? withReferences([...found], collections) : [...found];
}

/**
 * Those, plus every collection they point at, and so on.
 *
 * A `follow` reads a record out of another collection, so a page that says
 * `⟨Author⟩ → ⟨Name⟩` needs the authors as much as the posts — and nothing
 * repeats the authors, so nothing else was ever going to ask for them. That is
 * the bug this closes, found by a byline that came out as the placeholder on
 * both surfaces while the chain in the document was perfectly correct.
 *
 * Off the *schema* rather than off the nodes, which means it can over-fetch: a
 * `Posts` repeater whose Post declares an author nobody prints still loads the
 * authors. The alternative is resolving which chains actually follow, which
 * needs each node's scope walked and would answer *fewer* collections at the
 * cost of being wrong whenever the walk and the renderer disagree. Bounded by
 * the number of collections in the project, which is a schema-sized number, so
 * over-fetching here is one query rather than an unbounded one.
 *
 * Transitive, and it has to be: an author has a publisher. Guarded against a
 * cycle by only ever adding what is not already in the set.
 */
export function withReferences(ids: string[], collections: Collection[]): string[] {
  const seed = new Set(ids);
  const byId = new Map(collections.map((one) => [one.id, one]));
  const queue = [...seed];
  while (queue.length) {
    const current = byId.get(queue.shift()!);
    if (!current) continue;
    for (const field of current.fields) {
      if (field.type !== 'reference' || !field.of || seed.has(field.of)) continue;
      seed.add(field.of);
      queue.push(field.of);
    }
  }
  return [...seed];
}
