"use client";

export type StatusValue = "healthy" | "degraded" | "unavailable" | "disabled" | "not_configured";

export interface StatusComponent {
  status: StatusValue;
}

export interface AdminChatbotStatus {
  checkedAt: string;
  fastapi: StatusComponent & { reachable: boolean };
  database: StatusComponent & { reachable: boolean | null };
  gemini: StatusComponent & { configured: boolean | null };
  inventory: StatusComponent & { rowCount: number | null };
  imports: StatusComponent & { latestSuccessfulImportAt: string | null };
  dataSource: StatusComponent & { current: "excel" };
  sap: StatusComponent & { configured: false };
  features: {
    sellerChat: StatusComponent & { enabled: boolean };
    autocomplete: StatusComponent & { enabled: boolean | null };
    technicalDocuments: StatusComponent & { enabled: boolean | null };
    voice: StatusComponent & { enabled: boolean | null };
    webKnowledge: StatusComponent & { enabled: boolean | null };
  };
  local: StatusComponent & {
    sellerCount: number | null;
    showroomCount: number | null;
    sellerChatEnabled: boolean;
  };
}

export interface StatusState {
  status: AdminChatbotStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

