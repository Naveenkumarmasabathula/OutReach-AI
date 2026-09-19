import { z } from "zod";

export const conversationTurnSchema = z.object({
  speaker: z.enum(["agent", "patient"]),
  text: z.string().min(1),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const triageClassificationEnum = z.enum(["routine", "concerning", "urgent", "uncertain"]);
export type TriageClassification = z.infer<typeof triageClassificationEnum>;

/**
 * PRD §13: "A triage result contains a classification (routine, concerning,
 * urgent, or uncertain), observed indicators, evidence from the
 * conversation, relevant protocol references, confidence/uncertainty
 * information, and an escalation recommendation." Every AI-produced triage
 * result (rule-based or LLM-based) is validated against this schema before
 * anything downstream trusts it — PRD §13's "backend must validate AI
 * output before use."
 */
export const triageResultSchema = z.object({
  source: z.enum(["rule_based", "ai_model"]),
  classification: triageClassificationEnum,
  observedIndicators: z.array(z.string()),
  evidence: z.array(z.string()),
  protocolReferences: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  escalationRecommended: z.boolean(),
  reasoning: z.string(),
});
export type TriageResult = z.infer<typeof triageResultSchema>;

export const consensusResultSchema = z.object({
  assessments: z.array(triageResultSchema).length(2),
  disagreement: z.boolean(),
  consensusClassification: triageClassificationEnum,
  escalate: z.boolean(),
  escalationPriority: z.number().int().min(1).max(5).nullable(),
  rationale: z.string(),
});
export type ConsensusResult = z.infer<typeof consensusResultSchema>;

export const documentationRecordSchema = z.object({
  callSummary: z.string(),
  patientReportedSymptoms: z.array(z.string()),
  observations: z.array(z.string()),
  outcome: z.string(),
  triageClassification: triageClassificationEnum,
  escalationStatus: z.enum(["none", "escalated"]),
  followUpRequirements: z.array(z.string()),
});
export type DocumentationRecord = z.infer<typeof documentationRecordSchema>;

export type TriageAgentInput = {
  patientContext: string;
  transcript: ConversationTurn[];
  reportedSymptoms: string[];
  retrievedProtocols: { title: string; sourceReference: string; content: string; category: string }[];
};

export type DocumentationAgentInput = {
  transcript: ConversationTurn[];
  connectivityOutcome: string;
  consensus: ConsensusResult;
};

/**
 * The swap point Phase 5 was built around from the start (matching
 * `EHRInterface`/`MockEHR` and the planned `VoiceProvider`): everything in
 * `clinicalTriageAgent.ts`/`documentationAgent.ts` calls this interface, not
 * a specific vendor SDK. `SimulatedAIProvider` is deterministic and always
 * available; `GeminiProvider` is the real implementation, selected
 * automatically once `GEMINI_API_KEY` is set — see index.ts.
 */
export interface AIProvider {
  readonly name: string;
  assessTriage(input: TriageAgentInput): Promise<TriageResult>;
  generateDocumentation(input: DocumentationAgentInput): Promise<DocumentationRecord>;
}

export class AIOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "AIOutputValidationError";
  }
}
