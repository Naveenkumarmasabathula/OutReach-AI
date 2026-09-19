export type Role = "PLATFORM_ADMIN" | "HOSPITAL_ADMIN" | "CAMPAIGN_MANAGER" | "CLINICAL_REVIEWER";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hospitalId: string | null;
};

export type Hospital = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "suspended";
  timezone: string;
  callingHoursStart: string;
  callingHoursEnd: string;
  outboundCapacity: number;
  maxRetries: number;
  settings: { escalationReviewerTimeoutMinutes?: number } & Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type HospitalUser = {
  id: string;
  hospitalId: string | null;
  email: string;
  name: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type Patient = {
  id: string;
  hospitalId: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  preferredContactMethod: "phone" | "sms" | "email";
  preferredLanguage: string;
  communicationConsent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: { page: number; limit: number; total: number };
};

export type Encounter = {
  id: string;
  hospitalId: string;
  patientId: string;
  careSetting: "inpatient" | "outpatient" | "emergency" | "surgical" | "observation";
  status: "in_progress" | "discharged";
  admissionDate: string | null;
  dischargeDate: string | null;
  dischargeDisposition: string | null;
  dischargeInstructions: string | null;
  followUpWindowHours: number;
  riskLevel: number;
  createdAt: string;
  updatedAt: string;
};

export type CampaignStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type Campaign = {
  id: string;
  hospitalId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  eligibilityCriteria: { careSettings?: string[]; minRiskLevel?: number; maxRiskLevel?: number };
  followUpWindowHours: number;
  callingHoursStart: string | null;
  callingHoursEnd: string | null;
  priority: number;
  retryLimit: number | null;
  outboundCapacity: number | null;
  startDate: string | null;
  endDate: string | null;
  escalationConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CampaignWorkloadEstimate = {
  campaignId: string;
  eligiblePatientCount: number;
  expectedAttempts: number;
};

export type QueueHealth = {
  byStatus: Record<string, number>;
  oldestPendingScheduledFor: string | null;
  tasksNearCutoff: number;
  stuckTasksCount: number;
};

export type PatientTimeline = {
  encounters: Encounter[];
  conditions: Array<{ id: string; description: string; clinicalStatus: string; severity: string | null }>;
  medications: Array<{ id: string; name: string; dosage: string | null; frequency: string | null }>;
  procedures: Array<{ id: string; name: string; performedAt: string | null }>;
  carePlans: Array<{ id: string; instructions: string; status: string }>;
  observations: Array<{ id: string; category: string; value: unknown; recordedAt: string; source: string }>;
  communications: Array<{ id: string; channel: string; direction: string; summary: string; sentAt: string }>;
  tasks: Array<{ id: string; type: string; status: string; dueAt: string | null; notes: string | null }>;
  outreachTasks: Array<{ id: string; campaignId: string; status: string; attemptCount: number; clinicalDeadline: string }>;
  outreachAttempts: Array<{ id: string; outreachTaskId: string; attemptNumber: number; outcome: string; startedAt: string }>;
  escalations: Array<{ id: string; status: string; priority: number; trigger: string; createdAt: string }>;
};

export type ProtocolCategory =
  | "follow_up_questions"
  | "red_flag_indicator"
  | "specialty_instruction"
  | "patient_guidance"
  | "escalation_contact"
  | "operational_rule";

export type EscalationStatus = "open" | "assigned" | "in_review" | "waiting_for_information" | "resolved" | "closed";

export type Escalation = {
  id: string;
  hospitalId: string;
  patientId: string;
  encounterId: string | null;
  campaignId: string | null;
  outreachTaskId: string | null;
  trigger: string;
  clinicalIndicators: unknown;
  triageResult: unknown;
  consensusResult: unknown;
  priority: number;
  status: EscalationStatus;
  notes: string | null;
  assignedReviewerId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EscalationDetail = {
  escalation: Escalation;
  patient: Patient | null;
  transcript: Array<{ speaker: "agent" | "patient"; text: string }> | null;
  triageResult: unknown;
  consensusResult: {
    disagreement?: boolean;
    consensusClassification?: string;
    escalate?: boolean;
    escalationPriority?: number | null;
    rationale?: string;
  } | null;
};

export type AiUsageStats = {
  totalCalls: number;
  byAgentType: Record<string, number>;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  averageLatencyMs: number | null;
};

export type HospitalAnalytics = {
  campaigns: { total: number; byStatus: Record<string, number> };
  outreach: {
    totalTasks: number;
    byStatus: Record<string, number>;
    byOutcome: Record<string, number>;
    averageAttemptsPerCompletedTask: number | null;
    contactRate: number;
    manualFollowUps: number;
  };
  timing: { averageTimeToContactHours: number | null; averageQueueWaitHours: number | null };
  capacity: { outboundCapacity: number; activeCalls: number; utilization: number };
  escalations: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
  eligiblePatientCount: number;
  activeProtocolCount: number;
  staffByRole: Record<string, number>;
  aiUsage: AiUsageStats;
  ehrWriteActivity: {
    windowHours: number;
    communications: number;
    observations: number;
    manualFollowUpTasks: number;
    escalationRecords: number;
    total: number;
  };
};

export type PlatformAggregateAnalytics = {
  hospitalCount: number;
  totals: {
    campaignCount: number;
    activeCalls: number;
    outboundCapacity: number;
    escalationCount: number;
    manualFollowUps: number;
    queueUtilization: number;
  };
  aiUsage: AiUsageStats;
  errors: { failedTaskCount: number; technicalFailureCount: number };
  systemPerformance: { activeCalls: number; outboundCapacity: number; queueUtilization: number };
  perHospital: Array<{
    hospitalId: string;
    hospitalName: string;
    campaigns: { total: number; byStatus: Record<string, number> };
    capacity: { outboundCapacity: number; activeCalls: number; utilization: number };
    escalations: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
    aiUsage: AiUsageStats;
    errors: { failedTaskCount: number; technicalFailureCount: number };
  }>;
};

export type Protocol = {
  id: string;
  hospitalId: string;
  category: ProtocolCategory;
  title: string;
  tags: string[];
  content: string;
  sourceReference: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
