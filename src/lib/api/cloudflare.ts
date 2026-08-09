'use client';

/**
 * Cloudflare storage adapter.
 *
 * Implements the same `StorageAdapter` as the local IndexedDB one, so the
 * editor cannot tell which is behind it. Selected automatically when the boot
 * probe finds an API answering — see `getStorage()`.
 */

import { hydrateDocument } from '../document/factory';
import { LIMITS } from '../document/types';
import type { CollectionRecord, Cre8Document, ProjectSummary } from '../document/types';
import { api, ApiError } from './client';
import type {
  PublishedInfo,
  PublishedSite,
  PublishedSummary,
  StorageAdapter,
} from './storage';

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
   * Publishing is one request carrying a project id and nothing else.
   *
   * The Worker reads the live document from the room, reads the rows its
   * repeaters point at out of D1, and runs the same generator the editor used
   * to run. Serving the result still costs a cache lookup rather than CPU —
   * what moved is where the bytes are made, not where they are read.
   */
  async publishSite(projectId: string): Promise<PublishedSummary> {
    const result = await api.publish(projectId);
    return {
      publishedAt: result.publishedAt,
      bytes: result.bytes,
      pageCount: result.pageCount,
      pages: result.pages,
      url: result.url,
      subdomain: result.subdomain,
      siteDomain: result.siteDomain,
    };
  }

  /**
   * Unreachable, and declared only because the interface requires it.
   *
   * `publishSite` above is what this adapter uses, and `publishProject`
   * prefers it. Storing bytes a client generated is exactly the arrangement
   * D3 removed: it is what forced every publish to download whole collections
   * and what made republish-on-change impossible.
   */
  async savePublished(): Promise<PublishedInfo> {
    throw new Error('This host publishes for itself — call publishSite');
  }

  /** Published sites are served by the Worker, not read back through the API. */
  async loadPublished(): Promise<PublishedSite | null> {
    return null;
  }

  async uploadAsset(projectId: string, file: Blob, filename: string): Promise<string> {
    return api.uploadAsset(projectId, file, filename);
  }

  /**
   * Published rows only, and no more of them than a repeater may show.
   *
   * The clamp is the same number the renderer applies, asked for at the source
   * instead of after the fact — a collection of five thousand should not cross
   * the wire so the canvas can throw away four and a half. The record table
   * (D5) pages against the same route with its own window; this is the
   * renderer's view, not the editor's.
   */
  async listRecords(projectId: string, collectionId: string): Promise<CollectionRecord[]> {
    const { records } = await api.listRecords(projectId, collectionId, {
      limit: LIMITS.recordsPerRepeat,
      publishedOnly: true,
    });
    return records;
  }
}
