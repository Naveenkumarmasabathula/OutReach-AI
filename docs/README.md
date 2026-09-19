# Documentation Index

This folder holds the living documentation for the **Multi-Hospital Post-Discharge Outreach Platform**.

| Doc | Purpose |
|---|---|
| [requirements-summary.md](./requirements-summary.md) | Must-have feature map extracted from `Project_Requirements (1).pdf`, grouped by domain area |
| [architecture.md](./architecture.md) | The required system architecture diagram (PRD §24/§33): major services, the five named architectural boundaries, API surface, data model relationships |
| [multi-tenancy.md](./multi-tenancy.md) | Tenant-isolation design, adapted from `Documents/Zopkit/Project-Management-master` and hardened for PHI (RLS, scope-object pattern, per-read audit) |
| [ehr-abstraction.md](./ehr-abstraction.md) | The EHR interface/MockEHR boundary (PRD §6): contract, why it's replaceable, what was and wasn't refactored to use it |
| [campaigns-eligibility.md](./campaigns-eligibility.md) | Campaign lifecycle state machine and the eligibility engine (PRD §7-8): design, what's deliberately deferred to Phase 3 |
| [queue-design.md](./queue-design.md) | The outbound queue/scheduler (PRD §8-10, the top "critical" grading item): priority algorithm justification, concurrency-safety argument, state machine, retry/backoff, failure recovery |
| [protocols-knowledge-retrieval.md](./protocols-knowledge-retrieval.md) | Hospital-scoped protocols/knowledge (PRD §5): schema, source traceability, the task-specific retrieval engine, and its upgrade path to semantic search |
| [ai-usage.md](./ai-usage.md) | The AI agent layer (PRD §33 deliverable): provider/model choice, agent separation, the two independent triage paths, consensus/escalation logic, controlled-tool pattern, persistence |
| [voice-provider.md](./voice-provider.md) | The `VoiceProvider` interface and how a real telephony/voice-AI integration replaces the Phase 5 simulator |
| [escalation-management.md](./escalation-management.md) | Escalation lifecycle and human-in-the-loop review (PRD §19): schema extension, reviewer actions, the notifications table |
| [workflows-events.md](./workflows-events.md) | The async event bus (PRD §18): idempotent publish/consume, the escalation-notify-then-backup-escalate workflow, what's published vs. wired to a consumer |
| [dashboards-analytics.md](./dashboards-analytics.md) | Role-differentiated dashboards and analytics (PRD §20), the patient operational view, and a critical queue-concurrency bug this phase's testing surfaced |
| [safety-evaluation.md](./safety-evaluation.md) | The fixed safety evaluation dataset (PRD §15/§33 deliverable): methodology, TP/FP/TN/FN results, disagreement cases, observed weaknesses, improvements |
| [observability-reliability.md](./observability-reliability.md) | Health states, the AI-provider circuit breaker + safe degradation, correlation IDs, AI observability logging, and the audit-log extension to human-driven operations (PRD §21-22) |
| [implementation-plan.md](./implementation-plan.md) | Tech stack, architecture, and phased build plan |
| [deployment.md](./deployment.md) | How to deploy the platform (Railway/Render, five processes, migration/seed steps) — documented, not executed; see the doc for why |
| [demo-script.md](./demo-script.md) | A step-by-step walkthrough covering the required demo-video flow, for whoever records it |
| [known-limitations.md](./known-limitations.md) | Documented scope tradeoffs and what's simplified for the prototype, updated as we go |
| [dev-ai-usage.md](./dev-ai-usage.md) | Record of AI coding-tool usage during development, updated as we go |
| [design/apple-design-analysis.md](./design/apple-design-analysis.md) | Source design spec (Apple marketing-site design language) supplied for the frontend |
| [design/dashboard-design-system.md](./design/dashboard-design-system.md) | How that spec was adapted for a dense clinical-ops dashboard instead of a marketing site |

Every doc required by the PRD deliverables list (§33) now exists except the deployed URL and the demo video itself — see `deployment.md` and `demo-script.md` for why, and what's needed to produce each.

Source PRD: `../Project_Requirements (1).pdf` (v2.0).
