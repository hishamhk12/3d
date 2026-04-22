import { z } from "zod";

// ─── Gate form schema ─────────────────────────────────────────────────────────

const nameSchema = z
  .string()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name is too long")
  .trim();

/**
 * Accepts international phone numbers:
 * optional leading +, then 7–15 digits, spaces, dashes, and parentheses.
 * Examples: +966 50 123 4567  |  0501234567  |  +1 (555) 123-4567
 */
const phoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-().]{7,20}$/, "Enter a valid phone number")
  .transform((v) => v.replace(/[\s\-().]/g, ""));

const employeeCodeSchema = z
  .string()
  .min(2, "Employee code must be at least 2 characters")
  .max(50, "Employee code is too long")
  .trim();

export const gateFormSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("customer"),
    name: nameSchema,
    phone: phoneSchema,
  }),
  z.object({
    role: z.literal("employee"),
    name: nameSchema,
    employeeCode: employeeCodeSchema,
  }),
]);

export type GateFormInput = z.infer<typeof gateFormSchema>;
export type GateFormRole = GateFormInput["role"];
