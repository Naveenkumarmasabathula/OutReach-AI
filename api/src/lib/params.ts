import type { Request } from "express";
import { ValidationError } from "./errors.js";

/** Express 5 types route params as possibly `string[]` (repeated-param routes). We never use those. */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing required route param: ${name}`);
  }
  return value;
}
