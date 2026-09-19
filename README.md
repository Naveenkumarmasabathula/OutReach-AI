# Multi-Hospital Post-Discharge Outreach Platform

Multi-tenant, AI-powered healthcare operations platform coordinating post-discharge patient outreach across hospitals — see [docs/](./docs) for the full requirements map, multi-tenancy design, and implementation plan.

**Status**: Phases 0-11 complete (foundations through testing polish — see [docs/implementation-plan.md](./docs/implementation-plan.md) for the full phased breakdown), plus a frontend covering all of it. Phase 12's documentation is complete too — architecture diagram, deployment instructions, a demo-video script (see below) — with only the actual hosted deployment and video recording left, both requiring the user's own action. Phase 13 (stretch goals — real telephony, etc.) is explicitly optional and out of scope unless requested.

## What's implemented so far

- Multi-tenant hospital/user model with JWT auth and role-based access control (`PLATFORM_ADMIN`, `HOSPITAL_ADMIN`, `CAMPAIGN_MANAGER`, `CLINICAL_REVIEWER`)
- Tenant isolation enforced two ways: explicit `hospital_id` filters in every service, **and** Postgres Row-Level Security as a DB-level backstop — see [docs/multi-tenancy.md](./docs/multi-tenancy.md)
- FHIR-like healthcare data model (Patient, Encounter, Condition, Medication, Procedure, CarePlan, Observation, Communication, Task, Escalation)
- Hospital onboarding (platform-admin managed) and hospital-scoped user/patient/encounter CRUD
- An EHR abstraction layer (`EHRInterface` + `MockEHR`, replaceable) that clinical reads/writes go through instead of raw queries — see [docs/ehr-abstraction.md](./docs/ehr-abstraction.md)
- Campaign management: full lifecycle (draft→ready→scheduled→running→paused→completed/cancelled/failed), a pure/explainable eligibility engine, and workload estimates — see [docs/campaigns-eligibility.md](./docs/campaigns-eligibility.md)
- The outbound queue and scheduler (the PRD's top "critical" grading item): a documented/justified priority algorithm, capacity-safe concurrent claiming (verified under real concurrency), retry/backoff, callback scheduling, worker-crash recovery, and real distributed processing via BullMQ+Redis — see [docs/queue-design.md](./docs/queue-design.md)
- Hospital-scoped protocols and knowledge (follow-up questions, red-flag indicators, specialty instructions, patient guidance, escalation contacts, operational rules) with a task-specific, source-cited retrieval engine — see [docs/protocols-knowledge-retrieval.md](./docs/protocols-knowledge-retrieval.md)
- The AI agent layer: a Voice Intake Agent (`VoiceProvider`/`SimulatedVoiceProvider`), a Clinical Triage Agent with two independent assessment paths (deterministic rule/protocol-matching + AI-model), an Escalation Decision System (consensus + conservative disagreement handling), and a Documentation Agent — all schema-validated. Tests/required scripts run against a deterministic simulated AI provider, deliberately, for reproducibility; a real `GEMINI_API_KEY` has since been supplied and `GeminiProvider` live-verified end-to-end (flash tier confirmed working; pro tier confirmed correctly failing against a real quota error — the account has zero pro-tier quota until billing is enabled) — see [docs/ai-usage.md](./docs/ai-usage.md) and [docs/voice-provider.md](./docs/voice-provider.md)
- Per-read PHI audit logging for the AI agent's own reads (the "regulated subject" pattern) via an `audit_log` table and an `AuditedEHR` decorator around the Phase 1 EHR interface
- Escalation management: a full reviewer lifecycle (acknowledge/assign/reassign/start review/request information/resolve/close), a detail view assembling patient context + call transcript + both independent AI assessments + consensus rationale in one place, and simulated/logged notifications — see [docs/escalation-management.md](./docs/escalation-management.md)
- An asynchronous, idempotent event bus (BullMQ-backed) publishing all of PRD §18's "important events," with one concrete multi-step workflow built end-to-end: an escalation notifies every clinical reviewer, then escalates to backup review (hospital-configurable timeout) if unacknowledged — see [docs/workflows-events.md](./docs/workflows-events.md)
- Role-differentiated dashboards (Campaign Manager, Hospital Admin, Platform Admin) backed by one comprehensive analytics aggregation, plus an extended patient operational view (outreach status, call history, escalations) — see [docs/dashboards-analytics.md](./docs/dashboards-analytics.md)
- A fixed, reproducible safety evaluation dataset (14 hand-authored cases across all 7 PRD-required categories) run via `npm run safety:evaluate --workspace server` against the real triage/consensus functions — 0 false negatives, 0 false positives on the current dataset, with disclosed weaknesses (phrase-matching blindness, no negation handling) documented rather than hidden — see [docs/safety-evaluation.md](./docs/safety-evaluation.md)
- Real health-state reporting (`GET /health` — Healthy/Degraded/Unavailable, backed by actual dependency checks), an AI-provider circuit breaker with a safety-conservative degraded fallback, correlation-ID tracing for async jobs, structured AI observability logging, and an audit-log extension covering human-driven operational actions (campaign lifecycle, escalation reviews) — see [docs/observability-reliability.md](./docs/observability-reliability.md)
- Comprehensive test suites — tenant isolation, the EHR layer, campaign lifecycle/eligibility, the queue (including priority ordering and a critical concurrency-safety fix), protocols/retrieval, the AI agent layer (including schema rejection and provider retry logic), escalation management, the event bus, analytics, the safety evaluation, observability/reliability, authentication failure paths, and API validation (`server/test/`) — 146 tests passing across 23 suites
- A React + Tailwind frontend (`web/`) covering all of the above (auth, hospitals, patients, campaigns, queue status, protocols, escalation review, dashboards) — design language adapted from an Apple-marketing-site spec for a dense operations dashboard, see [docs/design/](./docs/design)
- A system architecture diagram and the rest of the PRD's required documentation set — see [docs/architecture.md](./docs/architecture.md), [docs/deployment.md](./docs/deployment.md) (how to deploy — not yet executed), and [docs/demo-script.md](./docs/demo-script.md) (a walkthrough for the required demo video, which needs actual screen recording this tool can't produce)

All 12 phases of the core implementation plan (Phases 0-11) are complete, and Phase 12's documentation is done. Not yet done: actually deploying it (needs a hosting decision — see docs/deployment.md), recording the demo video (see docs/demo-script.md), and Phase 13's optional stretch goals (e.g. real telephony).

## Prerequisites

- Node.js 20+
- Docker (for local Postgres + Redis)

## Setup

```bash
npm install                 # installs all workspaces
docker compose up -d        # starts Postgres (5432) and Redis (6379)
cp server/.env.example server/.env   # adjust if needed; defaults match docker-compose

npm run db:migrate          # creates tables, RLS policies, and the app_runtime DB role
npm run db:seed             # seeds 3 hospitals, staff users, and ~270 patients with encounters
```

`db:migrate` runs as the Postgres superuser (`MIGRATE_DATABASE_URL`) since it creates tables and a role. The application itself connects as a separate, non-superuser `app_runtime` role (`DATABASE_URL`) — this matters because Postgres superusers bypass Row-Level Security unconditionally, so the app must never connect as the superuser. See [docs/multi-tenancy.md](./docs/multi-tenancy.md) §2.

## Running

```bash
npm run dev:server          # starts the API on http://localhost:4000
npm run dev:web             # starts the frontend on http://localhost:5173 (proxies /api to :4000)
npm run dev:worker --workspace server   # starts the BullMQ queue worker (claims + processes outreach tasks)
```

Campaigns don't do anything on their own — the worker above is what actually claims and processes queued outreach tasks (tick every 5s) and sweeps for crashed-worker stale locks (every 60s). Without it running, a started campaign's tasks just sit `pending`.

To see the required queue simulation (PRD §10 — capacity limiting, priority ordering, retries, callbacks, and escalations, all demonstrated in one run):

```bash
npm run queue:simulate --workspace server
```

This doesn't need the worker running — it drives the same queue logic directly and prints each tick's claims/outcomes to the console. See [docs/queue-design.md](./docs/queue-design.md) for what it demonstrates and why.

To see the required safety evaluation report (PRD §15 — the fixed 14-case dataset run against the real triage/consensus logic, with TP/FP/TN/FN and the false-negative rate):

```bash
npm run safety:evaluate --workspace server
```

No database or network needed — it's pure functions over a fixed dataset, so it's safe to re-run after any prompt/protocol/consensus change and diff the output. See [docs/safety-evaluation.md](./docs/safety-evaluation.md).

Demo credentials (all seeded users share one password):

| Email | Role |
|---|---|
| `platform.admin@outreach.dev` | PLATFORM_ADMIN |
| `admin@riverside-general.dev` | HOSPITAL_ADMIN (Riverside General) |
| `campaigns@riverside-general.dev` | CAMPAIGN_MANAGER (Riverside General) |
| `reviewer@riverside-general.dev` | CLINICAL_REVIEWER (Riverside General) |

(same pattern for `lakeside-medical` and `metro-health`) — password: `ChangeMe123!`

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@riverside-general.dev","password":"ChangeMe123!"}'
```

## Testing

```bash
npm run test:server
```

Tests are real integration tests against the Postgres/Redis started by `docker compose up -d` (not mocked) — they require migrations to have been applied first.

## Project layout

```
docs/               requirements, multi-tenancy design, implementation plan, design system
server/             Express 5 + TypeScript API
  src/db/schema/    Drizzle ORM schema (tenant + healthcare data model)
  src/db/scope.ts   HospitalScope guard pattern + RLS session-variable helper
  src/ehr/          EHR abstraction layer (EHRInterface + MockEHR) — see docs/ehr-abstraction.md
  src/ai/           AI agent layer (AIProvider, triage/escalation/documentation agents, the pipeline) — see docs/ai-usage.md
  src/voice/        Voice Intake Agent's VoiceProvider (SimulatedVoiceProvider) — see docs/voice-provider.md
  src/queue/        BullMQ Queue/connection setup
  src/events/       async event bus (publish/consumer/handlers) — see docs/workflows-events.md
  src/worker.ts     background worker entrypoint (scheduler tick + stale-lock sweep)
  src/scripts/      queueSimulation.ts (PRD §10) and safetyEvaluation.ts (PRD §15) — the two required demonstration/report scripts
  src/safety/       the fixed safety evaluation dataset + runner (PRD §15) — see docs/safety-evaluation.md
  src/middleware/   auth (JWT) + RBAC/tenant-scope guards
  src/services/     business logic (tenant-scoped queries, delegates clinical reads to src/ehr/)
  src/routes/       thin Express routers
  drizzle/          SQL migrations
  test/security/    tenant-isolation test suite
  test/ehr/         EHR abstraction test suite
  test/campaigns/   campaign lifecycle + eligibility test suite
  test/queue/       queue concurrency/retry/escalation/isolation test suite
  test/protocols/   protocol CRUD, tenant isolation, and retrieval-scoring test suite
  test/ai/          AI agent pipeline integration test suite (triage, consensus, escalation, audit)
  test/escalations/ escalation lifecycle, tenant isolation, and reviewer RBAC test suite
  test/events/      event bus idempotency and escalation-timeout workflow test suite
  test/analytics/   dashboard analytics aggregation and RBAC test suite
  test/safety/      safety evaluation dataset coverage, determinism, and false-negative/positive test suite
  test/health/      system health states (healthy/degraded/unavailable) test suite
  test/audit/       audit logging for human-driven operations test suite
  test/auth/        authentication failure-path test suite (wrong password, bad/expired tokens)
  test/validation/  central API-validation (Zod -> 400) test suite
web/                React + TypeScript + Tailwind v4 frontend
  src/components/ui/      design-system component library (Button, Badge, Table, ...)
  src/components/layout/  app shell (sidebar + topbar)
  src/pages/              route-level pages, split platform/ vs hospital/ (includes campaigns)
  src/lib/                API client, auth context, React Query hooks
docker-compose.yml  local Postgres + Redis
```
