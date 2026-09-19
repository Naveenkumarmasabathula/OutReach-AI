/**
 * Fix #5 (reliability audit): shared with app.ts's `pinoHttp` config so the
 * list is defined once, not duplicated (and so test/unit/logRedaction.test.ts
 * exercises the exact same paths the running app actually uses, not a
 * hand-copied approximation of them). See app.ts's own comment at the call
 * site for the full rationale and lib/logger.ts for this backstop's honest
 * scope (it covers a logged `req.body` shape specifically, not every way
 * PHI could end up in a log line).
 */
export const PHI_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.body.password",
  "req.body.mrn",
  "req.body.firstName",
  "req.body.lastName",
  "req.body.dateOfBirth",
  "req.body.phone",
  "req.body.email",
  "req.body.notes",
  "req.body.resolution",
  "req.body.transcript",
  "req.body.conditions",
  "*.transcript",
  "*.conditions",
];

export const PHI_LOG_REDACT_CENSOR = "[REDACTED]";
