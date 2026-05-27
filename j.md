# رحلة العميل الكاملة — Room Preview

> **نوع المستند:** وثيقة تقنية وUX للمطورين وفريق QA والمنتج  
> **النظام:** Room Preview Showroom  
> **آخر تحديث:** 2026-05-27

---

## 1. الهدف من النظام

نظام Room Preview يتيح للعميل في صالة العرض رؤية كيف يبدو منتج الأرضيات في غرفته الحقيقية قبل الشراء.

**الآلية:**
1. تعرض شاشة المتجر (كيوسك) رمز QR يخص سيشن حالي.
2. العميل يفتح الرمز بجواله فيتصل الجوال بالسيشن.
3. العميل يصوّر غرفته من الجوال.
4. يختار منتج أرضيات (بسكان QR المنتج أو يدويًا).
5. النظام يرسل صورة الغرفة والمنتج إلى Gemini AI ليولّد صورة مدمجة.
6. النتيجة تظهر على الجوال وعلى شاشة المتجر في الوقت الفعلي.

**المكونات الرئيسية:**
- **Screen (الشاشة):** واجهة الكيوسك في المتجر، تتلقى التحديثات عبر SSE.
- **Mobile (الجوال):** تطبيق ويب يفتحه العميل، يتواصل عبر Polling.
- **Backend:** Next.js API routes، قاعدة بيانات PostgreSQL، Redis، تخزين R2/S3.
- **Gemini AI:** موفر توليد الصور.

---

## 2. الحالات الأساسية للسيشن

| الحالة | المعنى |
|---|---|
| `created` | تم إنشاء السيشن، لم يتصل جوال بعد |
| `waiting_for_mobile` | الشاشة تنتظر العميل يفتح QR |
| `mobile_connected` | العميل فتح QR والجوال اتصل بالسيشن |
| `room_selected` | العميل رفع صورة الغرفة بنجاح |
| `product_selected` | العميل اختار منتجًا، النظام جاهز للرندر |
| `ready_to_render` | طلب الرندر قُبل (202)، الخادم يهيئ العملية |
| `rendering` | Gemini يعمل على توليد الصورة |
| `result_ready` | الصورة المولّدة جاهزة وتظهر للعميل |
| `completed` | العميل أنهى التجربة، انتهى السيشن بنجاح |
| `failed` | فشل الرندر أو خطأ في المسار الحيوي |
| `expired` | انتهت مدة السيشن (عادةً 30 دقيقة من الإنشاء) |

**ملاحظات مهمة:**
- `failed` ليس نهاية مطلقة — يمكن الانتقال منه إلى `ready_to_render` لإعادة المحاولة.
- `completed` و`expired` حالتان نهائيتان حقيقيتان لا رجعة منهما إلا بسيشن جديد.
- `result_ready` يسبق `completed` — العميل يرى النتيجة ثم يضغط "إنهاء" أو تنتهي بالتايمر.

---

## 3. رحلة النجاح الكاملة

### الخطوة 0 — إعداد الشاشة
| | التفاصيل |
|---|---|
| **إجراء العميل** | يقترب من كيوسك المتجر |
| **الشاشة** | تعرض صفحة showroom، تنشئ سيشن جديد عند الحاجة |
| **الجوال** | لا يوجد اتصال بعد |
| **حالة السيشن** | `created` → `waiting_for_mobile` |
| **حدث التشخيص** | `session_created`، `qr_displayed` |

---

### الخطوة 1 — عرض QR وفتحه
| | التفاصيل |
|---|---|
| **إجراء العميل** | يصوّر QR Code بكاميرا الجوال أو يفتح الرابط |
| **الشاشة** | تعرض QR كبيرًا مع تعليمات |
| **الجوال** | يفتح صفحة `/room-preview/mobile/[sessionId]` |
| **الباك-إند** | يتحقق من gate (اجتياز فحص الدخول)، يُعيد توجيه إلى صفحة الجوال |
| **حالة السيشن** | `waiting_for_mobile` |
| **حدث التشخيص** | `qr_opened` أو `qr_scanned` |

---

### الخطوة 2 — اتصال الجوال
| | التفاصيل |
|---|---|
| **إجراء العميل** | الصفحة تُحمَّل تلقائيًا، يتصل الجوال تلقائيًا (auto-connect) |
| **الشاشة** | تستقبل حدث SSE `session_updated`، تُظهر "جوال متصل" |
| **الجوال** | يعرض واجهة رفع الصورة |
| **الباك-إند** | `POST /connect` → `connectMobileTransition()` |
| **حالة السيشن** | `mobile_connected` |
| **حدث التشخيص** | `mobile_connected`، `mobile_connect_success` |

---

### الخطوة 3 — رفع صورة الغرفة
| | التفاصيل |
|---|---|
| **إجراء العميل** | يختار صورة من المعرض أو يلتقط صورة بالكاميرا |
| **الجوال** | يعرض مؤشر التقدم "جاري رفع صورة الغرفة... X%" |
| **الشاشة** | تُحدَّث لتعكس أن الغرفة اختيرت (عبر SSE) |
| **الباك-إند** | رفع مباشر لـ R2 → `POST /confirm-upload` → يخزن imageUrl |
| **حالة السيشن** | `room_selected` |
| **حدث التشخيص** | `room_upload_started`، `room_upload_completed` |

---

### الخطوة 4 — اختيار المنتج بـ QR
| | التفاصيل |
|---|---|
| **إجراء العميل** | يصوّر QR المطبوع على المنتج أو الرف |
| **الجوال** | يبحث عن المنتج، يعرض اسمه وصورته للتأكيد |
| **الشاشة** | تستقبل تحديث SSE بالمنتج المختار |
| **الباك-إند** | `POST /product` مع productCode → `selectProductTransition()` |
| **حالة السيشن** | `product_selected` |
| **حدث التشخيص** | `product_selected` |

---

### الخطوة 5 — طلب الرندر
| | التفاصيل |
|---|---|
| **إجراء العميل** | يضغط زر "إنشاء المعاينة" |
| **الجوال** | يُرسل `POST /render`، يستقبل 202 Accepted |
| **الشاشة** | تعرض شاشة التحميل والانتظار |
| **الباك-إند** | `markReadyToRenderTransition()` → يُعيد 202 مع `status: ready_to_render` |
| **حالة السيشن** | `ready_to_render` |
| **حدث التشخيص** | `render_requested`، **`render_request_accepted`** (وليس "Render Success") |

> **تنبيه مهم:** في هذه المرحلة الطلب قُبل فقط، لم يكتمل الرندر بعد. الحدث الصحيح هو `render_request_accepted`، وليس أي مسمى يوحي بالنجاح.

---

### الخطوة 6 — تشغيل الرندر
| | التفاصيل |
|---|---|
| **إجراء العميل** | ينتظر |
| **الجوال** | يعرض رسومية انتظار (RenderLoadingAnimation)، يستطلع النتيجة كل 2.5 ثانية |
| **الشاشة** | تعرض رسومية انتظار، تستقبل SSE |
| **الباك-إند** | `executeRenderPipeline()` في `after()` → يُشغَّل في الخلفية |
| **حالة السيشن** | `rendering` |
| **حدث التشخيص** | `render_started`، `gemini_attempt_started` (attempt=1, timeoutMs=25000) |

---

### الخطوة 7 — اكتمال الرندر
| | التفاصيل |
|---|---|
| **إجراء العميل** | ينتظر (عادةً 20–60 ثانية) |
| **الجوال** | يكتشف `result_ready` عبر Polling، يعرض صورة النتيجة |
| **الشاشة** | تستقبل SSE `session_updated` بـ `result_ready`، تعرض صورة Gemini |
| **الباك-إند** | `completeRenderingTransition()` → يحفظ imageUrl |
| **حالة السيشن** | `result_ready` |
| **أحداث التشخيص** | `gemini_attempt_completed`، `render_completed`، `result_seen_mobile`، `result_displayed_screen` |

---

### الخطوة 8 — الاكتمال وإعادة التوجيه
| | التفاصيل |
|---|---|
| **إجراء العميل** | يشاهد النتيجة، يضغط "تعديل" أو ينتهي |
| **الجوال** | يعرض overlay بالصورة مع أزرار: تحميل، مشاركة، تعديل |
| **الشاشة** | تعرض رسالة الإتمام، بعد مدة تُعيد التوجيه للصفحة الرئيسية |
| **الباك-إند** | `markSessionCompleted()` عند الإتمام |
| **حالة السيشن** | `completed` |
| **أحداث التشخيص** | `session_completed`، `screen_completion_message_displayed`، `screen_completed_redirect_to_home` |

---

## 4. رحلة فشل رفع صورة الغرفة

### 4.1 انتهاء مهلة الرفع (Upload Timeout)
- **ما يحدث:** انقطع الاتصال أثناء الرفع إلى R2.
- **الجوال:** يعرض رسالة "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى".
- **زر الاسترداد:** `retry_upload` → "إعادة المحاولة".
- **حالة السيشن:** تبقى `mobile_connected` أو `room_selected` بحسب المرحلة.
- **التشخيص:** `room_upload_failed` (code: NETWORK_INTERRUPTED).

### 4.2 صورة كبيرة جدًا (413)
- **ما يحدث:** حجم الصورة يتجاوز الحد المسموح.
- **الجوال:** يعرض "حجم الصورة كبير جدًا، يرجى اختيار صورة أصغر".
- **زر الاسترداد:** `image_too_large` → "اختيار صورة أخرى".
- **ملاحظة:** النظام يُحاول ضغط الصورة تلقائيًا قبل الرفع، هذا الخطأ نادر.

### 4.3 نوع صورة غير مدعوم
- **ما يحدث:** الملف ليس JPEG أو PNG أو WebP.
- **الجوال:** يعرض رسالة خطأ، يطلب اختيار صورة أخرى.
- **زر الاسترداد:** `retry_upload`.

### 4.4 الأرضية غير ظاهرة في الصورة
- **أين يُكتشف:** في مرحلة الرندر (Gemini يُعيد sentinel خاص).
- **ما يحدث:** Gemini يكتشف أن الأرضية غير مرئية بما يكفي.
- **الجوال:** يعرض رسالة فشل الرندر مع زر "رفع صورة غرفة أوضح".
- **زر الاسترداد:** `retake_room_photo` → `handleRetakeRoomPhoto()` → يمسح `selectedRoom`، يعود لخطوة الرفع.
- **حالة السيشن:** `failed`.
- **التشخيص:** `render_failed`، `SENTINEL_FLOOR_NOT_VISIBLE`.

### القاعدة العامة لفشل الرفع:
> **لا يجب إعادة التوجيه إلى صفحة QR.** الجلسة تبقى نشطة. يعرض الجوال زر إعادة المحاولة في نفس الخطوة.

---

## 5. رحلة فشل اختيار المنتج أو QR المنتج

### 5.1 منتج غير موجود
- **ما يحدث:** الكود الممسوح لا يطابق أي منتج في النظام.
- **الجوال:** يعرض "لم نتعرف على هذا المنتج، حاول مسح الرمز مرة أخرى".
- **يبقى في:** خطوة المنتج، لا ينتقل للرندر.

### 5.2 إذن الكاميرا مرفوض
- **ما يحدث:** العميل رفض إذن الكاميرا.
- **الجوال:** يعرض رسالة "الرجاء السماح للتطبيق باستخدام الكاميرا".
- **الحل البديل:** زر "اختيار من قائمة المنتجات" → `setUseProductListFallback(true)`.

### 5.3 فشل مسح QR (صورة ضبابية أو ضوء سيء)
- **ما يحدث:** لا يمكن التعرف على الرمز.
- **الجوال:** يعرض "تعذر قراءة الرمز، تأكد من الإضاءة وحاول مجددًا".
- **الحل البديل:** إدخال الكود يدويًا (manual entry).

### 5.4 خطأ في حفظ المنتج (شبكة)
- **ما يحدث:** `POST /product` فشل.
- **الجوال:** يعرض رسالة الخطأ.
- **يبقى في:** خطوة المنتج.

### القاعدة العامة:
> لا ينتقل السيشن إلى `product_selected` حتى ينجح `POST /product`. الجوال يبقى في خطوة المنتج ويتيح إعادة المحاولة.

---

## 6. رحلة الرندر الناجح (تسلسل الأحداث الدقيق)

```
1. العميل يضغط "إنشاء المعاينة"
2. الجوال: POST /render
3. الباك-إند: markReadyToRenderTransition() → 202 Accepted
   → حدث: render_requested, render_request_accepted
   → الحالة: ready_to_render

4. خلفية الخادم: executeRenderPipeline()
   → الحالة: rendering
   → حدث: render_started

5. Gemini Provider:
   → حدث: gemini_attempt_started (attempt=1, timeoutMs=25000ms)
   → استدعاء: ai.models.generateContent() داخل Promise.race()
   → حدث: gemini_attempt_completed (actualDurationMs=~20000ms)

6. التحقق من المخرجات:
   → قياس الأبعاد، نسبة العرض/الارتفاع، حجم الملف
   → رفع الصورة إلى R2

7. completeRenderingTransition() → result_ready
   → حدث: render_completed
   → الحالة: result_ready

8. الجوال يكتشف result_ready عبر Polling
   → يعرض صورة النتيجة
   → حدث: result_seen_mobile

9. الشاشة تستقبل SSE
   → تعرض صورة النتيجة
   → حدث: result_displayed_screen
```

> **تنبيه:** لا يُسمى الحدث "Render Success" حتى تصبح الحالة `result_ready` ويوجد `outputImageUrl` فعلي. الحدث عند قبول الطلب (202) هو `render_request_accepted` حصرًا.

---

## 7. رحلة فشل الرندر

### 7.1 خطأ في Gemini (5xx, 429)
- **ما يحدث:** Gemini يُعيد خطأ قابل لإعادة المحاولة.
- **الباك-إند:** يُعيد المحاولة تلقائيًا حتى MAX_RETRIES=3، مع تأخير تصاعدي.
- **إذا فشلت كل المحاولات:** `failRenderingTransition()` → `failed`.
- **الجوال:** يعرض "حدث خطأ أثناء التصميم، يرجى المحاولة مجددًا".
- **زر الاسترداد:** `retry_render`.

### 7.2 فشل رفع النتيجة إلى التخزين
- **ما يحدث:** `storageUpload()` فشل.
- **الباك-إند:** يُسجل الخطأ، `failRenderingTransition()` → `failed`.
- **الجوال:** نفس رسالة فشل الرندر مع `retry_render`.

### 7.3 فشل التحقق من المخرجات (نسبة أبعاد، حجم صغير)
- **ما يحدث:** الصورة المُولَّدة صغيرة جدًا أو نسبة أبعادها مختلفة بأكثر من 5%.
- **الباك-إند:** يُعيد المحاولة مرة بـ prompt أكثر صرامة، وإن فشل → `failed`.

### 7.4 المادة غير واضحة (SENTINEL_MATERIAL_UNCLEAR)
- **ما يحدث:** Gemini لا يستطيع تحديد مادة المنتج من الصورة.
- **الجوال:** يعرض رسالة الفشل.
- **زر الاسترداد:** `retry_render` أو `retake_room_photo`.

### السلوك المطلوب لجميع حالات فشل الرندر:
```
✅ لا إعادة توجيه إلى QR
✅ لا إخفاء واجهة الرندر
✅ يُعرض ResultStep مع زر "إنشاء" (الحالة idle)
✅ يُعرض شريط الخطأ مع زر إعادة المحاولة
✅ الجلسة تبقى نشطة

الأزرار المتاحة:
- إعادة المحاولة (retry_render) — يُعيد POST /render
- رفع صورة أوضح (retake_room_photo) — يمسح selectedRoom ويعود لخطوة الرفع
- اختيار منتج آخر — يعود لخطوة المنتج

الانتقالات المسموح بها من failed:
  failed → ready_to_render (عبر POST /render مجددًا)
  failed → room_selected (عبر retake)
  failed → product_selected (عبر اختيار منتج مجددًا)
```

---

## 8. رحلة Gemini Timeout

### المحاولة الأولى (attempt 1) — timeout=25 ثانية

```
1. gemini_attempt_started { attempt: 1, timeoutMs: 25000 }
2. Promise.race([geminiPromise, timeoutPromise])
3. بعد 25 ثانية: timeoutPromise يربح
4. GeminiTimeoutError مرفوع { name: "GeminiTimeoutError", code: "GEMINI_TIMEOUT", retryable: true }
5. حدث: gemini_attempt_timeout { attempt: 1, timeoutMs: 25000, actualDurationMs: 25000, action: "retrying_with_reduced_dimensions" }
6. الباك-إند يُعيد تحميل الصور بأبعاد أصغر (1024px بدلًا من 1280px)
7. gemini_attempt_started { attempt: 2, timeoutMs: 90000 }
```

### المحاولة الثانية (attempt 2) — timeout=90 ثانية

**إذا نجحت المحاولة الثانية:**
```
→ gemini_attempt_completed { attempt: 2, actualDurationMs: ~40000 }
→ result_ready
→ الجوال والشاشة يعرضان النتيجة
```

**إذا فشلت المحاولة الثانية أيضًا:**
```
→ gemini_attempt_timeout { attempt: 2, action: "giving_up" }
→ failRenderingTransition() → failed
→ الجوال يعرض رسالة الفشل
```

### ما يرى العميل:

**بعد انتهاء مهلة المحاولة الأولى وإعادة المحاولة تلقائيًا:**
- الجوال: يبقى على شاشة الانتظار (الرندر لا يزال يعمل بمحاولة ثانية).

**إذا فشل الرندر نهائيًا (بعد المحاولتين):**
```
الرسالة الأولى (من retry_render recovery):
"حدث خطأ أثناء التصميم، يرجى المحاولة مجددًا"
زر: إعادة المحاولة
```

**إذا وصل المستخدم إلى render_limit_reached (تجاوز العدد الأقصى):**
```
الرسالة: "فشل التصميم مرتين. يرجى رفع صورة غرفة أوضح أو اختيار منتج آخر."
زر: retake_room_photo → "اختيار صورة أخرى"
```

### ضمانات Timeout:
- المحاولة الأولى: لا تتجاوز `ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS` (افتراضي 25 ثانية).
- المحاولة الثانية: لا تتجاوز `ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS` (افتراضي 90 ثانية).
- آلية الفرض: `Promise.race()` — لا يعتمد على AbortController وحده.
- إذا كانت diagnostics تُظهر محاولة رندر أطول من الـ timeout → يعني timeout لا يعمل.

### المتغيرات البيئية:
```
ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=25000   # المحاولة الأولى
ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS=90000   # المحاولة الثانية
```

---

## 9. رحلة انتهاء السيشن (Expired)

### متى تنتهي الجلسة؟
- بعد مدة معينة من الإنشاء (عادةً 30 دقيقة).
- الحالة تصبح `expired`.

### ما يحدث:
```
1. الباك-إند يُعلّم السيشن expired
2. الشاشة: تستقبل SSE → تعرض "انتهت الجلسة" → تُعيد إنشاء سيشن جديد
3. الجوال:
   - المؤقت المحلي (client-side expiry timer) يكتشف انتهاء المدة
   - يُعيّن viewState = "expired"
   - يعرض "انتهت صلاحية هذه الرابط"
4. أزرار: "بدء جلسة جديدة" (رابط للصفحة الرئيسية)
5. حدث التشخيص: session_expired
```

### متى يُسمح بإعادة التوجيه إلى QR/start؟

```
✅ مسموح بالتوجيه إلى QR/start في هذه الحالات فقط:
  - expired        → الجلسة انتهت
  - completed      → الجلسة اكتملت وعُرضت النتيجة
  - not_found      → الرابط أو الـ sessionId غير موجود
  - expired token  → رمز التفعيل منتهي أو مستخدم
  - explicit reset → المستخدم ضغط "بدء جلسة جديدة" يدويًا

❌ غير مسموح بالتوجيه إلى QR/start في:
  - failed         → فشل رندر، يجب عرض retry UI
  - render_timeout → فشل Gemini، يجب عرض retry UI
  - upload_failed  → فشل رفع الصورة، يجب إعادة المحاولة
  - product error  → خطأ في المنتج، يجب البقاء في خطوة المنتج
  - network error  → خطأ شبكة مؤقت، يجب إعادة المحاولة
```

---

## 10. رحلة فشل الاتصال بين الشاشة والجوال

### 10.1 انقطاع SSE على الشاشة
```
1. اتصال SSE ينقطع
2. الشاشة: تُفعّل Fallback Polling (استطلاع كل 3-5 ثواني)
3. حدث: sse_disconnected، fallback_polling_started
4. الشاشة تُظهر مؤشر "إعادة الاتصال..." (أو لا تُظهر شيئًا)
5. بعد إعادة الاتصال: sse_reconnected، fallback_polling_stopped
```

**القاعدة:** الشاشة لا تتوقف عن استقبال التحديثات حتى لو انقطع SSE. Polling يأخذ مكانه.

### 10.2 Heartbeat فشل على الجوال
```
1. /api/heartbeat يُعيد أخطاء متكررة
2. الجوال: يُظهر شريط تحذير "يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال..."
3. حدث: weak_connection_warning_shown
4. الجلسة لا تُلغى، العميل يمكنه الاستمرار
```

**ملاحظة:** Heartbeat يتوقف تلقائيًا لـ `expired`، `completed`، `failed`.

### 10.3 Redis غير متاح
```
1. Heartbeat أو SSE يفشل (Redis down)
2. الشاشة والجوال: يعتمدان على Polling من قاعدة البيانات مباشرة
3. الرندر يستمر (لا يعتمد على Redis للعملية الأساسية)
4. حدث: يُسجَّل خطأ في الخادم، fallback_polling_started
```

### السلوك المطلوب:
> انقطاع SSE أو Heartbeat **لا يكسر التجربة**. Polling يكفل اكتشاف `result_ready`، `failed`، `expired`، `completed` في جميع الأحوال.

---

## 11. رحلة رجوع المتصفح Back أو Reload

### 11.1 Back Button على الجوال
```
الشرط: الصفحة تدفع history entry عند التحميل لاعتراض الرجوع

عند ضغط Back:
1. يتم اعتراض الحدث (popstate handler)
2. يُستعاد history entry
3. تُجلب الحالة الحالية للسيشن من الخادم
4. حسب الحالة:
   - expired / completed → viewState = "expired"
   - failed → viewState = "ready" + recovery message (retry_render)
   - result_ready → viewState = "ready" + showResult = true
   - أي حالة أخرى → viewState = "ready" (خطوة المناسبة)
5. حدث: back_pressed
6. رسالة مؤقتة: "أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك"
```

> **قاعدة:** الضغط على Back بعد فشل الرندر **لا يُعيد المستخدم إلى QR**. يُعيده إلى واجهة الرندر مع زر إعادة المحاولة.

### 11.2 إعادة تحميل الصفحة (Reload)
```
1. الصفحة تُعاد من البداية
2. gate check → إذا كان المستخدم اجتاز Gate → يدخل مباشرة
3. loadSession() يُجلب السيشن
4. auto-connect إذا لزم
5. السيشن يُستعاد حسب حالته الحالية
6. حدث: mobile_rapid_reload_detected (إذا كانت إعادات متكررة)
```

### 11.3 الصفحة مخفية (Page Hidden)
```
1. حدث: mobile_page_hidden (Visibility API)
2. Polling يُبطّئ ×4 (لتوفير البطارية)
3. عند العودة: mobile_page_visible
4. Polling يعود لسرعته الطبيعية
5. sendBeacon يُرسل: mobile_pagehide للتسجيل
```

---

## 12. رحلة اكتمال التجربة

### تسلسل الاكتمال:
```
1. result_ready: الصورة المُولَّدة موجودة في renderResult.imageUrl
2. الجوال: showResult = true → يعرض Overlay بالصورة
   - زر تحميل الصورة
   - زر مشاركة الرابط
   - زر "تعديل" (يُخفي النتيجة ويعود للمنتج)
3. حدث: result_seen_mobile

4. الشاشة: تستقبل SSE → تعرض صورة النتيجة في كامل الشاشة
   - قبل/بعد (Before/After Slider)
   - بيانات المنتج المختار
5. حدث: result_displayed_screen

6. بعد مدة (auto-complete timer على الشاشة):
   - markSessionCompleted() → completed
   - حدث: session_completed
   - الشاشة تعرض رسالة "شكرًا لك"
   - حدث: screen_completion_message_displayed

7. الشاشة تُعيد التوجيه إلى الصفحة الرئيسية (Home)
   - حدث: screen_completed_redirect_to_home
   - تنشئ سيشن جديد أو تعرض QR جديد
```

### التعديل (Modify):
```
1. العميل يضغط "تعديل" على الجوال
2. حدث: edit_requested
3. showResult = false
4. handleProductSelect(localProductId) يُعيد حفظ المنتج
   → هذا يُعيد السيشن من result_ready إلى product_selected
   → يُلغي auto-complete timer على الشاشة
5. العميل يختار منتجًا آخر أو يُعيد الرندر
```

---

## 13. جدول الحالات والانتقال بينها

| الحالة الحالية | المُشغّل | الحالة التالية | نتيجة الواجهة | حدث التشخيص |
|---|---|---|---|---|
| `created` | إنشاء السيشن | `waiting_for_mobile` | الشاشة تعرض QR | `session_created`، `qr_displayed` |
| `waiting_for_mobile` | العميل يفتح QR | `mobile_connected` | الجوال يُحمَّل | `qr_opened` |
| `mobile_connected` | auto-connect ينجح | `mobile_connected` | الجوال يعرض خطوة الغرفة | `mobile_connected` |
| `mobile_connected` | رفع صورة ناجح | `room_selected` | الجوال يعرض خطوة المنتج | `room_upload_completed` |
| `room_selected` | اختيار منتج | `product_selected` | الجوال يعرض زر الرندر | `product_selected` |
| `product_selected` | POST /render | `ready_to_render` | كلاهما يعرض شاشة الانتظار | `render_requested`، `render_request_accepted` |
| `ready_to_render` | بدء pipeline | `rendering` | مؤشر التقدم يظهر | `render_started` |
| `rendering` | Gemini ينجح + رفع ناجح | `result_ready` | الصورة تظهر على كليهما | `render_completed` |
| `rendering` | خطأ أو timeout | `failed` | شريط خطأ + retry | `render_failed` أو `gemini_attempt_timeout` |
| `failed` | POST /render مجددًا | `ready_to_render` | عودة لشاشة الانتظار | `render_requested` |
| `failed` | retake room | `room_selected` | العودة لخطوة الصورة | `room_upload_started` |
| `result_ready` | اختيار منتج آخر (تعديل) | `product_selected` | إخفاء النتيجة، خطوة المنتج | `edit_requested` |
| `result_ready` | auto-complete | `completed` | رسالة الاكتمال | `session_completed` |
| أي حالة نشطة | انتهاء المدة | `expired` | رسالة انتهاء الصلاحية | `session_expired` |

---

## 14. جدول الفشل والاستجابة المطلوبة

| نوع الفشل | أين يحدث | رسالة المستخدم | الإجراءات المتاحة | إعادة توجيه لـ QR؟ |
|---|---|---|---|---|
| فشل رفع الصورة (شبكة) | الجوال | "تعذر رفع الصورة، تحقق من الاتصال" | إعادة المحاولة | ❌ لا |
| صورة كبيرة جدًا | الجوال | "حجم الصورة كبير جدًا" | اختيار صورة أخرى | ❌ لا |
| منتج غير موجود | الجوال | "لم نتعرف على هذا المنتج" | مسح مجددًا أو إدخال يدوي | ❌ لا |
| إذن الكاميرا مرفوض | الجوال | "الرجاء السماح باستخدام الكاميرا" | اختيار من القائمة | ❌ لا |
| Gemini timeout (محاولة 1) | الخادم | لا يظهر للمستخدم (retry داخلي) | — | ❌ لا |
| فشل الرندر (بعد كل المحاولات) | الجوال | "حدث خطأ أثناء التصميم" | إعادة المحاولة، صورة أوضح | ❌ لا |
| render_limit_reached | الجوال | "فشل التصميم مرتين..." | رفع صورة غرفة أوضح | ❌ لا |
| الأرضية غير ظاهرة | الخادم/الجوال | "الأرضية غير ظاهرة في الصورة" | رفع صورة أوضح | ❌ لا |
| ضعف الاتصال | الجوال | "الاتصال ضعيف، نحاول إعادة الاتصال" | الانتظار تلقائيًا | ❌ لا |
| انقطاع SSE | الشاشة | (Fallback Polling يعمل بصمت) | — | ❌ لا |
| انتهاء مدة السيشن | كلاهما | "انتهت صلاحية هذه الرابط" | بدء جلسة جديدة | ✅ نعم (expired) |
| الجلسة مكتملة | كلاهما | "شكرًا، اكتملت تجربتك" | — | ✅ نعم (completed) |
| sessionId غير موجود | الجوال | "الرابط غير صالح" | بدء جلسة جديدة | ✅ نعم (not_found) |
| رمز تفعيل منتهي | الجوال | رسالة الرابط المنتهي | بدء جلسة جديدة | ✅ نعم (expired token) |

---

## 15. قائمة التحقق من أحداث التشخيص (Diagnostics Checklist)

### أحداث يجب أن توجد لكل رحلة ناجحة:

| الحدث | المصدر | متى يُطلق |
|---|---|---|
| `session_created` | server | عند إنشاء السيشن |
| `qr_displayed` | screen | عند عرض QR على الشاشة |
| `qr_scanned` / `qr_opened` | mobile | عند فتح الرابط |
| `mobile_connected` | mobile/server | عند نجاح auto-connect |
| `room_upload_started` | mobile | عند بدء رفع الصورة |
| `room_upload_completed` | mobile | عند نجاح الرفع |
| `product_selected` | mobile | عند حفظ المنتج |
| `render_requested` | server | عند قبول POST /render |
| `render_request_accepted` | mobile | عند استقبال 202 Accepted |
| `render_started` | server | عند بدء pipeline |
| `gemini_attempt_started` | server | عند كل محاولة Gemini |
| `gemini_attempt_completed` | server | عند نجاح محاولة Gemini |
| `render_completed` | server | عند اكتمال الرندر |
| `render_timing_summary` | server | ملخص التوقيتات |
| `result_displayed_screen` | screen | عند عرض النتيجة على الشاشة |
| `result_seen_mobile` | mobile | عند عرض النتيجة على الجوال |
| `session_completed` | server | عند اكتمال التجربة |

### أحداث رحلات الفشل:

| الحدث | المصدر | متى يُطلق |
|---|---|---|
| `room_upload_failed` | mobile | عند فشل الرفع |
| `render_request_failed` | mobile | عند رفض POST /render بخطأ |
| `gemini_attempt_timeout` | server | عند انتهاء مهلة Gemini |
| `render_failed` | server/mobile | عند فشل الرندر |
| `render_timeout` | mobile | عند انتهاء مهلة polling |
| `session_expired` | server | عند انتهاء مدة السيشن |
| `mobile_rapid_reload_detected` | mobile | عند إعادات تحميل متكررة |
| `weak_connection_warning_shown` | mobile | عند ضعف الاتصال |
| `back_pressed` | mobile | عند ضغط زر الرجوع |

### أحداث الشاشة:

| الحدث | المصدر | متى يُطلق |
|---|---|---|
| `sse_connected` | screen | عند اتصال SSE |
| `sse_disconnected` | screen | عند انقطاع SSE |
| `sse_reconnected` | screen | عند إعادة الاتصال |
| `fallback_polling_started` | screen | عند التحول لـ Polling |
| `screen_completion_message_displayed` | screen | عند عرض رسالة الاكتمال |
| `screen_completed_redirect_to_home` | screen | عند إعادة التوجيه للمنزل |

### Issues يجب فتحها تلقائيًا في حالات معينة:

| النوع | متى يُفتح |
|---|---|
| `RENDER_FAILED` | عند فشل الرندر |
| `RENDER_TIMEOUT` | عند اكتشاف stuck render > 8 دقائق |

---

## 16. قواعد مهمة لا يجب كسرها

### 1. لا يبقى الرندر في حالة `rendering` إلى الأبد
```
- إذا كانت مدة الرندر > 8 دقائق بدون تحديث → recoverStuckRenderJob()
- يُعلَّم الـ job بـ failed، السيشن يُعاد لـ failed
- يُفتح Issue: RENDER_TIMEOUT
```

### 2. لا يُعرض QR بعد فشل الرندر
```
- failed status → ResultStep يُعرض (ليس ProductQrStep)
- shouldShowProductQrStep يشترط: session.status !== "failed"
- shouldShowResultStep يشمل: session.status === "failed"
```

### 3. لا يُسمى قبول طلب الرندر "نجاح"
```
- 202 Accepted → render_request_accepted فقط
- لا يوجد "Render Success" حتى تصبح الحالة result_ready
- timeline label: "Render Request Accepted"
```

### 4. لا يُعلَّم الرندر مكتملًا إلا مع صورة فعلية
```
- completeRenderingTransition() تُستدعى فقط مع imageUrl صالح
- لا توجد result_ready بدون renderResult.imageUrl
```

### 5. فشل الرندر يُظهر retry UI دائمًا
```
- session.status === "failed" → عرض شريط خطأ + زر إعادة المحاولة
- لا null recovery messages بعد فشل الرندر العادي
- الاستثناء الوحيد: render_limit_reached يعرض retake_room_photo
```

### 6. Timeout يجب أن يظهر في diagnostics
```
- gemini_attempt_timeout يُطلق مع: attempt، timeoutMs، actualDurationMs
- إذا كانت diagnostics تُظهر attempt_duration > timeoutMs → خلل في timeout enforcement
```

### 7. Stuck rendering sessions تُعالج عند بدء كل طلب
```
- POST /render يفحص: session.status === "rendering"
- إذا وجد stuck job → recoverStuckRenderJob()
- إذا لا → RENDER_IN_PROGRESS (429)
```

### 8. الجوال والشاشة يتعافيان من انقطاع SSE/Polling
```
- SSE disconnected → Fallback Polling يبدأ فورًا
- لا يتوقف استقبال التحديثات
- result_ready، failed، expired، completed مضمونة الاكتشاف عبر Polling
```

### 9. Back button لا يكسر تجربة المستخدم
```
- popstate handler → fetchRoomPreviewSession() → استعادة الحالة الصحيحة
- failed → viewState=ready + retry message (ليس SessionStatePanel)
- expired → viewState=expired فقط
```

### 10. التحقق من الإذن gate مرة واحدة فقط
```
- gate check يحدث على SSR فقط (page.tsx)
- لا يتكرر عند كل reload ما دام الـ cookie موجودًا
- cookie: gate_ok_{sessionId} = "1"
```

---

*وثيقة تقنية — Room Preview Customer Journey — 2026-05-27*
