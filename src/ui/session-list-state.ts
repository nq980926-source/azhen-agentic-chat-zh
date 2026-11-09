import type { SessionInfo } from "../session/session-manager";
import { t } from "../i18n";

export interface SessionRowState {
  session: SessionInfo;
  title: string;
  meta: string;
  active: boolean;
}

/** Substring filter over a session's display name and first message (case-insensitive). */
export function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => {
    const name = session.name?.trim() ?? "";
    // Guard against a nullish firstMessage so it never coerces to "undefined"
    // (which would otherwise match a search for "undef").
    const firstMessage = session.firstMessage?.trim() ?? "";
    return `${name}\n${firstMessage}`.toLowerCase().includes(needle);
  });
}

export function sessionRows(sessions: SessionInfo[], query: string, activePath: string | null): SessionRowState[] {
  return filterSessions(sessions, query).map((session) => ({
    session,
    title: sessionTitle(session),
    meta: t(session.messageCount === 1 ? "sessions.messageOne" : "sessions.messageMany", {
      count: session.messageCount,
      date: formatWhen(session.updatedAt),
    }),
    active: session.path === activePath,
  }));
}

export function emptySessionMessage(totalSessions: number): string {
  return t(totalSessions === 0 ? "sessions.empty" : "sessions.noMatch");
}

export function removeSessionByPath(sessions: SessionInfo[], path: string): SessionInfo[] {
  return sessions.filter((session) => session.path !== path);
}

/**
 * Re-insert a session at its original index. Used to undo an optimistic removal
 * when the underlying delete fails, so the list keeps matching reality. A
 * no-op when the session is already present (e.g. a retry) to avoid duplicates.
 */
export function restoreSessionAt(sessions: SessionInfo[], session: SessionInfo, index: number): SessionInfo[] {
  if (sessions.some((entry) => entry.path === session.path)) return sessions;
  const next = [...sessions];
  const position = index < 0 || index > next.length ? next.length : index;
  next.splice(position, 0, session);
  return next;
}

/** The text prefilled when a row enters inline rename mode. */
export function sessionRenameDraft(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage.trim();
}

/**
 * Return the name to persist for a rename, or null when Enter/blur/Escape should
 * only leave edit mode. Empty string is meaningful: it clears an existing custom
 * name and falls back to the first prompt.
 */
export function resolveSessionRename(session: SessionInfo, rawName: string, save: boolean): string | null {
  if (!save) return null;
  const hadCustomName = !!session.name?.trim();
  const current = sessionRenameDraft(session);
  const next = rawName.trim();
  const changed = next !== current;
  const clearsCustomName = next.length === 0 && hadCustomName;
  return changed && (next.length > 0 || clearsCustomName) ? next : null;
}

export function applySessionRename(session: SessionInfo, name: string): SessionInfo {
  return { ...session, name: name.trim() || undefined };
}

export function sessionTitle(session: SessionInfo): string {
  const text = session.name?.trim() || session.firstMessage;
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > 80 ? `${single.slice(0, 80)}…` : single || t("sessions.emptyConversation");
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
