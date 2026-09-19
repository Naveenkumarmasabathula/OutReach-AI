import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api.js";
import type {
  Campaign,
  CampaignWorkloadEstimate,
  Encounter,
  Escalation,
  EscalationDetail,
  EscalationStatus,
  Hospital,
  HospitalAnalytics,
  HospitalUser,
  PaginatedResult,
  Patient,
  PatientTimeline,
  PlatformAggregateAnalytics,
  Protocol,
  ProtocolCategory,
  QueueHealth,
} from "./types.js";

// ---- Platform admin: hospitals ----

export function usePlatformHospitals() {
  return useQuery({
    queryKey: ["platform", "hospitals"],
    queryFn: () => apiRequest<Hospital[]>("/api/v1/platform/hospitals"),
  });
}

export function usePlatformHospital(hospitalId: string) {
  return useQuery({
    queryKey: ["platform", "hospitals", hospitalId],
    queryFn: () => apiRequest<Hospital>(`/api/v1/platform/hospitals/${hospitalId}`),
    enabled: Boolean(hospitalId),
  });
}

export type CreateHospitalInput = {
  name: string;
  slug: string;
  timezone?: string;
  callingHoursStart?: string;
  callingHoursEnd?: string;
  outboundCapacity?: number;
  maxRetries?: number;
  settings?: { escalationReviewerTimeoutMinutes?: number };
};

export function useCreateHospital() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHospitalInput) =>
      apiRequest<Hospital>("/api/v1/platform/hospitals", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform", "hospitals"] }),
  });
}

export type UpdateHospitalConfigInput = Partial<Omit<CreateHospitalInput, "slug">>;

export function useUpdatePlatformHospitalConfig(hospitalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateHospitalConfigInput) =>
      apiRequest<Hospital>(`/api/v1/platform/hospitals/${hospitalId}/config`, { method: "PATCH", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform", "hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["platform", "hospitals", hospitalId] });
    },
  });
}

export function useMarkHospitalReady(hospitalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Hospital>(`/api/v1/platform/hospitals/${hospitalId}/ready`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform", "hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["platform", "hospitals", hospitalId] });
    },
  });
}

export type CreateStaffInput = {
  email: string;
  password: string;
  name: string;
  role: "HOSPITAL_ADMIN" | "CAMPAIGN_MANAGER" | "CLINICAL_REVIEWER";
};

export function useCreatePlatformHospitalStaff(hospitalId: string) {
  return useMutation({
    mutationFn: (input: CreateStaffInput) =>
      apiRequest<HospitalUser>(`/api/v1/platform/hospitals/${hospitalId}/users`, { method: "POST", body: input }),
  });
}

// ---- Hospital-scoped: my hospital ----

export function useMyHospital() {
  return useQuery({
    queryKey: ["hospitals", "me"],
    queryFn: () => apiRequest<Hospital>("/api/v1/hospitals/me"),
  });
}

export function useUpdateMyHospitalConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateHospitalConfigInput) =>
      apiRequest<Hospital>("/api/v1/hospitals/me/config", { method: "PATCH", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hospitals", "me"] }),
  });
}

/**
 * `enabled` defaults to true for the StaffPage (route-guarded to
 * HOSPITAL_ADMIN already). OverviewPage passes `false` for other roles so
 * this never fires a request they don't have permission for — gating only
 * the *rendering* of a 403 response, not the request itself, still spams
 * the network tab and console with expected-but-avoidable errors.
 */
export function useMyStaff(enabled = true) {
  return useQuery({
    queryKey: ["hospitals", "me", "users"],
    queryFn: () => apiRequest<HospitalUser[]>("/api/v1/hospitals/me/users"),
    enabled,
  });
}

export function useCreateMyStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) =>
      apiRequest<HospitalUser>("/api/v1/hospitals/me/users", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hospitals", "me", "users"] }),
  });
}

// ---- Patients ----

export function usePatients(page: number, limit = 20) {
  return useQuery({
    queryKey: ["patients", page, limit],
    queryFn: () => apiRequest<PaginatedResult<Patient>>("/api/v1/patients", { query: { page, limit } }),
    placeholderData: (prev) => prev,
  });
}

export function usePatient(patientId: string) {
  return useQuery({
    queryKey: ["patients", patientId],
    queryFn: () => apiRequest<Patient>(`/api/v1/patients/${patientId}`),
    enabled: Boolean(patientId),
  });
}

export function usePatientTimeline(patientId: string) {
  return useQuery({
    queryKey: ["patients", patientId, "timeline"],
    queryFn: () => apiRequest<PatientTimeline>(`/api/v1/patients/${patientId}/timeline`),
    enabled: Boolean(patientId),
  });
}

export type CreatePatientInput = {
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  preferredContactMethod?: "phone" | "sms" | "email";
  preferredLanguage?: string;
  communicationConsent?: boolean;
};

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePatientInput) => apiRequest<Patient>("/api/v1/patients", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patients"] }),
  });
}

export type CreateEncounterInput = {
  patientId: string;
  careSetting: Encounter["careSetting"];
  admissionDate?: string;
  dischargeDate?: string;
  dischargeDisposition?: string;
  dischargeInstructions?: string;
  followUpWindowHours?: number;
  riskLevel?: number;
};

export function useCreateEncounter(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEncounterInput) =>
      apiRequest<Encounter>("/api/v1/encounters", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patients", patientId, "timeline"] }),
  });
}

// ---- Campaigns ----

export type CreateCampaignInput = {
  name: string;
  description?: string;
  eligibilityCriteria?: Campaign["eligibilityCriteria"];
  followUpWindowHours?: number;
  callingHoursStart?: string;
  callingHoursEnd?: string;
  priority?: number;
  retryLimit?: number;
  outboundCapacity?: number;
  startDate?: string;
  endDate?: string;
};

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiRequest<Campaign[]>("/api/v1/campaigns", { query: { limit: 100 } }),
  });
}

export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId],
    queryFn: () => apiRequest<Campaign>(`/api/v1/campaigns/${campaignId}`),
    enabled: Boolean(campaignId),
  });
}

export function useCampaignWorkloadEstimate(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId, "workload-estimate"],
    queryFn: () => apiRequest<CampaignWorkloadEstimate>(`/api/v1/campaigns/${campaignId}/workload-estimate`),
    enabled: Boolean(campaignId),
  });
}

export function useCampaignQueueHealth(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId, "queue-health"],
    queryFn: () => apiRequest<QueueHealth>(`/api/v1/campaigns/${campaignId}/queue-health`),
    enabled: Boolean(campaignId),
    // Queue state changes continuously while a campaign is running — a short
    // poll keeps this section actually live without needing websockets for
    // this prototype (PRD lists "realtime dashboards" as a should-have, not
    // a must-have).
    refetchInterval: 5000,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) => apiRequest<Campaign>("/api/v1/campaigns", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

function useCampaignAction(campaignId: string, action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Campaign>(`/api/v1/campaigns/${campaignId}/${action}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns", campaignId] });
    },
  });
}

export const useMarkCampaignReady = (campaignId: string) => useCampaignAction(campaignId, "ready");
export const useStartCampaign = (campaignId: string) => useCampaignAction(campaignId, "start");
export const usePauseCampaign = (campaignId: string) => useCampaignAction(campaignId, "pause");
export const useCancelCampaign = (campaignId: string) => useCampaignAction(campaignId, "cancel");
export const useCompleteCampaign = (campaignId: string) => useCampaignAction(campaignId, "complete");

export function useResumeCampaign(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ campaign: Campaign; eligiblePatientCount: number }>(`/api/v1/campaigns/${campaignId}/resume`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns", campaignId] });
    },
  });
}

export function useReprioritizeCampaign(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (priority: number) =>
      apiRequest<Campaign>(`/api/v1/campaigns/${campaignId}/priority`, { method: "PATCH", body: { priority } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns", campaignId] });
    },
  });
}

// ---- Protocols & knowledge retrieval ----

export type CreateProtocolInput = {
  category: ProtocolCategory;
  title: string;
  tags?: string[];
  content: string;
  sourceReference: string;
};

export function useProtocols(includeInactive = false) {
  return useQuery({
    queryKey: ["protocols", { includeInactive }],
    queryFn: () =>
      apiRequest<Protocol[]>("/api/v1/protocols", {
        query: { limit: 100, includeInactive: includeInactive ? "true" : undefined },
      }),
  });
}

export function useProtocol(protocolId: string) {
  return useQuery({
    queryKey: ["protocols", protocolId],
    queryFn: () => apiRequest<Protocol>(`/api/v1/protocols/${protocolId}`),
    enabled: Boolean(protocolId),
  });
}

export function useCreateProtocol() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProtocolInput) =>
      apiRequest<Protocol>("/api/v1/protocols", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["protocols"] }),
  });
}

export function useDeactivateProtocol() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (protocolId: string) =>
      apiRequest<Protocol>(`/api/v1/protocols/${protocolId}/deactivate`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["protocols"] }),
  });
}

// ---- Escalations ----

export function useEscalations(filters: { status?: EscalationStatus } = {}) {
  return useQuery({
    queryKey: ["escalations", filters],
    queryFn: () =>
      apiRequest<Escalation[]>("/api/v1/escalations", { query: { limit: 100, status: filters.status } }),
  });
}

export function useEscalationDetail(escalationId: string) {
  return useQuery({
    queryKey: ["escalations", escalationId],
    queryFn: () => apiRequest<EscalationDetail>(`/api/v1/escalations/${escalationId}`),
    enabled: Boolean(escalationId),
  });
}

function useEscalationAction(escalationId: string, action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: Record<string, unknown>) =>
      apiRequest<Escalation>(`/api/v1/escalations/${escalationId}/${action}`, { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["escalations", escalationId] });
    },
  });
}

export const useAcknowledgeEscalation = (escalationId: string) => useEscalationAction(escalationId, "acknowledge");
export const useStartReview = (escalationId: string) => useEscalationAction(escalationId, "start-review");
export const useResumeReview = (escalationId: string) => useEscalationAction(escalationId, "resume-review");

export function useAssignEscalation(escalationId: string) {
  const action = useEscalationAction(escalationId, "assign");
  return {
    ...action,
    mutateAsync: (reviewerId: string) => action.mutateAsync({ reviewerId }),
  };
}

export function useRequestInformation(escalationId: string) {
  const action = useEscalationAction(escalationId, "request-information");
  return {
    ...action,
    mutateAsync: (notes: string) => action.mutateAsync({ notes }),
  };
}

export function useResolveEscalation(escalationId: string) {
  const action = useEscalationAction(escalationId, "resolve");
  return {
    ...action,
    mutateAsync: (resolution: string) => action.mutateAsync({ resolution }),
  };
}

export const useCloseEscalation = (escalationId: string) => useEscalationAction(escalationId, "close");

// ---- Analytics (Phase 8 dashboards) ----

export function useHospitalAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: ["analytics", "hospital"],
    queryFn: () => apiRequest<HospitalAnalytics>("/api/v1/analytics/hospital"),
    enabled,
  });
}

export function usePlatformAnalytics() {
  return useQuery({
    queryKey: ["platform", "analytics"],
    queryFn: () => apiRequest<PlatformAggregateAnalytics>("/api/v1/platform/analytics"),
  });
}
