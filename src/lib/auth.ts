import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { orgs, users } from "@/db/schema";

export type AppUser = typeof users.$inferSelect;

type AuthIdentity = {
  clerkId: string;
  name: string | null;
  email: string | null;
};

function hasRealClerkKeys() {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder") &&
    !process.env.CLERK_SECRET_KEY?.includes("placeholder")
  );
}

async function resolveIdentity(): Promise<AuthIdentity | null> {
  if (hasRealClerkKeys()) {
    const session = await auth();
    if (session.userId) {
      const clerkUser = await currentUser();
      const email =
        clerkUser?.primaryEmailAddress?.emailAddress ??
        clerkUser?.emailAddresses[0]?.emailAddress ??
        null;
      const name =
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
        clerkUser?.username ||
        null;
      return { clerkId: session.userId, name, email };
    }
  }

  if (process.env.ALLOW_DEV_AUTH !== "true") {
    return null;
  }

  const headerStore = await headers();
  const clerkId = headerStore.get("x-dev-clerk-id");
  if (!clerkId) {
    return null;
  }

  return {
    clerkId,
    name: headerStore.get("x-dev-user-name"),
    email: headerStore.get("x-dev-user-email"),
  };
}

/** Resolve the authenticated app user, creating org + user rows on first request. */
export async function requireAppUser(): Promise<AppUser> {
  const identity = await resolveIdentity();
  if (!identity) {
    throw new AuthError("Unauthorized", 401);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, identity.clerkId),
  });

  if (existing?.orgId) {
    if (
      (identity.name && identity.name !== existing.name) ||
      (identity.email && identity.email !== existing.email)
    ) {
      const [updated] = await db
        .update(users)
        .set({
          name: identity.name ?? existing.name,
          email: identity.email ?? existing.email,
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  if (existing && !existing.orgId) {
    const [org] = await db
      .insert(orgs)
      .values({ name: `${identity.name ?? identity.email ?? "Personal"}'s Org` })
      .returning();
    const [updated] = await db
      .update(users)
      .set({
        orgId: org.id,
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }

  const [org] = await db
    .insert(orgs)
    .values({ name: `${identity.name ?? identity.email ?? "Personal"}'s Org` })
    .returning();

  const [created] = await db
    .insert(users)
    .values({
      clerkId: identity.clerkId,
      orgId: org.id,
      name: identity.name,
      email: identity.email,
    })
    .returning();

  return created;
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function jsonError(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
