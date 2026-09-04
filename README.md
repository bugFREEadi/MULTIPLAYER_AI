# Multiplayer AI

Collaborative AI work sessions for teams. Build order follows `multiplayer-ai-development-flow.md`.

## Local setup

1. Copy `.env.example` → `.env.local` and set `DATABASE_URL`.
2. Run migrations: `npm run db:migrate`
3. Start the app: `npm run dev`

## Security TODOs (before any real deployment)

- [ ] **Set `ALLOW_DEV_AUTH=false` (or remove it)** before deploying. Dev auth accepts `x-dev-clerk-id` and bypasses Clerk — it is for local curl/Postman only and must never be enabled in production.
- [ ] Replace placeholder Clerk keys with real production credentials.
- [ ] Point `DATABASE_URL` at Supabase (or another managed Postgres) with RLS policies filled in for application roles.
