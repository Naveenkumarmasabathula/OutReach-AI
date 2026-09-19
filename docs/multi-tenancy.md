# Multi-Tenancy Design

Adapted from the tenant-isolation pattern in `Documents/Zopkit/Project-Management-master` (see its `Documents/04-DATA/MULTITENANCY.md` and `Documents/06-AUTHORIZATION/SECURITY_INVARIANTS.md`), hardened where this platform's PHI/healthcare requirements are stricter than a general B2B SaaS. Written so implementation can start directly from this design rather than re-deriving it.

## 1. What we're reusing as-is

- **Root tenant table** pattern → here the tenant unit is `hospitals` (PRD §3–4). CUID2 primary keys (not serial ints), a `status` enum (`active` / `suspended` / ...), and a `settings` jsonb column for hospital-specific config (timezone, calling hours, outbound capacity, retry rules — PRD §4).
- Every tenant-scoped table carries a `hospital_id` FK with `ON DELETE CASCADE`, a btree index on it, and **tenant-scoped composite uniqueness** instead of global uniqueness. The reference project hit a real bug where a natural key (`workspaces.slug`) was globally unique and caused a live cross-tenant collision; fixed by making it unique per-tenant instead. We adopt "unique per hospital, not globally" as the default from day one.
- `hospital_id` lives on the authenticated principal only, set once in an auth preHandler (`request.user.hospitalId`), and is **never read from request params/body/query**.
- Service methods take the hospital scope as an **explicit argument** — every query touching a tenant-scoped table must filter on it explicitly. No implicit/ambient scoping.
- **Tenant-check-before-bypass ordering.** The reference project's Invariant I15 records a real vulnerability: an admin-bypass check ran before the tenant check, letting any org's admin read another tenant's data. Fixed order, which we adopt directly: **hospital scope → visibility → module → capability**. Any Platform Admin cross-hospital "read everything" path still resolves hospital scope first.
- **One-authorization-model-per-response discipline** (I17): if a response aggregates multiple sources (e.g., a dashboard combining campaign data, AI usage, and escalation data), every source must resolve visibility through the same scope computation — otherwise the weakest source silently governs the whole response.
- **Explicit tenant context across async boundaries.** Background jobs and queue tasks carry `hospital_id` directly on the payload, never inferred from thread-local/ambient context. This maps cleanly onto the PRD's outbound queue and event system (§9, §18): every queue task, retry, callback, and event message has `hospital_id` as a first-class field. Cron-style aggregate jobs iterate across all hospitals in one query and re-derive scope from each row's own `hospital_id`.
- **Dedicated isolation test suite.** One test file per domain area (`test/security/<domain>-isolation.test.ts`) asserting a hospital can never read another hospital's data, plus a completeness check: one query enumerating every tenant-scoped table that must sum to zero after a hospital's data is purged, so an added table without isolation coverage fails CI instead of leaking silently.

## 2. What we're changing (hardening for PHI)

**Add Postgres Row-Level Security as a second, DB-level enforcement layer — from day one, not deferred.**

The reference project is explicit that this is a known gap in its own design: RLS is enabled on every table but has zero `CREATE POLICY` statements and isn't forced, so today isolation is ~700 hand-written `eq(tenantId, ...)` filters with no database backstop. Its own docs call a forgotten filter "the top data-safety review item" and name RLS as a stated-but-not-yet-adopted defense-in-depth option. For a general SaaS that's a defensible tradeoff; for a platform whose entire risk model is PHI, it's not one we want to inherit.

Implementation:
- `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` **and** `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` on every hospital-scoped table.
- One policy per table: `USING (hospital_id = current_setting('app.current_hospital_id', true))`.
- The API sets `app.current_hospital_id` via `SET LOCAL` (via `set_config(..., true)`) at the start of each request's DB transaction, sourced from the same `request.user.hospitalId` used for the app-layer filters.
- Net effect: a cross-tenant leak now requires two independent bugs (a missing app-layer filter *and* a missing/wrong session variable) instead of one.

Two real gotchas found wiring this up, worth calling out explicitly:
- **`FORCE ROW LEVEL SECURITY` does nothing for a superuser or the table owner unless that owner is a non-superuser role** — Postgres superusers bypass RLS unconditionally, `FORCE` or not. Since the docker-compose Postgres bootstrap user is a superuser (used to run migrations, i.e. create tables/roles), the app must connect as a **separate, dedicated, non-superuser `app_runtime` role** instead, or this entire layer is silently inert. Migrations run via the superuser (`MIGRATE_DATABASE_URL`); the running app connects via `app_runtime` (`DATABASE_URL`).
- **`users` is deliberately excluded from RLS.** Login must look up an account by email before any hospital is known (`findUserByEmail` in `userService.ts`) — a legitimately cross-tenant, unscoped query. A forced RLS policy keyed on a session variable that isn't set yet would silently return zero rows for that exact query, breaking login. `users` isolation relies on the app-layer `hospital_id` filter alone for every other read/write; the email-lookup exception is narrow, named, and documented at its call site.

**Make the "scope object" pattern the only path from day one**, rather than migrating to it later. The reference project has a `ProjectScope` type that can only be constructed by an access guard, with two "fitness ratchet" counters tracking legacy code that still takes a bare id — a migration in progress, not yet universal. We start where they're heading: a `HospitalScope` value object mintable only by an auth/access guard; every service method touching patient, campaign, or queue data takes a `HospitalScope`, never a bare `hospitalId` string. Holding one is the evidence a check ran.

**Adopt the "regulated subject" pattern for PHI specifically.** The reference project's Invariant I26 documents a real incident: an AI feature exposed unredacted PII about a regulated subject (a job candidate's hiring status) because the record's regulated status wasn't computed from its actual subtype. Their fix pattern — mark specific entity subtypes as regulated, gate them centrally, audit every *read* not just every write — maps directly onto PHI here. Any entity carrying patient-identifying clinical data (conversation transcripts, triage results, observations, escalation rationale) is a regulated class: every read produces an audit row naming which user read which patient's data and why, not just writes. This is stricter than the reference project's general default and directly satisfies PRD §21's audit requirement.

## 3. Roles

PRD §3 defines four roles — simpler than the reference project's two-tier org-role + project-role model, since no per-campaign membership/role granularity is required here:

- `PLATFORM_ADMIN` — cross-hospital, mostly read/aggregate access; any hospital-scoped read still goes through hospital-scope-before-bypass ordering (§1 above).
- `HOSPITAL_ADMIN`, `CAMPAIGN_MANAGER`, `CLINICAL_REVIEWER` — hospital-scoped, resolved from `request.user.hospitalId` + `request.user.role`.

One role→permission map (`hospitalRoleGrants.ts`, data not scattered `if` branches — reusing the reference project's `orgRoleGrants.ts` pattern) is enough for this scope. If per-campaign role assignment becomes necessary later, the reference project's registry pattern (capabilities as data, resolved per role) is the fallback design to extend into.

## 4. Background jobs & the outbound queue

Every queue task, retry, callback, and workflow event carries `hospital_id` explicitly as a payload field — never inferred from ambient context (see §1). This is a direct fit for the PRD's queue design: the concurrency semaphore key for the capacity-aware scheduler (PRD §8–9) is naturally `hospital_id`, so tenant isolation and capacity isolation collapse into the same mechanism rather than being two separate concerns.

## 5. What we're deliberately not copying

- **Dual-IdP auth routing** (Cognito + Kinde in the reference project) — unnecessary complexity for this prototype. A single JWT issuer is enough, with the same `request.user` shape (`id`, `hospitalId`, `role`) as the one source of tenant context.
- **`permissionsEpoch` staleness propagation** — useful for a SaaS with frequent live permission changes; not worth the complexity here. Can be added later if a real need shows up.
- **Project-role registries / per-project capability resolution** — no analog needed since campaigns aren't a membership/role boundary in this PRD.

## 6. Reference implementation pointers

When implementation starts, these files in `Documents/Zopkit/Project-Management-master` are the templates to adapt (not copy verbatim — the RLS and `HospitalScope`-from-day-one changes above are real deltas):

- `backend/src/db/schema/tenants.ts` — root tenant table shape
- `backend/src/db/scoped.ts` + `backend/src/middleware/projectScope.ts` — the scope-object guard pattern, to be adapted into `HospitalScope`
- `backend/src/middleware/auth.ts` — JWT verification → `request.user` construction (simplify: drop Cognito routing)
- `backend/src/middleware/permissions.ts` — `requirePermission`/`requireOrgAdmin`-style guards
- `backend/test/security/*-isolation.test.ts` — isolation test suite shape to replicate per domain
