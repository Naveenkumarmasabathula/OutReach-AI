import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { paginationSchema } from "../lib/pagination.js";
import * as auditService from "../services/auditService.js";

export const auditRouter = Router();
auditRouter.use(authenticate, requireHospitalAccess());

const filtersSchema = z.object({
  resourceType: z.string().optional(),
  actorType: z.enum(["user", "ai_agent", "system"]).optional(),
});

auditRouter.get("/", requirePermission("audit.read"), async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const filters = filtersSchema.parse(req.query);
  const entries = await auditService.listAuditLog(req.hospitalScope!, pagination, filters);
  res.json(entries);
});
