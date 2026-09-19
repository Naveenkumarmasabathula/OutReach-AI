import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Superuser connection — schema introspection/DDL needs elevated privileges
    // the app's own runtime role (DATABASE_URL) intentionally doesn't have.
    url: process.env.MIGRATE_DATABASE_URL ?? "postgres://hospital:hospital@localhost:5432/hospital_outreach",
  },
});
