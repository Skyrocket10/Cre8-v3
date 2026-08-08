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
import type { Cre8Document, ProjectSummary } from '../document/types';
import { isHosted } from './client';
import { CloudflareAdapter } from './cloudflare';

export interface StorageAdapter {
  readonly name: string;
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Cre8Document | null>;
  saveProject(doc: Cre8Document): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Published output, addressed by project id. */
  savePublished(projectId: string, site: PublishedSite): Promise<void>;
  loadPublished(projectId: string): Promise<PublishedSite | null>;
  /**
   * Store asset bytes somewhere durable and return a URL.
   *
   * Optional: the local adapter has nowhere to put them, so it leaves images
   * inlined in the document. A hosted adapter implements this and keeps
   * documents small.
   */
  uploadAsset?(projectId: string, file: Blob, filename: string): Promise<string>;
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
 * Hosted mode is opt-in through one build-time variable: set
 * `NEXT_PUBLIC_CRE8_API_URL` to a deployed Worker and projects live in D1 and
 * R2, behind accounts and teams. Leave it unset and Cre8 runs with no backend
 * at all — no sign-in, no network, works offline.
 *
 * Nothing else in the editor knows which one is in use.
 */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;

  if (isHosted) {
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
