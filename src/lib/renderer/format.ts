/**
 * Turning a record's value into the text a page shows.
 *
 * Every function here is pure, total, and written out longhand. There is no
 * `Intl`, no locale database, no `toLocaleString`, and no reading of the local
 * time zone — for the reason `repeat.ts` gives for refusing `localeCompare`:
 *
 *   > it consults ICU data that differs between a browser and a Worker, which
 *   > is precisely the kind of "works on my machine" the byte-identical gate
 *   > exists to catch.
 *
 * That gate is D3's, and it is not theoretical for formatting. `Intl` renders
 * `fr-FR` currency with U+00A0 on one ICU version and U+202F on the next, so a
 * page published by the Worker and the same page rendered on the canvas would
 * differ by an invisible character nobody could see and every diff would show.
 * Longhand is duller and it is the same bytes everywhere.
 *
 * The cost is honest: dates read in English, and a currency is a symbol the
 * designer types rather than a code looked up in a table. Both are real
 * limitations, and both are better than output that depends on which engine ran
 * it. Locales are a model, and a model is worth having before it is faked.
 *
 * Where this sits: formatting is presentation. `Format` is a property of a
 * `Binding`, not of a `Value`, so nothing that compares values can reach it.
 */

import type { DatePattern, Field, FieldType, Format } from '../document/types';

/** What a record's field holds, and what a formatted one becomes. */
type Raw = string | number | boolean | null | undefined;

/* --------------------------------------------------------------------------
 * The entry point
 * ----------------------------------------------------------------------- */

/**
 * `raw` as the binding asks for it.
 *
 * Returns the input untouched whenever it cannot do better: no format, nothing
 * to format, or a value the format does not apply to. A formatter that printed
 * `NaN` or `Invalid Date` into somebody's published page would be worse than
 * one that printed what the record said.
 */
export function formatValue(raw: Raw, format: Format | undefined): Raw {
  if (!format) return raw;
  // Deliberately not `!raw`: `0` and `false` are values a record has said, and
  // `$0.00` is the right answer for a free product.
  if (raw === null || raw === undefined || raw === '') return raw;

  switch (format.kind) {
    case 'number':
      return numeric(raw, format.decimals ?? 0, format.group ?? true, '', '');
    case 'currency':
      return money(raw, format);
    case 'percent':
      return numeric(raw, format.decimals ?? 0, format.group ?? true, '', '%');
    case 'date':
      return date(raw, format.pattern);
    case 'case':
      return recase(String(raw), format.to);
    case 'truncate':
      return truncate(String(raw), format.chars);
  }
}

/* --------------------------------------------------------------------------
 * Numbers
 * ----------------------------------------------------------------------- */

/**
 * A number with a fixed number of decimals, grouped, wrapped.
 *
 * `toFixed` is specified down to the digit in ECMA-262 rather than left to the
 * platform, so it is one of the few formatting primitives that is safe here.
 */
function numeric(raw: Raw, decimals: number, group: boolean, before: string, after: string): Raw {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return raw;

  const places = Math.min(Math.max(Math.trunc(decimals), 0), 6);
  const body = Math.abs(n).toFixed(places);
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? '' : body.slice(dot);

  // Rounding can eat the whole value: -0.4 to no decimals is 0, and "-0" is
  // not a price anybody has ever quoted.
  const sign = n < 0 && Number(body) !== 0 ? '-' : '';
  return sign + before + (group ? grouped(whole) : whole) + fraction + after;
}

function money(raw: Raw, format: Extract<Format, { kind: 'currency' }>): Raw {
  const symbol = format.symbol ?? '$';
  const decimals = format.decimals ?? 2;
  const group = format.group ?? true;
  return format.after
    ? numeric(raw, decimals, group, '', symbol)
    : numeric(raw, decimals, group, symbol, '');
}

/** `1234567` → `1,234,567`. Right to left, because that is where the groups start. */
function grouped(whole: string): string {
  let out = '';
  for (let end = whole.length; end > 0; end -= 3) {
    out = whole.slice(Math.max(0, end - 3), end) + (out && ',') + out;
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Dates
 * ----------------------------------------------------------------------- */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A calendar date, read as written.
 *
 * An ISO string is taken apart with a regular expression rather than handed to
 * `Date`, which means `2026-08-11T23:00:00-05:00` prints as 11 August: the day
 * the author typed, not the day it becomes in some other zone. That is both the
 * more useful answer for a publication date and the only one that does not
 * depend on where the code is running — the canvas is in the designer's time
 * zone and the Worker is in UTC, so anything zone-sensitive would make the two
 * disagree for several hours a day.
 *
 * A number is epoch milliseconds and is read in UTC for the same reason.
 */
function date(raw: Raw, pattern: DatePattern): Raw {
  const parts = calendar(raw);
  if (!parts) return raw;
  const { year, month, day } = parts;
  const name = MONTHS[month - 1]!;

  switch (pattern) {
    case 'iso':
      return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
    case 'long':
      return `${day} ${name} ${year}`;
    case 'us':
      return `${name} ${day}, ${year}`;
    case 'short':
      return `${day} ${name.slice(0, 3)} ${year}`;
    case 'monthYear':
      return `${name} ${year}`;
  }
}

function calendar(raw: Raw): { year: number; month: number; day: number } | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) return null;
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(String(raw).trim());
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = Number(iso[3]);
  // A string that looks like a date and is not one — 2026-13-40 — passes
  // through rather than becoming "40 undefined 2026".
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/* --------------------------------------------------------------------------
 * Text
 * ----------------------------------------------------------------------- */

/**
 * `toUpperCase`, not `toLocaleUpperCase`: the plain one is locale-independent
 * by specification, and the locale-aware one turns a Turkish `i` into a
 * different letter depending on who is looking.
 */
function recase(text: string, to: 'upper' | 'lower' | 'capitalize'): string {
  if (to === 'upper') return text.toUpperCase();
  if (to === 'lower') return text.toLowerCase();
  // Only the first letter of each word is touched. Lowercasing the rest would
  // turn MacDonald into Macdonald, and a formatter has no business knowing
  // which names are spelled like that.
  return text.replace(/(^|\s)(\S)/g, (_, space: string, first: string) => space + first.toUpperCase());
}

/**
 * The first `chars` characters, cut at a word.
 *
 * Backing up to a space is skipped when the space is near the start — a long
 * word would otherwise truncate to almost nothing, which reads as a bug rather
 * than as an excerpt.
 */
function truncate(text: string, chars: number): string {
  const limit = Math.min(Math.max(Math.trunc(chars), 1), 10_000);
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  const body = space > limit * 0.6 ? cut.slice(0, space) : cut;
  return body.replace(/[\s,;:.!?-]+$/, '') + '…';
}

/* --------------------------------------------------------------------------
 * What may be formatted, and how
 * ----------------------------------------------------------------------- */

export type FormatKind = Format['kind'];

/**
 * Which formats make sense for which kind of field.
 *
 * Not a safety rule — a mismatched format passes its value through untouched —
 * but an interface one. Offering "as currency" on a checkbox is a control that
 * appears to do nothing, and the picker is generated from this table so the
 * question never comes up.
 *
 * `richtext` gets nothing on purpose: it is markup, and every transform here
 * would cut a tag in half.
 */
export const FORMATS_FOR: Record<FieldType, readonly FormatKind[]> = {
  text: ['case', 'truncate'],
  richtext: [],
  number: ['number', 'currency', 'percent'],
  boolean: [],
  date: ['date'],
  image: [],
  select: ['case', 'truncate'],
  reference: [],
};

/**
 * Props that are addresses rather than prose.
 *
 * There is no reading of "the image URL in title case" that is not a broken
 * image, so the picker does not offer a format for these and the document check
 * refuses one that got in another way.
 */
export const UNFORMATTABLE_PROPS: readonly string[] = ['src', 'href'];

/** Whether a format may be offered at all for this prop and field. */
export function formatsFor(prop: string, field: Field | undefined): readonly FormatKind[] {
  if (!field || UNFORMATTABLE_PROPS.includes(prop)) return [];
  return FORMATS_FOR[field.type];
}

/** What the inspector calls each one, and what it defaults to when chosen. */
export const FORMAT_LABELS: Record<FormatKind, string> = {
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
  case: 'Capitalisation',
  truncate: 'Shorten',
};

export function defaultFormat(kind: FormatKind): Format {
  switch (kind) {
    case 'number':
      return { kind: 'number', decimals: 0 };
    case 'currency':
      return { kind: 'currency', symbol: '$', decimals: 2 };
    case 'percent':
      return { kind: 'percent', decimals: 0 };
    case 'date':
      return { kind: 'date', pattern: 'long' };
    case 'case':
      return { kind: 'case', to: 'upper' };
    case 'truncate':
      return { kind: 'truncate', chars: 120 };
  }
}

/** Every date pattern, with an example, for the picker. */
export const DATE_PATTERNS: ReadonlyArray<{ value: DatePattern; label: string }> = [
  { value: 'long', label: '11 August 2026' },
  { value: 'us', label: 'August 11, 2026' },
  { value: 'short', label: '11 Aug 2026' },
  { value: 'monthYear', label: 'August 2026' },
  { value: 'iso', label: '2026-08-11' },
];
