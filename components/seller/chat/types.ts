// Shared message types for the seller-chat UI. Trimmed from the chatbot's
// ChatClient Message type: NO technicalSources, NO voice — inventory only.
import type { InventoryDTO } from "@/lib/seller/chat/inventory-types";

export type ChatErrorKind = "retry" | "session" | "generic";

export interface ChatErrorState {
  kind: ChatErrorKind;
  /** The original question, so a retry repeats the exact request. */
  question: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text?: string;
  cards?: InventoryDTO[];
  /** Inline validation/non-recoverable error rendered as a tinted bubble. */
  isError?: boolean;
  mode?: "ai" | "deterministic";
  /** Recoverable transport/server failure → compact state with optional retry. */
  errorState?: ChatErrorState;
}
