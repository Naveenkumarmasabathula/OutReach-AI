import pino from "pino";
import { PHI_LOG_REDACT_CENSOR, PHI_LOG_REDACT_PATHS } from "../../src/lib/logRedaction.js";

/**
 * Fix #5 (reliability audit): proves `PHI_LOG_REDACT_PATHS` (the exact
 * config app.ts's `pinoHttp` uses) actually redacts a request-body-shaped
 * object logged through pino, rather than being an unused/miswired config
 * value. Builds a real pino instance with this config and writes to an
 * in-memory stream (matching pino's own recommended way to test redaction)
 * instead of asserting against app.ts's wiring indirectly.
 */
function makeTestLogger() {
  const chunks: string[] = [];
  const stream = {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };
  const logger = pino({ redact: { paths: PHI_LOG_REDACT_PATHS, censor: PHI_LOG_REDACT_CENSOR } }, stream as never);
  return { logger, lines: () => chunks.map((c) => JSON.parse(c)) };
}

describe("PHI log redaction (Fix #5 — a real pino redact.paths mechanism, not just a comment)", () => {
  it("redacts req.headers.authorization (the pre-existing behavior, unchanged)", () => {
    const { logger, lines } = makeTestLogger();
    logger.info({ req: { headers: { authorization: "Bearer secret-token" } } }, "request");
    expect(lines()[0].req.headers.authorization).toBe(PHI_LOG_REDACT_CENSOR);
  });

  it("redacts req.body.firstName/lastName/phone/email/dateOfBirth/mrn — the real createPatientSchema field names", () => {
    const { logger, lines } = makeTestLogger();
    logger.info(
      {
        req: {
          body: {
            mrn: "MRN-001",
            firstName: "Jane",
            lastName: "Doe",
            dateOfBirth: "1990-01-01",
            phone: "+15551234567",
            email: "jane.doe@example.com",
            preferredContactMethod: "phone",
          },
        },
      },
      "request",
    );
    const body = lines()[0].req.body;
    expect(body.mrn).toBe(PHI_LOG_REDACT_CENSOR);
    expect(body.firstName).toBe(PHI_LOG_REDACT_CENSOR);
    expect(body.lastName).toBe(PHI_LOG_REDACT_CENSOR);
    expect(body.dateOfBirth).toBe(PHI_LOG_REDACT_CENSOR);
    expect(body.phone).toBe(PHI_LOG_REDACT_CENSOR);
    expect(body.email).toBe(PHI_LOG_REDACT_CENSOR);
    // A non-PHI field on the same body is left alone — this isn't a
    // blanket "redact everything in req.body" rule.
    expect(body.preferredContactMethod).toBe("phone");
  });

  it("redacts req.body.password (auth/user-creation)", () => {
    const { logger, lines } = makeTestLogger();
    logger.info({ req: { body: { email: "a@b.com", password: "hunter2" } } }, "request");
    expect(lines()[0].req.body.password).toBe(PHI_LOG_REDACT_CENSOR);
  });

  it("redacts req.body.notes and req.body.resolution (escalation review free-text fields)", () => {
    const { logger, lines } = makeTestLogger();
    logger.info({ req: { body: { notes: "Patient reported chest pain." } } }, "request");
    expect(lines()[0].req.body.notes).toBe(PHI_LOG_REDACT_CENSOR);

    const { logger: logger2, lines: lines2 } = makeTestLogger();
    logger2.info({ req: { body: { resolution: "Reviewed and cleared." } } }, "request");
    expect(lines2()[0].req.body.resolution).toBe(PHI_LOG_REDACT_CENSOR);
  });

  it("redacts transcript/conditions wherever nested — forward defense even though no route accepts them today", () => {
    const { logger, lines } = makeTestLogger();
    logger.info(
      { req: { body: { transcript: [{ speaker: "patient", text: "..." }] } }, other: { conditions: ["hypertension"] } },
      "request",
    );
    const line = lines()[0];
    expect(line.req.body.transcript).toBe(PHI_LOG_REDACT_CENSOR);
    expect(line.other.conditions).toBe(PHI_LOG_REDACT_CENSOR);
  });
});
