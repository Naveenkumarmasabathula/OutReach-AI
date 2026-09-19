import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { paginationSchema } from "../lib/pagination.js";
import { requireParam } from "../lib/params.js";
import * as patientService from "../services/patientService.js";
import { createPatientSchema } from "../services/patientService.js";
import * as encounterService from "../services/encounterService.js";

export const patientsRouter = Router();
patientsRouter.use(authenticate, requireHospitalAccess());

patientsRouter.post("/", requirePermission("patient.write"), async (req, res) => {
  const input = createPatientSchema.parse(req.body);
  const patient = await patientService.createPatient(req.hospitalScope!, input);
  res.status(201).json(patient);
});

patientsRouter.get("/", requirePermission("patient.read"), async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const patientList = await patientService.listPatients(req.hospitalScope!, pagination);
  res.json(patientList);
});

patientsRouter.get("/:patientId", requirePermission("patient.read"), async (req, res) => {
  const patient = await patientService.getPatientById(req.hospitalScope!, requireParam(req, "patientId"));
  res.json(patient);
});

patientsRouter.get("/:patientId/timeline", requirePermission("patient.read"), async (req, res) => {
  const timeline = await encounterService.getPatientTimeline(req.hospitalScope!, requireParam(req, "patientId"));
  res.json(timeline);
});
