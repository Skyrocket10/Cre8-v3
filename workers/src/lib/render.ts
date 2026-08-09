/**
 * The one place the Worker reaches into the app's source.
 *
 * `ARCHITECTURE.md` §1 says there is one renderer. Until D3 that was true of
 * the *canvas* and the *published file* but quietly untrue of where publishing
 * happened: the browser generated every byte and the Worker only stored them.
 * That is why a publish had to download whole collections, and why nothing on
 * the server could republish when a record changed.
 *
 * So the Worker imports the same modules the editor does. Not a copy, not a
 * port — the same files, bundled twice. `renderer/`, `document/` and
 * `publishing/` are framework-free TypeScript with no React and no DOM, which
 * is what makes that possible rather than aspirational.
 *
 * ## Why everything crosses here
 *
 * One import site, so the boundary is greppable and a static check can hold it
 * to one. Reaching into `../../../src` from ten different route files would
 * make "does the Worker depend on the app?" a question nobody could answer
 * quickly, and the answer matters: anything imported here is bundled into
 * every Worker invocation.
 *
 * ## The DOM
 *
 * The Worker has no DOM lib, and it must not get one — `@cloudflare/workers-
 * types` loses to it, so `Request`, `Response` and `FormData` would silently
 * become the browser's. The two serialised browser runtimes therefore declare
 * the handful of DOM members they touch instead of borrowing ambient names;
 * see the long note at the top of `runtime/behaviour.ts`.
 */

export { hydrateDocument } from '../../../src/lib/document/factory';
export { generateSite, pagePath } from '../../../src/lib/publishing/html';
export { collectionsUsedBy } from '../../../src/lib/renderer/repeat';
export type { RecordSet } from '../../../src/lib/renderer/repeat';
export type { GeneratedSite } from '../../../src/lib/publishing/html';
export type { CollectionRecord, Cre8Document } from '../../../src/lib/document/types';
