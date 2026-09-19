import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { db, pool } from "./client.js";
import * as schema from "./schema/index.js";

// A real runtime symbol, not just a type-level brand — `declare const ...:
// unique symbol` has no runtime value, which broke `mintHospitalScope` (used
// it as a computed property key, evaluated at runtime).
const scopeBrand = Symbol("HospitalScope");

/**
 * Evidence that a request's hospital access was checked. A `HospitalScope` can
 * only be constructed by `mintHospitalScope`, which must only ever be called
 * from the auth/access-guard middleware (`src/middleware/*`) after verifying
 * the authenticated principal's hospital. Service methods take a
 * `HospitalScope`, never a bare `hospitalId` string — holding one is the proof
 * a check ran. See docs/multi-tenancy.md §2.
 */
export type HospitalScope = {
  readonly hospitalId: string;
  readonly [scopeBrand]: true;
};

/**
 * Only call this from middleware, after resolving hospital access for the
 * current request/principal. Do not call this from a route handler or service
 * with an id read straight from params/body — that defeats the entire point.
 */
export function mintHospitalScope(hospitalId: string): HospitalScope {
  return { hospitalId, [scopeBrand]: true };
}

export type ScopedDb = NodePgDatabase<typeof schema>;

/**
 * Runs `fn` inside a DB transaction with `app.current_hospital_id` set via
 * `SET LOCAL`, so Postgres RLS policies (forced on every hospital-scoped table)
 * enforce the same boundary as the application-layer `hospital_id` filters
 * services still apply explicitly. This is the second, DB-level layer from
 * docs/multi-tenancy.md §2 — a leak now requires two independent bugs instead
 * of one.
 */
export async function withHospitalScope<T>(
  scope: HospitalScope,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    const tx = drizzle(client, { schema });
    await client.query("BEGIN");
    // set_config with is_local=true is the parameterized equivalent of SET LOCAL,
    // safe against injection since the hospitalId isn't string-interpolated into SQL.
    await client.query("SELECT set_config('app.current_hospital_id', $1, true)", [scope.hospitalId]);
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { db, sql };
