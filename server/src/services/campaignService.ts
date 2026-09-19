import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Campaign } from "../db/schema/index.js";
import { campaigns } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { publishEvent } from "../events/publish.js";
import type { AppEventType } from "../events/types.js";
import { getHospitalByScope } from "./hospitalService.js";
import { assertDefined } from "../lib/assert.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { type Pagination, toOffsetLimit } from "../lib/pagination.js";
import { evaluateEligiblePatients } from "./eligibilityService.js";

const eligibilityCriteriaSchema = z
  .object({
    careSettings: z.array(z.enum(["inpatient", "outpatient", "emergency", "surgical", "observation"])).optional(),
    minRiskLevel: z.number().int().min(1).max(5).optional(),
    maxRiskLevel: z.number().int().min(1).max(5).optional(),
  })
  .default({});

export const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  eligibilityCriteria: eligibilityCriteriaSchema,
  followUpWindowHours: z.number().int().positive().default(72),
  callingHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  callingHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  priority: z.number().int().min(1).max(5).default(3),
  retryLimit: z.number().int().nonnegative().optional(),
  outboundCapacity: z.number().int().positive().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

const EDITABLE_STATUSES: Campaign["status"][] = ["draft", "ready"];
const CANCELLABLE_STATUSES: Campaign["status"][] = ["draft", "ready", "scheduled", "running", "paused"];

export async function createCampaign(scope: HospitalScope, input: CreateCampaignInput) {
  const campaign = await withHospitalScope(scope, async (tx) => {
    const [row] = await tx
      .insert(campaigns)
      .values({ ...input, hospitalId: scope.hospitalId })
      .returning();
    return assertDefined(row, "campaign insert returned no row");
  });
  await publishEvent(scope, "campaign.created", { campaignId: campaign.id });
  return campaign;
}

export async function listCampaigns(scope: HospitalScope, pagination: Pagination) {
  const { offset, limit } = toOffsetLimit(pagination);
  return withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.hospitalId, scope.hospitalId))
      .orderBy(desc(campaigns.createdAt))
      .limit(limit)
      .offset(offset),
  );
}

export async function getCampaignById(scope: HospitalScope, campaignId: string) {
  const [campaign] = await withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.hospitalId, scope.hospitalId))),
  );
  if (!campaign) throw new NotFoundError("Campaign not found");
  return campaign;
}

export async function updateCampaign(scope: HospitalScope, campaignId: string, input: UpdateCampaignInput) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    throw new ConflictError(`Cannot edit a campaign in status '${campaign.status}'`);
  }

  return withHospitalScope(scope, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.hospitalId, scope.hospitalId)))
      .returning();
    return assertDefined(updated, "campaign update returned no row");
  });
}

/**
 * Reprioritizing is allowed right up until a campaign reaches a terminal
 * state — unlike other config, priority affects live queue arbitration
 * (Phase 3), not campaign setup, so it isn't restricted to draft/ready.
 */
export async function reprioritizeCampaign(scope: HospitalScope, campaignId: string, priority: number) {
  const campaign = await getCampaignById(scope, campaignId);
  if (["completed", "cancelled", "failed"].includes(campaign.status)) {
    throw new ConflictError(`Cannot reprioritize a campaign in status '${campaign.status}'`);
  }

  return withHospitalScope(scope, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({ priority, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.hospitalId, scope.hospitalId)))
      .returning();
    return assertDefined(updated, "campaign priority update returned no row");
  });
}

async function setStatus(
  scope: HospitalScope,
  campaignId: string,
  status: Campaign["status"],
  event: AppEventType,
) {
  const updated = await withHospitalScope(scope, async (tx) => {
    const [row] = await tx
      .update(campaigns)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.hospitalId, scope.hospitalId)))
      .returning();
    return assertDefined(row, "campaign status update returned no row");
  });
  await publishEvent(scope, event, { campaignId });
  return updated;
}

/**
 * Validates a draft is complete and internally consistent, then locks it
 * into 'ready'. Calling-hours narrowing check enforces the envelope rule
 * from docs/multi-tenancy.md's ADR-0009-style pattern: a campaign may narrow
 * the hospital's calling hours, never widen them.
 */
export async function markCampaignReady(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (campaign.status !== "draft") {
    throw new ConflictError(`Cannot mark ready a campaign in status '${campaign.status}' (must be 'draft')`);
  }

  const hospital = await getHospitalByScope(scope);
  if (campaign.callingHoursStart && campaign.callingHoursStart < hospital.callingHoursStart) {
    throw new ValidationError("Campaign calling hours start cannot be earlier than the hospital's");
  }
  if (campaign.callingHoursEnd && campaign.callingHoursEnd > hospital.callingHoursEnd) {
    throw new ValidationError("Campaign calling hours end cannot be later than the hospital's");
  }
  if (campaign.startDate && campaign.endDate && campaign.startDate > campaign.endDate) {
    throw new ValidationError("Campaign start date must be before its end date");
  }

  return setStatus(scope, campaignId, "ready", "campaign.ready");
}

/**
 * ready|scheduled -> running (immediately) or -> scheduled (if startDate is
 * still in the future). Whichever future job actually flips
 * scheduled -> running when startDate arrives is Phase 3's background
 * scheduler; this only sets the state a manual "start" action produces today.
 */
export async function startCampaign(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!["ready", "scheduled"].includes(campaign.status)) {
    throw new ConflictError(`Cannot start a campaign in status '${campaign.status}' (must be 'ready' or 'scheduled')`);
  }

  // Hospital lifecycle gate: a hospital's own `status` (draft/active/
  // suspended) isn't just a label — a hospital still being configured (or
  // suspended) must not have outbound calling actually begin. This is the
  // point real outreach activity starts (ready/scheduled -> running), so
  // it's the sensible enforcement point rather than campaign creation, which
  // is harmless setup work a hospital admin may do before the hospital is
  // marked ready (see `markHospitalReady`).
  const hospital = await getHospitalByScope(scope);
  if (hospital.status !== "active") {
    throw new ConflictError(
      `Cannot start a campaign while the hospital is in status '${hospital.status}' (must be 'active' — see markHospitalReady)`,
    );
  }

  const isFutureStart = campaign.startDate && campaign.startDate.getTime() > Date.now();
  return setStatus(scope, campaignId, isFutureStart ? "scheduled" : "running", "campaign.started");
}

export async function pauseCampaign(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (campaign.status !== "running") {
    throw new ConflictError(`Cannot pause a campaign in status '${campaign.status}' (must be 'running')`);
  }
  return setStatus(scope, campaignId, "paused", "campaign.paused");
}

/**
 * PRD §8: "Resuming should recalculate eligible work rather than blindly
 * restarting every previous task." We don't have outreach tasks yet
 * (Phase 3), so "recalculate" here means re-running the eligibility engine
 * and returning the fresh count alongside the resumed campaign, rather than
 * trusting whatever was true when the campaign was paused.
 */
export async function resumeCampaign(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (campaign.status !== "paused") {
    throw new ConflictError(`Cannot resume a campaign in status '${campaign.status}' (must be 'paused')`);
  }
  const resumed = await setStatus(scope, campaignId, "running", "campaign.resumed");
  const eligible = await evaluateEligiblePatients(scope, resumed);
  return { campaign: resumed, eligiblePatientCount: eligible.length };
}

export async function cancelCampaign(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!CANCELLABLE_STATUSES.includes(campaign.status)) {
    throw new ConflictError(`Cannot cancel a campaign in status '${campaign.status}'`);
  }
  return setStatus(scope, campaignId, "cancelled", "campaign.cancelled");
}

export async function completeCampaign(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!["running", "paused"].includes(campaign.status)) {
    throw new ConflictError(`Cannot complete a campaign in status '${campaign.status}' (must be 'running' or 'paused')`);
  }
  return setStatus(scope, campaignId, "completed", "campaign.completed");
}

/**
 * PRD §8: "Before activation, the system should show an estimate of the
 * workload." expectedAttempts is deliberately a documented upper bound
 * (every eligible patient needs the maximum configured retries), not a
 * contact-rate prediction — real attempt modeling depends on the retry/
 * backoff behavior Phase 3 builds.
 */
export async function getCampaignWorkloadEstimate(scope: HospitalScope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  const hospital = await getHospitalByScope(scope);
  const eligible = await evaluateEligiblePatients(scope, campaign);
  const retryLimit = campaign.retryLimit ?? hospital.maxRetries;
  return {
    campaignId,
    eligiblePatientCount: eligible.length,
    expectedAttempts: eligible.length * (retryLimit + 1),
  };
}
