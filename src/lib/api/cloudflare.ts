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
   * Published rows only, and enough of them for the hungriest reader.
   *
   * That is the *route* ceiling, not the repeater's: a repeater shows at most
   * five hundred, but a dynamic page publishes one file per record up to a
   * thousand, and fetching the smaller number would have capped a blog at
   * five hundred posts without saying so. One more than the ceiling, so
   * "at the limit" can be told from "over it" and refused with a message.
   *
   * The record table (D5) pages against the same route with its own window;
   * this is the renderer's view, not the editor's.
   */
  async listRecords(projectId: string, collectionId: string): Promise<CollectionRecord[]> {
    // Fetched a window at a time, because the API caps one response at 200
    // rows and asking for a thousand would quietly have got two hundred. That
    // cap is right — it stops one request pulling a whole table — so the
    // paging belongs here rather than in a bigger limit.
    //
    // Cost: up to six requests for a collection that big, once per session,
    // and the result is cached by the store. The canvas rarely needs them all,
    // but a ZIP export does, and one code path that is sometimes generous
    // beats two that disagree.
    const wanted = LIMITS.pagesPerRoute + 1;
    const page = 200;
    const out: CollectionRecord[] = [];
    while (out.length < wanted) {
      const { records } = await api.listRecords(projectId, collectionId, {
        limit: Math.min(page, wanted - out.length),
        offset: out.length,
        publishedOnly: true,
      });
      out.push(...records);
      if (records.length < page) break;
    }
    return out;
  }
}
