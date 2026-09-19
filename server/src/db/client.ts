import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

/**
 * Unscoped DB handle. Only for code paths that are legitimately cross-tenant by
 * design: platform-admin aggregate queries, auth lookup by email (before a
 * hospital is known), migrations, and seeding. Anything touching
 * patient/campaign/queue data should go through `withHospitalScope` instead —
 * see docs/multi-tenancy.md.
 */
export const db = drizzle(pool, { schema });
