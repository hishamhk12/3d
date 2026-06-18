// Zod schema for the seller-chat proxy payload. Mirrors the existing chatbot
// `/internal/chat` contract (question + style) so the future copied UI stays
// compatible. `.strict()` REJECTS any extra keys — so a browser cannot smuggle
// sellerId / showroomId / actorType / role: identity is taken ONLY from the
// verified seller session, never from the body.
import { z } from "zod";

export const MAX_QUESTION_LENGTH = 500;

export const sellerChatSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, "السؤال مطلوب")
      .max(MAX_QUESTION_LENGTH, "السؤال طويل جداً"),
    // Tone/verbosity only — never affects inventory facts. Allowlisted values
    // match the FastAPI/chatbot contract; defaults to balanced.
    style: z.enum(["creative", "balanced", "precise"]).default("balanced"),
  })
  .strict();

export type SellerChatInput = z.infer<typeof sellerChatSchema>;
