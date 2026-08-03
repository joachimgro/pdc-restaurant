# PDC Platform — working rules

## Stack facts (do not re-derive)
- pnpm 10.15 workspaces + Turbo. apps/web (Next 15 App Router), workers/api (Cloudflare Worker), packages/*
- Worker is a raw `fetch` handler with sequential `if (path === …)` dispatch in workers/api/src/index.ts.
  NOT Hono. NOT itty-router. Do not introduce a router.
- D1 via raw SQL: env.DB.prepare().bind().first()/.all()/.run(), env.DB.batch() for atomic writes.
  No ORM. Do not add Drizzle/Prisma/Kysely.
- Zod schemas live in packages/shared-types and are shared by the Worker and the web client.
- Web state is Zustand. Components are custom. No shadcn, no Radix, no component library.
- Tailwind v4, CSS-first, no tailwind.config file. Design tokens are in apps/web/src/app/globals.css.
- Web plugins self-register via registerPlugin() and only load if imported in apps/web/src/plugins/index.ts.

## Hard rules
- Every org-scoped query binds env.ORGANIZATION_ID. No exceptions.
- Every new table carries organization_id and location_id.
- Migrations: workers/api/migrations/NNNN_name.sql, sequential, never edit an applied one.
  Each sets _meta.schema_version. Bump EXPECTED_SCHEMA_VERSION in workers/api/src/meta.ts in the
  SAME commit. Deploying ahead of the applied migration 503s all traffic.
- No DROP TABLE. Migration 0032 did this and cascade-deleted contact_identifiers rows.
- Do not refactor workers/api/src/ai/pipeline.ts. It is load-bearing and out of scope until Phase 8.
- Reservations must never create `leads` rows — leads has UNIQUE(organization_id, phone).
- Amounts are integer pence. Never floats.
- Venue-local times are YYYY-MM-DD + HH:MM strings. Never derive local time from a UTC timestamp.

## Workflow
- Plan before code. Show the plan, wait for approval.
- One phase at a time. Stop at each gate in docs/specs/SERVICE-MODULE-BUILD-SPEC.md.
- Run `pnpm test` in workers/api before declaring a phase done.
- Small reviewable commits. Never `git push` without being asked.