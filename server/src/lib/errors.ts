/**
 * Typed domain errors. Routes/services throw these; a single central error
 * handler (src/app.ts) maps them to HTTP responses. Route handlers must never
 * call res.status(...) directly for a domain outcome — see docs/multi-tenancy.md
 * §1's "one-authorization-model-per-response" discipline, which this supports
 * by keeping error-shape decisions in one place.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not permitted") {
    super(message, 403, "FORBIDDEN");
  }
}

/**
 * Used for both "doesn't exist" and "exists but you can't see it" — a hospital
 * a caller has no access to must 404, not 403, so its existence isn't
 * observable (reference-project pattern for org-only resources).
 */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Invalid request",
    public readonly details?: unknown,
  ) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

/**
 * PRD §22 circuit-breaking, applied to EHR/voice-provider calls (Fix #1,
 * reliability audit): thrown by `ehr/circuitBreakerEhr.ts` and
 * `voice/circuitBreakerVoiceProvider.ts` when their breaker is open, so a
 * dependency known to be failing repeatedly fails fast with an explicit
 * 503 instead of hanging or being retried pointlessly against it.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}
