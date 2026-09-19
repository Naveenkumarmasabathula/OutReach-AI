import { and, desc, eq } from "drizzle-orm";
import { auditLog } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { toOffsetLimit, type Pagination } from "../lib/pagination.js";

/**
 * Read side of the `audit_log` table `lib/audit.ts` writes to. `audit.read`
 * has been a defined permission (granted to `HOSPITAL_ADMIN`/`PLATFORM_ADMIN`)
 * since Phase 0's original RBAC design, but nothing exposed a way to
 * actually use it until now — PRD §21's "not casually editable or
 * deletable" implies someone authorized can at least *read* the trail;
 * an audit log nobody can inspect isn't meaningfully auditable.
 */
export async function listAuditLog(
  scope: HospitalScope,
  pagination: Pagination,
  filters: { resourceType?: string; actorType?: "user" | "ai_agent" | "system" } = {},
) {
  const { offset, limit } = toOffsetLimit(pagination);
  const conditions = [eq(auditLog.hospitalId, scope.hospitalId)];
  if (filters.resourceType) conditions.push(eq(auditLog.resourceType, filters.resourceType));
  if (filters.actorType) conditions.push(eq(auditLog.actorType, filters.actorType));

  return withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
  );
}
