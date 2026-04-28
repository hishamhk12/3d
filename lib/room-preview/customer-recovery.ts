import type { CustomerMessageKey } from "@/lib/room-preview/issue-catalog";

export type CustomerRecoveryCtaIntent =
  | "retry_upload"
  | "retry_render"
  | "reload_page"
  | "retake_room_photo"
  | "reconnect_mobile";

export type CustomerRecoveryMessage = {
  ctaIntent: CustomerRecoveryCtaIntent;
  ctaText: string;
  text: string;
};

export const CUSTOMER_RECOVERY_MESSAGES: Record<CustomerMessageKey, CustomerRecoveryMessage> = {
  retry_upload: {
    ctaIntent: "retry_upload",
    ctaText: "إعادة المحاولة",
    text: "تعذر رفع الصورة. يرجى المحاولة مرة أخرى.",
  },
  retry_render: {
    ctaIntent: "retry_render",
    ctaText: "إعادة المعالجة",
    text: "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة.",
  },
  reload_page: {
    ctaIntent: "reload_page",
    ctaText: "إعادة تحميل الصفحة",
    text: "حدثت مشكلة مؤقتة. يرجى إعادة تحميل الصفحة.",
  },
  retake_room_photo: {
    ctaIntent: "retake_room_photo",
    ctaText: "اختيار صورة أخرى",
    text: "الصورة غير مناسبة للمعاينة. يرجى رفع صورة تُظهر الأرضية بوضوح.",
  },
  reconnect_mobile: {
    ctaIntent: "reconnect_mobile",
    ctaText: "إعادة الاتصال",
    text: "تعذر الاتصال بالجلسة. يرجى فتح رمز QR مرة أخرى.",
  },
};

export function getCustomerRecoveryMessage(key: CustomerMessageKey | null | undefined) {
  return key ? CUSTOMER_RECOVERY_MESSAGES[key] : null;
}
