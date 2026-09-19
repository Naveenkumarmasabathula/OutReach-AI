import type { Request } from "express";
import type { HospitalScope } from "../db/scope.js";
import { recordAudit } from "./audit.js";

/**
 * PRD §21: "Important operations must produce audit records (campaign
 * create/pause, AI escalation assessments, consensus decisions, staff
 * reviews, EHR updates, operational overrides) that are not casually
 * editable or deletable." Reuses the same append-only `audit_log` table and
 * `recordAudit` function Phase 5 built for AI-agent PHI reads — this is the
 * human-action half of the same "regulated subject" audit trail
 * (docs/multi-tenancy.md §2), not a separate logging system. A thin
 * wrapper, not a new abstraction: it exists only to avoid repeating
 * `req.user!.id` / `req.hospitalScope!` at every one of the ~15 call sites
 * this phase adds.
 */
export async function auditUserAction(
  req: Request,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await recordAudit(req.hospitalScope as HospitalScope, {
    actor: { type: "user", id: req.user!.id },
    action,
    resourceType,
    resourceId,
  });
}
