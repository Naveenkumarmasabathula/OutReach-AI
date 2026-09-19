import { z } from "zod";
import { UnauthorizedError } from "../lib/errors.js";
import { signAuthToken } from "../lib/jwt.js";
import { verifyPassword } from "../lib/password.js";
import { findUserByEmail } from "./userService.js";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export async function login(input: LoginInput) {
  const user = await findUserByEmail(input.email);
  if (!user || user.status !== "active") {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const token = signAuthToken({ sub: user.id, hospitalId: user.hospitalId, role: user.role });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, hospitalId: user.hospitalId },
  };
}
