'use client';

/**
 * Cloudflare storage adapter.
 *
 * Implements the same `StorageAdapter` as the local IndexedDB one, so the
 * editor cannot tell which is behind it. Selected automatically when
 * `NEXT_PUBLIC_CRE8_API_URL` is set — see `getStorage()`.
 */

import { hydrateDocument } from '../document/factory';
import type { Cre8Document, ProjectSummary } from '../document/types';
import { generateSite } from '../publishing/html';
import { api, ApiError } from './client';
import type { PublishedSite, StorageAdapter } from './storage';

/**
 * Which team new projects belong to.
 *
 * Module-level rather than threaded through every call: the storage interface
 * deliberately knows nothing about teams, and this is the one place that has
 * to. `SessionProvider` keeps it in step with the team switcher.
 */
let activeTeamId: string | null = null;

export function setActiveTeamId(teamId: string | null): void {
  activeTeamId = teamId;
}

export class CloudflareAdapter implements StorageAdapter {
  readonly name = 'cloudflare';

  async listProjects(): Promise<ProjectSummary[]> {
    const { projects } = await api.listProjects(activeTeamId ?? undefined);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      pageCount: p.pageCount,
    }));
  }

  async loadProject(id: string): Promise<Cre8Document | null> {
    try {
      const { document } = await api.getProject(id);
      return hydrateDocument(document);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async saveProject(doc: Cre8Document): Promise<void> {
    // `teamId` only matters on first save; the server ignores it thereafter
    // and keeps the project where it already lives.
    await api.saveProject({ ...doc, teamId: activeTeamId ?? undefined });
  }

  async deleteProject(id: string): Promise<void> {
    await api.deleteProject(id);
  }

  /**
   * Publishing uploads finished files. The Worker writes them to R2 and never
   * renders, so serving a published page costs a cache lookup rather than CPU.
   */
  async savePublished(projectId: string, site: PublishedSite): Promise<void> {
    await api.publish(
      projectId,
      site.pages.map((page) => ({
        path: page.slug === '' ? 'index.html' : `${page.slug}/index.html`,
        contents: page.html,
      }))
    );
  }

  /** Published sites are served by the Worker, not read back through the API. */
  async loadPublished(): Promise<PublishedSite | null> {
    return null;
  }

  async uploadAsset(projectId: string, file: Blob, filename: string): Promise<string> {
    return api.uploadAsset(projectId, file, filename);
  }
}

/** Publish including sitemap.xml and robots.txt, not just the pages. */
export async function publishToCloudflare(doc: Cre8Document): Promise<void> {
  const generated = generateSite(doc);
  await api.publish(
    doc.id,
    generated.files.map((f) => ({ path: f.path, contents: f.contents }))
  );
}
