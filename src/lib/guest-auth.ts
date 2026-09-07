import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  guestInvites,
  sessionMembers,
  sessions,
  users,
} from "@/db/schema";
import { AuthError } from "@/lib/auth-error";

export type GuestUser = typeof users.$inferSelect;

export const GUEST_COOKIE_NAME = "mp_guest_session";

export const GUEST_ROLES = ["observer", "reviewer"] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];

export function isGuestRole(value: string): value is GuestRole {
  return (GUEST_ROLES as readonly string[]).includes(value);
}

export type GuestInviteRow = typeof guestInvites.$inferSelect;

export type GuestCookiePayload = {
  v: 1;
  inviteId: string;
  userId: string;
  sessionId: string;
  exp: number;
};

function guestSecret(): string {
  const secret =
    process.env.GUEST_SESSION_SECRET ||
    process.env.TOOL_AUTH_ENCRYPTION_KEY ||
    process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new AuthError(
      "GUEST_SESSION_SECRET (or TOOL_AUTH_ENCRYPTION_KEY) is required for guest invites",
      500
    );
  }
  return secret;
}

function signPayload(payload: GuestCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const sig = createHmac("sha256", guestSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySigned(token: string): GuestCookiePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", guestSecret())
    .update(body)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as GuestCookiePayload;
    if (parsed.v !== 1 || !parsed.inviteId || !parsed.userId || !parsed.sessionId) {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isGuestClerkId(clerkId: string): boolean {
  return clerkId.startsWith("guest:");
}

export async function createGuestInvite(opts: {
  sessionId: string;
  orgId: string;
  createdBy: string;
  role: GuestRole;
  guestOrgName?: string | null;
  expiresInHours?: number;
}): Promise<{ invite: GuestInviteRow; token: string; inviteUrlPath: string }> {
  const hours = opts.expiresInHours ?? 72;
  if (hours < 1 || hours > 24 * 30) {
    throw new AuthError("expires_in_hours must be between 1 and 720", 400);
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, opts.sessionId))
    .limit(1);
  if (!session || session.orgId !== opts.orgId) {
    throw new AuthError("Session not found", 404);
  }

  // Guest-visible sessions must be client_facing (segmentation).
  if (session.visibility !== "client_facing") {
    await db
      .update(sessions)
      .set({ visibility: "client_facing" })
      .where(eq(sessions.id, opts.sessionId));
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const [invite] = await db
    .insert(guestInvites)
    .values({
      sessionId: opts.sessionId,
      token,
      role: opts.role,
      guestOrgName: opts.guestOrgName?.trim() || null,
      expiresAt,
      createdBy: opts.createdBy,
    })
    .returning();

  return {
    invite,
    token,
    inviteUrlPath: `/guest/invite/${token}`,
  };
}

/**
 * Redeem a magic-link token: create a guest user (no Clerk), membership,
 * and a signed cookie scoped to exactly one session.
 */
export async function redeemGuestInvite(token: string): Promise<{
  user: GuestUser;
  sessionId: string;
  cookieValue: string;
  expiresAt: Date;
}> {
  const [invite] = await db
    .select()
    .from(guestInvites)
    .where(eq(guestInvites.token, token))
    .limit(1);

  if (!invite) {
    throw new AuthError("Invalid guest invite", 404);
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new AuthError("Guest invite has expired", 401);
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, invite.sessionId))
    .limit(1);
  if (!session) {
    throw new AuthError("Session not found", 404);
  }
  if (session.visibility === "internal_only") {
    throw new AuthError(
      "This session is internal_only and cannot be accessed by guests",
      403
    );
  }

  let user: GuestUser | null = null;
  if (invite.redeemedUserId) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, invite.redeemedUserId))
      .limit(1);
    user = existing ?? null;
  }

  if (!user) {
    const clerkId = `guest:${invite.id}`;
    const [created] = await db
      .insert(users)
      .values({
        clerkId,
        orgId: null,
        name: invite.guestOrgName
          ? `Guest (${invite.guestOrgName})`
          : "Guest",
        email: null,
      })
      .returning();
    user = created;
    await db
      .update(guestInvites)
      .set({ redeemedUserId: user.id })
      .where(eq(guestInvites.id, invite.id));
  }

  const [membership] = await db
    .select()
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, invite.sessionId),
        eq(sessionMembers.userId, user.id)
      )
    )
    .limit(1);

  if (!membership) {
    await db.insert(sessionMembers).values({
      sessionId: invite.sessionId,
      userId: user.id,
      role: invite.role,
      isGuest: true,
      guestOrgName: invite.guestOrgName,
    });
  } else {
    await db
      .update(sessionMembers)
      .set({
        role: invite.role,
        isGuest: true,
        guestOrgName: invite.guestOrgName,
      })
      .where(
        and(
          eq(sessionMembers.sessionId, invite.sessionId),
          eq(sessionMembers.userId, user.id)
        )
      );
  }

  const payload: GuestCookiePayload = {
    v: 1,
    inviteId: invite.id,
    userId: user.id,
    sessionId: invite.sessionId,
    exp: invite.expiresAt.getTime(),
  };
  const cookieValue = signPayload(payload);

  return {
    user,
    sessionId: invite.sessionId,
    cookieValue,
    expiresAt: invite.expiresAt,
  };
}

export async function readGuestCookiePayload(): Promise<GuestCookiePayload | null> {
  const jar = await cookies();
  const raw = jar.get(GUEST_COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySigned(raw);
}

/**
 * Resolve guest AppUser from cookie. Re-validates invite expiry + session
 * visibility on every call.
 */
export async function resolveGuestUser(): Promise<{
  user: GuestUser;
  sessionId: string;
  inviteId: string;
} | null> {
  const payload = await readGuestCookiePayload();
  if (!payload) return null;

  const [invite] = await db
    .select()
    .from(guestInvites)
    .where(eq(guestInvites.id, payload.inviteId))
    .limit(1);
  if (!invite) return null;
  if (invite.expiresAt.getTime() <= Date.now()) return null;
  if (invite.sessionId !== payload.sessionId) return null;

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, payload.sessionId))
    .limit(1);
  if (!session || session.visibility === "internal_only") return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);
  if (!user || !isGuestClerkId(user.clerkId)) return null;

  return { user, sessionId: payload.sessionId, inviteId: invite.id };
}

/** Guest may only touch the single session bound to their invite cookie. */
export function assertGuestSessionScope(
  guestSessionId: string,
  requestedSessionId: string
) {
  if (guestSessionId !== requestedSessionId) {
    throw new AuthError(
      "Forbidden: guest token is scoped to a different session",
      403
    );
  }
}

export async function listGuestInvitesForSession(sessionId: string) {
  return db
    .select()
    .from(guestInvites)
    .where(eq(guestInvites.sessionId, sessionId));
}

export async function setSessionVisibility(opts: {
  sessionId: string;
  orgId: string;
  visibility: "internal_only" | "client_facing";
}) {
  const [row] = await db
    .update(sessions)
    .set({ visibility: opts.visibility })
    .where(
      and(eq(sessions.id, opts.sessionId), eq(sessions.orgId, opts.orgId))
    )
    .returning();
  if (!row) throw new AuthError("Session not found", 404);
  return row;
}

/** For tests / scripts — verify invite without cookies. */
export async function getValidInviteByToken(token: string) {
  const [invite] = await db
    .select()
    .from(guestInvites)
    .where(
      and(eq(guestInvites.token, token), gt(guestInvites.expiresAt, new Date()))
    )
    .limit(1);
  return invite ?? null;
}
