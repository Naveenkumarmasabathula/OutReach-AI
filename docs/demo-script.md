# Demo Script (Phase 12, for the required demo video)

**Why this exists instead of a video file**: recording, narrating, and editing a screen-capture video isn't something this tool can produce — there's no screen/audio recording capability available in this environment. What follows is a precise, step-by-step walkthrough covering exactly the flow PRD §33 asks the video to demonstrate, using real credentials and real commands against this actual codebase (not a hypothetical script) — every step below has already been exercised live at least once during this project's own development (see the phase-by-phase "live smoke test" entries in `docs/dev-ai-usage.md`), so following it should reproduce working behavior, not require debugging on top of following instructions.

Estimated total runtime if recorded straight through: 12-15 minutes.

## Setup (before recording)

```bash
docker compose up -d
npm install
cp server/.env.example server/.env   # adjust only if your local ports differ
npm run db:migrate --workspace server
npm run db:seed --workspace server
```

Then, in three separate terminals:
```bash
npm run dev:server          # API on :4000
npm run dev:web             # frontend on :5173
npm run dev:worker --workspace server   # background worker
```

Open `http://localhost:5173` in the browser you'll record.

## 1. Onboarding (as Platform Admin)

- Log in as `platform.admin@outreach.dev` / `ChangeMe123!`.
- Show the Platform Admin dashboard (`/`) — point out it's real aggregate data across hospitals, not per-patient data (narrate: "this dashboard is safe by construction — it never touches a patient record, see `docs/dashboards-analytics.md`").
- Navigate to Hospitals, open **Riverside General Hospital**. Show its configuration (calling hours, capacity, retry limit, the escalation-reviewer-timeout setting from Settings).

## 2. Patient / discharge ingestion (as Hospital Admin)

- Log out, log in as `admin@riverside-general.dev` / `ChangeMe123!`.
- Go to Patients → New Patient. Create one with a real-looking name, MRN, and consent checked.
- Open the patient, add an encounter (discharge) with a care setting, a follow-up window, and a risk level — this is the "discharge ingestion" step.
- Briefly show the Protocols page — a hospital's post-discharge protocols/knowledge (`docs/protocols-knowledge-retrieval.md`).

## 3. Campaign creation and eligibility

- Go to Campaigns → New Campaign. Set a follow-up window and priority; leave eligibility criteria open (or narrow it, e.g. "inpatient only").
- Open the new campaign, show the **workload estimate** (eligible patient count, expected attempts) before activating it.
- Mark it Ready, then Start.

## 4. Queue behavior, constrained concurrency, retries, callbacks — the required simulation

This is the single most important segment (PRD's top "critical" grading item). Rather than waiting on real timing in the UI, run the required, purpose-built simulation script in a terminal while the campaign detail page's Queue section is visible in another window, so both the raw output and the live-updating UI are on screen together:

```bash
npm run queue:simulate --workspace server
```

Narrate as it runs: point out the capacity limit being enforced (only N tasks claimed per tick, matching the hospital's `outboundCapacity`), the showcase section explicitly demonstrating retry-then-manual-follow-up, callback-then-completed, a forced escalation, dropped-then-recovered, and a declined (terminal) outcome — every PRD §9 required outcome type in one run, per `docs/queue-design.md`. Then switch to the browser and refresh the Riverside General campaign's Queue card to show the same activity reflected live.

## 5. AI interaction, triage, and escalation

The queue simulation above already drives real AI pipeline runs for every "connected" outcome (not a separate mocked path — see `docs/ai-usage.md`). To show one concretely tied to a specific patient:

- In a terminal, note an escalated patient's name from the simulation output (or from the Escalations list, next step).
- Go to Escalations (still logged in as Hospital Admin, or switch to `reviewer@riverside-general.dev` / `ChangeMe123!`). Open one with status "open."
- Show the detail page: the real call transcript, **both independent triage assessments side by side** (rule-based and AI-model), whether they agreed or disagreed, and the consensus rationale — this is PRD §14's required "record individual assessments, disagreement, consensus result" made visible.

## 6. Human review and documentation

- As the Clinical Reviewer, click **Acknowledge**, then **Start review**, then **Resolve** with a short resolution note.
- Point out the resolution is now shown on the escalation, and (if narrating technical detail) that this whole action produced a real audit-log entry (`docs/observability-reliability.md`) naming the reviewer, not just a status change.
- Open the patient's own page → Outreach tab, showing the call history/outcomes and the escalation, all in one place (PRD §20's patient operational view).

## 7. EHR update

- Still on the patient's Outreach tab (or Timeline tab), point out the communication record the Documentation Agent wrote (a "call summary" entry) — this went through the EHR abstraction (`docs/ehr-abstraction.md`), not a direct database write, and is what "documentation... sent to the mock EHR" (PRD §17) looks like end to end.

## 8. Analytics and system health

- Go back to Overview (as Hospital Admin or Campaign Manager) — show the analytics: contact rate, average attempts, queue wait, escalation counts, all real numbers from the activity just generated.
- Open a new tab to `http://localhost:4000/health` directly and show the real `{"status": "healthy", "checks": {...}}` response (`docs/observability-reliability.md`) — narrate that this reflects real dependency checks (Postgres, Redis, the AI provider's circuit breaker), not a hardcoded string.
- Optionally, run `npm run safety:evaluate --workspace server` in a terminal to show the required safety evaluation report (TP/FP/TN/FN, 0% false-negative rate on the fixed dataset) as the closing beat — it's the other PRD-flagged "critical" deliverable alongside the queue.

## Notes for whoever records this

- The queue simulation and safety evaluation scripts are deterministic (hash-seeded, not random) — running them ahead of time to rehearse won't change what they show when actually recorded.
- If recording multiple takes, either reset the dev database (`docker compose down -v && docker compose up -d && npm run db:migrate --workspace server && npm run db:seed --workspace server`) or simply use a fresh patient/campaign name each take — leftover demo data from a previous take doesn't break anything, it just adds visual noise to list pages.
- Total demo credentials, if needed on screen: see the table in the top-level `README.md`.
