'use client';

/**
 * Members and invites for one workspace.
 *
 * Invites are links, not emails — the API has no mail provider behind it. That
 * makes one moment load-bearing: the raw token comes back exactly once, from
 * the call that creates it, and only its hash is stored. So the link is shown
 * immediately, stays on screen until it is dismissed, and copying it is the
 * most prominent thing in the panel. Lose it and the invite has to be revoked
 * and reissued.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, LogOut, Trash2, UserPlus } from 'lucide-react';
import {
  api,
  ApiError,
  type PendingInvite,
  type Role,
  type Team,
  type TeamMember,
} from '@/lib/api/client';
import { avatarColor, initials, useSession } from '@/lib/auth/session';
import { cn } from '@/lib/utils/cn';
import { Button, EmptyState, Select, Skeleton } from '../ui/primitives';

/** Roles an admin can hand out. Ownership is deliberately not one of them. */
const ASSIGNABLE: { value: Role; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Manage members' },
  { value: 'editor', label: 'Editor', hint: 'Design and publish' },
  { value: 'viewer', label: 'Viewer', hint: 'Read only' },
];

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function TeamMembers({ team }: { team: Team }) {
  const { user, refresh } = useSession();

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [freshInvite, setFreshInvite] = useState<{ email: string; url: string } | null>(null);

  const canManage = RANK[team.role] >= RANK.admin;

  const load = useCallback(async () => {
    try {
      const result = await api.members(team.id);
      setMembers(result.members);
      setInvites(result.invites);
      setError(null);
    } catch (caught) {
      setMembers([]);
      setError(caught instanceof ApiError ? caught.message : 'Could not load the member list');
    }
  }, [team.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any change to membership can change the caller's own access, so re-read both. */
  const reload = async () => {
    await load();
    await refresh();
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      {canManage && (
        <InviteRow
          teamId={team.id}
          onInvited={async (email, token) => {
            setFreshInvite({ email, url: `${window.location.origin}/invite?token=${token}` });
            await load();
          }}
          onError={setError}
        />
      )}

      {freshInvite && (
        <InviteLink invite={freshInvite} onDismiss={() => setFreshInvite(null)} />
      )}

      {error && (
        <p className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[11.5px] text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {members === null ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState compact title="Nobody here yet" description="Invite someone to get started." />
        ) : (
          <div className="p-2">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                team={team}
                isSelf={member.id === user?.id}
                canManage={canManage}
                onChanged={reload}
                onError={setError}
              />
            ))}
          </div>
        )}

        {invites.length > 0 && (
          <div className="border-t border-[var(--border-soft)] p-2">
            <div className="panel-title px-2 pt-1 pb-1.5">Pending invites</div>
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--field)]"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--text-faint)]">
                  <Link2 size={11} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-[var(--text-secondary)]">{invite.email}</p>
                  <p className="text-[10.5px] text-[var(--text-faint)]">
                    {invite.role} · expires {relativeDays(invite.expires_at)}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void api
                        .revokeInvite(team.id, invite.id)
                        .then(load)
                        .catch((caught: unknown) =>
                          setError(caught instanceof ApiError ? caught.message : 'Could not revoke')
                        )
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * One member
 * ----------------------------------------------------------------------- */

function MemberRow({
  member,
  team,
  isSelf,
  canManage,
  onChanged,
  onError,
}: {
  member: TeamMember;
  team: Team;
  isSelf: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Mirrors what the server enforces, so the UI never offers a doomed action:
  // owners are untouchable, and nobody can grant a role above their own.
  const editable = canManage && member.role !== 'owner' && !isSelf;
  const options = ASSIGNABLE.filter((option) => RANK[option.value] <= RANK[team.role]);
  const removable = member.role !== 'owner' && (canManage || isSelf);

  const run = async (action: Promise<unknown>) => {
    setBusy(true);
    try {
      await action;
      await onChanged();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--field)]',
        busy && 'opacity-50'
      )}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(member.avatarHue) }}
      >
        {initials(member.name)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-[var(--text)]">
          {member.name}
          {isSelf && <span className="ml-1.5 text-[10.5px] text-[var(--text-faint)]">you</span>}
        </p>
        <p className="truncate text-[10.5px] text-[var(--text-faint)]">{member.email}</p>
      </div>

      {editable ? (
        <Select
          width={168}
          options={options}
          value={member.role}
          onChange={(role) => void run(api.setMemberRole(team.id, member.id, role))}
          className="w-[92px]"
        />
      ) : (
        <span className="shrink-0 px-1 text-[11px] text-[var(--text-muted)] capitalize">
          {member.role}
        </span>
      )}

      {removable ? (
        <Button
          size="xs"
          variant="ghost"
          aria-label={isSelf ? 'Leave workspace' : `Remove ${member.name}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--danger)]"
          onClick={() => void run(api.removeMember(team.id, member.id))}
        >
          {isSelf ? <LogOut size={11} /> : <Trash2 size={11} />}
        </Button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Invite
 * ----------------------------------------------------------------------- */

function InviteRow({
  teamId,
  onInvited,
  onError,
}: {
  teamId: string;
  onInvited: (email: string, token: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const invite = await api.invite(teamId, trimmed, role);
      setEmail('');
      await onInvited(invite.email, invite.token);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not create the invite');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-soft)] p-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void send()}
        placeholder="teammate@company.com"
        className={cn(
          'h-8 min-w-0 flex-1 rounded-md bg-[var(--field)] px-2.5 text-[12px] text-[var(--text)]',
          'outline-none transition-colors placeholder:text-[var(--text-faint)]',
          'hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset'
        )}
      />
      <Select
        size="md"
        width={168}
        options={ASSIGNABLE}
        value={role}
        onChange={setRole}
        className="w-[86px] shrink-0"
      />
      <Button size="md" variant="primary" loading={busy} onClick={() => void send()}>
        <UserPlus size={12} />
        Invite
      </Button>
    </div>
  );
}

/**
 * The one-and-only sighting of an invite token.
 *
 * Deliberately loud, deliberately not auto-dismissing: there is no way to get
 * this link back once the panel closes.
 */
function InviteLink({
  invite,
  onDismiss,
}: {
  invite: { email: string; url: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
    } catch {
      // Clipboard can be blocked; the link is selectable either way.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="anim-fade border-b border-[var(--border-soft)] bg-[var(--accent-subtle)] px-3 py-2.5">
      <p className="text-[11.5px] text-[var(--text-secondary)]">
        Invite ready for <strong className="text-[var(--text)]">{invite.email}</strong>. Send them
        this link — it is only shown once.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 min-w-0 flex-1 rounded-md bg-[var(--panel-raised)] px-2.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none"
        />
        <Button size="md" variant={copied ? 'accent-soft' : 'primary'} onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="md" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function relativeDays(timestamp: number): string {
  const days = Math.round((timestamp - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
