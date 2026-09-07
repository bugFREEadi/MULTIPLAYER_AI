# Multiplayer AI

Collaborative AI work sessions for teams. Build order follows `multiplayer-ai-development-flow.md`.

## Local setup

1. Copy `.env.example` → `.env.local` and set `DATABASE_URL`. Keep `MOCK_AI_RESPONSES=true` until you have an Anthropic key.
2. Ensure Redis is running (`redis-cli ping` → `PONG`). Default `REDIS_URL=redis://127.0.0.1:6379`.
3. Run migrations: `npm run db:migrate`
4. Start the app: `npm run dev`
5. (Optional) For scheduled handoff briefs: run `npx inngest-cli@latest dev` and sync `/api/inngest`. On-demand handoff works without Inngest.
6. (Optional) Tool Mesh GitHub Connect: set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `APP_URL` (see `.env.example`). Permission gating works without OAuth via `/settings/tools` → Add GitHub tool.

See `VERIFICATION_STATUS.md` for which Phase 1 steps still need a real API key re-check.

## Security TODOs (before any real deployment)

- [ ] **Set `ALLOW_DEV_AUTH=false` (or remove it)** before deploying. Dev auth accepts `x-dev-clerk-id` and bypasses Clerk — it is for local curl/Postman only and must never be enabled in production.
- [ ] Replace placeholder Clerk keys with real production credentials.
- [ ] Point `DATABASE_URL` at Supabase (or another managed Postgres) with RLS policies filled in for application roles.
