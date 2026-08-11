/**
 * Persistence.
 *
 * The editor talks to a `StorageAdapter`, never to a database. Today the
 * default adapter is IndexedDB in the browser, which makes the product work
 * offline and with zero infrastructure. The Cloudflare adapter behind the same
 * interface (D1 for documents, R2 for assets) is a drop-in swap — see
 * `workers/` and docs/ARCHITECTURE.md.
 */

import { hydrateDocument } from '../document/factory';
import type { CollectionRecord, Cre8Document, ProjectSummary } from '../document/types';
import { hasBackend } from './client';
import { CloudflareAdapter } from './cloudflare';

/** One row a template wants written once its project exists. */
export interface SeedRecord {
  collectionId: string;
  slug?: string;
  data: Record<string, string | number | boolean | null>;
}

export interface StorageAdapter {
  readonly name: string;
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Cre8Document | null>;
  saveProject(doc: Cre8Document): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /**
   * Published output, addressed by project id.
   *
   * `files` is the complete generated site — pages plus sitemap.xml and
   * robots.txt — because a host serves files, not pages. `site` is the same
   * content in the shape the in-browser preview reads. A hosted adapter uploads
   * the former and returns where it landed; the local one keeps the latter and
   * returns nothing.
   */
  savePublished(
    projectId: string,
    site: PublishedSite,
    files: PublishedFile[],
    assets: PublishedAssetRef[]
  ): Promise<PublishedInfo | void>;
  loadPublished(projectId: string): Promise<PublishedSite | null>;
  /**
   * Store asset bytes somewhere durable and return a URL.
   *
   * Optional: the local adapter has nowhere to put them, so it leaves images
   * inlined in the document. A hosted adapter implements this and keeps
   * documents small.
   */
  uploadAsset?(projectId: string, file: Blob, filename: string): Promise<string>;
  /**
   * Every published row of one collection, for the repeaters that read it.
   *
   * Optional for the same reason `uploadAsset` is: the local adapter has no
   * record store, so a project built with no backend has collections it can
   * shape and no content to put in them. That is the documented split — the
   * schema is design and lives in the document, the records are content and
   * live in D1 — and a repeater with nothing to repeat is a normal state, not
   * an error: it draws its template row on the canvas and nothing anywhere
   * else.
   */
  /**
   * `publishedOnly` defaults to true, and the default is the safe one.
   *
   * The publisher must never ship a draft, so it takes the default. The editor
   * must be able to *see* one — a panel that hides the record you are working
   * on is a panel that reports your last write as having failed — so it asks
   * for everything explicitly.
   */
  listRecords?(
    projectId: string,
    collectionId: string,
    options?: { publishedOnly?: boolean }
  ): Promise<CollectionRecord[]>;
  /**
   * The content a template opens with.
   *
   * Optional for the same reason as the two above, and the consequence is
   * worth stating plainly: with no backend a template's collection arrives
   * shaped and empty, so the blog's index draws its template row on the canvas
   * and publishes nothing. That is the documented split rather than a failure
   * — fields are design and travel in the document, rows are content and live
   * in D1 — but it does mean the no-backend build gets a thinner blog than the
   * hosted one, and the Collections panel is where somebody fills it in.
   *
   * Rows are written in order and one at a time. A template seeds single
   * figures, and the order is what the reader sees.
   */
  createRecords?(projectId: string, rows: SeedRecord[]): Promise<void>;
  /**
   * Ask the host to render and store the site itself.
   *
   * Present only where there *is* a host. An adapter that implements this owns
   * generating too, and `publishProject` hands it nothing but a project id:
   * the whole point is that the browser stops deciding what a published page
   * contains, so it must stop being able to. `savePublished` remains for the
   * no-backend path, which has nowhere to move the work to.
   */
  publishSite?(projectId: string): Promise<PublishedSummary>;
}

/** What a host reports after publishing a project. */
export interface PublishedSummary extends PublishedInfo {
  publishedAt: number;
  bytes: number;
  pageCount: number;
  pages: { slug: string; title: string }[];
  /**
   * What the publish actually wrote, for a host that only writes what moved.
   *
   * Absent where the question has no answer: the no-backend path builds a ZIP,
   * which is every file every time by definition.
   */
  changed?: { written: number; removed: number; unchanged: number };
}

export interface PublishedPage {
  slug: string;
  title: string;
  html: string;
}

export interface PublishedSite {
  projectId: string;
  projectName: string;
  publishedAt: number;
  pages: PublishedPage[];
  bytes: number;
}

export interface PublishedFile {
  path: string;
  contents: string;
}

/**
 * An uploaded file the published site needs.
 *
 * Sent as a reference rather than bytes: the browser never had the bytes —
 * it uploaded them once and kept a URL — so re-sending them would mean
 * downloading and re-uploading megabytes on every publish.
 */
export interface PublishedAssetRef {
  key: string;
  path: string;
}

/** Where a published site ended up, once the host has decided. */
export interface PublishedInfo {
  /** Absolute when the site has its own domain; a same-origin path otherwise. */
  url: string;
  /** Hostname label, when the deployment gives sites their own domain. */
  subdomain?: string;
  /** Apex those subdomains hang off, e.g. `cre8.app`. */
  siteDomain?: string;
}

const DB_NAME = 'cre8';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_META = 'summaries';
const STORE_SITES = 'sites';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      if (!db.objectStoreNames.contains(STORE_SITES)) db.createObjectStore(STORE_SITES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function summarise(doc: Cre8Document): ProjectSummary {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pageCount: doc.pages.length,
    published: Boolean(doc.lastPublished),
  };
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly name = 'indexeddb';
  private db: Promise<IDBDatabase> | null = null;

  private connect(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.connect();
    const values = await tx<ProjectSummary[]>(db, STORE_META, 'readonly', (s) => s.getAll());
    return values.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadProject(id: string): Promise<Cre8Document | null> {
    const db = await this.connect();
    const raw = await tx<Cre8Document | undefined>(db, STORE_DOCS, 'readonly', (s) => s.get(id));
    return raw ? hydrateDocument(raw) : null;
  }

  async saveProject(doc: Cre8Document): Promise<void> {
    const db = await this.connect();
    await tx(db, STORE_DOCS, 'readwrite', (s) => s.put(doc, doc.id));
    await tx(db, STORE_META, 'readwrite', (s) => s.put(summarise(doc), doc.id));
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.connect();
    await tx(db, STORE_DOCS, 'readwrite', (s) => s.delete(id));
    await tx(db, STORE_META, 'readwrite', (s) => s.delete(id));
    await tx(db, STORE_SITES, 'readwrite', (s) => s.delete(id));
  }

  async savePublished(projectId: string, site: PublishedSite): Promise<void> {
    const db = await this.connect();
    await tx(db, STORE_SITES, 'readwrite', (s) => s.put(site, projectId));
  }

  async loadPublished(projectId: string): Promise<PublishedSite | null> {
    const db = await this.connect();
    const raw = await tx<PublishedSite | undefined>(db, STORE_SITES, 'readonly', (s) =>
      s.get(projectId)
    );
    return raw ?? null;
  }
}

/** Fallback for private-mode browsers where IndexedDB throws on open. */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memory';
  private docs = new Map<string, Cre8Document>();
  private sites = new Map<string, PublishedSite>();

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.docs.values()].map(summarise).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async loadProject(id: string) {
    const doc = this.docs.get(id);
    return doc ? hydrateDocument(doc) : null;
  }
  async saveProject(doc: Cre8Document) {
    this.docs.set(doc.id, doc);
  }
  async deleteProject(id: string) {
    this.docs.delete(id);
    this.sites.delete(id);
  }
  async savePublished(projectId: string, site: PublishedSite) {
    this.sites.set(projectId, site);
  }
  async loadPublished(projectId: string) {
    return this.sites.get(projectId) ?? null;
  }
}

let adapter: StorageAdapter | null = null;

/**
 * The active adapter.
 *
 * Chosen by whether a backend answered on boot. Deployed as one Worker, the API
 * is at `/api/*` on this same origin and projects live in D1 and R2 behind
 * accounts and teams. Served as plain static files with nothing behind them,
 * Cre8 runs with no backend at all — no sign-in, no network, works offline.
 *
 * Must not be called before `SessionProvider` has probed; `RequireSession`
 * guarantees that for every route that reads projects.
 *
 * Nothing else in the editor knows which one is in use.
 */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;

  if (hasBackend()) {
    adapter = new CloudflareAdapter();
    return adapter;
  }

  adapter = typeof indexedDB !== 'undefined' ? new IndexedDbAdapter() : new MemoryAdapter();
  return adapter;
}

/** Which backend is in play — surfaced in the dashboard so it is never a mystery. */
export function storageMode(): 'local' | 'hosted' {
  return getStorage().name === 'cloudflare' ? 'hosted' : 'local';
}

/** Override the adapter, for tests or a bespoke deployment. */
export function setStorage(next: StorageAdapter): void {
  adapter = next;
}
