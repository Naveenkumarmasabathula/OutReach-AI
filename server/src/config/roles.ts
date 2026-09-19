export const ROLES = [
  "PLATFORM_ADMIN",
  "HOSPITAL_ADMIN",
  "CAMPAIGN_MANAGER",
  "CLINICAL_REVIEWER",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "platform.hospitals.manage", // create/list hospitals across the platform
  "platform.aggregate.read", // cross-hospital dashboards/analytics
  "hospital.config.manage", // edit own hospital's configuration
  "hospital.users.manage", // create/update users within a hospital
  "patient.read",
  "patient.write",
  "campaign.manage",
  "campaign.read",
  "queue.control", // start/pause/resume/reprioritize
  "protocol.manage",
  "protocol.read",
  "escalation.manage", // acknowledge/assign/resolve
  "escalation.read",
  "analytics.read",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Data-driven role -> permission grants (never scattered `if (role === 'X')` checks
 * in route/service code — see docs/multi-tenancy.md §3).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Deliberately excludes patient/campaign/protocol/escalation read access.
  // PRD §3: "Access to clinical content should still follow authorization
  // rules rather than automatically granting unrestricted access to every
  // patient's information" — Platform Admin operates at the hospital-tenant
  // and aggregate-metrics level only, never per-patient PHI.
  PLATFORM_ADMIN: [
    "platform.hospitals.manage",
    "platform.aggregate.read",
    "hospital.config.manage",
    "hospital.users.manage",
    "audit.read",
  ],
  HOSPITAL_ADMIN: [
    "hospital.config.manage",
    "hospital.users.manage",
    "patient.read",
    "patient.write",
    "campaign.manage",
    "campaign.read",
    "queue.control",
    "protocol.manage",
    "protocol.read",
    "escalation.manage",
    "escalation.read",
    "analytics.read",
    "audit.read",
  ],
  CAMPAIGN_MANAGER: [
    "patient.read",
    "campaign.manage",
    "campaign.read",
    "queue.control",
    "protocol.read",
    "escalation.read",
    "analytics.read",
  ],
  CLINICAL_REVIEWER: [
    "patient.read",
    "campaign.read",
    "protocol.read",
    "escalation.manage",
    "escalation.read",
  ],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
