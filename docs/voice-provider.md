# Voice Provider: the Voice Intake Agent's swap point

Discussed with the user ahead of Phase 5 and written up now that the interface actually exists (`server/src/voice/`). This is the same swap-in pattern as `EHRInterface`/`MockEHR` (`docs/ehr-abstraction.md`), applied to the telephony/conversation layer instead of the clinical-data layer.

## Why this is a separate interface from `AIProvider`

`server/src/ai/types.ts`'s `AIProvider` is the reasoning-model concern (Gemini or its simulated stand-in). `server/src/voice/types.ts`'s `VoiceProvider` is the *channel* concern: how a call is actually placed, how a live conversation is captured, and how speech becomes text (or vice versa). These are genuinely different problems with different vendors and different failure modes — a real deployment might use Twilio for the phone leg and a completely different vendor (or the same Gemini account, via a live audio-capable model) for the conversation reasoning, or a single hosted voice-AI platform that bundles both. Keeping them as two separate swap points means either one can change without touching the other.

## What exists today: `SimulatedVoiceProvider`

`server/src/voice/simulatedVoiceProvider.ts` — deterministic (hash-seeded on `taskId:attemptNumber`, no `Math.random()`, same reproducibility reason as `callSimulator.ts` and `SimulatedAIProvider`). Given a `VoiceCallContext` (patient's first name, the hospital's own protocol-driven follow-up questions from Phase 4, and any previous call summary), it:

1. Picks one of five scenarios (`routine` 50%, `concerning` 18%, `uncertain` 9%, `urgent` 15%, `declined` 8% — weighted like a realistic post-discharge population, matching `callSimulator.ts`'s outcome-weighting convention). `declined` is a fifth, mutually exclusive bucket, not an independent roll layered on top of the other four — that keeps the whole thing deterministic per seed instead of a routine/urgent call having some separate chance of also failing verification.
2. Opens every call with a combined greeting + in-call verification line, and a patient reply — PRD §14's "verify that the interaction can proceed", genuinely checked before any protocol question is asked, not just assumed. For a `declined` scenario, the patient's reply is a decline/wrong-person response and the call ends right there: no protocol question is ever asked, the transcript is three turns long, and `ConversationResult.verified` is `false`. `ai/pipeline.ts` checks that flag and skips triage entirely for a declined call, recording a `declined` outcome (`recordAttemptOutcome` already had a `declined` case in `SimulatedOutcome`/`attemptOutcomeEnum` — this is the first thing that actually produces it from a connected call, as opposed to `declined` only ever coming from the upstream connectivity simulator before).
3. For every other scenario, builds a transcript by walking the hospital's actual follow-up questions paired with a scenario-appropriate scripted patient answer — but stops early, skipping any remaining routine questions and closing with a transfer-flavored line, the moment a patient answer contains an urgent red-flag phrase (PRD §14's "decide when the interaction should end or be transferred"). In practice this means the `urgent` scenario's transcript is visibly shorter than `routine`'s: a real nurse wouldn't keep working through a routine question list after a patient reports chest pain, and now this simulator doesn't either. `reportedSymptoms` for the scenario is unaffected by where the transcript stopped — it's still the full structured signal `clinicalTriageAgent.ts`'s rule-based path reads.
4. Returns the transcript, `reportedSymptoms`, and `verified`.

This is genuinely useful as a placeholder, not just a stub: it exercises the hospital's real, configured protocol questions (Phase 4), produces a real transcript the triage agents actually parse (not a canned classification handed to them), has two real branching points instead of always running a fixed script to the end, and is reproducible for Phase 9's safety evaluation. See `server/test/unit/simulatedProviders.test.ts` for tests proving both the `declined` outcome and the early-exit transcript-length behavior.

## How to add a real voice agent later

Two realistic paths, in increasing order of integration effort:

**Option A — a hosted voice-AI platform** (e.g. Vapi, Bland, Retell, or similar "voice agent as a service" products). These typically handle telephony + STT + TTS + conversation orchestration behind one API, and often let you configure the conversation with a system prompt plus a set of "tools" the agent can call mid-call. Implementation:

- Configure the platform with the hospital's protocol questions as its script/prompt (fetched the same way `pipeline.ts` does today, via `retrieveRelevantProtocols`).
- Give it a webhook/tool-call back into this backend to report captured symptoms in real time, or simply have it return a final transcript + structured extraction at call end.
- Implement `VoiceProvider.conductConversation` to: place the call via the platform's API, wait for (or receive via webhook) the completed transcript, and map the platform's response into this project's `ConversationResult` shape (`{ transcript: ConversationTurn[], reportedSymptoms: string[], verified: boolean }` — `verified` is whatever the platform's own identity/consent check, or an equivalent question folded into the call script, resolved to).
- Swap the binding in `server/src/voice/index.ts` — `voiceProvider` becomes `new HostedVoiceProvider(apiKey)` instead of `new SimulatedVoiceProvider()`. No other file needs to change; `clinicalTriageAgent.ts`, `escalationDecisionSystem.ts`, and `documentationAgent.ts` only ever see the `ConversationResult` shape.

**Option B — build it from parts** (more control, more work): Twilio (or another telephony provider) for the phone leg and Media Streams for live audio, a streaming STT service, an LLM (could reuse the same `AIProvider`/Gemini binding, or a separate one better suited to low-latency turn-taking) to decide what the agent says next given the protocol questions and the conversation so far, and a TTS service to speak it. This is a real, non-trivial voice pipeline (barge-in handling, silence detection, turn-taking latency) — Option A trades some of that control for a much smaller integration surface.

Either way, the integration point in this codebase is exactly one class implementing `VoiceProvider` and one line in `server/src/voice/index.ts` — nothing in the triage/consensus/documentation agents, the queue's `processTask`, or the EHR layer needs to know which is active.

## What doesn't change when this is swapped in

- `queueService.processTask`'s connectivity-vs-clinical split: `simulateCallOutcome` still decides whether a call *connected at all* (no_answer/busy/voicemail/etc. — still a telephony-layer placeholder pending real integration too, tracked separately in `docs/known-limitations.md`). A real `VoiceProvider` would eventually replace that connectivity signal as well, but that's a distinct swap (telephony call setup succeeding vs. a conversation being clinically assessed) from the one this document describes.
- Everything downstream of `ConversationResult` — the two independent triage paths, the consensus/escalation logic, the documentation agent, and all of Phase 5's persistence — is completely voice-provider-agnostic already.
