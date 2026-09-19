import { aiCallLog } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";

export type RecordAiCallInput = {
  /** e.g. "clinical_triage", "documentation", "escalation_decision". */
  agentType: string;
  /** e.g. "gemini" — matches `aiProvider.name` in ai/pipeline.ts. */
  provider: string;
  model?: string | null;
  latencyMs: number;
  success: boolean;
};

/**
 * Write-side helper for the `ai_call_log` table (see
 * db/schema/aiCallLog.ts). Not called from anywhere yet: ai/pipeline.ts
 * currently only `logger.info`s the equivalent data (its "AI triage
 * pipeline run completed" log line) and hasn't been wired to persist it —
 * that pipeline.ts change is a separate, concurrently-owned follow-up (see
 * docs/dashboards-analytics.md for the exact status). This function exists
 * so that wiring, whenever it lands, is a single call at each AI agent step
 * (e.g. right after the existing `logger.info(...)` call in
 * runOutreachAiPipeline) rather than a new table/service to design at that
 * point.
 *
 * Deliberately swallows nothing and does no batching — one row per call,
 * inserted inside the same tenant-scoped transaction pattern every other
 * write in this codebase uses. A caller on the hot path (the AI pipeline,
 * once wired) may prefer to fire this without awaiting it if insert latency
 * ever matters there; that's the caller's call to make, not this
 * function's.
 */
export async function recordAiCall(scope: HospitalScope, input: RecordAiCallInput): Promise<void> {
  await withHospitalScope(scope, (tx) =>
    tx.insert(aiCallLog).values({
      hospitalId: scope.hospitalId,
      agentType: input.agentType,
      provider: input.provider,
      model: input.model ?? null,
      latencyMs: input.latencyMs,
      success: input.success,
    }),
  );
}
