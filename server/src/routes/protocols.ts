import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { paginationSchema } from "../lib/pagination.js";
import { requireParam } from "../lib/params.js";
import * as protocolService from "../services/protocolService.js";
import { createProtocolSchema, updateProtocolSchema } from "../services/protocolService.js";
import { retrieveRelevantProtocols } from "../services/protocolRetrievalService.js";
import { protocolCategoryEnum } from "../db/schema/index.js";

export const protocolsRouter = Router();
protocolsRouter.use(authenticate, requireHospitalAccess());

protocolsRouter.post("/", requirePermission("protocol.manage"), async (req, res) => {
  const input = createProtocolSchema.parse(req.body);
  const protocol = await protocolService.createProtocol(req.hospitalScope!, input);
  res.status(201).json(protocol);
});

const listFiltersSchema = z.object({
  category: z.enum(protocolCategoryEnum.enumValues).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

protocolsRouter.get("/", requirePermission("protocol.read"), async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const filters = listFiltersSchema.parse(req.query);
  const protocolList = await protocolService.listProtocols(req.hospitalScope!, pagination, filters);
  res.json(protocolList);
});

// Task-specific retrieval (PRD §5) — this is the seam Phase 5's AI agents
// will call in-process as a controlled tool; exposed over HTTP too so
// retrieval quality can be inspected/tested before that agent layer exists.
const searchQuerySchema = z.object({
  category: z.enum(protocolCategoryEnum.enumValues).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : undefined)),
  keywords: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).default(5),
});

protocolsRouter.get("/search", requirePermission("protocol.read"), async (req, res) => {
  const { limit, ...query } = searchQuerySchema.parse(req.query);
  const results = await retrieveRelevantProtocols(req.hospitalScope!, query, limit);
  res.json(results);
});

protocolsRouter.get("/:protocolId", requirePermission("protocol.read"), async (req, res) => {
  const protocol = await protocolService.getProtocolById(req.hospitalScope!, requireParam(req, "protocolId"));
  res.json(protocol);
});

protocolsRouter.patch("/:protocolId", requirePermission("protocol.manage"), async (req, res) => {
  const input = updateProtocolSchema.parse(req.body);
  const protocol = await protocolService.updateProtocol(
    req.hospitalScope!,
    requireParam(req, "protocolId"),
    input,
  );
  res.json(protocol);
});

protocolsRouter.post("/:protocolId/deactivate", requirePermission("protocol.manage"), async (req, res) => {
  const protocol = await protocolService.deactivateProtocol(req.hospitalScope!, requireParam(req, "protocolId"));
  res.json(protocol);
});
