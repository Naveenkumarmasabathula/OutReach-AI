# Product AI Documentation

A product-level description of how AI is used in the Multi-Hospital Post-Discharge Outreach Platform — what it does, why it's built this way, and what guardrails exist. This is written for an evaluator or product stakeholder, not an engineer; see `docs/ai-usage.md` for the technical implementation and `docs/architecture.md` for the system diagram.

## What problem the AI is solving

After a patient leaves the hospital, someone needs to check in on them — did their symptoms improve, are they taking their medication, has anything gotten worse. Hospitals can't staff enough people to personally call every discharged patient, so follow-up gets skipped, delayed, or done inconsistently. This platform uses AI to conduct that follow-up conversation at scale, while keeping a qualified human in charge of every decision that actually matters clinically.

The AI's job is narrow and specific: have a structured conversation, figure out if anything the patient said needs a nurse or doctor's attention, and write down what happened. It never diagnoses, prescribes, or decides on its own that a patient doesn't need human attention when there's real uncertainty.

## The four AI agents, and what each one is responsible for

The platform deliberately does not use one general-purpose AI agent for everything. Four narrow, single-purpose components split the responsibility:

| Agent | Its one job |
|---|---|
| **Voice Intake Agent** | Conducts the actual conversation — introduces the call, confirms it's an appropriate time and the right person, asks the hospital's own approved follow-up questions, and can end the call early if the patient says something urgent instead of finishing a routine script. |
| **Clinical Triage Agent** | Turns what the patient said into a structured clinical read: routine, concerning, urgent, or uncertain — using **two separate, independent methods** (see below), not one. |
| **Escalation Decision System** | Compares the two independent reads. If they agree, that's the answer. If they disagree, it always takes the more cautious one rather than splitting the difference. |
| **Documentation Agent** | Writes up what happened on the call into a structured record — a summary, the symptoms reported, the outcome — the same record a human reviewer or the hospital's records system sees afterward. |

Each one only does its own piece and hands off to the next. None of them can reach into the database directly or take an action on their own — every actual effect (recording an outcome, creating an escalation, sending a notification) goes through the application's own controlled logic, with authorization and validation in front of it, not the AI acting unsupervised.

## Why two independent opinions instead of one

This is the platform's central safety idea, and it's worth explaining plainly: **one AI model can be wrong, and it won't tell you when it is.** So instead of trusting a single classification, every conversation is read two different ways at once:

1. A **rule-based check** that looks at the specific symptoms the patient reported and compares them against the hospital's own written red-flag list — no AI model involved, just a fixed, clinician-authored lookup.
2. An **AI-model check** that reads the free-form conversation itself and forms its own independent judgment from the language the patient actually used.

These two checks genuinely can disagree — one might read "I'm not sure, maybe a little dizzy sometimes" as merely uncertain, while the other reads real concern into the hedging language. When that happens, the system does not average the two or trust either one blindly. It always escalates toward the more cautious reading. A patient is never quietly classified as fine because one of two checks happened to miss something the other one caught.

## What the AI is never allowed to do

- Diagnose a condition.
- Prescribe or change a medication.
- Decide, on its own, that an escalation isn't needed when there's real disagreement or uncertainty.
- Write directly to a patient's record. Every write goes through the application's own validated, audited pathway — the AI requests an action, the application decides whether it's allowed and does it.
- Treat anything the patient says, or anything in a retrieved hospital document, as an instruction to follow. Patient speech and hospital documents are data the AI reads, never commands it obeys — this specifically protects against someone trying to talk the AI out of escalating a real concern.

## What happens when the AI isn't sure — or isn't available

"Uncertain" is treated as a real, distinct outcome, not a soft version of "routine" — if there genuinely isn't enough information to say a case is fine, the system treats that itself as a reason for a human to take a look, rather than assuming the best case.

If the AI provider itself becomes unavailable or starts failing (an outage, a rate limit), the system does not silently skip triage or guess. After a small number of consecutive failures, it deliberately falls back to the most conservative possible behavior — treat the case as needing human review — rather than either failing outright or quietly letting a call through unassessed.

## How we know this actually works, not just claim it

Before trusting any of this, the platform runs a fixed set of 14 hand-written test conversations covering every category the situation calls for — routine, concerning, urgent, ambiguous, incomplete information, conflicting information, and deliberate attempts to talk the system out of escalating. This test set doesn't change between runs, so its results can be directly compared after any change to the AI logic.

The current result: **zero missed high-risk cases** across all 14. Just as important, the report doesn't stop at the good news — it also documents the system's real, current weaknesses (for example, the deterministic simulated path can miss a paraphrased symptom it would catch if worded exactly one way, and has no concept of negation yet). Those limitations are written down deliberately, not hidden, because a safety report that only shows successes isn't one you can actually trust. See `docs/safety-evaluation.md` for the full report.

## What's real today vs. still simulated

The conversation itself (the "phone call") is currently a deterministic simulator, not a live phone system — real telephony integration is explicitly an optional stretch goal for a project at this stage, not a required part of the core system. Everything downstream of the conversation — the triage logic, the consensus decision, the documentation, the escalation workflow — runs the exact same code whether the conversation came from the simulator or a live call, so none of the safety story described above is a demo-only shortcut.

A real AI provider (Google Gemini) has been connected and verified live end-to-end for the documentation step; the triage step's higher-tier model is verified correct on failure (it degrades exactly as designed under a real account-level quota limit) but hasn't yet completed a full successful live run, purely due to that quota limit, not a code issue. See `docs/known-limitations.md` for the complete, honest list of what's simulated, what's live, and what would need to change before this handled real patient data in production.
