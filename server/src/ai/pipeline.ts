import { and, desc, eq } from "drizzle-orm";
import type { OutreachTask } from "../db/schema/index.js";
import { communications } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { logger } from "../lib/logger.js";
import { voiceProvider } from "../voice/index.js";
import { aiProvider } from "./index.js";
import { runIndependentTriageAssessments } from "./clinicalTriageAgent.js";
import { generateCallDocumentation } from "./documentationAgent.js";
import { decideEscalation } from "./escalationDecisionSystem.js";
import { recordAiCall } from "../services/aiCallLogService.js";
import { lookupProtocols, lookupPatient, recordCallOutcome, recordCommunication } from "./tools.js";
import type { ConsensusResult, ConversationTurn, DocumentationRecord, TriageResult } from "./types.js";

const PIPELINE_ACTOR = { type: "ai_agent" as const, id: "outreach-ai-pipeline" };

export type EscalationDetails = {
  trigger: string;
  clinicalIndicators: Record<string, unknown>;
  triageResult: [TriageResult, TriageResult];
  consensusResult: ConsensusResult;
  priority: number;
  notes: string;
};

export type OutreachAiPipelineResult = {
  // "declined" is new: the Voice Intake Agent's in-call verification step
  // (PRD §14's "verify that the interaction can proceed") failed — the call
  // connected (telephony succeeded) but the conversation itself never ran,
  // so there is no transcript to triage. `triageAssessments`/`consensus`/
  // `documentation` are `null` in exactly this one case; every other
  // outcome still produces all three, unchanged.
  clinicalOutcome: "completed" | "escalated" | "declined";
  transcript: ConversationTurn[];
  triageAssessments: [TriageResult, TriageResult] | null;
  consensus: ConsensusResult | null;
  documentation: DocumentationRecord | null;
  escalationDetails: EscalationDetails | null;
  conversationContextUpdate: Record<string, unknown>;
};

async function getPreviousCallSummary(scope: HospitalScope, patientId: string): Promise<string | null> {
  const [latest] = await withHospitalScope(scope, (tx) =>
    tx
      .select({ summary: communications.summary })
      .from(communications)
      .where(and(eq(communications.patientId, patientId), eq(communications.hospitalId, scope.hospitalId)))
      .orderBy(desc(communications.sentAt))
      .limit(1),
  );
  return latest?.summary ?? null;
}

/**
 * The controlled-tool orchestration PRD §17/§18 asks for — "AI request ->
 * authorization -> schema validation -> business rules -> execution ->
 * audit -> result" — run explicitly step by step rather than as one opaque
 * call. This function itself stands in for "the AI's decision of what to
 * request": it never touches a service/EHR method directly — every read and
 * write below goes through `./tools.js`'s named, individually-authorized
 * functions, each of which enforces the full six-step shape on its own (see
 * `tools.ts`'s module comment, and docs/ai-usage.md's "Controlled tools"
 * section for exactly what this design choice does and doesn't claim).
 */
export async function runOutreachAiPipeline(
  scope: HospitalScope,
  task: Pick<OutreachTask, "id" | "patientId" | "attemptCount" | "conversationContext">,
): Promise<OutreachAiPipelineResult> {
  const patient = await lookupPatient(scope, PIPELINE_ACTOR, { patientId: task.patientId });
  const previousCallSummary =
    (task.conversationContext as { lastCallSummary?: string } | null)?.lastCallSummary ??
    (await getPreviousCallSummary(scope, task.patientId));

  const followUpProtocols = await lookupProtocols(scope, PIPELINE_ACTOR, { category: "follow_up_questions", limit: 5 });
  const protocolQuestions = followUpProtocols.map((p) => p.protocol.content);

  const seed = `${task.id}:${task.attemptCount}`;
  const { transcript, reportedSymptoms, verified } = await voiceProvider.conductConversation(
    { patientFirstName: patient.firstName, protocolQuestions, previousCallSummary },
    seed,
  );

  if (!verified) {
    // The Voice Intake Agent's in-call verification step (PRD §14: "verify
    // that the interaction can proceed") failed — e.g. the wrong person
    // answered, or the patient declined to continue. The conversation ended
    // immediately, before any protocol question was asked, so there is
    // nothing clinical to triage: skip straight to recording the outcome.
    await recordCommunication(scope, PIPELINE_ACTOR, {
      patientId: task.patientId,
      channel: "phone",
      direction: "outbound",
      summary: "Call connected but could not proceed: in-call verification failed (identity not confirmed or patient declined).",
    });

    return {
      clinicalOutcome: "declined",
      transcript,
      triageAssessments: null,
      consensus: null,
      documentation: null,
      escalationDetails: null,
      conversationContextUpdate: {
        lastCallOutcome: "declined",
        lastCallAt: new Date().toISOString(),
      },
    };
  }

  const redFlagProtocols = await lookupProtocols(scope, PIPELINE_ACTOR, {
    category: "red_flag_indicator",
    tags: reportedSymptoms,
    keywords: reportedSymptoms.join(" "),
    limit: 5,
  });

  const triageStartedAt = Date.now();
  let assessments: [TriageResult, TriageResult];
  try {
    assessments = await runIndependentTriageAssessments({
      patientContext: `Post-discharge follow-up call, attempt #${task.attemptCount}.`,
      transcript,
      reportedSymptoms,
      retrievedProtocols: redFlagProtocols.map((p) => ({
        title: p.protocol.title,
        sourceReference: p.protocol.sourceReference,
        content: p.protocol.content,
        category: p.protocol.category,
      })),
    });
  } catch (err) {
    // Persisted even on failure — PRD §22's AI observability ask covers
    // failures "where practical," and an all-failing AI provider should be
    // visible in the Platform Admin dashboard's aiUsage stats, not just in
    // logs. Rethrown unchanged: this function still doesn't swallow the
    // error, matching AIOutputValidationError's existing "explicit
    // operational failure" contract that queueService.processTask relies on.
    await recordAiCall(scope, {
      agentType: "clinical_triage",
      provider: aiProvider.name,
      latencyMs: Date.now() - triageStartedAt,
      success: false,
    });
    throw err;
  }
  await recordAiCall(scope, {
    agentType: "clinical_triage",
    provider: aiProvider.name,
    latencyMs: Date.now() - triageStartedAt,
    success: true,
  });

  const consensus = decideEscalation(assessments);

  // PRD §21's AI observability list: agent/model, latency, retrieval
  // sources, disagreement, escalation evidence, tool usage — one structured
  // line per triage run. No patient-identifying content is logged (PRD
  // §21's "sensitive healthcare information must not be unnecessarily
  // written into logs") — only counts, classifications, and ids, all of
  // which are already durably persisted on the escalation/attempt rows
  // this same run produces, not new PHI exposure.
  logger.info(
    {
      taskId: task.id,
      aiProvider: aiProvider.name,
      latencyMs: Date.now() - triageStartedAt,
      protocolsRetrieved: redFlagProtocols.length + followUpProtocols.length,
      disagreement: consensus.disagreement,
      consensusClassification: consensus.consensusClassification,
      escalate: consensus.escalate,
    },
    "AI triage pipeline run completed",
  );

  const documentation = await generateCallDocumentation({
    transcript,
    connectivityOutcome: "completed",
    consensus,
  });

  // Escalation-record creation is left to queueService.recordAttemptOutcome
  // (already the single place that owns "nextStatus === 'escalated' creates
  // a record") — this pipeline only supplies the real clinical details that
  // replace its old hardcoded placeholder note, rather than creating a
  // second, duplicate escalation record itself.
  const escalationDetails: EscalationDetails | null = consensus.escalate
    ? {
        trigger: consensus.disagreement ? "ai_triage_disagreement" : "ai_triage_consensus",
        clinicalIndicators: {
          assessments: consensus.assessments,
          consensusClassification: consensus.consensusClassification,
        },
        triageResult: assessments,
        consensusResult: consensus,
        priority: consensus.escalationPriority ?? 3,
        notes: consensus.rationale,
      }
    : null;

  await recordCommunication(scope, PIPELINE_ACTOR, {
    patientId: task.patientId,
    channel: "phone",
    direction: "outbound",
    summary: documentation.callSummary,
  });

  for (const symptom of documentation.patientReportedSymptoms) {
    await recordCallOutcome(scope, PIPELINE_ACTOR, {
      patientId: task.patientId,
      category: "reported_symptom",
      value: symptom,
      source: "ai_conversation",
    });
  }

  return {
    clinicalOutcome: consensus.escalate ? "escalated" : "completed",
    transcript,
    triageAssessments: assessments,
    consensus,
    documentation,
    escalationDetails,
    // Persisted onto outreach_tasks.conversationContext by queueService so
    // the NEXT call to this same task (a retry) or a future campaign's call
    // to this same patient can pick up "what was already discussed" — PRD
    // §17's "maintain relevant patient outreach context across calls."
    conversationContextUpdate: {
      lastCallSummary: documentation.callSummary,
      lastReportedSymptoms: reportedSymptoms,
      lastClassification: consensus.consensusClassification,
      lastCallAt: new Date().toISOString(),
    },
  };
}
