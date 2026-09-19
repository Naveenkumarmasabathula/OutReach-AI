# EHR Abstraction Layer

Implements PRD §6 ("EHR Integration and Data Boundaries"): a real EHR is not required for the prototype, but the platform must include a genuine abstraction layer — AI agents (and application code generally) must never touch patient/encounter tables directly, and a mock implementation today must be replaceable by a real EHR integration later without changing calling code.

## The contract

`server/src/ehr/types.ts` defines `EHRInterface` — the single boundary through which clinical data is read or written:

- `getPatient`, `getEncounter`, `getDischargeInfo`, `getConditions`, `getObservations`, `getCarePlan` — reads
- `writeCommunication`, `writeObservation`, `createFollowUpTask`, `createEscalationRecord`, `updateEncounterMock` — writes

Every method takes a `HospitalScope` (never a bare `hospitalId`), the same guard-minted-object pattern used everywhere else (`docs/multi-tenancy.md`). Every write input has a paired Zod schema (`writeCommunicationSchema`, `writeObservationSchema`, etc.) in the same file.

## The pipeline this sets up for Phase 5

PRD §16's required pattern is **AI request → authorization → schema validation → business rules → execution → audit → result**. This module is the last two steps of that chain, built now so Phase 5's controlled AI tools have a stable, tested boundary to call into rather than being built against raw queries:

```
AI agent → controlled tool (Phase 5) → authorization (RBAC/HospitalScope, already built)
         → validation (the Zod schemas above, already built)
         → EHRInterface → MockEHR → database
```

A Phase 5 tool handler will parse an AI-proposed operation against these same Zod schemas, resolve a `HospitalScope` from the authenticated request the same way every route already does, and call the matching `EHRInterface` method — no new validation or authorization logic needed at that point, and no path from a tool back to a raw Drizzle query.

## `MockEHR` — today's implementation

`server/src/ehr/mockEhr.ts` implements `EHRInterface` against our own tables (`patients`, `encounters`, `conditions`, `observations`, `carePlans`, `communications`, `tasks`, and a new `escalations` table — see below). Every method opens its own `withHospitalScope` transaction, so both enforcement layers from `multi-tenancy.md` (the app-layer filter and Postgres RLS) apply to every EHR operation, not just the routes that existed before this.

`server/src/ehr/index.ts` exports one bound instance: `export const ehr: EHRInterface = new MockEHR();`. Swapping in a future `RealEHR` (e.g. a real FHIR API integration) is a one-line change to that file — nothing that calls `ehr.*` needs to change, which is the actual "replaceable" requirement from PRD §6, not just a naming convention.

## The new `escalations` table

PRD §21 describes a full escalation shape — patient, hospital, **campaign, call**, trigger, clinical indicators, triage result, **consensus result**, priority, **assigned reviewer**, status, resolution — that references campaign and call entities that don't exist yet (Phases 2 and 3). Building that full shape now would mean guessing at foreign keys for tables that don't exist. Instead, `escalations` (migration `0002`/`0003`) covers only what's answerable today: hospital, patient, encounter, trigger, clinical indicators (jsonb), priority, status (using PRD §21's lifecycle names: `open/assigned/in_review/waiting_for_information/resolved/closed`), and notes. Phase 6 extends this table with the remaining columns rather than replacing it. RLS is enabled and forced on it from the start, same as every other clinical table.

## What was refactored, and what deliberately wasn't

- `patientService.getPatientById` and `encounterService.getEncounterById` now delegate straight to `ehr.getPatient` / `ehr.getEncounter` — these are exact 1:1 matches with an EHR read, so there was no reason to keep a second, separate query for the same thing.
- `encounterService.getPatientTimeline` (the patient-history UI view) **deliberately does not** delegate its per-resource reads to `ehr.getConditions`/`getObservations`/`getCarePlan`, even though those cover 3 of its 8 resource types. The timeline fetches all 8 as one consistent snapshot inside a single transaction; each `EHRInterface` method opens its *own* transaction, so routing through them would split one consistent read into several inconsistent ones and add round trips, for a UI aggregate that isn't itself an EHR operation the way a controlled AI tool call would be.
- `patientService.createPatient` / `encounterService.createEncounter` (discharge data ingestion, used by hospital onboarding) were **not** changed — creating patients/encounters isn't in PRD §6's EHR read/write list (which is about *outreach* reads/writes), and rewriting working ingestion code with no behavioral need to would have violated the "don't rewrite unnecessarily" constraint on this task.

## Bugs found while adding tests for this

Writing `test/ehr/ehr.test.ts` (which exercises `getPatientTimeline` more thoroughly than any prior test) surfaced a real, pre-existing bug unrelated to the EHR work itself: both `getPatientTimeline` and `patientService.listPatients` issued multiple queries via `Promise.all` against a single transaction's one `pg` connection. `node-postgres` only tolerates this today via an internal queue and is deprecating it (a live `DeprecationWarning` appeared in test output). Fixed by awaiting each query sequentially instead — a single Postgres transaction can't run its statements concurrently anyway, so this costs nothing and removes a real forward-compatibility risk.

## Tests

`server/test/ehr/ehr.test.ts` (13 assertions total, run alongside `test/security/patient-isolation.test.ts`) covers: every read/write method against real data, tenant isolation (hospital B's scope gets `NotFoundError`, not silent success, when it tries to read or write against hospital A's patient), and that `patientService`/`encounterService`'s refactored methods actually flow through the EHR-backed path rather than a parallel implementation.
