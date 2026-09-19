import { auditLog } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";

export type AuditActor = {
  type: "user" | "ai_agent" | "system";
  id: string;
};

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

/**
 * The "regulated subject" pattern (docs/multi-tenancy.md §2): a single,
 * append-only write for every PHI read by a non-human actor. Never throws on
 * its own account failing to matter more than the read it's auditing would
 * be wrong — but a failed audit write here would mean a PHI read happened
 * with no record of it, which is exactly the failure mode this exists to
 * prevent, so this intentionally does NOT swallow errors.
 */
export async function recordAudit(scope: HospitalScope, entry: AuditEntry): Promise<void> {
  await withHospitalScope(scope, (tx) =>
    tx.insert(auditLog).values({
      hospitalId: scope.hospitalId,
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      reason: entry.reason,
      metadata: entry.metadata ?? {},
    }),
  );
}
