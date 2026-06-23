# مخطط معمارية النظام

```mermaid
flowchart TD
    SCREEN["شاشة المعرض"]
    MOBILE["جوال العميل"]
    SELLER["متصفح البائع"]

    subgraph APP["تطبيق Next.js (الواجهة + API)"]
      RP["Room Preview"]
      SC["Seller Chat"]
      ADM["Admin"]
    end

    PG[("PostgreSQL")]
    RED[("Redis")]
    R2[("Object Storage / R2")]
    GEM["Google Gemini"]
    FA["FastAPI (Seller Chat backend)"]
    GH["GitHub + بيئة النشر"]
    SAP["SAP (تكامل مستقبلي)"]

    SCREEN --> APP
    MOBILE --> APP
    SELLER --> APP

    RP --> PG
    RP --> RED
    MOBILE -. "رفع مباشر Presigned" .-> R2
    RP --> R2
    RP --> GEM
    SC --> FA
    ADM --> FA
    APP --> PG

    GH -. "نشر/تحديث" .-> APP
    FA -. "مستقبلاً" .-> SAP

    style SAP stroke-dasharray: 5 5
```

## شرح الاتصالات
| # | من | إلى | الغرض | الحالة |
| - | --- | --- | ----- | ------ |
| 1 | شاشة المعرض / جوال العميل / البائع | تطبيق Next.js | الوصول للواجهة عبر HTTPS | حالي |
| 2 | Room Preview | PostgreSQL | تخزين جلسات وبيانات المعاينة | حالي |
| 3 | Room Preview | Redis | حدود الطلبات + أقفال التوليد + الأحداث اللحظية | حالي |
| 4 | جوال العميل | Object Storage (R2) | رفع صورة الغرفة مباشرة عبر Presigned URL | حالي |
| 5 | Room Preview | Object Storage (R2) | حفظ/قراءة نتائج المعاينة | حالي |
| 6 | Room Preview | Google Gemini | توليد صورة المعاينة بالذكاء الاصطناعي | حالي |
| 7 | Seller Chat | FastAPI | استعلام المخزون واقتراح الأكواد (خادم‑لخادم) | حالي |
| 8 | Admin | FastAPI | استيراد المخزون وحالة/مقاييس الشات | حالي |
| 9 | GitHub + بيئة النشر | تطبيق Next.js | النشر والتحديث | حالي (التفاصيل تحتاج تأكيد من فريق IT) |
| 10 | FastAPI | SAP | مصدر مخزون معتمد | **مستقبلي — غير مطبّق** |

> ملاحظة: المتصفح لا يتصل بـFastAPI ولا Gemini ولا الأسرار مباشرة؛ كل ذلك عبر خادم Next.js.
