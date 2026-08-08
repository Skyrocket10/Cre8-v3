'use client';

/**
 * Session and active-team context.
 *
 * Also the place that decides whether this build has a backend at all, because
 * that is no longer a build-time fact: the same static export is served by a
 * Worker that also answers `/api/*`, or dropped on a CDN with nothing behind
 * it. One probe on boot settles it, and `RequireSession` holds the routes back
 * until it has — so `getStorage()` is never asked before the answer is known.
 *
 * Local mode is a first-class state, not a degraded one. With no backend the
 * provider reports `mode: 'local'` and the whole editor works exactly as it did
 * before accounts existed. Everything auth-related in the UI keys off that.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, hasBackend, probeBackend, type AccountUser, type Team } from '../api/client';
import { setActiveTeamId as setStorageTeam } from '../api/cloudflare';

const ACTIVE_TEAM_KEY = 'cre8:team';

/** Keep the current team if it still exists, else the remembered one, else the first. */
function resolveTeam(teams: Team[], current: string | null): string | null {
  if (current && teams.some((t) => t.id === current)) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(ACTIVE_TEAM_KEY);
  } catch {
    /* storage unavailable; fall back to the first team */
  }
  if (stored && teams.some((t) => t.id === stored)) return stored;
  return teams[0]?.id ?? null;
}

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out' | 'local';

interface SessionValue {
  status: SessionStatus;
  mode: 'local' | 'hosted';
  user: AccountUser | null;
  teams: Team[];
  activeTeam: Team | null;
  setActiveTeam: (teamId: string) => void;
  /**
   * Set when an API answered but refused to work — a misconfigured deployment
   * rather than an absent one. Carries the server's own words.
   */
  backendError: { message: string; detail?: string } | null;
  /** Re-read the session after signing in, accepting an invite, etc. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  applySession: (user: AccountUser | null, teams: Team[]) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession used outside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Always 'loading' first: whether there is a backend is now discovered, not
  // compiled in, so nothing may assume either answer before the probe lands.
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<SessionValue['backendError']>(null);
  const activeTeamRef = useRef<string | null>(null);

  /**
   * The one place the active team changes.
   *
   * The storage adapter is told **synchronously**, not from an effect. The
   * dashboard lists projects in its own mount effect, and child effects flush
   * before a parent's — so an effect here would hand the adapter the right team
   * only after it had already been asked for the wrong one's projects.
   */
  const commitActiveTeam = useCallback((teamId: string | null) => {
    activeTeamRef.current = teamId;
    setActiveTeamId(teamId);
    setStorageTeam(teamId);
  }, []);

  const applySession = useCallback(
    (nextUser: AccountUser | null, nextTeams: Team[]) => {
      setUser(nextUser);
      setTeams(nextTeams);
      setStatus(nextUser ? 'signed-in' : 'signed-out');
      commitActiveTeam(resolveTeam(nextTeams, activeTeamRef.current));
    },
    [commitActiveTeam]
  );

  const refresh = useCallback(async () => {
    if (!hasBackend()) return;
    try {
      const session = await api.me();
      applySession(session.user, session.teams);
    } catch {
      // An unreachable API is indistinguishable from being signed out as far
      // as the UI is concerned; the sign-in screen surfaces the real error.
      applySession(null, []);
    }
  }, [applySession]);

  // The boot probe. Doubles as the first `me` call, so discovering the backend
  // costs no extra round trip.
  useEffect(() => {
    let cancelled = false;
    void probeBackend().then((result) => {
      if (cancelled) return;
      if (result.kind === 'ready') {
        applySession(result.session.user, result.session.teams);
        return;
      }
      // Both remaining cases fall back to browser storage so the editor still
      // works; only the explanation differs.
      if (result.kind === 'broken') {
        setBackendError({
          message: result.message,
          ...(result.detail ? { detail: result.detail } : {}),
        });
      }
      setStatus('local');
    });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const setActiveTeam = useCallback(
    (teamId: string) => {
      commitActiveTeam(teamId);
      try {
        localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
      } catch {
        /* preference is best-effort */
      }
    },
    [commitActiveTeam]
  );

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    applySession(null, []);
  }, [applySession]);

  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? teams[0] ?? null;

  const value = useMemo<SessionValue>(
    () => ({
      status,
      mode: status === 'local' ? 'local' : 'hosted',
      user,
      teams,
      activeTeam,
      setActiveTeam,
      backendError,
      refresh,
      signOut,
      applySession,
    }),
    [status, user, teams, activeTeam, setActiveTeam, backendError, refresh, signOut, applySession]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Stable per-person colour, shared by avatars and collaboration cursors. */
export function avatarColor(hue: number): string {
  return `hsl(${hue} 62% 52%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
