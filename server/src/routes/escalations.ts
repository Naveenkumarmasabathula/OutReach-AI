import { Router } from "express";
import { z } from "zod";
import { escalationStatusEnum } from "../db/schema/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { auditUserAction } from "../lib/auditRoute.js";
import { paginationSchema } from "../lib/pagination.js";
import { requireParam } from "../lib/params.js";
import * as escalationService from "../services/escalationService.js";
import * as notificationService from "../services/notificationService.js";

export const escalationsRouter = Router();
escalationsRouter.use(authenticate, requireHospitalAccess());

const listFiltersSchema = z.object({
  status: z.enum(escalationStatusEnum.enumValues).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
});

escalationsRouter.get("/", requirePermission("escalation.read"), async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const filters = listFiltersSchema.parse(req.query);
  const list = await escalationService.listEscalations(req.hospitalScope!, pagination, filters);
  res.json(list);
});

escalationsRouter.get("/:escalationId", requirePermission("escalation.read"), async (req, res) => {
  const detail = await escalationService.getEscalationDetail(req.hospitalScope!, requireParam(req, "escalationId"));
  res.json(detail);
});

// PRD §24 names "notifications" as required API surface. The
// `notifications` table and `sendNotification` (server/src/services/
// notificationService.ts) have existed since Phase 6, but nothing ever
// exposed a read path — this closes that gap rather than leave a
// documented-but-unreachable capability, found while writing docs/architecture.md.
escalationsRouter.get("/:escalationId/notifications", requirePermission("escalation.read"), async (req, res) => {
  const escalationId = requireParam(req, "escalationId");
  await escalationService.getEscalationById(req.hospitalScope!, escalationId); // 404s if not in scope
  const notifications = await notificationService.listNotificationsForResource(
    req.hospitalScope!,
    "escalation",
    escalationId,
  );
  res.json(notifications);
});

// PRD §21: "staff reviews" are explicitly named as an important-operation
// audit category — every reviewer action below writes one, on top of the
// escalation row's own status change (which records *what* happened but not
// *who* did it or when, independent of the row itself later being edited).
escalationsRouter.post("/:escalationId/acknowledge", requirePermission("escalation.manage"), async (req, res) => {
  // Fix #4 (reliability audit): pinoHttp's own per-request id (app.ts),
  // threaded through so the `escalation.acknowledged` event's async worker
  // processing logs the SAME id this request's own log lines already
  // carry — a genuine HTTP-to-worker-log trace, not just a freshly
  // generated id at the queue boundary.
  const escalation = await escalationService.acknowledgeEscalation(
    req.hospitalScope!,
    requireParam(req, "escalationId"),
    req.user!.id,
    String(req.id),
  );
  await auditUserAction(req, "escalation.acknowledge", "escalation", escalation.id);
  res.json(escalation);
});

const assignSchema = z.object({ reviewerId: z.string().min(1) });

escalationsRouter.post("/:escalationId/assign", requirePermission("escalation.manage"), async (req, res) => {
  const { reviewerId } = assignSchema.parse(req.body);
  const escalation = await escalationService.assignEscalation(
    req.hospitalScope!,
    requireParam(req, "escalationId"),
    reviewerId,
  );
  await auditUserAction(req, "escalation.assign", "escalation", escalation.id);
  res.json(escalation);
});

escalationsRouter.post("/:escalationId/start-review", requirePermission("escalation.manage"), async (req, res) => {
  const escalation = await escalationService.startReview(req.hospitalScope!, requireParam(req, "escalationId"));
  await auditUserAction(req, "escalation.start_review", "escalation", escalation.id);
  res.json(escalation);
});

const requestInfoSchema = z.object({ notes: z.string().min(1) });

escalationsRouter.post(
  "/:escalationId/request-information",
  requirePermission("escalation.manage"),
  async (req, res) => {
    const { notes } = requestInfoSchema.parse(req.body);
    const escalation = await escalationService.requestInformation(
      req.hospitalScope!,
      requireParam(req, "escalationId"),
      notes,
    );
    await auditUserAction(req, "escalation.request_information", "escalation", escalation.id);
    res.json(escalation);
  },
);

escalationsRouter.post("/:escalationId/resume-review", requirePermission("escalation.manage"), async (req, res) => {
  const escalation = await escalationService.resumeReview(req.hospitalScope!, requireParam(req, "escalationId"));
  await auditUserAction(req, "escalation.resume_review", "escalation", escalation.id);
  res.json(escalation);
});

const resolveSchema = z.object({ resolution: z.string().min(1) });

escalationsRouter.post("/:escalationId/resolve", requirePermission("escalation.manage"), async (req, res) => {
  const { resolution } = resolveSchema.parse(req.body);
  const escalation = await escalationService.resolveEscalation(
    req.hospitalScope!,
    requireParam(req, "escalationId"),
    resolution,
    String(req.id), // Fix #4 — see the acknowledge route above
  );
  await auditUserAction(req, "escalation.resolve", "escalation", escalation.id);
  res.json(escalation);
});

escalationsRouter.post("/:escalationId/close", requirePermission("escalation.manage"), async (req, res) => {
  const escalation = await escalationService.closeEscalation(req.hospitalScope!, requireParam(req, "escalationId"));
  await auditUserAction(req, "escalation.close", "escalation", escalation.id);
  res.json(escalation);
});
