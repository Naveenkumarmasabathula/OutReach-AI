import { env } from "../config/env.js";
import { GeminiProvider } from "./geminiProvider.js";
import { SimulatedAIProvider } from "./simulatedProvider.js";
import type { AIProvider } from "./types.js";

/**
 * The one-line swap point, matching `ehr/index.ts`'s pattern exactly: no
 * calling code (clinicalTriageAgent.ts, documentationAgent.ts) imports
 * either implementation directly, only this binding. Automatic, not a
 * manual toggle — the moment `GEMINI_API_KEY` is set in `server/.env`, the
 * next process start uses the real provider with zero code changes.
 *
 * `NODE_ENV === "test"` always wins over a configured key, even when one is
 * present — found the hard way: setting a real `GEMINI_API_KEY` in
 * `server/.env` for local development silently flipped the entire test
 * suite over to hitting the live, rate-limited, quota-constrained API
 * instead of the deterministic simulator, breaking `docs/safety-evaluation.md`'s
 * "no database, no network, no randomness" reproducibility guarantee and
 * causing real, non-deterministic test failures. Jest sets `NODE_ENV=test`
 * automatically, so this requires no test-specific configuration — the
 * *default* provider for anything running under Jest is always
 * `SimulatedAIProvider`, and only `server/test/unit/geminiProvider.test.ts`
 * (which constructs `GeminiProvider` directly, bypassing this binding
 * entirely) ever exercises the real provider under test.
 */
export const aiProvider: AIProvider =
  env.GEMINI_API_KEY && env.NODE_ENV !== "test"
    ? new GeminiProvider(env.GEMINI_API_KEY)
    : new SimulatedAIProvider();

export * from "./types.js";
