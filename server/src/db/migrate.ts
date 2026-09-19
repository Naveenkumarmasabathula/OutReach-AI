import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Uses the superuser connection, not the app's runtime pool (src/db/client.ts)
// — creating tables/roles requires privileges the app process must never have.
const migrateDatabaseUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!migrateDatabaseUrl) {
  throw new Error("MIGRATE_DATABASE_URL (or DATABASE_URL) must be set to run migrations");
}

async function main() {
  const pool = new Pool({ connectionString: migrateDatabaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
