import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireHospitalAccess, requirePermission } from "../middleware/rbac.js";
import { auditUserAction } from "../lib/auditRoute.js";
import { paginationSchema } from "../lib/pagination.js";
import { requireParam } from "../lib/params.js";
import { z } from "zod";
import * as campaignService from "../services/campaignService.js";
import { createCampaignSchema, updateCampaignSchema } from "../services/campaignService.js";
import * as queueService from "../services/queueService.js";

export const campaignsRouter = Router();
campaignsRouter.use(authenticate, requireHospitalAccess());

campaignsRouter.post("/", requirePermission("campaign.manage"), async (req, res) => {
  const input = createCampaignSchema.parse(req.body);
  const campaign = await campaignService.createCampaign(req.hospitalScope!, input);
  await auditUserAction(req, "campaign.create", "campaign", campaign.id);
  res.status(201).json(campaign);
});

campaignsRouter.get("/", requirePermission("campaign.read"), async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const campaignList = await campaignService.listCampaigns(req.hospitalScope!, pagination);
  res.json(campaignList);
});

campaignsRouter.get("/:campaignId", requirePermission("campaign.read"), async (req, res) => {
  const campaign = await campaignService.getCampaignById(req.hospitalScope!, requireParam(req, "campaignId"));
  res.json(campaign);
});

campaignsRouter.get("/:campaignId/workload-estimate", requirePermission("campaign.read"), async (req, res) => {
  const estimate = await campaignService.getCampaignWorkloadEstimate(
    req.hospitalScope!,
    requireParam(req, "campaignId"),
  );
  res.json(estimate);
});

campaignsRouter.patch("/:campaignId", requirePermission("campaign.manage"), async (req, res) => {
  const input = updateCampaignSchema.parse(req.body);
  const campaign = await campaignService.updateCampaign(req.hospitalScope!, requireParam(req, "campaignId"), input);
  await auditUserAction(req, "campaign.update", "campaign", campaign.id);
  res.json(campaign);
});

const reprioritizeSchema = z.object({ priority: z.number().int().min(1).max(5) });

campaignsRouter.patch("/:campaignId/priority", requirePermission("queue.control"), async (req, res) => {
  const { priority } = reprioritizeSchema.parse(req.body);
  const campaign = await campaignService.reprioritizeCampaign(
    req.hospitalScope!,
    requireParam(req, "campaignId"),
    priority,
  );
  // "Operational overrides" (PRD §21): reprioritizing live queue arbitration
  // outside a campaign's normal lifecycle is exactly that kind of override.
  await auditUserAction(req, "campaign.reprioritize", "campaign", campaign.id);
  res.json(campaign);
});

campaignsRouter.post("/:campaignId/ready", requirePermission("campaign.manage"), async (req, res) => {
  const campaign = await campaignService.markCampaignReady(req.hospitalScope!, requireParam(req, "campaignId"));
  await auditUserAction(req, "campaign.ready", "campaign", campaign.id);
  res.json(campaign);
});

campaignsRouter.post("/:campaignId/start", requirePermission("queue.control"), async (req, res) => {
  const campaign = await campaignService.startCampaign(req.hospitalScope!, requireParam(req, "campaignId"));
  // Orchestrated here, not inside campaignService, deliberately: queueService
  // already imports campaignService (for calling-hours lookups in
  // recordAttemptOutcome), so campaignService importing queueService back
  // would create a circular module dependency. Routes are the natural place
  // to coordinate two services that can't depend on each other directly.
  if (campaign.status === "running") {
    await queueService.enqueueEligiblePatients(req.hospitalScope!, campaign);
  }
  await auditUserAction(req, "campaign.start", "campaign", campaign.id);
  res.json(campaign);
});

campaignsRouter.post("/:campaignId/pause", requirePermission("queue.control"), async (req, res) => {
  const campaign = await campaignService.pauseCampaign(req.hospitalScope!, requireParam(req, "campaignId"));
  await auditUserAction(req, "campaign.pause", "campaign", campaign.id);
  res.json(campaign);
});

campaignsRouter.post("/:campaignId/resume", requirePermission("queue.control"), async (req, res) => {
  const result = await campaignService.resumeCampaign(req.hospitalScope!, requireParam(req, "campaignId"));
  // See the /start handler above for why this lives here, not in the service.
  await queueService.enqueueEligiblePatients(req.hospitalScope!, result.campaign);
  await auditUserAction(req, "campaign.resume", "campaign", result.campaign.id);
  res.json(result);
});

campaignsRouter.get("/:campaignId/queue-health", requirePermission("campaign.read"), async (req, res) => {
  await campaignService.getCampaignById(req.hospitalScope!, requireParam(req, "campaignId")); // 404s if not in scope
  const health = await queueService.getQueueHealth(req.hospitalScope!);
  res.json(health);
});

campaignsRouter.post("/:campaignId/cancel", requirePermission("queue.control"), async (req, res) => {
  const campaign = await campaignService.cancelCampaign(req.hospitalScope!, requireParam(req, "campaignId"));
  await auditUserAction(req, "campaign.cancel", "campaign", campaign.id);
  res.json(campaign);
});

campaignsRouter.post("/:campaignId/complete", requirePermission("queue.control"), async (req, res) => {
  const campaign = await campaignService.completeCampaign(req.hospitalScope!, requireParam(req, "campaignId"));
  await auditUserAction(req, "campaign.complete", "campaign", campaign.id);
  res.json(campaign);
});
