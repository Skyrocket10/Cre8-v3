'use client';

/**
 * Account and team controls for the dashboard header.
 *
 * Renders nothing at all in local mode — a build with no backend should not
 * grow a "Sign in" button that leads nowhere.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, LogOut, Plus, Users } from 'lucide-react';
import { api, ApiError, type Team } from '@/lib/api/client';
import { avatarColor, initials, useSession } from '@/lib/auth/session';
import { cn } from '@/lib/utils/cn';
import { Button, Popover } from '../ui/primitives';
import { MenuItem } from '../panels/pages-panel';
import { Modal } from '../chrome/publish-dialog';
import { TeamMembers } from './team-members';

export function AccountControls() {
  const { status, mode, user, teams, activeTeam, setActiveTeam, signOut, refresh } = useSession();
  const router = useRouter();
  const [managing, setManaging] = useState(false);

  if (mode === 'local') return null;

  if (status === 'loading') {
    return <span className="size-7 animate-pulse rounded-full bg-[var(--field)]" />;
  }

  if (status === 'signed-out') {
    return (
      <div className="flex items-center gap-2">
        <Button size="md" onClick={() => router.push('/signin')}>
          Sign in
        </Button>
        <Button size="md" variant="primary" onClick={() => router.push('/signup')}>
          Create account
        </Button>
      </div>
    );
  }

  const pick = (team: Team) => setActiveTeam(team.id);

  return (
    <div className="flex items-center gap-2">
      <TeamSwitcher teams={teams} active={activeTeam} onPick={pick} onCreated={refresh} />

      {activeTeam && !activeTeam.personal && (
        <Button size="md" onClick={() => setManaging(true)}>
          <Users size={12} />
          {activeTeam.memberCount}
        </Button>
      )}

      <Popover
        width={220}
        align="end"
        trigger={({ toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-label="Account"
            className="flex size-7 items-center justify-center rounded-full text-[10.5px] font-semibold text-white transition-transform hover:scale-105"
            style={{ backgroundColor: avatarColor(user?.avatarHue ?? 220) }}
          >
            {initials(user?.name ?? '?')}
          </button>
        )}
      >
        {(close) => (
          <div className="p-1">
            <div className="px-2 pt-1.5 pb-2">
              <p className="truncate text-[12px] font-medium text-[var(--text)]">{user?.name}</p>
              <p className="truncate text-[11px] text-[var(--text-faint)]">{user?.email}</p>
            </div>
            <div className="my-1 h-px bg-[var(--border-soft)]" />
            {activeTeam && !activeTeam.personal && (
              <MenuItem
                icon={<Users size={11} />}
                label="Team members"
                onClick={() => {
                  setManaging(true);
                  close();
                }}
              />
            )}
            <MenuItem
              icon={<LogOut size={11} />}
              label="Sign out"
              onClick={() => {
                void signOut();
                close();
              }}
            />
          </div>
        )}
      </Popover>

      <Modal
        open={managing}
        onClose={() => {
          setManaging(false);
          void refresh();
        }}
        title={activeTeam ? `${activeTeam.name} · members` : 'Members'}
        width={520}
      >
        {activeTeam && <TeamMembers team={activeTeam} />}
      </Modal>
    </div>
  );
}

function TeamSwitcher({
  teams,
  active,
  onPick,
  onCreated,
}: {
  teams: Team[];
  active: Team | null;
  onPick: (team: Team) => void;
  onCreated: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { team } = await api.createTeam(name.trim());
      await onCreated();
      onPick(team);
      setCreating(false);
      setName('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the team');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Popover
        width={240}
        align="end"
        trigger={({ toggle, ref, open }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            className={cn(
              'flex h-8 max-w-[220px] items-center gap-1.5 rounded-md px-2.5 transition-colors',
              open ? 'bg-[var(--field)]' : 'hover:bg-[var(--field)]'
            )}
          >
            <span className="truncate text-[12.5px] font-medium text-[var(--text)]">
              {active?.name ?? 'No workspace'}
            </span>
            <ChevronDown size={11} className="shrink-0 text-[var(--text-faint)]" />
          </button>
        )}
      >
        {(close) => (
          <div className="p-1">
            <div className="panel-title px-2 pt-1.5 pb-1">Workspaces</div>
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  onPick(team);
                  close();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[5px] px-2 py-[6px] text-left text-[11.5px]',
                  'transition-colors hover:bg-[var(--field)]',
                  team.id === active?.id ? 'text-[var(--text)]' : 'text-[var(--text-secondary)]'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{team.role}</span>
                {team.id === active?.id && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
              </button>
            ))}
            <div className="my-1 h-px bg-[var(--border-soft)]" />
            <MenuItem
              icon={<Plus size={11} />}
              label="New workspace"
              onClick={() => {
                setCreating(true);
                close();
              }}
            />
          </div>
        )}
      </Popover>

      <Modal open={creating} onClose={() => setCreating(false)} title="New workspace" width={380}>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="Design team"
              className="h-9 w-full rounded-md bg-[var(--field)] px-2.5 text-[12.5px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset"
            />
          </label>
          {error && <p className="text-[11.5px] text-[var(--danger)]">{error}</p>}
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Projects belong to a workspace. Invite people to it and they can open and edit
            everything inside.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="md" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="md" variant="primary" loading={busy} onClick={() => void create()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
