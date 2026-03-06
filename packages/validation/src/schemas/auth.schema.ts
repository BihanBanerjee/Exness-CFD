import { z } from "zod";

// Signup request body
export const signupSchema = z.object({
  email: z.string()
    .email({ message: "Invalid email address" })
    .toLowerCase()
    .trim(),

  phone: z.number()
    .int({ message: "Phone must be an integer" })
    .positive({ message: "Phone must be positive" }),

  password: z.string()
    .min(6, { message: "Password must be at least 6 characters" })
    .max(100, { message: "Password too long" })
});

// Signin request body
export const signinSchema = z.object({
  email: z.string()
    .email({ message: "Invalid email address" })
    .toLowerCase()
    .trim(),

  password: z.string()
    .min(1, { message: "Password is required" })
});

// Magic link request body
export const magicLinkSchema = z.object({
  email: z.string()
    .email({ message: "Invalid email address" })
    .toLowerCase()
    .trim(),
});

// Export inferred types
export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
