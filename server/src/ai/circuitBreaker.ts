import { logger } from "../lib/logger.js";

type CircuitState = "closed" | "open" | "half_open";

/**
 * PRD §22: "Use appropriate timeouts, retries, backoff, circuit breaking/
 * fallback mechanisms, explicit failure states." Wraps calls to `aiProvider`
 * specifically (an AI provider outage — the concrete failure mode this
 * targets — is a real, PRD-named scenario, unlike this codebase's other
 * external dependencies which already have their own recovery story:
 * Postgres/Redis failures surface as thrown errors Express's central
 * handler turns into a 500, and BullMQ's own `attempts`/backoff already
 * retries transient job failures).
 *
 * After `failureThreshold` consecutive failures, the circuit opens for
 * `cooldownMs`: further calls are short-circuited immediately (no network
 * call attempted) so a real outage doesn't pile up slow, doomed requests.
 * After the cooldown, one trial call is allowed through (half-open); it
 * closes the circuit on success or re-opens it (resetting the cooldown) on
 * failure.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly failureThreshold: number = 3,
    private readonly cooldownMs: number = 60_000,
  ) {}

  isOpen(): boolean {
    if (this.state === "open" && this.openedAt !== null && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half_open";
      logger.info({ circuit: this.name }, "Circuit breaker entering half-open state — allowing one trial call");
    }
    return this.state === "open";
  }

  recordSuccess(): void {
    if (this.state !== "closed") {
      logger.info({ circuit: this.name }, "Circuit breaker closing after a successful call");
    }
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "half_open" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
      logger.warn(
        { circuit: this.name, consecutiveFailures: this.consecutiveFailures },
        "Circuit breaker opened — further calls will be short-circuited until cooldown elapses",
      );
    }
  }

  getState(): CircuitState {
    this.isOpen(); // refresh half-open transition as a side effect
    return this.state;
  }
}

export const aiProviderCircuitBreaker = new CircuitBreaker("ai-provider");
