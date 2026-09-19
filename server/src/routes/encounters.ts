import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { requireParam } from "../lib/params.js";
import * as encounterService from "../services/encounterService.js";
import { createEncounterSchema } from "../services/encounterService.js";

export const encountersRouter = Router();
encountersRouter.use(authenticate, requireHospitalAccess());

encountersRouter.post("/", requirePermission("patient.write"), async (req, res) => {
  const input = createEncounterSchema.parse(req.body);
  const encounter = await encounterService.createEncounter(req.hospitalScope!, input);
  res.status(201).json(encounter);
});

encountersRouter.get("/:encounterId", requirePermission("patient.read"), async (req, res) => {
  const encounter = await encounterService.getEncounterById(req.hospitalScope!, requireParam(req, "encounterId"));
  res.json(encounter);
});
