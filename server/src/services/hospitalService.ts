import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { hospitals } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { assertDefined } from "../lib/assert.js";
import { NotFoundError } from "../lib/errors.js";

// Non-engineering-configurable operational behavior (PRD §18): "reviewer
// timeouts, callback reminders, campaign pauses, retry notifications... configure
// without changing AI logic." Kept in the existing `settings` jsonb (already
// documented on the schema as covering exactly this kind of hospital
// preference) rather than a new dedicated column or a new config system.
//
// `notificationPreferences.defaultChannel` (PRD §4's "notification
// preferences") is the fallback channel `notificationService.sendNotification`
// uses whenever a caller doesn't pick one explicitly — see
// `getDefaultNotificationChannel` below and its call site in
// notificationService.ts.
export const notificationPreferencesSchema = z
  .object({
    defaultChannel: z.enum(["email", "sms", "dashboard"]),
  })
  .partial();
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const hospitalSettingsSchema = z
  .object({
    escalationReviewerTimeoutMinutes: z.number().int().positive().optional(),
    notificationPreferences: notificationPreferencesSchema.optional(),
  })
  .partial();
export type HospitalSettings = z.infer<typeof hospitalSettingsSchema>;

export const DEFAULT_ESCALATION_REVIEWER_TIMEOUT_MINUTES = 30;
export const DEFAULT_NOTIFICATION_CHANNEL = "dashboard" as const;

export function getEscalationReviewerTimeoutMinutes(hospital: { settings: unknown }): number {
  const parsed = hospitalSettingsSchema.safeParse(hospital.settings);
  return parsed.success && parsed.data.escalationReviewerTimeoutMinutes
    ? parsed.data.escalationReviewerTimeoutMinutes
    : DEFAULT_ESCALATION_REVIEWER_TIMEOUT_MINUTES;
}

export function getDefaultNotificationChannel(hospital: {
  settings: unknown;
}): "email" | "sms" | "dashboard" {
  const parsed = hospitalSettingsSchema.safeParse(hospital.settings);
  return (
    (parsed.success && parsed.data.notificationPreferences?.defaultChannel) || DEFAULT_NOTIFICATION_CHANNEL
  );
}

// Per-hospital MockEHR simulation parameters (PRD §4's "mock EHR integration
// settings"). Genuinely read by MockEHR (server/src/ehr/mockEhr.ts) on every
// EHR interface call via `getMockEhrConfig` below — not a decorative field.
// `simulatedLatencyMs` delays the call; `simulatedFailureRate` (0-1) is the
// probability the call throws instead of completing, for demonstrating the
// platform's reliability/retry story against an unreliable upstream EHR.
export const mockEhrConfigSchema = z
  .object({
    simulatedLatencyMs: z.number().int().nonnegative().max(30_000).optional(),
    simulatedFailureRate: z.number().min(0).max(1).optional(),
  })
  .partial();
export type MockEhrConfig = z.infer<typeof mockEhrConfigSchema>;

export const DEFAULT_MOCK_EHR_CONFIG: Required<MockEhrConfig> = {
  simulatedLatencyMs: 0,
  simulatedFailureRate: 0,
};

export function getMockEhrConfig(hospital: { mockEhrConfig: unknown }): Required<MockEhrConfig> {
  const parsed = mockEhrConfigSchema.safeParse(hospital.mockEhrConfig);
  const data = parsed.success ? parsed.data : {};
  return {
    simulatedLatencyMs: data.simulatedLatencyMs ?? DEFAULT_MOCK_EHR_CONFIG.simulatedLatencyMs,
    simulatedFailureRate: data.simulatedFailureRate ?? DEFAULT_MOCK_EHR_CONFIG.simulatedFailureRate,
  };
}

export const createHospitalSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  timezone: z.string().min(1).default("UTC"),
  callingHoursStart: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  callingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  outboundCapacity: z.number().int().positive().default(10),
  maxRetries: z.number().int().nonnegative().default(3),
  settings: hospitalSettingsSchema.optional(),
  mockEhrConfig: mockEhrConfigSchema.optional(),
});
export type CreateHospitalInput = z.infer<typeof createHospitalSchema>;

export const updateHospitalConfigSchema = createHospitalSchema.partial().omit({ slug: true });
export type UpdateHospitalConfigInput = z.infer<typeof updateHospitalConfigSchema>;

/**
 * Platform-admin only: hospitals don't exist yet at creation time, so there is
 * no tenant scope to check — this is the one legitimate unscoped write.
 */
export async function createHospital(input: CreateHospitalInput) {
  const [hospital] = await db.insert(hospitals).values(input).returning();
  return assertDefined(hospital, "hospital insert returned no row");
}

/** Platform-admin only: cross-hospital aggregate listing. */
export async function listHospitals() {
  return db.select().from(hospitals);
}

export async function getHospitalByScope(scope: HospitalScope) {
  const [hospital] = await db.select().from(hospitals).where(eq(hospitals.id, scope.hospitalId));
  if (!hospital) throw new NotFoundError("Hospital not found");
  return hospital;
}

export async function markHospitalReady(scope: HospitalScope) {
  const [hospital] = await db
    .update(hospitals)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(hospitals.id, scope.hospitalId))
    .returning();
  if (!hospital) throw new NotFoundError("Hospital not found");
  return hospital;
}

export async function updateHospitalConfig(scope: HospitalScope, input: UpdateHospitalConfigInput) {
  const { settings: settingsPatch, mockEhrConfig: mockEhrConfigPatch, ...rest } = input;

  const [existing] = await db.select().from(hospitals).where(eq(hospitals.id, scope.hospitalId));
  if (!existing) throw new NotFoundError("Hospital not found");

  // A merge, not a replace — `settings`/`mockEhrConfig` may accumulate
  // independent keys over time, and a blind overwrite would silently drop
  // whichever ones the current request didn't happen to mention.
  const mergedSettings = settingsPatch
    ? { ...(existing.settings as Record<string, unknown>), ...settingsPatch }
    : undefined;
  const mergedMockEhrConfig = mockEhrConfigPatch
    ? { ...(existing.mockEhrConfig as Record<string, unknown>), ...mockEhrConfigPatch }
    : undefined;

  const [hospital] = await db
    .update(hospitals)
    .set({
      ...rest,
      ...(mergedSettings ? { settings: mergedSettings } : {}),
      ...(mergedMockEhrConfig ? { mockEhrConfig: mergedMockEhrConfig } : {}),
      updatedAt: new Date(),
    })
    .where(eq(hospitals.id, scope.hospitalId))
    .returning();
  return assertDefined(hospital, "hospital update returned no row");
}
