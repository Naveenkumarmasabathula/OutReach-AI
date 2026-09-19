# Escalation Management & Human-in-the-Loop (Phase 6, PRD §19)

## What this covers

Escalations become first-class, actionable operational records instead of the write-only rows Phase 1/5 produced. Authorized staff can inspect the full context behind an escalation (patient, conversation, both independent AI assessments, consensus rationale) and move it through a lifecycle: `open → assigned → in_review → waiting_for_information → resolved → closed`, with acknowledge/assign/reassign/resolve actions matching PRD §19 exactly.

## Design

**Extended, not replaced.** `escalations` (Phase 1's minimal table) gained `campaignId`, `outreachTaskId`, `triageResult`, `consensusResult`, `assignedReviewerId`, `resolution`, `resolvedAt` — every new column nullable, so nothing that already writes to this table (Phase 1's EHR interface tests, Phase 3's queue tests, Phase 5's pipeline) needed to change. `escalationStatusEnum` was already correct from Phase 1 (it anticipated this exact lifecycle), so no enum change was needed either.

**Creation stays where it was; management is new.** `ehr.createEscalationRecord` (Phase 1) is still the only way an escalation is created — `escalationService.ts` (this phase) only manages what happens *after* creation. This mirrors the project's existing split between campaign creation and campaign lifecycle management, and means the AI pipeline (Phase 5) needed zero changes beyond passing the new optional fields (`campaignId`, `outreachTaskId`, `triageResult`, `consensusResult`) through to the existing write call.

**Lifecycle transitions are explicit, guarded functions**, one per action (`acknowledgeEscalation`, `assignEscalation`, `startReview`, `requestInformation`, `resumeReview`, `resolveEscalation`, `closeEscalation`), each declaring its own valid source status/es and throwing `ConflictError` otherwise — the same pattern `campaignService.ts`'s lifecycle functions use, not a generic status setter. `acknowledgeEscalation` (self-claim, `open → assigned`) is kept distinct from `assignEscalation` (an explicit assign/reassign, valid from any non-terminal status) because PRD §19 lists "acknowledge" and "assign, reassign" as separate reviewer actions — collapsing them into one function would have hidden that distinction.

**`getEscalationDetail` assembles everything a reviewer needs in one call** — the escalation row, the patient, and (via the escalation's `outreachTaskId`) the originating call's transcript and both triage assessments from `outreach_attempts` — because PRD §19 explicitly requires reviewers to "inspect patient context, conversation, AI outputs, protocol evidence, and escalation rationale before resolving the case." Building this as one backend call, not several the frontend stitches together, keeps that requirement satisfied by construction rather than by frontend discipline.

**Notifications are a real table, not just a log line** (`notifications.ts`), per Decision #6's "simulated/logged for now" — but "delivery must be observable" (PRD §19) means something a human or the frontend can query, not only something that scrolls past in server logs. Every `sendNotification` call both inserts a row (`status: "simulated"`, always, today) and logs structurally. Swapping in a real channel later only changes what happens *after* the row is inserted, not the row's shape or anything that reads it.

## What was verified

- `tsc --noEmit` clean on both `server` and `web`; `npm run build --workspace web` clean.
- RLS confirmed via `psql` on the new `notifications` table (escalations already had RLS from Phase 1, extending it with nullable columns needed no new RLS migration).
- New test suite (`server/test/escalations/escalation.test.ts`, 6 assertions): the full lifecycle walk, rejection of invalid transitions (`ConflictError`), a real notification row created on acknowledge, `getEscalationDetail`'s enrichment from a real linked `outreach_attempts` row, service-level tenant isolation, and an HTTP RBAC pass (`CAMPAIGN_MANAGER` can read but gets 403 on `acknowledge`; `CLINICAL_REVIEWER` can). Full suite: 88/88 passing (was 82 before this phase).
- Live smoke test: seeded a real "urgent" scenario through the actual Phase 5 pipeline against the demo `Riverside General` hospital (not a throwaway test hospital, so it's visible when logging in with the README's demo credentials), then drove the real running frontend as the seeded `CLINICAL_REVIEWER` user via Playwright — escalations list, detail page showing the real transcript and both independent assessments side by side, acknowledge → start review → resolve, all against the live app, zero browser console errors.

## What was deliberately not built now

- **Timeout-based auto-escalation to a backup reviewer** ("an escalation notifies a nurse, then escalates to a backup reviewer if not acknowledged within a configured period") is explicitly PRD §18/Phase 7 territory — it requires the async event/workflow bus (delayed jobs, reviewer-timeout configuration) that phase builds, not something to bolt onto this phase's synchronous service functions.
- **No email/SMS integration** — see "Notifications are a real table" above; this is the same placeholder-now/swap-later posture as voice and AI, not a gap.
- **Reviewer workload balancing / auto-assignment** — `assignEscalation` requires a specific `reviewerId` chosen by the caller (a Hospital Admin, in practice); there's no "assign to whoever has capacity" logic. Reasonable Phase 8 (dashboards/analytics) territory if it's needed at all — PRD doesn't require it.
