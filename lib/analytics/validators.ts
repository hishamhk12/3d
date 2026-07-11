import { z } from "zod";

// ─── Shared field schemas ──────────────────────────────────────────────────────

const nameSchema = z
  .string()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name is too long")
  .trim();

/** Local phone number (without country code). Digits, spaces, dashes allowed. */
const phoneLocalSchema = z
  .string()
  .regex(/^[\d\s\-()+.]{5,20}$/, "Enter a valid phone number");

const dialCodeSchema = z
  .string()
  .regex(/^\+\d{1,4}$/, "Invalid dial code");

const countryCodeSchema = z.string().min(2).max(2);

const employeeCodeSchema = z
  .string()
  .min(2, "Employee code must be at least 2 characters")
  .max(50, "Employee code is too long")
  .trim();

// ─── Gate form schema ─────────────────────────────────────────────────────────

export const gateFormSchema = z.discriminatedUnion("flow", [
  /** First-time customer — creates or refreshes Customer record. */
  z.object({
    flow: z.literal("customer_new"),
    name: nameSchema,
    countryCode: countryCodeSchema,
    dialCode: dialCodeSchema,
    phone: phoneLocalSchema,
  }),

  /** Returning customer lookup — no UserSession created yet, just phone lookup. */
  z.object({
    flow: z.literal("customer_existing"),
    countryCode: countryCodeSchema,
    dialCode: dialCodeSchema,
    phone: phoneLocalSchema,
  }),

  /** Confirm step after phone lookup found a customer. Creates UserSession + binds. */
  z.object({
    flow: z.literal("customer_confirm"),
    customerId: z.string().min(1),
    name: z.string().min(1),
  }),

  z.object({
    flow: z.literal("employee"),
    name: nameSchema,
    employeeCode: employeeCodeSchema,
  }),
]);

export type GateFormInput = z.infer<typeof gateFormSchema>;
export type GateFormFlow = GateFormInput["flow"];
