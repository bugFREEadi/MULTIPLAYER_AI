import { AuthError } from "@/lib/auth-error";
import type { AppUser, ActorContext } from "@/lib/auth";
import { assertSessionNotPausedForWrites } from "@/lib/checkpoints";
import {
  requireSessionAccess,
  type MembershipRow,
  type SessionRow,
} from "@/lib/sessions";

/**
 * Mutating actions that must pass through {@link requireSessionPermission}.
 * Phase 3 RBAC (custom roles / permission matrix) should extend this vocabulary
 * and the role→permission map — not add per-route role if-checks.
 */
export type SessionAction =
  | "user_message.write"
  | "suggestion.write"
  | "suggestion.resolve"
  | "members.manage"
  | "session.take_control"
  | "checkpoint.raise_manual"
  | "session.branch"
  | "session.merge"
  | "session.handoff";

const SESSION_ROLES = [
  "owner",
  "pilot",
  "co_pilot",
  "reviewer",
  "observer",
  "auditor",
] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

const ACTION_ROLES: Record<SessionAction, ReadonlySet<string>> = {
  "user_message.write": new Set(["owner", "pilot", "co_pilot"]),
  "suggestion.write": new Set(["reviewer"]),
  "suggestion.resolve": new Set(["owner", "pilot"]),
  "members.manage": new Set(["owner", "pilot"]),
  "session.take_control": new Set(["owner", "pilot", "co_pilot", "reviewer"]),
  "checkpoint.raise_manual": new Set(["owner", "pilot", "co_pilot"]),
  "session.branch": new Set(["owner", "pilot", "co_pilot"]),
  "session.merge": new Set(["owner", "pilot"]),
  "session.handoff": new Set(["owner", "pilot", "co_pilot"]),
};

const PAUSED_BLOCKED_ACTIONS = new Set<SessionAction>([
  "user_message.write",
  "suggestion.write",
  "suggestion.resolve",
  "checkpoint.raise_manual",
]);

export function isSessionRole(role: string): role is SessionRole {
  return (SESSION_ROLES as readonly string[]).includes(role);
}

export function roleAllows(role: string, action: SessionAction): boolean {
  return ACTION_ROLES[action].has(role);
}

export function assertSessionPermission(
  membership: MembershipRow,
  action: SessionAction
): void {
  if (!roleAllows(membership.role, action)) {
    throw new AuthError(
      `Forbidden: role '${membership.role}' cannot perform '${action}'`,
      403
    );
  }
}

export async function requireSessionPermission(
  user: AppUser,
  sessionId: string,
  action: SessionAction,
  guestSessionId?: string | null
): Promise<{ session: SessionRow; membership: MembershipRow }> {
  const { session, membership } = await requireSessionAccess(
    user,
    sessionId,
    guestSessionId
  );
  assertSessionPermission(membership, action);
  if (PAUSED_BLOCKED_ACTIONS.has(action)) {
    assertSessionNotPausedForWrites(session);
  }
  return { session, membership };
}

export async function requireActorSessionPermission(
  actor: ActorContext,
  sessionId: string,
  action: SessionAction
) {
  return requireSessionPermission(
    actor.user,
    sessionId,
    action,
    actor.guestSessionId
  );
}

export function permissionsForRole(role: string) {
  return {
    canWriteUserMessage: roleAllows(role, "user_message.write"),
    canPostSuggestion: roleAllows(role, "suggestion.write"),
    canResolveSuggestion: roleAllows(role, "suggestion.resolve"),
    canManageMembers: roleAllows(role, "members.manage"),
    canTakeControl: roleAllows(role, "session.take_control"),
    canRaiseManualCheckpoint: roleAllows(role, "checkpoint.raise_manual"),
    canBranch: roleAllows(role, "session.branch"),
    canMerge: roleAllows(role, "session.merge"),
    canGenerateHandoff: roleAllows(role, "session.handoff"),
  };
}
