/**
 * Data conditions.
 *
 * Stage 3 of `STATE-AND-CONDITIONS.md`, and the test of whether the layering
 * underneath it is right:
 *
 *     condition  →  state  →  CSS / DOM effect
 *
 * A data condition gets no rendering path of its own. It resolves to a value
 * written onto the document element, and from there it is indistinguishable
 * from a switch — the same selector shape, the same ordering, the same
 * expansion into one element per alternative. The generator learned one
 * anchor. Nothing else in the state engine moved.
 *
 * ## What counts as data here
 *
 * Only what a browser knows **synchronously, locally, and without storing
 * anything**. That is not a placeholder for something better; it is the line
 * where the design stops being honest, and it is drawn in three places:
 *
 * *Synchronously*, because the resolver runs in `<head>` before the body is
 * parsed. There is no flash — not a short one, none — and that is the property
 * every other decision in this project has been made to keep.
 *
 * *Locally*, because a round trip cannot be synchronous. Anything that needs
 * one — who is signed in, what a record says — belongs at the edge, filled in
 * before the HTML is sent, and Cre8 has no edge data layer yet. Offering it
 * from the client instead would mean the page painting the wrong thing and
 * correcting itself, which is exactly what the scripting-disabled test exists
 * to prevent.
 *
 * *Without storing anything*, because storage is a consent question, and
 * `dismissibleNoticeSpec` already answers it: a block has no business making
 * that decision on a visitor's behalf. So there is no "returning visitor"
 * source, however obviously useful it looks.
 */

import { eachCondition } from '../document/when';
import type { ProjectSettings, SceneNode } from '../document/types';

/** One token list on `<html>`, `source:value` per entry, matched with `~=`. */
export const DATA_ATTR = 'data-cre8-data';

export interface DataSource {
  id: string;
  label: string;
  hint: string;
  /** What it can be. A URL parameter is open-ended and has none. */
  values: string[];
  /** What the published file carries until the resolver replaces it. */
  fallback: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'time',
    label: 'Time of day',
    hint: 'The visitor’s own clock, not the server’s',
    values: ['morning', 'afternoon', 'evening', 'night'],
    // Arbitrary, and meant to be changed: whatever ships is what a visitor
    // with no scripting sees for ever, so it is the designer's call.
    fallback: 'afternoon',
  },
  {
    id: 'referrer',
    label: 'Arrived from',
    hint: 'Where the visit came from, as far as the browser will say',
    values: ['direct', 'search', 'social', 'link'],
    fallback: 'direct',
  },
];

/**
 * A URL parameter, as a source id.
 *
 * Open-ended on purpose — a campaign is `?ref=acme`, and the set of campaigns
 * is not knowable when the site is built. It has no fallback for the same
 * reason: a parameter that is not in the URL should read as absent, and an
 * invented default would make every visit look like it came from somewhere.
 */
export const QUERY_PREFIX = 'query.';

/**
 * Parameters this site puts in its own URLs, so they read as facts rather than
 * as strings somebody has to know.
 *
 * `sent` is the whole of the form round trip. A published form posts to
 * `/api/f/…?r=<path>`, the endpoint answers `303` back to that path with
 * `sent=1` on it, and the resolver turns that into `query.sent:1` before the
 * first paint. So "say thank you once the form has been sent" is a condition
 * on an ordinary visit — no event, no listener, and nothing for a visitor with
 * scripting off to miss, because the redirect is the server's.
 *
 * Every piece of that shipped long ago and none of it was reachable: the
 * source could not be changed in the panel, so the only condition anybody
 * could write was on the time of day. Naming it here is what makes the round
 * trip discoverable rather than folklore.
 */
const KNOWN_QUERY: Record<string, { label: string; hint: string; values: string[] }> = {
  sent: {
    label: 'A form was just sent',
    hint: 'The submissions endpoint adds ?sent=1 on the way back to the page',
    values: ['1'],
  },
};

export function describeSource(id: string): DataSource | null {
  const known = DATA_SOURCES.find((source) => source.id === id);
  if (known) return known;
  if (!id.startsWith(QUERY_PREFIX)) return null;
  const name = id.slice(QUERY_PREFIX.length);
  const named = KNOWN_QUERY[name];
  return {
    id,
    label: named?.label ?? `?${name}`,
    hint: named?.hint ?? 'A URL parameter — absent unless the link carries it',
    values: named?.values ?? [],
    fallback: '',
  };
}

/** Every source the panel can offer: the declared ones, and the ones we mint. */
export function offerableSources(): DataSource[] {
  return [
    ...DATA_SOURCES,
    ...Object.keys(KNOWN_QUERY).map((name) => describeSource(`${QUERY_PREFIX}${name}`)!),
  ];
}

/**
 * Every data source the given nodes actually condition on.
 *
 * Read off the rules rather than declared anywhere, for the same reason the
 * switch panel reads its values off the tree: two records of one fact drift,
 * and this one decides whether a page carries a script at all.
 */
export function collectDataSources(
  nodes: Record<string, SceneNode>,
  ids: Iterable<string>
): Set<string> {
  const found = new Set<string>();
  for (const id of ids) {
    for (const rule of nodes[id]?.rules ?? []) {
      // Every condition, however deep. This decides whether the page carries
      // the resolver script at all, so a source buried inside an "any of
      // these" that this walk missed would publish a page whose rule can
      // never come true.
      eachCondition(rule.when, (condition) => {
        if (condition.kind === 'data' && condition.source) found.add(condition.source);
      });
    }
  }
  return found;
}

/** Which value the designer is working against, for one source. */
export function designValue(settings: ProjectSettings, id: string): string {
  const source = describeSource(id);
  if (!source) return '';
  const config = settings.data?.[id];
  return config?.designing || config?.ships || source.fallback;
}

/** The token list a published page ships with. */
export function fallbackTokens(settings: ProjectSettings, sources: Iterable<string>): string {
  const out: string[] = [];
  for (const id of sources) {
    const source = describeSource(id);
    if (!source) continue;
    const chosen = settings.data?.[id]?.ships ?? source.fallback;
    if (chosen) out.push(`${id}:${chosen}`);
  }
  return out.join(' ');
}

/** The same list, but showing whichever value the designer is working against. */
export function designTokens(settings: ProjectSettings, sources: Iterable<string>): string {
  const out: string[] = [];
  for (const id of sources) {
    const chosen = designValue(settings, id);
    if (chosen) out.push(`${id}:${chosen}`);
  }
  return out.join(' ');
}

/** The one element the resolver writes to, and the one member it uses. */
interface Attributed {
  setAttribute(name: string, value: string): void;
}

/**
 * The two browser globals the resolver reads, shadowing the ambient ones.
 *
 * Module-scoped, so nothing outside this file sees them — and the file is
 * checked against these rather than against the DOM lib on both platforms,
 * which is the point: it must mean the same thing in the app and in a Worker.
 */
declare const document: { readonly referrer: string };
declare const location: { readonly host: string; readonly search: string };

/**
 * Resolve every source and write them onto the document element.
 *
 * Serialised with `Function.prototype.toString()` like the behaviour runtime,
 * and under the same rule: **completely self-contained**. No imports, no
 * shared constants, every string a literal. A bundler renames module-scope
 * bindings, and a renamed binding inside a serialised function is a
 * `ReferenceError` on somebody's live site.
 *
 * It replaces the whole attribute rather than merging into it, which is what
 * makes it idempotent — the fallback the file shipped with is a guess, and
 * every guess it could have made is one this function also computes.
 *
 * The browser globals it reads are declared just above rather than taken from
 * the DOM lib, for the reason `behaviour.ts` sets out at length: the publisher
 * that embeds this string also runs in a Worker, which has no DOM lib and
 * where `Element` already means an `HTMLRewriter` element.
 *
 * @param root `document.documentElement` on a published page, the frame in
 *   preview. Not called on the canvas at all: there the value is one the
 *   designer picked, the same way a switch's design-time case works.
 */
export function dataRuntime(root: Attributed): void {
  var out: string[] = [];

  var hour = new Date().getHours();
  out.push(
    'time:' +
      (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night')
  );

  // `document.referrer` is empty for a direct visit, and increasingly empty
  // for a real one too — a referrer policy elsewhere can strip it. Reading
  // that as "direct" is the honest failure: it is what the browser said.
  var referrer = document.referrer || '';
  var host = '';
  var match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(referrer);
  if (match) host = match[1]!.toLowerCase();
  var arrived = 'direct';
  if (host && host !== location.host) {
    arrived = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage)\./.test(
      host
    )
      ? 'search'
      : /(^|\.)(facebook|instagram|twitter|x|linkedin|reddit|pinterest|tiktok|youtube|threads|mastodon|bsky|t)\./.test(
            host
          )
        ? 'social'
        : 'link';
  }
  out.push('referrer:' + arrived);

  // Slugged to the same alphabet the generator puts in a selector, because
  // that is where these end up. A parameter that slugs to nothing is dropped
  // rather than written as an empty token.
  function slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  var seen = 0;
  var params = new URLSearchParams(location.search);
  params.forEach(function (value: string, name: string) {
    if (seen >= 10) return;
    var key = slug(name);
    var slugged = slug(value);
    if (!key || !slugged) return;
    seen++;
    out.push('query.' + key + ':' + slugged);
  });

  root.setAttribute('data-cre8-data', out.join(' '));
}

/**
 * The resolver as a string, for the publisher to inline into `<head>`.
 *
 * The head, not the end of the body, and that placement is the whole design:
 * a classic script there blocks parsing, so it runs before a single element of
 * the body exists. The attribute is correct before the first paint rather than
 * corrected after it.
 */
export function dataRuntimeSource(): string {
  return `(${dataRuntime.toString()})(document.documentElement)`;
}
