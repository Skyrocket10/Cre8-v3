'use client';

/**
 * Project dashboard and first-run experience.
 *
 * The goal is measured in seconds: land here, pick a starting point, and be
 * designing. Template choice is the first screen for a new user rather than a
 * setting buried behind an empty canvas.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Ellipsis, Plus, Rocket, Trash2 } from 'lucide-react';
import { getStorage, storageMode } from '@/lib/api/storage';
import { useSession } from '@/lib/auth/session';
import type { ProjectSummary } from '@/lib/document/types';
import { routes } from '@/lib/routes';
import { TEMPLATES } from '@/lib/templates';
import { cn, relativeTime } from '@/lib/utils/cn';
import { Button, Popover, Skeleton } from '@/components/ui/primitives';
import { Modal } from '@/components/chrome/publish-dialog';
import { MenuItem } from '@/components/panels/pages-panel';
import { AccountControls } from '@/components/auth/account-menu';
import { RequireSession } from '@/components/auth/require-session';

export default function DashboardPage() {
  return (
    <RequireSession>
      <Dashboard />
    </RequireSession>
  );
}

function Dashboard() {
  const router = useRouter();
  const { activeTeam } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  // Keyed on the workspace: switching teams shows a different set of projects,
  // and showing the previous team's list while the new one loads is a lie.
  const teamId = activeTeam?.id ?? null;

  const refresh = useCallback(async () => {
    setProjects(null);
    try {
      setProjects(await getStorage().listProjects());
    } catch (error) {
      console.error('[cre8] could not list projects', error);
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, teamId]);

  const create = useCallback(
    async (templateId: string) => {
      setCreating(templateId);
      try {
        const template = TEMPLATES.find((t) => t.id === templateId);
        if (!template) return;
        const doc = template.build();
        await getStorage().saveProject(doc);
        router.push(routes.editor(doc.id));
      } catch (error) {
        console.error('[cre8] could not create project', error);
        setCreating(null);
      }
    },
    [router]
  );

  const remove = useCallback(
    async (id: string) => {
      await getStorage().deleteProject(id);
      void refresh();
    },
    [refresh]
  );

  const firstRun = projects !== null && projects.length === 0;

  return (
    <main className="min-h-dvh bg-[var(--app)]">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--app)]/90 px-6 backdrop-blur-md">
        <span className="flex size-7 items-center justify-center rounded-md bg-[var(--text)] text-[var(--app)]">
          <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor" aria-hidden="true">
            <path d="M4 3h5.6a5 5 0 0 1 0 10H7.2v4H4V3Zm3.2 2.8v4.4h2.4a2.2 2.2 0 0 0 0-4.4H7.2Z" />
          </svg>
        </span>
        <span className="text-[13px] font-medium tracking-tight text-[var(--text)]">Cre8</span>
        <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[9.5px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
          Beta
        </span>
        <StorageBadge />
        <div className="flex-1" />
        {!firstRun && (
          <Button size="md" variant="primary" onClick={() => setPicking(true)}>
            <Plus size={12} />
            New project
          </Button>
        )}
        <AccountControls />
      </header>

      <div className="mx-auto max-w-[1120px] px-6 py-10">
        {projects === null && <ProjectSkeleton />}

        {firstRun && (
          <section className="anim-slide-up">
            <div className="mb-9 max-w-[560px]">
              <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.028em] text-[var(--text)]">
                Design a website, properly.
              </h1>
              <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--text-muted)]">
                Cre8 is a canvas that renders the real page — the same engine draws what you edit,
                what you preview and what you publish. Start from a blank canvas or a template.
              </p>
            </div>
            <TemplateGrid onPick={create} creating={creating} />
          </section>
        )}

        {projects !== null && projects.length > 0 && (
          <>
            <div className="mb-4 flex items-baseline justify-between">
              <h1 className="text-[15px] font-medium tracking-tight text-[var(--text)]">
                Your projects
              </h1>
              <span className="text-[11.5px] text-[var(--text-faint)]">
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => router.push(routes.editor(project.id))}
                  onDelete={() => void remove(project.id)}
                />
              ))}
              <button
                type="button"
                onClick={() => setPicking(true)}
                className={cn(
                  'flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-xl',
                  'border border-dashed border-[var(--border-strong)] text-[var(--text-muted)]',
                  'transition-colors duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]'
                )}
              >
                <Plus size={17} />
                <span className="text-[12px] font-medium">New project</span>
              </button>
            </div>
          </>
        )}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title="Start a new project" width={760}>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <TemplateGrid
            onPick={(id) => {
              setPicking(false);
              void create(id);
            }}
            creating={creating}
          />
        </div>
      </Modal>
    </main>
  );
}

/**
 * Where projects are being stored.
 *
 * Worth a permanent line of chrome: "my projects vanished" almost always means
 * the storage backend changed, and browser-local storage is invisible unless
 * something says so.
 */
function StorageBadge() {
  const [mode, setMode] = useState<'local' | 'hosted' | null>(null);
  useEffect(() => setMode(storageMode()), []);
  if (!mode) return null;

  return (
    <span
      title={
        mode === 'hosted'
          ? 'Projects are stored on your Cloudflare Worker'
          : 'Projects are stored in this browser only'
      }
      className="rounded-full border border-[var(--border)] px-1.5 py-px text-[9.5px] tracking-[0.06em] text-[var(--text-faint)] uppercase"
    >
      {mode === 'hosted' ? 'Cloud' : 'This browser'}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Templates
 * ----------------------------------------------------------------------- */

function TemplateGrid({
  onPick,
  creating,
}: {
  onPick: (id: string) => void;
  creating: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          disabled={Boolean(creating)}
          onClick={() => onPick(template.id)}
          className={cn(
            'group flex flex-col overflow-hidden rounded-xl border border-[var(--border)] text-left',
            'bg-[var(--panel)] transition-[border-color,transform,box-shadow] duration-150',
            'hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]',
            'disabled:pointer-events-none disabled:opacity-60'
          )}
        >
          <div
            className="relative h-[92px] w-full overflow-hidden"
            style={{
              backgroundImage: `linear-gradient(135deg, ${template.swatch[0]}, ${template.swatch[1]})`,
            }}
          >
            <TemplateWireframe id={template.id} />
            {creating === template.id && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                <span className="anim-spin size-4 rounded-full border-2 border-white border-t-transparent" />
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1 p-3">
            <span className="flex items-center gap-1 text-[12.5px] font-medium text-[var(--text)]">
              {template.name}
              <ArrowRight
                size={11}
                className="opacity-0 transition-opacity group-hover:opacity-60"
              />
            </span>
            <span className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {template.description}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Abstract page wireframe over the template's gradient. */
function TemplateWireframe({ id }: { id: string }) {
  if (id === 'blank') {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[11px] tracking-[0.08em] text-black/35 uppercase">
        Empty
      </span>
    );
  }
  return (
    <span className="absolute inset-x-4 top-4 bottom-0 flex flex-col gap-1.5 rounded-t-md bg-white/88 p-2.5 shadow-sm">
      <span className="flex items-center gap-1">
        <span className="h-1 w-6 rounded-full bg-black/45" />
        <span className="ml-auto h-1 w-3 rounded-full bg-black/20" />
        <span className="h-1 w-3 rounded-full bg-black/20" />
      </span>
      <span className="mt-1.5 h-1.5 w-3/5 rounded-full bg-black/35" />
      <span className="h-1 w-4/5 rounded-full bg-black/15" />
      <span className="mt-1 flex gap-1.5">
        <span className="h-6 flex-1 rounded bg-black/10" />
        <span className="h-6 flex-1 rounded bg-black/10" />
        <span className="h-6 flex-1 rounded bg-black/10" />
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Project card
 * ----------------------------------------------------------------------- */

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        'group flex min-h-[168px] cursor-pointer flex-col overflow-hidden rounded-xl',
        'border border-[var(--border)] bg-[var(--panel)]',
        'transition-[border-color,transform,box-shadow] duration-150',
        'hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]'
      )}
    >
      <div className="canvas-surface relative flex-1 border-b border-[var(--border)]">
        <span className="absolute inset-x-5 top-5 bottom-0 rounded-t-md bg-white/[0.07] shadow-inner" />
      </div>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-[var(--text)]">{project.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--text-faint)]">
            {project.pageCount} page{project.pageCount === 1 ? '' : 's'}
            <span>·</span>
            {relativeTime(project.updatedAt)}
            {project.published && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-[var(--success)]">
                  <Rocket size={9} />
                  Live
                </span>
              </>
            )}
          </p>
        </div>
        <Popover
          width={160}
          align="end"
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              type="button"
              aria-label="Project options"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--field)] hover:text-[var(--text)]"
            >
              <Ellipsis size={13} />
            </button>
          )}
        >
          {(close) => (
            <div className="p-1" onClick={(e) => e.stopPropagation()}>
              <MenuItem label="Open" onClick={onOpen} />
              <MenuItem
                icon={<Trash2 size={11} />}
                label="Delete"
                tone="danger"
                onClick={() => {
                  onDelete();
                  close();
                }}
              />
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-[168px] rounded-xl" />
      ))}
    </div>
  );
}
