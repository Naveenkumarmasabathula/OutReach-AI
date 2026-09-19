import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import * as analyticsService from "../services/analyticsService.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireHospitalAccess());

analyticsRouter.get("/hospital", requirePermission("analytics.read"), async (req, res) => {
  const analytics = await analyticsService.getHospitalAnalytics(req.hospitalScope!);
  res.json(analytics);
});
