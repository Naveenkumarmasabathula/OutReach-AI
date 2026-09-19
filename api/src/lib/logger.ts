import pino from "pino";
import { env } from "../config/env.js";

/**
 * PRD §21/§25: sensitive healthcare information must not be unnecessarily
 * written into logs. Never log request/response bodies here — route/service
 * code must log identifiers (patientId, hospitalId) and outcomes, not PHI
 * content (conversation text, clinical notes).
 *
 * Fix #5 (reliability audit): that used to be enforced only by this comment
 * and by convention. `app.ts`'s `pinoHttp` config now also enforces a real
 * `redact.paths` list for the request-body fields most likely to carry
 * PHI/credentials if that discipline is ever broken (see its own comment
 * for the exact list and why). This base `logger` instance (used directly
 * by services, outside any per-request `req.log`) is NOT covered by that
 * redact config — it's a separate pino instance — so the convention above
 * still matters here specifically: don't pass patient names, phone/email,
 * conversation transcripts, or clinical notes into a `logger.*()` call in
 * this codebase. Treat the redact config as a backstop for the
 * HTTP-request-body path, not a substitute for that discipline everywhere.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
});
