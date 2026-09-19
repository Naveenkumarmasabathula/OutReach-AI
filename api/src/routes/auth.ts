import { Router } from "express";
import { loginSchema } from "../services/authService.js";
import * as authService from "../services/authService.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.json(result);
});
