# AI Usage (Phase 5, PRD §33 deliverable)

How the AI agent layer is built, why it's split the way it is, what it validates, and how the consensus/escalation mechanism works. See [voice-provider.md](./voice-provider.md) for the separate Voice Intake Agent/telephony swap point, and [protocols-knowledge-retrieval.md](./protocols-knowledge-retrieval.md) for the retrieval engine the triage agent consumes.

## Provider and models

**Provider**: Google Gemini, via `@google/genai` — switched from an initial Anthropic Claude plan mid-build (product decision, before any Phase 5 code existed, so it was a clean dependency/config swap; see `docs/dev-ai-usage.md`). Selected automatically at `server/src/ai/index.ts`'s one binding point:

```ts
export const aiProvider: AIProvider = env.GEMINI_API_KEY
  ? new GeminiProvider(env.GEMINI_API_KEY)
  : new SimulatedAIProvider();
```

**A real key has been supplied and `GeminiProvider` is now live-verified**, not just implemented against type definitions. `SimulatedAIProvider` (deterministic, hash-seeded, not `Math.random()`) is still what every automated test and the required `queue:simulate`/`safety:evaluate` scripts run against — that's deliberate, for the same reproducibility reason `callSimulator.ts` uses a hash: Phase 9's safety evaluation needs to re-run a fixed scenario set and diff results after a prompt/model/protocol change, and neither a real network call nor true randomness would allow that. `GeminiProvider` activates automatically the moment `GEMINI_API_KEY` is set (`server/src/ai/index.ts`), and now that it has been, both agent-facing methods were exercised directly against the live API (not through the queue, a one-off standalone check): `generateDocumentation` succeeded end-to-end, producing valid structured JSON that passed `documentationRecordSchema` on a real call; `assessTriage` correctly exhausted its one repair attempt against a real `429 RESOURCE_EXHAUSTED` error and threw `AIOutputValidationError` exactly as designed — see "What was actually verified live" below for why that's the *expected* result for that specific call, not a bug.

**Model tiers** (Decision #5, `docs/implementation-plan.md`): a Gemini **Pro-tier model** for the two safety-critical decisions (clinical triage and the escalation consensus that depends on it), a **Flash-tier model** for the lower-stakes documentation summary. The originally-guessed defaults (`gemini-2.5-pro`/`gemini-2.5-flash`) had already been deprecated by Google before a real key arrived to test them — confirmed live, not assumed: calling either returned a `404` naming its replacement directly. Current defaults, both confirmed live:

- **Pro tier**: `gemini-3.1-pro-preview` — a genuine, successful model (its `404` predecessor's own deprecation notice named this as the replacement), but **the supplied key's account has zero free-tier quota for it** (`429 RESOURCE_EXHAUSTED`, `limit: 0`, confirmed on both keys supplied) — a billing/plan fact about the account, not a code defect. Until billing is enabled on the associated Google Cloud project, every `assessTriage` call will hit this quota wall, exhaust its one repair attempt the same way, and throw `AIOutputValidationError` — which `queueService.processTask` already treats as an explicit `technical_failure` (PRD §13), and which trips `aiProviderCircuitBreaker` open after 3 such calls, degrading the whole pipeline to the conservative "uncertain, escalate for human review" fallback (`docs/observability-reliability.md`) rather than failing every task outright.
- **Flash tier**: `gemini-3.5-flash` — confirmed working on the supplied key, including the full structured-JSON round-trip through `generateDocumentation`. Note: the live API was visibly under heavy load while testing (3 of 4 consecutive calls returned `503 UNAVAILABLE` "experiencing high demand" before one succeeded, and the successful call took ~14s) — likely because several newer model versions (3.5 through 3.8) were all listed as available at test time, suggesting a very recent rollout window. Expect this to stabilize; it isn't a problem with this integration.

Both supplied keys were tested and behave identically (same zero pro-tier quota, same working flash tier) — the second is not currently configured anywhere, kept only as a spare in case the first is rotated.

### What was actually verified live

Run directly against `GeminiProvider` (not through the queue/pipeline, to isolate the provider itself from everything downstream):

- `assessTriage` (pro tier): threw `AIOutputValidationError` after genuinely attempting the call twice (the original call, then the repair re-prompt), both attempts failing with the real `429` quota error from Google — proving `generateJSON`'s repair-then-throw logic (PRD §13) works against a real failure, not just a hand-constructed mock one.
- `generateDocumentation` (flash tier): succeeded on a real call, returning `{ callSummary, patientReportedSymptoms, observations, outcome, triageClassification, escalationStatus, followUpRequirements }` that parsed cleanly through `documentationRecordSchema` — the full structured-output contract this whole design has been built around, since Phase 5, confirmed for real for the first time here. Token usage was logged as designed: `promptTokenCount: 298, totalTokenCount: 1626`.

**Not yet verified**: `assessTriage` producing an actual *successful* structured triage result from a live call (blocked by the account's zero pro-tier quota, not by anything in this codebase) — re-run once billing is enabled on the Google Cloud project behind this key, and re-run `npm run safety:evaluate --workspace server` against the real provider (temporarily swap `aiProvider` in `server/src/ai/clinicalTriageAgent.ts`'s import, or add an env flag to force it) to see how the fixed dataset's results compare against `SimulatedAIProvider`'s.

## Agent separation (PRD §17's "do not implement the whole product as one unrestricted AI agent")

| Agent | File | What it does |
|---|---|---|
| Voice Intake Agent | `server/src/voice/` | Manages the conversation, asks the hospital's own protocol-driven follow-up questions, captures responses, reports structured symptoms. Also: verifies the interaction can proceed at the start of the call, and can end/transfer a call early on a red-flag answer instead of always running the full script (PRD §14) — see `docs/voice-provider.md`. Placeholder (`SimulatedVoiceProvider`) today |
| Clinical Triage Agent | `server/src/ai/clinicalTriageAgent.ts` | Converts the conversation into structured observations and a classification, via **two independent paths** (below) |
| Escalation Decision System | `server/src/ai/escalationDecisionSystem.ts` | Combines the two triage assessments into a consensus, detects disagreement, decides whether to escalate |
| Documentation Agent | `server/src/ai/documentationAgent.ts` | Converts the whole interaction into a structured call record |

Each is a separate module with a narrow, single-purpose interface — none of them can reach the database directly (see "Controlled tools" below).

## The two independent triage paths (PRD §14)

1. **Rule-based / protocol-matching** (`assessRuleBased` in `clinicalTriageAgent.ts`) — pure, synchronous, no AI call. A fixed, clinician-authorable symptom→severity map (`chest pain`/`shortness of breath` → urgent, `swelling`/`fever` → concerning, `dizziness` → uncertain) classifies the patient's *structured* reported symptoms, and separately cites any hospital protocol (Phase 4's retrieval engine, `red_flag_indicator` category) whose title/content mentions the same symptom, as supporting evidence. Fully deterministic and testable without a database or an AI call — `server/test/unit/clinicalTriageAgent.test.ts`.
2. **AI-model-based** (`aiProvider.assessTriage`) — reads the *free-text transcript* and classifies from language, not the structured symptom list. Deliberately a different signal than path 1, on purpose: if both paths read the same input with the same logic, "multiple independent assessments" (PRD §14) would be theater, not a real second check. `SimulatedAIProvider`'s version of this path uses its own, separate keyword vocabulary from the rule-based path's symptom map — see `server/src/ai/simulatedProvider.ts`'s comment for why.

Because the two paths read different signals, they can and do genuinely disagree — e.g. a patient saying "I'm not sure, maybe a little dizzy sometimes" classifies as `uncertain` structurally (the word "dizziness" as a reported symptom) but `concerning` from the free-text path (the word "dizzy" appearing alongside vaguer language a real LLM would likely also flag). That disagreement is not a bug; it's the exact scenario PRD §14 says the consensus step must detect and handle conservatively — see the next section.

Both paths' output is validated against `triageResultSchema` (`server/src/ai/types.ts`) before anything downstream trusts it — for the rule-based path this is a cheap safety net (it's already correctly typed); for the AI path, this is the actual "backend must validate AI output before use" requirement (PRD §13). `GeminiProvider` does one repair re-prompt on a validation failure, then throws `AIOutputValidationError` — `queueService.processTask` catches that and records a `technical_failure` attempt (the same retry/manual-follow-up handling as any other connectivity failure) rather than crashing the worker or silently accepting bad output.

## Consensus / escalation decision (PRD §14-15)

`escalationDecisionSystem.decideEscalation` (pure, synchronous — `server/test/unit/escalationDecisionSystem.test.ts`) takes the two `TriageResult`s and:

- Computes `disagreement` (their classifications differ).
- Sets the consensus classification to **whichever of the two is more severe** (`routine < uncertain < concerning < urgent`) — never an average, never a majority vote of two, per PRD §14's own worked example ("if one assessment classifies a patient as routine while another identifies a protocol red flag... apply a conservative escalation strategy").
- Escalates whenever the consensus classification isn't `routine`, **or** either individual assessment independently recommended escalation — two signals checked, never one, so a severity-ranking edge case can't silently suppress an individual model's own escalation call.
- Maps classification to a priority (`urgent`→1, `concerning`→2, `uncertain`→3) for the resulting escalation record.
- Returns a `ConsensusResult` that records both individual assessments, the disagreement flag, the consensus classification, the escalate decision, and a human-readable rationale — this whole object is what actually gets persisted (see "What gets persisted" below), not just the final yes/no.

"Uncertain" is treated as its own trigger, not a rounding-down to routine, matching PRD §14's explicit listing of "significant uncertainty" as a potential escalation trigger in its own right.

## Controlled tools (PRD §18's "AI request → authorization → schema validation → business rules → execution → audit → result")

`server/src/ai/tools.ts` is that boundary, made real rather than just described: it defines each of PRD §18's named operations (patient lookup, encounter lookup, protocol search, observation lookup, campaign status lookup, callback scheduling, call outcome recording, escalation creation, notification requests, communication recording, mock EHR updates) as its own exported function — `lookupPatient`, `lookupEncounter`, `lookupProtocols`, `lookupObservations`, `lookupCampaignStatus`, `scheduleCallback`, `recordCallOutcome`, `createEscalation`, `requestNotification`, `recordCommunication`, `updateMockEhr`. Every one of them runs the same six steps, in the same order:

1. **Authorization** — `authorizeAiTool` rejects any actor that isn't `ai_agent`-typed before anything else runs. Layered on top of `HospitalScope` itself (mintable only by an access guard, `docs/multi-tenancy.md`), which is still the tenant-authorization boundary underneath every one of these calls.
2. **Schema validation** — a Zod schema per tool, reusing `ehr/types.ts`'s existing write schemas (`writeCommunicationSchema`, `writeObservationSchema`, `createFollowUpTaskSchema`, `createEscalationSchema`, `mockEncounterUpdateSchema`) where one already existed, rather than redefining them.
3. **Business rules** — enforced by the underlying service/EHR call itself (RLS tenant isolation, `NotFoundError`s, `createEscalationSchema`'s priority clamp, etc.) — `tools.ts` does not reimplement any of it, only calls it.
4. **Execution** — the existing `EHRInterface`/service call, unchanged.
5. **Audit** — one `ai_tool.<name>` row per call via `recordAudit`, on top of (not instead of) `AuditedEHR`'s own per-PHI-read audit rows for the tools that read PHI.
6. **Typed result** — the same typed value the wrapped call already returned.

`server/src/ai/pipeline.ts`'s `runOutreachAiPipeline` calls **only** through `tools.ts` for every one of these operations — `lookupPatient` (patient lookup), `lookupProtocols` (protocol search, called twice — once for `follow_up_questions`, once for `red_flag_indicator`), `recordCommunication` (the call summary), and `recordCallOutcome` (one call per reported symptom). It never reaches `ehr`/a service module directly for anything `tools.ts` names. The remaining named tools (`lookupEncounter`, `lookupObservations`, `lookupCampaignStatus`, `scheduleCallback`, `createEscalation`, `requestNotification`, `updateMockEhr`) are fully implemented and exported the same way, even though `pipeline.ts` doesn't call them today — `createEscalation` in particular is deliberately *not* called from the pipeline (escalation-record creation stays with `queueService.recordAttemptOutcome`, which still calls `ehr.createEscalationRecord` directly — see that function's own comment for why), so the tool exists for completeness and any future caller, not because every named tool has a current AI-driven use.

One deliberate exception: `getPreviousCallSummary` inside `pipeline.ts` (a raw, RLS-scoped read of the patient's most recent `communications` row) is **not** routed through `tools.ts`. It isn't one of PRD §18's named operations, and wrapping it wouldn't add anything beyond what it already has (a `withHospitalScope`-scoped, side-effect-free read) — reimplementing it as a twelfth tool just to have twelve tools would be padding, not a real boundary. This is a live judgment call, not an oversight, and is named here for exactly that reason.

**What this is, honestly, and what it is not.** This is *not* LLM function-calling / agentic tool-use: `aiProvider` (`GeminiProvider`/`SimulatedAIProvider`) never sees the tool list, never decides which tool to call, and never gets a chance to call one dynamically mid-reasoning. `pipeline.ts` still calls each tool in a fixed, hardcoded order — exactly the same order it called the underlying services/EHR methods in before `tools.ts` existed. What changed is *only* that `pipeline.ts` is no longer allowed to skip the boundary: every actual side-effecting or PHI-reading operation the AI layer's output leads to now goes through an individually-authorized, individually-validated, individually-audited function, so "AI request → authorization → schema validation → business rules → execution → audit → result" is a real, enforced code path for each one — not a description of an architecture that doesn't exist in the code. Building real function-calling (the model choosing, at runtime, which of these tools to invoke and with what arguments) is future scope, deliberately not attempted here: it's materially higher-risk for a project at this stage (prompt-injection-shaped attack surface on tool selection itself, nondeterministic tool sequencing that's much harder to safety-evaluate against a fixed dataset) and isn't necessary to close the actual gap the prior audit found, which was that no controlled-tool boundary existed at all, not that the existing deterministic orchestration was unsafe.

## Persistent per-patient context (PRD §17)

Two mechanisms, covering two different scopes:

- **Within one outreach task's retry lifecycle**: `outreach_tasks.conversationContext` (jsonb, added in Phase 3 specifically for this) is updated after every pipeline run with the last call's summary, reported symptoms, and classification — so a retry attempt on the *same* task can reference what was already discussed instead of starting cold.
- **Across campaigns/tasks for the same patient**: the pipeline reads the patient's most recent `communications` row (written by a prior outreach call, any campaign) if `conversationContext` has nothing yet — giving continuity even across separate outreach efforts for the same patient.

## What gets persisted per attempt (PRD §12: "every call maintains a record")

`outreach_attempts` (extended in Phase 5, additive nullable columns — see `docs/queue-design.md`'s pattern of extending rather than replacing) now carries, for every connected call: `transcript` (the full conversation), `triage_result` (both independent assessments), `consensus_result` (the full `ConsensusResult`, not just escalate/no-escalate), and `documentation_status`. An `escalations` row created from a pipeline run carries the real `trigger` (`ai_triage_consensus` or `ai_triage_disagreement`), the real `clinicalIndicators`, and the consensus rationale as `notes` — replacing Phase 3's placeholder note ("Flagged by the Phase 3 call-outcome simulator...") entirely. A row created without a pipeline run (a test or a manual override forcing "escalated" directly) still gets a clearly-labeled generic trigger (`queue_forced_escalation`) rather than fabricated clinical detail.

## What was deliberately not built now

- **No dedicated Phase 5 frontend.** Escalation records already show up in the existing queue-health view (Phase 3); a proper review UI (transcript, both assessments, consensus rationale, resolve/assign actions) is Phase 6 — Escalation & Human-in-the-Loop — scope, not deferred by oversight.
- **No prompt-injection-specific test suite yet** — the system prompts already instruct the model to treat transcript/protocol content as untrusted data, never instructions (PRD §14's trust-domain separation), but a dedicated adversarial test set is Phase 9/10 scope (safety evaluation, observability hardening).
- **`assessTriage` has never returned an actual successful result from a live call** — verified failing correctly (the real 429/repair/throw path), not verified succeeding, since the supplied key's account has zero pro-tier quota. See "Provider and models" above.
