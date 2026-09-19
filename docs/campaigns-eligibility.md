# Campaigns & Eligibility (Phase 2)

## Lifecycle state machine

`draft → ready → scheduled|running → paused → completed | cancelled | failed`, matching the states named in PRD §8. Implemented in `server/src/services/campaignService.ts` as one guarded transition function per action rather than a generic "set any status" endpoint, so every transition's precondition is enforced in one place and invalid transitions fail loudly (`ConflictError`, 409) instead of silently corrupting state:

| Action | Allowed from | Result |
|---|---|---|
| `markCampaignReady` | `draft` | `ready` (validates config first — see below) |
| `startCampaign` | `ready`, `scheduled` | `running` if no `startDate` or it's already past; `scheduled` if `startDate` is still in the future |
| `pauseCampaign` | `running` | `paused` |
| `resumeCampaign` | `paused` | `running` + a freshly recalculated eligible-patient count (see below) |
| `cancelCampaign` | any non-terminal state | `cancelled` |
| `completeCampaign` | `running`, `paused` | `completed` |
| `reprioritizeCampaign` | any non-terminal state | same status, new `priority` |

`markCampaignReady` validates the draft is internally consistent before locking it: `startDate` before `endDate`, and — enforcing the same envelope-narrowing rule as `docs/multi-tenancy.md`'s reference-project pattern — a campaign's calling hours may narrow the hospital's, never widen them. A campaign set to start calling before the hospital's own permitted start time is rejected at `markCampaignReady`, not silently accepted.

`failed` is defined but has no manual trigger today — it's reserved for a future background-job failure path (Phase 7), the same way `scheduled → running` on `startDate` arriving is reserved for Phase 3's background scheduler; today `startCampaign` only sets the state a manual action produces.

## Eligibility engine (PRD §7)

`server/src/services/eligibilityService.ts` splits into two pieces on purpose:

- **`evaluatePatientEligibility`** — a plain, synchronous, pure function taking a campaign/encounter/patient/now and returning either `{ eligible: true }` or `{ eligible: false, reason: <one of 6 named reasons> }`. PRD §7 requires eligibility to be "evaluated consistently and explainably" — a pure function with a named reason per rejection is the plainest way to satisfy that, and it's unit-tested directly (`test/unit/eligibilityService.test.ts`, 11 cases covering every reason) with no database involved.
- **`evaluateEligiblePatients`** — the database-facing wrapper: fetches every discharged encounter+patient in scope and runs each through the pure function above. Filtering happens in application code, not SQL, because the dataset is small (hundreds of rows per hospital) and an explainable rule belongs in readable code, not a WHERE clause someone has to reverse-engineer.

Rules applied, in order: encounter must be `discharged` with a discharge date recorded; patient must have `communicationConsent`; hours since discharge must fall within the campaign's `followUpWindowHours`; then the campaign's optional `eligibilityCriteria` (`careSettings`, `minRiskLevel`, `maxRiskLevel`) narrow further. Consent is checked unconditionally — it's a compliance floor, not something a campaign's criteria can override.

**Deliberately not checked yet, and not silently ignored either:** PRD §7 also lists "existing outreach status" as an eligibility input — whether a patient already has a pending or completed outreach attempt for this specific campaign. That requires the campaign-scoped outreach-task entity Phase 3 introduces (the actual queue-managed call attempts); building a parallel tracking mechanism now would be guessing at Phase 3's own data model. `evaluatePatientEligibility`'s signature is written to be extended with that input once it exists, not replaced.

## Workload estimate (PRD §8)

`getCampaignWorkloadEstimate` returns `eligiblePatientCount` (a live call to the eligibility engine, not a cached snapshot) and `expectedAttempts`, computed as `eligiblePatientCount × (retryLimit + 1)` — a documented **upper bound** (every eligible patient needs the campaign's maximum configured retries), not a contact-rate prediction. A real attempt-count model depends on the retry/backoff behavior Phase 3 builds; presenting a made-up "realistic" estimate before that exists would be less honest than a clearly-labeled worst case.

`resumeCampaign` calls the same eligibility engine and returns the fresh count alongside the resumed campaign — this is what PRD §8's "resuming should recalculate eligible work rather than blindly restarting every previous task" means at this layer, ahead of Phase 3's actual task queue existing to restart.

## What's new in the data model

One table, `campaigns` (migrations `0004`/`0005`, RLS forced from creation like every other clinical table). `eligibilityCriteria` and `escalationConfig` are `jsonb` — criteria because the shape is small and stable enough that a rigid column set isn't worth it yet, escalation config because Phase 6 will define its actual shape and this is only a placeholder for per-campaign overrides until then.

## Tests

`test/unit/eligibilityService.test.ts` (11 assertions, pure function, no DB) and `test/campaigns/campaign-lifecycle.test.ts` (8 assertions against real Postgres): the full lifecycle walk, invalid-transition rejection, the calling-hours envelope check, a real workload-estimate count against seeded patients with three different disqualifying conditions (stale discharge, no consent, ineligible-vs-eligible), tenant isolation (hospital B gets `NotFoundError` for hospital A's campaign, not silent success or a list leak), and an HTTP-level round trip confirming the same isolation holds through the API, not just the service layer.

**Bug found while writing these tests, not part of this phase's design:** `encounterService.createEncounter` never set `status`, so every encounter created through the API/UI (the "Add encounter" form) silently kept the table's `in_progress` default instead of `discharged` — meaning the eligibility engine, and anything else that filters on `status = 'discharged'`, would never have seen any of them. Fixed by explicitly setting `status: "discharged"` in that insert, since every encounter created through that endpoint already carries discharge fields and represents a completed discharge, not an admission still in progress.
