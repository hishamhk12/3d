// Zod schemas for the admin Chatbot seller/showroom management APIs. Codes are
// normalized with the SAME production helpers used by seller login/creation, so
// the unique constraint and lookups always agree. Passwords are validated by
// UTF-8 byte length (bcrypt's real limit). The browser can never set tokenVersion,
// role, identity, or a password hash - only the fields below.
import { z } from "zod";
import { normalizeSellerCode, normalizeShowroomCode } from "@/lib/seller/codes";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordByteLength } from "@/lib/seller/password";

const sellerCodeField = z
  .string()
  .trim()
  .min(1, "Seller code is required")
  .transform(normalizeSellerCode)
  .refine((c) => c.length > 0 && !/\s/.test(c), "Invalid seller code format");

const showroomCodeField = z
  .string()
  .trim()
  .min(1, "Showroom code is required")
  .transform(normalizeShowroomCode)
  .refine((c) => c.length > 0 && !/\s/.test(c), "Invalid showroom code format");

const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, "Password is too short")
  .refine((p) => passwordByteLength(p) <= MAX_PASSWORD_BYTES, "Password is too long");

const nameField = z.string().trim().min(1, "Name is required").max(100, "Name is too long");

export const createSellerSchema = z
  .object({
    name: nameField,
    sellerCode: sellerCodeField,
    showroomId: z.string().trim().min(1, "Showroom is required"),
    password: passwordField,
    status: z.enum(["active", "disabled"]).default("disabled"),
  })
  .strict();

// Discriminated by `action`. Each action carries ONLY its safe fields; the
// browser cannot send tokenVersion / role / status directly.
export const updateSellerSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update_profile"),
      name: nameField.optional(),
      showroomId: z.string().trim().min(1).optional(),
    })
    .strict()
    .refine((d) => d.name !== undefined || d.showroomId !== undefined, {
      message: "Nothing to update",
    }),
  z.object({ action: z.literal("activate") }).strict(),
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("reset_password"), password: passwordField }).strict(),
  z.object({ action: z.literal("force_logout") }).strict(),
]);

export const createShowroomSchema = z
  .object({ name: nameField, code: showroomCodeField })
  .strict();

export const updateShowroomSchema = z
  .object({ name: nameField.optional(), code: showroomCodeField.optional() })
  .strict()
  .refine((d) => d.name !== undefined || d.code !== undefined, {
    message: "Nothing to update",
  });

export type CreateSellerInput = z.infer<typeof createSellerSchema>;
export type UpdateSellerInput = z.infer<typeof updateSellerSchema>;
export type CreateShowroomInput = z.infer<typeof createShowroomSchema>;
export type UpdateShowroomInput = z.infer<typeof updateShowroomSchema>;
