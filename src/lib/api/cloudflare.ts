'use client';

/**
 * Cloudflare storage adapter.
 *
 * Implements the same `StorageAdapter` interface as the local IndexedDB one, so
 * switching a deployment from offline-first to hosted is one call to
 * `setStorage(new CloudflareAdapter(...))` at boot — nothing in the editor
 * changes, because nothing in the editor knows where documents live.
 *
 * Not wired up by default: the local adapter is what makes Cre8 work with zero
 * infrastructure. See workers/ and docs/ARCHITECTURE.md to enable it.
 */

import { hydrateDocument } from '../document/factory';
import type { Cre8Document, ProjectSummary } from '../document/types';
import { generateSite } from '../publishing/html';
import type { PublishedSite, StorageAdapter } from './storage';

export interface CloudflareAdapterOptions {
  /** Base URL of the deployed API Worker, e.g. https://cre8-api.example.workers.dev */
  baseUrl: string;
  /** Sent as `x-cre8-owner` until a real auth provider is attached. */
  ownerId?: string;
  fetchImpl?: typeof fetch;
}

export class CloudflareAdapter implements StorageAdapter {
  readonly name = 'cloudflare';
  private readonly base: string;
  private readonly owner: string;
  private readonly http: typeof fetch;

  constructor(options: CloudflareAdapterOptions) {
    this.base = options.baseUrl.replace(/\/$/, '');
    this.owner = options.ownerId ?? 'local';
    this.http = options.fetchImpl ?? fetch.bind(globalThis);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.http(`${this.base}${path}`, {
      ...init,
      headers: {
        'x-cre8-owner': this.owner,
        ...(init?.body && !(init.body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}`);
    return (await response.json()) as T;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const { projects } = await this.request<{ projects: ProjectSummary[] }>('/api/projects');
    return projects;
  }

  async loadProject(id: string): Promise<Cre8Document | null> {
    try {
      return hydrateDocument(await this.request<Partial<Cre8Document>>(`/api/projects/${id}`));
    } catch {
      return null;
    }
  }

  async saveProject(doc: Cre8Document): Promise<void> {
    await this.request('/api/projects', { method: 'POST', body: JSON.stringify(doc) });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/api/projects/${id}`, { method: 'DELETE' });
  }

  /**
   * Publishing uploads finished files. The Worker only writes them to R2 — it
   * never renders — so a visitor request costs a cache lookup, not CPU.
   */
  async savePublished(projectId: string, site: PublishedSite): Promise<void> {
    const files = site.pages.map((page) => ({
      path: page.slug === '' ? 'index.html' : `${page.slug}/index.html`,
      contents: page.html,
    }));
    await this.request(`/api/projects/${projectId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    });
  }

  /** Published sites are served by the Worker, not read back through the API. */
  async loadPublished(): Promise<PublishedSite | null> {
    return null;
  }

  /**
   * Store asset bytes in R2 and return a CDN-backed URL.
   *
   * This is what keeps hosted documents small: without it every image would
   * stay inlined as a data URL inside the document row.
   */
  async uploadAsset(projectId: string, file: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('file', file, filename);
    const result = await this.request<{ url: string }>('/api/assets', {
      method: 'POST',
      body: form,
    });
    return `${this.base}${result.url}`;
  }
}

/** Convenience for a publish that also writes sitemap.xml and robots.txt. */
export async function publishToCloudflare(
  adapter: CloudflareAdapter,
  doc: Cre8Document
): Promise<void> {
  const generated = generateSite(doc);
  await adapter.savePublished(doc.id, {
    projectId: doc.id,
    projectName: doc.settings.siteName || doc.name,
    publishedAt: Date.now(),
    bytes: generated.totalBytes,
    pages: generated.files
      .filter((f) => f.path.endsWith('.html'))
      .map((f) => ({
        slug: f.path === 'index.html' ? '' : f.path.replace(/\/index\.html$/, ''),
        title: doc.settings.siteName,
        html: f.contents,
      })),
  });
}
