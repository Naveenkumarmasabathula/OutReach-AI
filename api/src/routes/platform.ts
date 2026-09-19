import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requirePermission, requirePlatformHospitalAccess } from "../middleware/rbac.js";
import { paginationSchema } from "../lib/pagination.js";
import * as analyticsService from "../services/analyticsService.js";
import * as auditService from "../services/auditService.js";
import * as hospitalService from "../services/hospitalService.js";
import { createHospitalSchema, updateHospitalConfigSchema } from "../services/hospitalService.js";
import * as userService from "../services/userService.js";
import { createHospitalUserSchema } from "../services/userService.js";

export const platformRouter = Router();
platformRouter.use(authenticate);

// PRD §20: "Platform Admin dashboard: authorized aggregate visibility
// across hospitals... aggregate analytics must never bypass patient-level
// access controls." See analyticsService.getPlatformAggregateAnalytics's
// own comment for how that's satisfied by construction, not just by this
// permission check.
platformRouter.get("/analytics", requirePermission("platform.aggregate.read"), async (_req, res) => {
  const analytics = await analyticsService.getPlatformAggregateAnalytics();
  res.json(analytics);
});

platformRouter.post("/hospitals", requirePermission("platform.hospitals.manage"), async (req, res) => {
  const input = createHospitalSchema.parse(req.body);
  const hospital = await hospitalService.createHospital(input);
  res.status(201).json(hospital);
});

platformRouter.get("/hospitals", requirePermission("platform.hospitals.manage"), async (_req, res) => {
  const hospitalList = await hospitalService.listHospitals();
  res.json(hospitalList);
});

platformRouter.get(
  "/hospitals/:hospitalId",
  requirePlatformHospitalAccess("hospitalId"),
  requirePermission("hospital.config.manage"),
  async (req, res) => {
    const hospital = await hospitalService.getHospitalByScope(req.hospitalScope!);
    res.json(hospital);
  },
);

platformRouter.patch(
  "/hospitals/:hospitalId/config",
  requirePlatformHospitalAccess("hospitalId"),
  requirePermission("hospital.config.manage"),
  async (req, res) => {
    const input = updateHospitalConfigSchema.parse(req.body);
    const hospital = await hospitalService.updateHospitalConfig(req.hospitalScope!, input);
    res.json(hospital);
  },
);

platformRouter.post(
  "/hospitals/:hospitalId/ready",
  requirePlatformHospitalAccess("hospitalId"),
  requirePermission("hospital.config.manage"),
  async (req, res) => {
    const hospital = await hospitalService.markHospitalReady(req.hospitalScope!);
    res.json(hospital);
  },
);

// PLATFORM_ADMIN's own `audit.read` grant (defined since Phase 0, never
// wired to a route until now) is satisfied per-hospital, matching how every
// other platform route reaches hospital-scoped data — never a global,
// unscoped audit query.
platformRouter.get(
  "/hospitals/:hospitalId/audit-log",
  requirePlatformHospitalAccess("hospitalId"),
  requirePermission("audit.read"),
  async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const entries = await auditService.listAuditLog(req.hospitalScope!, pagination);
    res.json(entries);
  },
);

platformRouter.post(
  "/hospitals/:hospitalId/users",
  requirePlatformHospitalAccess("hospitalId"),
  requirePermission("hospital.users.manage"),
  async (req, res) => {
    const input = createHospitalUserSchema.parse(req.body);
    const user = await userService.createHospitalUser(req.hospitalScope!, input);
    res.status(201).json(user);
  },
);
