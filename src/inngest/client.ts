import { Inngest } from "inngest";

/**
 * Local schedule wire for handoff briefs. Without INNGEST_SIGNING_KEY,
 * prefer explicit local mode so `/api/inngest` does not assume cloud.
 * Deep cron testing is deferred — on-demand POST is the verification path.
 */
export const inngest = new Inngest({
  id: "multiplayer-ai",
  isDev:
    process.env.INNGEST_DEV === "1" ||
    (!process.env.INNGEST_SIGNING_KEY &&
      process.env.NODE_ENV !== "production"),
});
