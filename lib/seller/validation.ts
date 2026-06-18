// Zod schema for the seller login payload. Codes are normalized to their
// canonical form (trim + uppercase) AS PART of parsing, so the route always
// works with normalized values. Password length is validated by UTF-8 BYTE
// length (bcrypt's real limit), not character count.
import { z } from "zod";
import { normalizeCode } from "./codes";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  passwordByteLength,
} from "./password";

const codeField = z
  .string()
  .trim()
  .min(1, "هذا الحقل مطلوب")
  .transform(normalizeCode)
  .refine((c) => c.length > 0 && !/\s/.test(c), "صيغة الرمز غير صحيحة");

export const sellerLoginSchema = z.object({
  sellerCode: codeField,
  showroomCode: codeField,
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, "كلمة المرور قصيرة جداً")
    .refine(
      (p) => passwordByteLength(p) <= MAX_PASSWORD_BYTES,
      "كلمة المرور طويلة جداً",
    ),
});

export type SellerLoginInput = z.infer<typeof sellerLoginSchema>;
