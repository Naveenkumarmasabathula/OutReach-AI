import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { PHI_LOG_REDACT_CENSOR, PHI_LOG_REDACT_PATHS } from "./lib/logRedaction.js";
import { getSystemHealth } from "./lib/systemHealth.js";
import { analyticsRouter } from "./routes/analytics.js";
import { auditRouter } from "./routes/audit.js";
import { authRouter } from "./routes/auth.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { encountersRouter } from "./routes/encounters.js";
import { escalationsRouter } from "./routes/escalations.js";
import { hospitalsRouter } from "./routes/hospitals.js";
import { patientsRouter } from "./routes/patients.js";
import { platformRouter } from "./routes/platform.js";
import { protocolsRouter } from "./routes/protocols.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-correlation-id"]?.toString() ?? randomUUID(),
      // Fix #5 (reliability audit): PRD §21/§25 says PHI must not be
      // unnecessarily written into logs — previously only
      // `req.headers.authorization` was actually enforced via pino's
      // `redact`, everything else was just a comment in lib/logger.ts
      // telling callers not to. This makes it a real mechanism for the
      // request-body fields most likely to carry PHI/credentials, checked
      // against the real request body shapes (patientService's
      // `createPatientSchema`: mrn/firstName/lastName/dateOfBirth/phone/
      // email; escalation review routes' `notes`/`resolution` free-text
      // fields; auth/user-creation's `password`) — not guessed blindly.
      // `transcript`/`conditions` aren't accepted in any request body today
      // (they're AI/EHR-read outputs, not submitted fields) but are
      // redacted anyway, wildcarded across any nesting depth, as forward
      // defense per the audit's own suggestion — a harmless no-op today,
      // real protection the moment either ever does flow through a logged
      // request body. This is a blunt backstop for whatever ends up inside
      // a *logged* req/body shape, not a guarantee nothing else in the
      // codebase could still log PHI some other way — see
      // docs/observability-reliability.md for the honest scope of what
      // this does and doesn't cover.
      redact: { paths: PHI_LOG_REDACT_PATHS, censor: PHI_LOG_REDACT_CENSOR },
    }),
  );

  // PRD §21: "Health states: Healthy, Degraded, Unavailable." Unauthenticated
  // and deliberately cheap (each check has its own timeout — see
  // lib/systemHealth.ts) since this is meant to double as an external
  // liveness/readiness probe, not just an internal dashboard signal. Maps to
  // a real HTTP status too (503 for unavailable) so a load balancer or
  // uptime monitor can act on it without parsing the body.
  app.get("/health", async (_req, res) => {
    const health = await getSystemHealth();
    res.status(health.status === "unavailable" ? 503 : 200).json(health);
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/platform", platformRouter);
  app.use("/api/v1/hospitals", hospitalsRouter);
  app.use("/api/v1/patients", patientsRouter);
  app.use("/api/v1/encounters", encountersRouter);
  app.use("/api/v1/campaigns", campaignsRouter);
  app.use("/api/v1/protocols", protocolsRouter);
  app.use("/api/v1/escalations", escalationsRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/audit-log", auditRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // Central error handler — routes/services throw typed errors (src/lib/errors.ts);
  // nothing else maps a domain outcome to an HTTP status. Express 5 forwards
  // rejected promises from async handlers here automatically.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res
        .status(400)
        .json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.flatten() } });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
      return;
    }
    req.log?.error({ err }, "Unhandled error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
  });

  return app;
}
