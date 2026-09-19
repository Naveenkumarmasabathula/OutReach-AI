import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { Role } from "../config/roles.js";

export type AuthTokenPayload = {
  sub: string; // user id
  hospitalId: string | null;
  role: Role;
};

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}
