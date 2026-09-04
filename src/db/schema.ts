import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  unique,
  primaryKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Foundational schema — Phase 1 Step 1
 * Source: multiplayer-ai-technical-buildguide.md Section 2
 */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  orgId: uuid("org_id").references(() => orgs.id),
  name: text("name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id),
  title: text("title"),
  status: text("status").notNull().default("active"),
  sessionTemplate: text("session_template"),
  visibility: text("visibility").notNull().default("internal_only"),
  parentSessionId: uuid("parent_session_id").references(
    (): AnyPgColumn => sessions.id
  ),
  forkedFromEventSeq: integer("forked_from_event_seq"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessionMembers = pgTable(
  "session_members",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    isGuest: boolean("is_guest").default(false),
    guestOrgName: text("guest_org_name"),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })]
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    sequenceNumber: integer("sequence_number").notNull(),
    eventType: text("event_type").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorType: text("actor_type").notNull(),
    payload: jsonb("payload").notNull(),
    tokenUsage: jsonb("token_usage"),
    costUsd: numeric("cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("session_events_session_id_sequence_number_unique").on(
      table.sessionId,
      table.sequenceNumber
    ),
    index("session_events_session_id_sequence_number_idx").on(
      table.sessionId,
      table.sequenceNumber
    ),
  ]
);
