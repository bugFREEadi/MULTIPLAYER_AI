/**
 * Step 20 verification harness — run with:
 *   npx tsx scripts/verify-step20.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    guestInvites,
    sessionMembers,
    sessions,
    users,
  } = await import("../src/db/schema");
  const { roleAllows } = await import("../src/lib/rbac");
  const { requireSessionAccess } = await import("../src/lib/sessions");
  const {
    createGuestInvite,
    redeemGuestInvite,
    setSessionVisibility,
  } = await import("../src/lib/guest-auth");
  const { AuthError } = await import("../src/lib/auth-error");

  const [owner] = await db.select().from(users).limit(1);
  if (!owner?.orgId) throw new Error("Need a user with orgId");
  const orgId = owner.orgId;

  const [clientSession] = await db
    .insert(sessions)
    .values({
      orgId,
      title: "step20-client-facing",
      createdBy: owner.id,
      status: "active",
      visibility: "internal_only",
    })
    .returning();
  await db.insert(sessionMembers).values({
    sessionId: clientSession.id,
    userId: owner.id,
    role: "owner",
  });

  const [otherSession] = await db
    .insert(sessions)
    .values({
      orgId,
      title: "step20-other-internal",
      createdBy: owner.id,
      status: "active",
      visibility: "internal_only",
    })
    .returning();
  await db.insert(sessionMembers).values({
    sessionId: otherSession.id,
    userId: owner.id,
    role: "owner",
  });

  // 1. Create invite (flips to client_facing)
  const created = await createGuestInvite({
    sessionId: clientSession.id,
    orgId,
    createdBy: owner.id,
    role: "observer",
    guestOrgName: "Verify Client Co",
    expiresInHours: 24,
  });
  const [afterInvite] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, clientSession.id))
    .limit(1);
  if (afterInvite.visibility !== "client_facing") {
    throw new Error("Invite should flip session to client_facing");
  }
  console.log("invite ok", created.inviteUrlPath);

  // Redeem magic link
  const redeemed = await redeemGuestInvite(created.token);
  if (redeemed.sessionId !== clientSession.id) {
    throw new Error("Redeem scoped to wrong session");
  }
  if (roleAllows("observer", "user_message.write")) {
    throw new Error("Observer must not be able to write user messages");
  }
  console.log("observer cannot write — ok");

  // Guest can access invited session
  await requireSessionAccess(
    redeemed.user,
    clientSession.id,
    redeemed.sessionId
  );
  console.log("guest access to invited session — ok");

  // 2. Guest cannot access other session (cookie scope)
  let blockedOther = false;
  try {
    await requireSessionAccess(
      redeemed.user,
      otherSession.id,
      redeemed.sessionId
    );
  } catch (e) {
    blockedOther = e instanceof AuthError && e.status === 403;
  }
  if (!blockedOther) {
    throw new Error("Guest must not access a different session via cookie scope");
  }
  console.log("cross-session blocked — ok");

  // Even without cookie mismatch: no membership on other session
  let blockedMembership = false;
  try {
    await requireSessionAccess(redeemed.user, otherSession.id, otherSession.id);
  } catch (e) {
    blockedMembership =
      e instanceof AuthError && (e.status === 403 || e.status === 404);
  }
  // Spoofing guestSessionId to otherSession still fails: no membership + may be internal
  if (!blockedMembership) {
    // If somehow membership existed — visibility check
    throw new Error("Guest must not access other session even if scope spoofed");
  }
  console.log("no membership on other session — ok");

  // 4. internal_only never for guests
  await setSessionVisibility({
    sessionId: clientSession.id,
    orgId,
    visibility: "internal_only",
  });
  let blockedInternal = false;
  try {
    await requireSessionAccess(
      redeemed.user,
      clientSession.id,
      redeemed.sessionId
    );
  } catch (e) {
    blockedInternal = e instanceof AuthError && e.status === 403;
  }
  if (!blockedInternal) {
    throw new Error("Guest must be blocked from internal_only even if invited");
  }
  // Restore client_facing for remaining tests
  await setSessionVisibility({
    sessionId: clientSession.id,
    orgId,
    visibility: "client_facing",
  });
  console.log("internal_only blocked for guest — ok");

  // 3. Expired token rejected on redeem
  const expiredInvite = await createGuestInvite({
    sessionId: clientSession.id,
    orgId,
    createdBy: owner.id,
    role: "reviewer",
    expiresInHours: 1,
  });
  await db
    .update(guestInvites)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(guestInvites.id, expiredInvite.invite.id));
  let expiredRejected = false;
  try {
    await redeemGuestInvite(expiredInvite.token);
  } catch (e) {
    expiredRejected = e instanceof AuthError && e.status === 401;
  }
  if (!expiredRejected) {
    throw new Error("Expired invite must be rejected");
  }
  console.log("expired invite rejected — ok");

  // 5. Team member still sees client_facing flag on session row
  const [teamView] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, clientSession.id))
    .limit(1);
  if (teamView.visibility !== "client_facing") {
    throw new Error("Team UI source visibility should be client_facing");
  }
  console.log("team visibility distinction — ok");

  // Guest list isolation: only memberships where is_guest
  const guestMemberships = await db
    .select()
    .from(sessionMembers)
    .where(eq(sessionMembers.userId, redeemed.user.id));
  if (
    guestMemberships.length !== 1 ||
    guestMemberships[0].sessionId !== clientSession.id
  ) {
    throw new Error("Guest should only be a member of the invited session");
  }

  console.log("\nSTEP 20 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
