import { Router } from "express";
import { signin, signout, signup, getWsTicket, getMe, sendMagicLink, verifyMagicLink } from "../controller/auth.controller";
import { validateBody, signupSchema, signinSchema, magicLinkSchema } from "@exness/validation";

export const authRouter: Router = Router();

authRouter.post("/signup", validateBody(signupSchema), signup);
authRouter.post("/signin", validateBody(signinSchema), signin);
authRouter.post("/signout", signout);
authRouter.get("/ws-ticket", getWsTicket);
authRouter.get("/me", getMe);
authRouter.post("/magic-link", validateBody(magicLinkSchema), sendMagicLink);
authRouter.get("/auth/verify", verifyMagicLink);