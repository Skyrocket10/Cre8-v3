/**
 * A record's number, mapped onto a range.
 *
 * Phase D of the expression model, and the only part of it that produces a
 * value which differs per row:
 *
 *     price  →  normalize  →  --cre8-opacity  →  opacity: var(--cre8-opacity)
 *
 * Everything before this phase resolves to a *state*, and states are shared —
 * a hundred cards in three states need three rules. A continuous value cannot
 * be: a hundred prices are a hundred numbers. So it goes where per-row things
 * go, in the element's own `style` attribute, and the stylesheet stays one
 * rule. That is the repeater constraint honoured rather than worked around,
 * and it is the same mechanism the comparison slider has used since phase C —
 * a custom property in the markup, `var()` in the CSS, and the drawing done
 * entirely by the browser.
 *
 * The arithmetic is deliberately small: clamp, normalise, interpolate, round.
 * There is no expression language here and there is not going to be one in
 * this phase — `docs/EXPRESSIONS.md` calls D "actual arithmetic and mapping",
 * and a range map is the whole of what a designer needs to turn a price into
 * an opacity or a rating into a bar width.
 *
 * Determinism is the same requirement as everywhere else on this path and for
 * the same reason: this runs on the canvas and inside the Worker, and D3's
 * gate is that the two produce identical bytes. `toFixed` is specified to the
 * digit in ECMA-262, so the number that reaches the markup is not a matter of
 * which engine rounded it. See `format.ts` for the longer version of that
 * argument.
 */

import type { CollectionRecord, SceneNode, ValueVar } from '../document/types';
import { slug } from '../document/schema';
import { RANGE_VAR_PREFIX } from '../runtime/behaviour';

/**
 * `raw` mapped from the declared input span onto the output span.
 *
 * Returns the fallback — the start of `to` unless one was declared — whenever
 * the record has nothing usable to map. A row with no price is not a row with
 * a price of zero, and writing zero would fade it to invisible while looking
 * like a deliberate design.
 */
export function mapNumber(raw: unknown, spec: ValueVar): number {
  const [lowIn, highIn] = spec.from;
  const [lowOut, highOut] = spec.to;
  const fallback = spec.fallback ?? lowOut;

  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) return fallback;
  if (!Number.isFinite(lowIn) || !Number.isFinite(highIn)) return fallback;
  if (!Number.isFinite(lowOut) || !Number.isFinite(highOut)) return fallback;

  // A span of nothing has no position in it to find. Answering with the low
  // end is the only choice that is not a division by zero, and it is what a
  // designer who typed the same number twice almost certainly meant.
  if (lowIn === highIn) return lowOut;

  // Clamped on the input side, so a reversed output span still runs the right
  // way round: `from [0, 100] to [1, 0]` fades as the number grows.
  const clamped = Math.min(Math.max(n, Math.min(lowIn, highIn)), Math.max(lowIn, highIn));
  const position = (clamped - lowIn) / (highIn - lowIn);
  return lowOut + position * (highOut - lowOut);
}

/**
 * The number as it appears in the markup: rounded, and without a tail of zeros.
 *
 * `0.1 + 0.2` is `0.30000000000000004` and nobody wants that in an attribute
 * on every row. Rounding first also makes the output stable against a change
 * that moves a value by a millionth, which matters because publishing is
 * diffed — a fold that varied would rewrite every page.
 */
export function varText(value: number, decimals = 3): string {
  const places = Math.min(Math.max(Math.trunc(decimals), 0), 6);
  const fixed = value.toFixed(places);
  return places === 0 ? fixed : fixed.replace(/\.?0+$/, '') || '0';
}

/**
 * Every custom property this element carries for the record in scope.
 *
 * Written even when the record cannot answer, because the fallback is what
 * makes `var(--cre8-price)` safe to write without one of its own. A property
 * that was sometimes absent would make the declaration invalid at computed
 * value time on exactly the rows with missing data, and a card that loses its
 * opacity rule is a stranger bug than one that fades to the declared floor.
 */
export function varsFor(node: SceneNode, record: CollectionRecord | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(node.vars ?? {})) {
    const name = slug(key);
    if (!name || spec.value.kind !== 'field') continue;
    const raw = record ? record.data[spec.value.key] : undefined;
    out[`${RANGE_VAR_PREFIX}${name}`] = varText(mapNumber(raw, spec), spec.decimals);
  }
  return out;
}

/** What the designer pastes into a style field to use one. */
export function varReference(key: string): string {
  return `var(${RANGE_VAR_PREFIX}${slug(key)})`;
}
