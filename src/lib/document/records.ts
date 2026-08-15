/**
 * The order records are in, and how a field of one reads.
 *
 * Split out of `renderer/repeat.ts` for the reason `schedule.ts` was split out
 * of `renderer/test.ts`: two things need it and one of them is upstream of the
 * renderer. A repeater sorts the rows it draws; a chain's `sortedBy` step sorts
 * the rows it reduces. Those two have to be *the same order*, because one page
 * shows both at once — `⟨The first Post⟩ → ⟨Title⟩` in a hero, over a list of
 * the same posts — and a headline naming somebody who is not at the top of the
 * list underneath it is a lie the page itself disproves.
 *
 * A second comparator agreeing with the first is not a design, it is a
 * coincidence with a maintenance schedule. `repeat.ts` already imports
 * `schedule.ts`, so the resolver could not import the comparator back out of
 * it; here, both can.
 */

import type { CollectionRecord } from './types';

/** What a record's field holds once read out of `data`. */
export type FieldValue = string | number | boolean | null | undefined;

/**
 * Which field to order on, and which way.
 *
 * Structurally `RepeatSpec['sort']`, which is what a repeater passes. Named
 * here rather than imported from there because the dependency runs the other
 * way: this is what an order *is*, and a repeat spec is one place that holds
 * one.
 */
export interface RecordOrder {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * A total order, whatever the field holds.
 *
 * `position` then `createdAt` then `id` break every tie, so two records never
 * swap places between one publish and the next — the sort is stable in V8 but
 * not by specification, and "the diff is empty" is a property D6 depends on.
 *
 * `undefined` is the unsorted order, which is not "no order": it is position,
 * age, id — the order a designer sees in the Collections panel and the one a
 * repeater draws when nobody has chosen.
 */
export function compareWith(sort: RecordOrder | undefined) {
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

export function compare(a: FieldValue, b: FieldValue): number {
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

export function fieldOf(record: CollectionRecord, field: string): FieldValue {
  return field ? record.data[field] : undefined;
}

export function text(value: FieldValue): string {
  return value === undefined || value === null ? '' : String(value);
}
