# خرائط رحلة العميل — Room Preview

> **نوع المستند:** رسوم Mermaid تقنية — مبنية على `j.md`  
> **النظام:** Room Preview Showroom  
> **آخر تحديث:** 2026-05-27

---

## 1. الخريطة العامة للنظام

```mermaid
flowchart TD
    A([الشاشة تفتح showroom]) --> B[إنشاء سيشن جديد\ncreated]
    B --> C[waiting_for_mobile\nعرض QR على الشاشة]
    C --> D[العميل يسكان QR بالجوال]
    D --> E[mobile_connected\nالجوال متصل]
    E --> F[العميل يرفع صورة الغرفة]
    F --> G[room_selected\nالغرفة محفوظة]
    G --> H[العميل يسكان QR المنتج]
    H --> I[product_selected\nالمنتج محدد]
    I --> J[POST /render]
    J --> K[ready_to_render\nطلب الرندر مقبول]
    K --> L[rendering\nGemini يعمل]
    L --> M{النتيجة؟}
    M -->|نجاح| N[result_ready\nالصورة جاهزة]
    M -->|فشل| O[failed]
    N --> P[النتيجة تظهر\nعلى الجوال والشاشة]
    P --> Q[completed\nاكتملت التجربة]
    Q --> R([إعادة توجيه Home\nسيشن جديد])
    O --> S[retry UI\nزر إعادة المحاولة]
    S -->|POST /render مجددًا| K
    S -->|رفع صورة أوضح| F
    S -->|اختيار منتج آخر| H
```

---

## 2. رحلة النجاح الكاملة

```mermaid
sequenceDiagram
    actor C as العميل
    participant SC as الشاشة
    participant MB as الجوال
    participant BE as الخادم
    participant ST as R2 Storage
    participant GM as Gemini AI
    participant DG as التشخيص

    SC->>BE: إنشاء سيشن جديد
    BE-->>SC: sessionId · status: waiting_for_mobile
    BE->>DG: session_created · qr_displayed

    C->>SC: يصوّر QR Code
    C->>MB: يفتح /mobile/[sessionId]
    MB->>BE: GET /session
    MB->>BE: POST /connect  (auto-connect)
    BE-->>MB: status: mobile_connected
    BE-->>SC: SSE · session_updated
    BE->>DG: mobile_connected

    C->>MB: يختار صورة الغرفة
    MB->>DG: room_upload_started
    MB->>ST: PUT صورة مباشرة إلى R2
    MB->>BE: POST /confirm-upload
    BE-->>MB: status: room_selected
    BE-->>SC: SSE · session_updated
    BE->>DG: room_upload_completed

    C->>MB: يسكان QR المنتج
    MB->>BE: POST /product (productCode)
    BE-->>MB: status: product_selected
    BE-->>SC: SSE · session_updated
    BE->>DG: product_selected

    C->>MB: يضغط "إنشاء المعاينة"
    MB->>BE: POST /render
    BE-->>MB: 202 Accepted · status: ready_to_render
    BE-->>SC: SSE · session_updated
    BE->>DG: render_requested · render_request_accepted

    Note over BE,GM: executeRenderPipeline() داخل after()
    BE->>DG: render_started
    BE->>DG: gemini_attempt_started (attempt=1, timeoutMs=25000)
    BE->>GM: generateContent(room + product + prompt)\nداخل Promise.race(geminiPromise, timeoutPromise)
    GM-->>BE: صورة مولّدة
    BE->>DG: gemini_attempt_completed (actualDurationMs)
    BE->>ST: رفع النتيجة PNG
    ST-->>BE: imageUrl
    BE->>BE: completeRenderingTransition()
    BE-->>SC: SSE · session_updated (result_ready)
    BE->>DG: render_completed · render_timing_summary

    loop Polling كل 2.5 ثانية
        MB->>BE: GET /session
    end
    BE-->>MB: status: result_ready · renderResult.imageUrl
    MB-->>C: يعرض صورة النتيجة (overlay)
    MB->>DG: result_seen_mobile

    SC-->>C: يعرض Before/After على الشاشة
    SC->>DG: result_displayed_screen

    Note over SC,BE: بعد انتهاء auto-complete timer
    SC->>BE: markSessionCompleted()
    BE-->>SC: status: completed
    BE->>DG: session_completed
    SC->>DG: screen_completion_message_displayed
    SC->>SC: إعادة التوجيه إلى Home
    SC->>DG: screen_completed_redirect_to_home
```

---

## 3. رحلة فشل رفع صورة الغرفة

```mermaid
flowchart TD
    A([العميل يختار صورة]) --> B[compressRoomImage\nضغط تلقائي]
    B --> C[POST requestDirectUploadUrl\nطلب رابط رفع موقّع]
    C --> D{الخادم يرد؟}
    D -->|501 Not Supported\nبيئة dev| E[Fallback: FormData Upload]
    D -->|200 OK| F[PUT مباشر إلى R2]
    F --> G{نتيجة الرفع؟}
    G -->|نجاح| H[POST /confirm-upload]
    H --> I{الخادم يؤكد؟}
    I -->|نجاح| J([room_selected ✅])
    I -->|403 رابط منتهي| K[خطأ: انتهت صلاحية رابط الرفع]
    G -->|فشل شبكة / انقطاع| L[خطأ: network error]
    G -->|413 حجم كبير| M[خطأ: image too large]
    G -->|نوع غير مدعوم| N[خطأ: unsupported type]
    G -->|CORS / R2 500| O[خطأ: R2 PUT failed]

    K --> P[زر: إعادة المحاولة\nretry_upload]
    L --> P
    M --> Q[زر: اختيار صورة أخرى\nimage_too_large]
    N --> P
    O --> P

    P --> R{العميل يختار؟}
    Q --> R
    R -->|إعادة المحاولة| A
    R -->|صورة أخرى| A

    style J fill:#16a34a,color:#fff
    style P fill:#f59e0b,color:#fff
    style Q fill:#f59e0b,color:#fff

    note1[/"❌ لا إعادة توجيه إلى QR\n✅ البقاء في خطوة الرفع"/]
```

---

## 4. رحلة فشل QR المنتج / اختيار المنتج

```mermaid
flowchart TD
    A([خطوة اختيار المنتج]) --> B{طريقة الاختيار؟}

    B -->|مسح QR المنتج| C{إذن الكاميرا؟}
    C -->|مرفوض| D[رسالة: اسمح للتطبيق باستخدام الكاميرا]
    C -->|مسموح| E[مسح QR]
    E --> F{تم التعرف على الرمز؟}
    F -->|لا - ضوء سيء / ضبابي| G[رسالة: تعذر قراءة الرمز]
    F -->|نعم| H[POST /products?code=...]

    B -->|إدخال يدوي| H
    B -->|قائمة المنتجات| I[ProductStep Fallback\nاختيار من القائمة]
    I --> H

    H --> J{المنتج موجود؟}
    J -->|نعم| K[POST /product → product_selected]
    K --> L([product_selected ✅])
    J -->|404 غير موجود| M[رسالة: لم نتعرف على هذا المنتج]
    H --> N{شبكة / خطأ خادم؟}
    N -->|نعم| O[رسالة: تعذر الاتصال]

    D --> P[زر: اختيار من القائمة\nsetUseProductListFallback]
    G --> Q[زر: مسح مجددًا / إدخال يدوي]
    M --> Q
    O --> R[زر: إعادة المحاولة]

    P --> I
    Q --> B
    R --> H

    style L fill:#16a34a,color:#fff
    style D fill:#ef4444,color:#fff
    style M fill:#ef4444,color:#fff
    style O fill:#ef4444,color:#fff

    note1[/"❌ لا ينتقل لـ product_selected حتى ينجح POST /product\n✅ يبقى في خطوة المنتج مع إمكانية الإعادة"/]
```

---

## 5. رحلة الرندر الناجح

```mermaid
flowchart TD
    A([product_selected]) --> B[العميل يضغط إنشاء المعاينة]
    B --> C[POST /render]
    C --> D{التحقق من الحالة؟}
    D -->|session expired| Z1[410 Expired]
    D -->|session not found| Z2[404 Not Found]
    D -->|render in flight| Z3[429 Already Rendering]
    D -->|device cooldown| Z4[429 Device Cooldown]
    D -->|limit reached| Z5[429 Render Limit Reached]
    D -->|OK| E[tryIncrementRenderCount]
    E --> F[markReadyToRenderTransition]
    F --> G[202 Accepted ← الخادم يرد]
    G --> H[[حدث: render_request_accepted\nوليس Render Success]]
    H --> I[ready_to_render]
    I --> J[executeRenderPipeline - after]
    J --> K[startRenderingTransition\nالحالة: rendering]
    K --> L[[حدث: render_started\ngemini_attempt_started attempt=1]]
    L --> M[Promise.race\ngeminiPromise vs timeoutPromise 25s]
    M -->|Gemini ينجح خلال 25s| N[gemini_attempt_completed]
    N --> O[validateAndNormalizeOutputImage\nالتحقق من الأبعاد والحجم]
    O --> P[storageUpload → R2]
    P --> Q[completeRenderingTransition]
    Q --> R[result_ready]
    R --> S[[حدث: render_completed\nrender_timing_summary]]
    S --> T[الجوال يكتشف result_ready عبر Polling]
    T --> U[الشاشة تستقبل SSE result_ready]
    U --> V([النتيجة على الجوال والشاشة ✅])

    style G fill:#3b82f6,color:#fff
    style H fill:#f59e0b,color:#000
    style R fill:#16a34a,color:#fff
    style V fill:#16a34a,color:#fff
    style Z1 fill:#ef4444,color:#fff
    style Z2 fill:#ef4444,color:#fff
    style Z3 fill:#ef4444,color:#fff
    style Z4 fill:#ef4444,color:#fff
    style Z5 fill:#ef4444,color:#fff
```

---

## 6. رحلة فشل الرندر

```mermaid
flowchart TD
    A([rendering]) --> B{نوع الفشل؟}

    B -->|Gemini 5xx / 429 قابل للإعادة| C[إعادة المحاولة تلقائيًا\nحتى MAX_RETRIES=3\nتأخير تصاعدي BASE_DELAY=3s]
    C --> D{نجحت المحاولة؟}
    D -->|نعم| E([result_ready ✅])
    D -->|لا - فشلت كل المحاولات| F[failRenderingTransition]

    B -->|Gemini timeout\nراجع القسم 7| G[GeminiTimeoutError\ncode: GEMINI_TIMEOUT\nretryable: true]
    G --> F

    B -->|فشل رفع النتيجة storageUpload| H[خطأ تخزين]
    H --> F

    B -->|مخرجات صغيرة جدًا < 10KB| I[فشل التحقق من الحجم]
    I --> F

    B -->|نسبة أبعاد مختلفة > 5%| J{محاولة أولى؟}
    J -->|نعم| K[retry with strict prompt\nAspectRatioMismatchError]
    K --> D
    J -->|لا - فشل مرة ثانية| F

    B -->|SENTINEL_FLOOR_NOT_VISIBLE| L[الأرضية غير ظاهرة]
    L --> F
    B -->|SENTINEL_MATERIAL_UNCLEAR| M[مادة المنتج غير واضحة]
    M --> F

    F --> N[failed\nفشل الرندر]
    N --> O[decrementRenderCount\nيُعاد العداد]
    O --> P[[يُظهر الجوال:\nشريط خطأ + retry UI\nResultStep يبقى مرئيًا\nProductQrStep يختفي]]

    P --> Q{اختيار العميل؟}
    Q -->|إعادة المحاولة\nretry_render| R[POST /render مجددًا\nfailed → ready_to_render]
    Q -->|رفع صورة أوضح\nretake_room_photo| S[handleRetakeRoomPhoto\nclear selectedRoom\nroom_selected]
    Q -->|اختيار منتج آخر| T[مسح QR منتج جديد\nproduct_selected]

    R --> A
    S --> U([خطوة رفع الصورة])
    T --> V([خطوة المنتج])

    style E fill:#16a34a,color:#fff
    style N fill:#ef4444,color:#fff
    style P fill:#f59e0b,color:#000

    note1[/"❌ لا إعادة توجيه إلى QR بعد فشل الرندر\n✅ ResultStep مرئي · retry UI ظاهر"/]
```

---

## 7. رحلة Gemini Timeout

```mermaid
flowchart TD
    A([rendering يبدأ]) --> B[gemini_attempt_started\nattempt=1\ntimeoutMs=FIRST_ATTEMPT_TIMEOUT_MS\nافتراضي: 25000ms]

    B --> C[Promise.race\ngeminiPromise vs timeoutPromise]

    C -->|Gemini ينجح خلال 25s| D[gemini_attempt_completed\nattempt=1\nactualDurationMs]
    D --> E([result_ready ✅\nالمسار الناجح])

    C -->|بعد 25 ثانية: timeoutPromise يربح| F[GeminiTimeoutError\nname: GeminiTimeoutError\ncode: GEMINI_TIMEOUT\nretryable: true]
    F --> G[gemini_attempt_timeout\nattempt=1\nactualDurationMs=25000\naction: retrying_with_reduced_dimensions]

    G --> H[إعادة تحميل الصور بأبعاد أصغر\n1024px بدلًا من 1280px\n640px للمنتج بدلًا من 768px]
    H --> I[gemini_attempt_started\nattempt=2\ntimeoutMs=RETRY_ATTEMPT_TIMEOUT_MS\nافتراضي: 90000ms]

    I --> J[Promise.race\ngeminiPromise vs timeoutPromise]

    J -->|Gemini ينجح خلال 90s| K[gemini_attempt_completed\nattempt=2\nactualDurationMs]
    K --> E

    J -->|بعد 90 ثانية: timeout| L[GeminiTimeoutError\nattempt=2]
    L --> M[gemini_attempt_timeout\nattempt=2\naction: giving_up]
    M --> N[failRenderingTransition\nfailed]
    N --> O[الجوال يعرض:\nشريط خطأ + retry UI]

    O --> P{render_limit_reached؟}
    P -->|لا - محاولات متبقية| Q[زر: إعادة المحاولة\nretry_render\nPOST /render مجددًا]
    P -->|نعم - تجاوز الحد| R[رسالة:\nفشل التصميم مرتين\nيرجى رفع صورة غرفة أوضح\nأو اختيار منتج آخر\nزر: retake_room_photo]

    Q --> A
    R --> S([خطوة رفع الصورة])

    subgraph ENV [المتغيرات البيئية]
        direction LR
        T1[ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS\nافتراضي: 25000ms · نطاق: 5000–120000]
        T2[ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS\nافتراضي: 90000ms · نطاق: 30000–240000]
    end

    subgraph ENFORCE [آلية الفرض]
        direction LR
        U1[Promise.race garanteed timeout\nAbortController for SDK cleanup only\nلا يعتمد على AbortController وحده]
    end

    style E fill:#16a34a,color:#fff
    style N fill:#ef4444,color:#fff
    style F fill:#ef4444,color:#fff
    style L fill:#ef4444,color:#fff
    style R fill:#f59e0b,color:#000
```

---

## 8. رحلة Hedged Rendering المقترحة

> **ملاحظة:** هذا تصميم مقترح لتحسين مستقبلي، غير مُطبَّق حاليًا.
> الهدف: تقليل وقت الانتظار بتشغيل محاولتين متوازيتين، الأولى تفوز.

```mermaid
flowchart TD
    A([rendering يبدأ]) --> B[attempt 1 يبدأ فورًا\ntimeoutMs=FIRST_ATTEMPT_TIMEOUT_MS]

    B --> C{بعد HEDGE_DELAY_MS\nالمحاولة 1 لا تزال pending؟}
    C -->|نعم - بطيئة| D[attempt 2 يبدأ موازيًا\nأبعاد أصغر · RETRY_ATTEMPT_TIMEOUT_MS]
    C -->|لا - اكتملت| E

    B --> E{أول نتيجة ناجحة}
    D --> E

    E -->|المحاولة 1 تنجح أولًا| F[قبول نتيجة المحاولة 1]
    E -->|المحاولة 2 تنجح أولًا| G[قبول نتيجة المحاولة 2]

    F --> H{التحقق من صلاحية الحالة}
    G --> H

    H -->|session لا تزال rendering\nو renderJobId متطابق| I[completeRenderingTransition\nresult_ready]
    H -->|session تغيرت / job قديم\nنتيجة متأخرة stale result| J[تجاهل النتيجة\nignore stale result\nلا overwrite]

    I --> K([result_ready ✅])

    subgraph RULES [قواعد الحماية الإلزامية]
        direction TB
        R1[✅ فقط أول نتيجة ناجحة تُقبل]
        R2[✅ النتيجة الخاسرة تُتجاهل حتى لو وصلت لاحقًا]
        R3[✅ stale result لا تُعيد الكتابة على result_ready]
        R4[✅ السيشن يجب أن يكون لا يزال rendering]
        R5[✅ renderJobId يجب أن يطابق أحدث job]
        R6[✅ AbortController للمحاولة الخاسرة لتنظيف HTTP]
    end

    style K fill:#16a34a,color:#fff
    style J fill:#94a3b8,color:#fff
    style I fill:#16a34a,color:#fff
```

---

## 9. رحلة انتهاء السيشن (Expired)

```mermaid
flowchart TD
    A([سيشن نشط]) --> B{انتهت المدة\nعادةً 30 دقيقة؟}
    B -->|لا| A
    B -->|نعم| C[الخادم يُعلّم السيشن expired]
    C --> D[[حدث: session_expired]]

    C --> E[الشاشة تستقبل SSE expired]
    E --> F[الشاشة تعرض رسالة انتهاء السيشن]
    F --> G[الشاشة تُنشئ سيشن جديد]
    G --> H([QR جديد على الشاشة ✅])

    C --> I[الجوال:\nclient-side expiry timer يُطلق]
    I --> J[viewState = expired\nرسالة: انتهت صلاحية هذا الرابط]
    J --> K[زر: بدء جلسة جديدة → Landing page]

    subgraph ALLOWED [✅ متى يُسمح بإعادة التوجيه إلى QR/start؟]
        direction TB
        A1[expired — انتهت مدة السيشن]
        A2[completed — اكتملت التجربة بعد عرض النتيجة]
        A3[not_found — sessionId غير موجود]
        A4[expired token — رمز التفعيل منتهي أو مستخدم]
        A5[explicit reset — العميل ضغط بدء جلسة جديدة]
    end

    subgraph DENIED [❌ متى لا يُسمح بإعادة التوجيه؟]
        direction TB
        D1[failed — فشل رندر · يجب عرض retry UI]
        D2[render_timeout — فشل Gemini · يجب عرض retry UI]
        D3[upload_failed — فشل رفع · يبقى في خطوة الرفع]
        D4[product error — خطأ في المنتج · يبقى في خطوة المنتج]
        D5[network error — خطأ شبكة مؤقت · إعادة المحاولة]
    end

    style H fill:#16a34a,color:#fff
    style K fill:#f59e0b,color:#000
```

---

## 10. رحلة فشل الاتصال SSE / Realtime

```mermaid
flowchart TD
    A([الشاشة متصلة بـ SSE]) --> B{SSE ينقطع؟}
    B -->|لا| A
    B -->|نعم| C[[حدث: sse_disconnected]]
    C --> D[تفعيل Fallback Polling\nاستطلاع كل 3-5 ثوانٍ]
    D --> E[[حدث: fallback_polling_started]]

    D --> F{نتيجة الاستطلاع؟}
    F -->|result_ready| G[الشاشة تعرض النتيجة ✅]
    F -->|failed| H[الشاشة تعرض حالة الفشل]
    F -->|expired| I[الشاشة تعرض انتهاء الجلسة]
    F -->|completed| J[الشاشة تعرض الاكتمال وتُعيد التوجيه]
    F -->|SSE أعيد الاتصال| K[[حدث: sse_reconnected\nfallback_polling_stopped]]
    K --> A

    A2([الجوال - Heartbeat]) --> B2{Heartbeat يفشل\nمتكرر؟}
    B2 -->|لا| A2
    B2 -->|نعم| C2[شريط تحذير:\nيبدو أن الاتصال ضعيف\nنحاول إعادة الاتصال...]
    C2 --> D2[[حدث: weak_connection_warning_shown]]
    D2 --> E2{الجلسة تنتهي؟}
    E2 -->|لا| F2[الجوال يستمر Polling\nالتجربة لا تنقطع]
    E2 -->|نعم expired/completed/failed| G2[Heartbeat يتوقف تلقائيًا]

    A3([Redis غير متاح]) --> B3[SSE / Heartbeat يفشل]
    B3 --> C3[Polling من قاعدة البيانات مباشرة]
    C3 --> D3[الرندر يستمر لا يعتمد على Redis\nللعملية الأساسية]

    style G fill:#16a34a,color:#fff
    note1[/"✅ SSE failure لا يكسر التجربة أبدًا\n✅ Polling يكفل اكتشاف جميع الحالات النهائية"/]
```

---

## 11. رحلة Back Button / Reload

```mermaid
flowchart TD
    subgraph BACK [Back Button — زر الرجوع]
        A([العميل يضغط Back]) --> B[popstate handler يعترض الحدث]
        B --> C[window.history.pushState — إعادة تثبيت guard]
        C --> D[[حدث: back_pressed]]
        D --> E[fetchRoomPreviewSession\nجلب أحدث حالة للسيشن]
        E --> F{حالة السيشن؟}
        F -->|expired / completed| G[viewState = expired\nرسالة انتهاء الصلاحية]
        F -->|failed| H[viewState = ready\nrecovery = retry_render\nزر إعادة المحاولة]
        F -->|result_ready| I[viewState = ready\nshowResult = true\nعرض النتيجة]
        F -->|product_selected أو غيرها| J[viewState = ready\nخطوة المنتج / الرندر]
        F -->|خطأ شبكة| K[البقاء في الحالة الحالية بصمت]
        G --> L[رسالة مؤقتة:\nأعدناك إلى الخطوة الصحيحة]
        H --> L
        I --> L
        J --> L
    end

    subgraph RELOAD [إعادة تحميل الصفحة]
        M([العميل يُعيد تحميل الصفحة]) --> N[SSR: gate check]
        N -->|gate_ok cookie موجود| O[يدخل مباشرة بدون إعادة فحص]
        N -->|cookie غير موجود| P[إعادة توجيه إلى gate]
        O --> Q[loadSession\nجلب السيشن]
        Q --> R[auto-connect إذا لزم]
        R --> S{حالة السيشن؟}
        S -->|نشط| T[viewState = ready\nخطوة المناسبة]
        S -->|failed| U[viewState = ready\nretry UI مرئي]
        S -->|expired| V[viewState = expired]
        T --> W[[حدث: mobile_rapid_reload_detected\nإذا تكررت الإعادة]]
    end

    subgraph HIDDEN [الصفحة مخفية - Page Hidden]
        X([تطبيق يذهب للخلفية]) --> Y[[حدث: mobile_page_hidden]]
        Y --> Z[Polling يُبطّئ ×4 للبطارية]
        Z --> AA([العميل يعود])
        AA --> BB[[حدث: mobile_page_visible]]
        BB --> CC[Polling يعود لسرعته الطبيعية]
        CC --> DD[sendBeacon: mobile_pagehide]
    end

    style H fill:#f59e0b,color:#000
    style U fill:#f59e0b,color:#000
    note1[/"❌ Back بعد فشل الرندر لا يُعيد المستخدم إلى QR أبدًا"/]
```

---

## 12. خريطة State Machine الكاملة

```mermaid
stateDiagram-v2
    [*] --> created : إنشاء السيشن

    created --> waiting_for_mobile : الشاشة تعرض QR

    waiting_for_mobile --> mobile_connected : العميل يفتح QR\nPOST /connect

    mobile_connected --> room_selected : رفع صورة الغرفة\nPOST /room

    room_selected --> product_selected : اختيار المنتج\nPOST /product

    product_selected --> ready_to_render : POST /render\n202 Accepted

    ready_to_render --> rendering : executeRenderPipeline\nبدء في after()

    rendering --> result_ready : completeRenderingTransition\nimageUrl موجود ✅

    rendering --> failed : failRenderingTransition\nGemini error / timeout

    failed --> ready_to_render : POST /render مجددًا\nإعادة المحاولة

    failed --> product_selected : اختيار منتج مجددًا

    failed --> room_selected : retake_room_photo\nمسح selectedRoom

    result_ready --> product_selected : تعديل - Modify\nhandleProductSelect

    result_ready --> completed : auto-complete timer\nmarkSessionCompleted

    completed --> [*] : إعادة التوجيه Home\nسيشن جديد

    created --> expired : انتهاء المدة
    waiting_for_mobile --> expired : انتهاء المدة
    mobile_connected --> expired : انتهاء المدة
    room_selected --> expired : انتهاء المدة
    product_selected --> expired : انتهاء المدة
    ready_to_render --> expired : انتهاء المدة
    rendering --> expired : انتهاء المدة
    result_ready --> expired : انتهاء المدة

    expired --> [*] : رسالة انتهاء الصلاحية\nبدء جلسة جديدة

    note right of failed : يمكن الانتقال من failed\nإلى ready_to_render مباشرة\nبدون المرور بـ product_selected
    note right of rendering : stuck > 8 دقائق →\nrecoverStuckRenderJob()\n→ failed تلقائيًا
```

---

## 13. خريطة قرارات Redirect إلى QR/Start

```mermaid
flowchart TD
    A([أحدث حالة للسيشن؟]) --> B{الحالة}

    B -->|expired| C[✅ إعادة التوجيه مسموحة\nمبرر: الجلسة انتهت]
    B -->|completed| D{هل عُرضت النتيجة؟}
    D -->|نعم| E[✅ إعادة التوجيه مسموحة\nمبرر: اكتملت التجربة]
    D -->|لا| F[⏳ انتظار عرض النتيجة أولًا]

    B -->|not_found| G[✅ إعادة التوجيه مسموحة\nمبرر: sessionId غير موجود]
    B -->|expired token| H[✅ إعادة التوجيه مسموحة\nمبرر: رمز التفعيل منتهي]
    B -->|explicit reset| I[✅ إعادة التوجيه مسموحة\nمبرر: العميل ضغط بدء جديد]

    B -->|failed| J[❌ لا توجيه إلى QR\nعرض retry UI\nResultStep مرئي]
    B -->|product_selected| K[❌ لا توجيه إلى QR\nعرض خطوة الرندر/المنتج]
    B -->|ready_to_render| L[❌ لا توجيه إلى QR\nعرض شاشة الانتظار]
    B -->|rendering| M[❌ لا توجيه إلى QR\nعرض مؤشر التقدم]
    B -->|result_ready| N[❌ لا توجيه إلى QR\nعرض النتيجة]
    B -->|upload_failed| O[❌ لا توجيه إلى QR\nالبقاء في خطوة الرفع + retry]
    B -->|product_error| P[❌ لا توجيه إلى QR\nالبقاء في خطوة المنتج + retry]
    B -->|network_error| Q[❌ لا توجيه إلى QR\nشريط تحذير + إعادة المحاولة]

    style C fill:#16a34a,color:#fff
    style E fill:#16a34a,color:#fff
    style G fill:#16a34a,color:#fff
    style H fill:#16a34a,color:#fff
    style I fill:#16a34a,color:#fff
    style J fill:#ef4444,color:#fff
    style K fill:#ef4444,color:#fff
    style L fill:#ef4444,color:#fff
    style M fill:#ef4444,color:#fff
    style N fill:#ef4444,color:#fff
    style O fill:#ef4444,color:#fff
    style P fill:#ef4444,color:#fff
    style Q fill:#ef4444,color:#fff
```

---

## 14. Checklist سريع — قواعد لا تُكسر

```mermaid
flowchart LR
    subgraph RULES [قواعد النظام الصارمة]
        direction TB
        R1["❌ لا QR بعد failed render\nshould​ShowProductQrStep يشترط status ≠ failed"]
        R2["❌ لا Render Completed بدون result_ready + outputImageUrl\ncompleteRenderingTransition فقط مع imageUrl صالح"]
        R3["❌ لا Render Success عند 202 Accepted\nالحدث الصحيح: render_request_accepted فقط"]
        R4["❌ لا rendering للأبد\n> 8 دقائق → recoverStuckRenderJob() → failed"]
        R5["✅ Timeout ظاهر في diagnostics\ngemini_attempt_timeout مع: attempt · timeoutMs · actualDurationMs"]
        R6["✅ Late Gemini result يُتجاهل\nstale result لا تُعيد الكتابة على result_ready"]
        R7["✅ Retry UI يظهر بعد كل فشل\nResultStep مرئي · recoveryMessage ≠ null"]
        R8["✅ Fallback Polling عند انقطاع SSE\nلا تتوقف التحديثات أبدًا"]
        R9["✅ Back button يُعيد للخطوة الصحيحة\nfailed → ready + retry_render · لا SessionStatePanel"]
        R10["✅ Gate check مرة واحدة فقط\nSSR + cookie gate_ok_{sessionId}"]
    end
```

---

*خرائط Mermaid — Room Preview — 2026-05-27 — مبنية على `j.md`*
