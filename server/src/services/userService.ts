import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { assertDefined } from "../lib/assert.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";

export const createHospitalUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(["HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"]),
});
export type CreateHospitalUserInput = z.infer<typeof createHospitalUserSchema>;

/**
 * Creates a user within `scope`'s hospital. Used both by a HOSPITAL_ADMIN
 * managing their own staff and by a PLATFORM_ADMIN onboarding a hospital's
 * first HOSPITAL_ADMIN (via `requirePlatformHospitalAccess`, which mints the
 * scope for the *target* hospital, not the platform admin's own).
 */
export async function createHospitalUser(scope: HospitalScope, input: CreateHospitalUserInput) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new ConflictError("A user with this email already exists");

  const passwordHash = await hashPassword(input.password);
  return withHospitalScope(scope, async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        hospitalId: scope.hospitalId,
        email: input.email,
        passwordHash,
        name: input.name,
        role: input.role,
      })
      .returning();
    return assertDefined(user, "user insert returned no row");
  });
}

/** Bootstrap-only: PLATFORM_ADMIN has no hospital, so this is legitimately unscoped. */
export async function createPlatformAdmin(input: { email: string; password: string; name: string }) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new ConflictError("A user with this email already exists");
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ hospitalId: null, email: input.email, passwordHash, name: input.name, role: "PLATFORM_ADMIN" })
    .returning();
  return assertDefined(user, "platform admin insert returned no row");
}

/**
 * Unscoped by necessity: login must find the account by email before a
 * hospital is known. This is the one place `users` is queried without a
 * hospital filter — every other read/write on `users` goes through scope.
 */
export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function listUsersForHospital(scope: HospitalScope) {
  return withHospitalScope(scope, (tx) => tx.select().from(users).where(eq(users.hospitalId, scope.hospitalId)));
}

export async function getHospitalUserById(scope: HospitalScope, userId: string) {
  const [user] = await withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.hospitalId, scope.hospitalId))),
  );
  if (!user) throw new NotFoundError("User not found");
  return user;
}
