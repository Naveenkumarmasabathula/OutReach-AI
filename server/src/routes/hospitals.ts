import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import * as hospitalService from "../services/hospitalService.js";
import { updateHospitalConfigSchema } from "../services/hospitalService.js";
import * as userService from "../services/userService.js";
import { createHospitalUserSchema } from "../services/userService.js";

/** "My hospital" routes — for HOSPITAL_ADMIN / CAMPAIGN_MANAGER / CLINICAL_REVIEWER. */
export const hospitalsRouter = Router();
hospitalsRouter.use(authenticate, requireHospitalAccess());

hospitalsRouter.get("/me", async (req, res) => {
  const hospital = await hospitalService.getHospitalByScope(req.hospitalScope!);
  res.json(hospital);
});

hospitalsRouter.patch("/me/config", requirePermission("hospital.config.manage"), async (req, res) => {
  const input = updateHospitalConfigSchema.parse(req.body);
  const hospital = await hospitalService.updateHospitalConfig(req.hospitalScope!, input);
  res.json(hospital);
});

hospitalsRouter.get("/me/users", requirePermission("hospital.users.manage"), async (req, res) => {
  const userList = await userService.listUsersForHospital(req.hospitalScope!);
  res.json(userList);
});

hospitalsRouter.post("/me/users", requirePermission("hospital.users.manage"), async (req, res) => {
  const input = createHospitalUserSchema.parse(req.body);
  const user = await userService.createHospitalUser(req.hospitalScope!, input);
  res.status(201).json(user);
});
