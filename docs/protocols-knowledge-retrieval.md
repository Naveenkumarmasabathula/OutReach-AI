# Protocols & Knowledge Retrieval (Phase 4, PRD §5)

## What this covers

Each hospital maintains its own post-discharge protocols and knowledge: follow-up
questions, red-flag indicators, specialty instructions, approved patient guidance,
escalation contacts, and operational rules (PRD §5's own grouping — modeled as the
`protocol_category` enum in `server/src/db/schema/protocols.ts`). This phase adds
the `protocols` table, hospital-scoped CRUD, and a task-specific retrieval engine —
the seam Phase 5's AI agents will call as a controlled tool ("protocol search" in
PRD §17's tool list).

**This table is also PRD §4's "knowledge resources."** PRD §4 lists knowledge
resources as one of several things hospital configuration must cover; PRD §5
separately spells out what that knowledge actually consists of (follow-up
questions, red-flag indicators, specialty instructions, patient guidance,
escalation contacts, operational rules) and requires it to be source-traceable
and tenant-scoped. That's a description of one system, not two — so this project
deliberately does **not** maintain a second "knowledge resource" table or field
alongside `protocols`. Concretely: `patient_guidance`, `specialty_instruction`,
and `operational_rule` are the categories that read most like generic "knowledge
resources"; `follow_up_questions`, `red_flag_indicator`, and `escalation_contact`
read more like campaign/clinical protocol content — but they all share the same
source-traceability, versioning, tenant-isolation, and retrieval requirements, so
splitting them into a parallel model would either duplicate this table outright or
force an arbitrary line through content the PRD itself doesn't separate. A
hospital's "knowledge resources," for the purposes of hospital configuration
completeness, means: its `protocols` rows. See
`server/src/db/schema/hospitals.ts`'s `settings` column comment, which points
here rather than claiming knowledge resources live in hospital `settings`.

## Design

**Tenant isolation** follows the exact pattern established in `multi-tenancy.md`:
`protocols` carries `hospital_id`, is `FORCE ROW LEVEL SECURITY`-enabled (migration
`0009_enable_rls_on_protocols.sql`, verified via `psql`'s `relforcerowsecurity`),
and every service function goes through `withHospitalScope` plus an explicit
`hospital_id` filter (belt-and-suspenders, matching `campaignService.ts`).

**Source traceability** (PRD §5: "clinical guidance must preserve its
source/protocol reference for traceability") is enforced at the schema level —
`sourceReference` is `NOT NULL`, not optional, so a protocol can never be created
without something to cite. Every retrieval result carries the full protocol row,
including its source, back to the caller.

**Versioning, not deletion.** A protocol may already have been retrieved and cited
in a past AI decision or escalation record by the time someone edits it. Editing
therefore bumps `version` and updates in place rather than creating a new row, and
there is no hard-delete endpoint at all — only `deactivateProtocol`, a soft delete
(`isActive = false`) that `listProtocols`/retrieval exclude by default but
`includeInactive` can still surface for audit purposes. This mirrors the
`escalations` table's "don't destroy what something else may reference" posture
from `docs/ehr-abstraction.md`.

**Retrieval is keyword/tag-based, not semantic/embedding search — and that's a
deliberate choice for this phase, not a shortcut.** PRD §5 requires retrieval to
be "task-specific, not a dump of the patient's entire history or every hospital
document," and to be tenant-aware and source-traceable — none of that requires
embeddings. Phase 4 is explicitly scoped in `docs/implementation-plan.md` as not
needing the Gemini key, so building the retrieval contract around a Gemini
embedding call now would have created a Phase-5 dependency this phase doesn't
need. The pattern instead reuses this project's established
pure-function-plus-DB-wrapper split (`eligibilityService.ts`'s
`evaluatePatientEligibility`, `priorityService.ts`'s `computeTaskPriority`):

- `scoreProtocolRelevance(protocol, query)` — pure, synchronous, explainable.
  Category match (weight 10) > each matched tag (weight 3) > each matched keyword
  (weight 1), so a query with a category hint always outranks a same-tag-count
  competitor without one. Returns `matchedOn`, a human-readable list of exactly
  what matched, for the same "must be explainable" reason the priority/eligibility
  engines expose their own reasoning.
- `rankProtocolsByRelevance(candidates, query, limit)` — pure, drops zero-score
  results (so an empty/irrelevant query returns nothing, never "everything"),
  sorts, and truncates to the caller's limit.
- `retrieveRelevantProtocols(scope, query, limit)` — the only DB-touching
  function; queries the caller's own hospital's active protocols, then delegates
  scoring/ranking to the pure functions above.

**Upgrade path to semantic search**, when Phase 5 wants it: swap only
`retrieveRelevantProtocols`'s candidate-scoring step for a vector-similarity
query (e.g. embedding `query.keywords` and ranking by cosine distance against
pre-computed protocol embeddings) while keeping the function's signature and the
category/tag pre-filtering exactly as-is — the same swap-in posture as
`EHRInterface`/`MockEHR` and the planned `VoiceProvider`/`SimulatedVoiceProvider`.
Nothing calling `retrieveRelevantProtocols` today needs to change.

**RBAC**: `protocol.manage` (create/update/deactivate) is `HOSPITAL_ADMIN`-only —
protocols are hospital-level clinical policy, not campaign-operational data, so
they're treated like hospital configuration rather than campaign management.
`protocol.read` is granted to `HOSPITAL_ADMIN`, `CAMPAIGN_MANAGER`, and
`CLINICAL_REVIEWER` (all already defined in `server/src/config/roles.ts` since
Phase 0 — this phase only had to build the feature the permissions were already
waiting for). `PLATFORM_ADMIN` has neither, consistent with its documented
exclusion from clinical content.

**HTTP `/protocols/search` exists alongside the in-process function** deliberately:
Phase 5's AI agents will call `retrieveRelevantProtocols` directly as a controlled
tool (no HTTP hop, same process), but exposing it over HTTP too lets protocol
content and retrieval quality be inspected/tested by a human today, before any
agent exists to call it.

## What was verified

- `tsc --noEmit` clean on both `server` and `web` after every file.
- RLS confirmed directly via `psql` (`relrowsecurity`/`relforcerowsecurity` both
  `t` on `protocols`), same discipline as every prior RLS-bearing table.
- New test suite (`server/test/protocols/protocol.test.ts`, 9 assertions):
  pure-function scoring/ranking (zero-score exclusion, category > tag > keyword
  weighting, case-insensitivity, task-specific narrowing, "never return the whole
  library" for an empty query), CRUD + version-bump-on-edit + soft-delete,
  service-level tenant isolation (cross-hospital reads/writes get `NotFoundError`,
  matching every other domain's "existence not observable" convention), DB-backed
  retrieval's tenant boundary, and an HTTP end-to-end pass covering RBAC
  (`CAMPAIGN_MANAGER` can read but gets 403 on create), cross-hospital 404, and
  unauthenticated 401. Full suite: 59/59 passing (was 50 before this phase).
- Live smoke test: started the real dev server and Vite frontend, logged in as
  the seeded Riverside General `HOSPITAL_ADMIN`, and drove the actual UI —
  Protocols nav link, empty state, the create form (all six categories), the
  detail page, and the populated list — via Playwright against the real running
  app, zero browser console errors. Also hit the live `/protocols/search`
  endpoint directly with a category+tag+keyword query and confirmed it returned
  the created protocol with its full source citation and a `matchedOn` breakdown.
  The smoke-test protocol row was deleted afterward so it doesn't pollute the
  demo hospital's seed data.

No bugs were found while building this phase — RBAC permissions for `protocol.*`
already existed from Phase 0's original role design, so this was mostly new
surface area rather than a refactor of anything fragile.

## What was deliberately not built now

- **No embedding-based/semantic retrieval** — see "Retrieval is keyword/tag-based"
  above. Revisit only if Phase 5's real agent usage shows keyword/tag matching is
  insufficient for realistic conversational queries.
- **No protocol-authoring UI richness** (rich text, versioned diff view, bulk
  import) — the create/detail pages are intentionally minimal, matching how the
  frontend has been built one phase ahead of need throughout this project.
- **No hard delete** — see "Versioning, not deletion" above; this is a permanent
  design choice, not a deferred feature.
