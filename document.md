# دليل تحويل تجربة الجوال إلى React Native / Expo


> ملاحظة: هذه وثيقة تخطيطية فقط - لا يُعدَّل أي كود حالي.

---

## 1. ملخص رحلة العميل الحالية على الجوال

| الخطوة | ما يحدث |
|--------|---------|
| 1 | الشاشة الكبيرة تنشئ session وتعرض QR |
| 2 | العميل يمسح QR بكاميرا الجوال |
| 3 | QR يشير إلى: GET /api/room-preview/sessions/[id]/activate?t=TOKEN |
| 4 | السيرفر يتحقق من HMAC token، يضع cookie rp-mobile-token، يعيد التوجيه لصفحة الجوال |
| 5 | إذا لم تكتمل البوابة: redirect إلى /room-preview/gate/[id] |
| 6 | البوابة: عميل جديد / عميل سابق / موظف |
| 7 | بعد البوابة: connectMobileToSession() -> mobile_connected |
| 8 | MobileSessionClient يُحمَّل ويستدعي auto-connect |
| 9 | خطوة الغرفة: رفع صورة كاميرا/معرض أو اختيار غرفة تجريبية |
| 10 | خطوة المنتج: اختيار من القائمة |
| 11 | زر ابدأ التصميم: POST /render |
| 12 | Polling كل 2.5 ثانية حتى result_ready |
| 13 | عرض النتيجة: صورة AI + تحميل/مشاركة/تعديل |
| 14 | تعديل: يخفي النتيجة لاختيار منتج آخر |
| 15 | completed/expired/failed: رسائل مناسبة |

---

## 2. خريطة الملفات الحالية

### صفحات Next.js

| المسار | الوظيفة | مصير RN |
|--------|---------|----------|
| app/room-preview/activate/[id]/page.tsx | redirect قديم | لا يُستخدم في RN |
| app/room-preview/activate/[id]/_components/ActivationHandler.tsx | يقرأ token من hash يرسل POST activate | يُستبدل بـ deep link handler |
| app/room-preview/gate/[id]/page.tsx | صفحة البوابة SSR | يبقى للمتصفح |
| app/room-preview/gate/[id]/actions.ts | Server Actions البوابة 484 سطر | يبقى للمتصفح، يحتاج JSON endpoint لـ RN |
| app/room-preview/gate/[id]/_components/gate-form.tsx | فورم البوابة 20KB | يُستبدل بـ GateScreen في RN |
| app/room-preview/mobile/[id]/page.tsx | صفحة الجوال SSR | يبقى للمتصفح |

### مكونات React

| الملف | الوظيفة | مصير RN |
|-------|---------|----------|
| components/room-preview/MobileSessionClient.tsx | منسق الجوال الرئيسي | يُستبدل كلياً |
| features/room-preview/mobile/useMobileSession.ts | كل منطق الجوال 1143 سطر | يُستبدل بـ sessionStore |
| features/room-preview/mobile/RoomStep.tsx | خطوة الغرفة | يُستبدل بـ RoomUploadScreen |
| features/room-preview/mobile/ProductStep.tsx | خطوة المنتج | يُستبدل بـ ProductSelectionScreen |
| features/room-preview/mobile/ResultStep.tsx | شاشة النتيجة 509 سطر | يُستبدل بـ ResultScreen |
| features/room-preview/mobile/useMobileHeartbeat.ts | Heartbeat كل 30 ث | يُعاد تنفيذه في RN |

### مكتبات الخادم

| الملف | الوظيفة | خطر |
|-------|---------|-----|
| lib/room-preview/session-machine.ts | آلة الحالة | تبقى في الخادم |
| lib/room-preview/session-token.ts | HMAC-SHA256 للتوكن | تبقى - التوكن = HMAC(sessionId) |
| lib/room-preview/api-guard.ts | يقبل x-session-token header او cookie | جاهز لـ RN بالفعل |
| lib/room-preview/upload-service.ts | رفع صور مع تحقق أبعاد | تبقى في الخادم |
| lib/room-preview/session-polling.ts | polling للنتيجة | يُعاد تنفيذه في RN |
| lib/room-preview/types.ts | TypeScript types | تُنسخ لـ RN |
| lib/storage.ts | رفع R2/S3 | تبقى |

---

## 3. خريطة API الحالية

| الطريقة | المسار | الاستيثاق | الوظيفة | جاهز لـ RN |
|---------|--------|-----------|---------|------------|
| GET | /api/room-preview/sessions/[id] | لا يحتاج | جلب حالة الجلسة | نعم |
| GET | /api/room-preview/sessions/[id]/activate?t=TOKEN | query param | تفعيل QR + وضع cookie + redirect | لا - cookie فقط |
| POST | /api/room-preview/sessions/[id]/activate | body.token | تفعيل legacy | لا - cookie فقط |
| POST | /api/room-preview/sessions/[id]/connect | cookie او x-session-token | ربط الجوال بالجلسة | نعم |
| POST | /api/room-preview/sessions/[id]/heartbeat | cookie او x-session-token | heartbeat | نعم |
| POST | /api/room-preview/sessions/[id]/product | cookie او x-session-token | اختيار منتج | نعم |
| POST | /api/room-preview/sessions/[id]/room | cookie او x-session-token | رفع صورة FormData | جزئي - FormData فقط |
| POST | /api/room-preview/sessions/[id]/room/upload-url | cookie او x-session-token | presigned URL لـ R2 | نعم |
| POST | /api/room-preview/sessions/[id]/room/confirm-upload | cookie او x-session-token | تأكيد الرفع المباشر | نعم |
| POST | /api/room-preview/sessions/[id]/render | cookie او x-session-token | بدء الرندر | نعم |
| GET | /api/room-preview/sessions/[id]/events | cookie فقط SSE | احداث real-time | للشاشة فقط |

### آلية guardSession

الملف: lib/room-preview/api-guard.ts

يقبل التوكن من مصدرين:
1. Header: x-session-token: TOKEN (هذا ما سيستخدمه React Native)
2. Cookie: rp-mobile-token=TOKEN (هذا ما يستخدمه المتصفح)

المشكلة: مسار البوابة يستخدم Server Actions وليس JSON API - يحتاج endpoint جديد.

التوكن: HMAC-SHA256(sessionId, SESSION_TOKEN_SECRET) - حتمي، لا يحتاج تخزين في DB.

---

## 4. خريطة آلة الحالة (State Machine)

| الحالة | الجوال يعرض | الشاشة تعرض | يُحوَّل إليها عبر |
|--------|-------------|-------------|-------------------|
| created | loading | QR code | انشاء الجلسة من الشاشة |
| waiting_for_mobile | loading | QR ينتظر | الحالة الافتراضية عند الانشاء |
| mobile_connected | خطوة رفع الغرفة | الجوال متصل | POST /connect |
| room_selected | اختيار المنتج | صورة الغرفة | POST /room او /confirm-upload |
| product_selected | زر ابدأ التصميم | المنتج مختار | POST /product |
| ready_to_render | loading overlay | جاري التجهيز | POST /render |
| rendering | AI loading animation | جاري الرندر | pipeline داخلي يدعى في after() |
| result_ready | صورة النتيجة + ازرار | الصورة على الشاشة | render pipeline ينجح |
| completed | رسالة اكتملت تجربتك | reset بعد 60 ث | المستخدم لا يتفاعل مع result |
| failed | رسالة خطأ + اعادة محاولة | reset بعد 15 ث | فشل render pipeline |
| expired | انتهت الجلسة | reset | timeout 60 دقيقة |

### انتقالات الحالة

- created/waiting_for_mobile -> mobile_connected: POST /connect
- mobile_connected -> room_selected: POST /room
- room_selected -> product_selected: POST /product
- product_selected/failed -> ready_to_render: POST /render
- ready_to_render -> rendering: pipeline داخلي tryClaimRenderingSlot
- rendering -> result_ready: completeRenderingTransition
- rendering -> failed: failRenderingTransition
- result_ready -> product_selected: selectProductTransition (للتعديل)

### القيود الحالية

- MAX_RENDERS_PER_SESSION = 2 (قابل للتعديل عبر env)
- DEVICE_COOLDOWN_SECONDS: cooldown لنفس الجهاز
- لا يوجد endpoint صريح لـ request-retry - المنطق موجود في POST /product + POST /render

---

## 5. هيكل تطبيق React Native المقترح (Expo)

`
mobile-app/
  app/
    _layout.tsx          # Root layout + navigation setup
    session/
      [sessionId].tsx    # SessionEntryScreen - entry point من QR/deep link
    gate.tsx             # GateScreen - تسجيل دخول العميل
    products.tsx         # ProductSelectionScreen
    upload-room.tsx      # RoomUploadScreen
    rendering.tsx        # RenderingScreen - polling + loading
    result.tsx           # ResultScreen - عرض النتيجة
    expired.tsx          # ExpiredScreen
    failed.tsx           # FailedScreen
  src/
    api/
      roomPreviewApi.ts  # كل HTTP calls مع Bearer token
    types/
      roomPreview.ts     # منسوخ من lib/room-preview/types.ts
    store/
      sessionStore.ts    # Zustand/MMKV store للجلسة والتوكن
    components/
      ScreenShell.tsx    # Layout مشترك
      PrimaryButton.tsx
      ProductCard.tsx
      PhoneInput.tsx
      BeforeAfterSlider.tsx
    utils/
      tokenStorage.ts    # MMKV حفظ التوكن
      imageUpload.ts     # اختيار/ضغط/رفع الصور
      polling.ts         # polling loop للرندر
`

### التقنيات المقترحة

- Expo SDK (latest)
- expo-router للـ navigation
- Zustand للـ state management
- expo-secure-store او MMKV للتوكن
- expo-image-picker لاختيار الصور
- expo-camera للكاميرا المباشرة
- expo-file-system لضغط الصور قبل الرفع

---

## 6. تعيين الشاشات Native

### SessionEntryScreen - session/[sessionId].tsx
- المصدر الحالي: mobile/[sessionId]/page.tsx + ActivationHandler.tsx
- API: GET /api/room-preview/sessions/[id]
- الوظيفة: يستقبل sessionId+token من deep link، يحفظ التوكن، يستدعي /connect، يوجه للشاشة الصحيحة
- حالات: loading / gate_required / main_flow / expired / not_found

### GateScreen - gate.tsx
- المصدر الحالي: gate/[id]/page.tsx + gate-form.tsx + actions.ts
- API: POST /api/room-preview/mobile/gate (جديد مطلوب)
- Input: flow, name, phone, countryCode, dialCode, customerId, employeeCode
- الوظيفة: تسجيل العميل ثم استدعاء /connect
- حالات: customer_new / customer_existing / customer_confirm / employee

### ProductSelectionScreen - products.tsx
- المصدر الحالي: features/room-preview/mobile/ProductStep.tsx
- API: GET /api/room-preview/mobile/products (جديد مطلوب)
- الوظيفة: عرض المنتجات + POST /product عند الاختيار
- المشكلة الحالية: المنتجات تُمرَّر من SSR props - تحتاج endpoint JSON

### RoomUploadScreen - upload-room.tsx
- المصدر الحالي: features/room-preview/mobile/RoomStep.tsx
- API: POST /room/upload-url ثم PUT مباشر لـ R2 ثم POST /room/confirm-upload
- الوظيفة: اختيار صورة من المعرض او الكاميرا، ضغط، رفع مباشر
- خطر: في dev البيئة يعود إلى FormData (R2 غير متاح)

### RenderingScreen - rendering.tsx
- المصدر الحالي: ResultStep.tsx (RenderLoadingScreen جزء منه)
- API: polling GET /api/room-preview/sessions/[id] كل 2 ثانية
- الوظيفة: يُظهر animation الرندر + progress وهمي
- لا تستخدم SSE - polling فقط في النسخة الأولى

### ResultScreen - result.tsx
- المصدر الحالي: features/room-preview/mobile/ResultStep.tsx
- API: لا يحتاج بعد وصول النتيجة من polling
- ازرار: تحميل / مشاركة / تعديل
- تعديل: يعود لـ ProductSelectionScreen ويسمح برندر جديد

### ExpiredScreen - expired.tsx
- المصدر الحالي: SessionStatePanel في MobileSessionClient
- الوظيفة: رسالة انتهاء + زر بدء جلسة جديدة

### FailedScreen - failed.tsx
- المصدر الحالي: SessionStatePanel في MobileSessionClient
- الوظيفة: رسالة فشل + زر اعادة المحاولة
- اعادة المحاولة: POST /product ثم POST /render

---

## 7. خطة ترحيل المصادقة (Token/Auth)

### الوضع الحالي (المتصفح)

1. QR URL: GET /activate?t=TOKEN
2. السيرفر يضع HttpOnly cookie: rp-mobile-token=TOKEN
3. كل API requests ترسل الـ cookie تلقائياً
4. api-guard يتحقق من الـ cookie

### المشكلة مع React Native

- React Native لا يدعم HttpOnly cookies بشكل تلقائي
- QR redirect يعمل في المتصفح لكن ليس في deep link

### الحل المقترح لـ React Native

1. QR يشير إلى deep link: myapp://session/[id]?t=TOKEN
2. التطبيق يستخرج sessionId و token من الـ URL
3. التطبيق يحفظ التوكن في expo-secure-store:
   `
   tokenStorage.ts:
   SecureStore.setItemAsync(session_token_[id], token)
   `
4. كل API request يرسل الهيدر:
   `
   Authorization: Bearer TOKEN
   x-session-token: TOKEN
   `
5. api-guard موجود يقبل x-session-token - لا يحتاج تعديل

### التوكن: HMAC-SHA256(sessionId, SECRET)

- التوكن حتمي = نفس sessionId ينتج نفس التوكن دائماً
- لا يحتاج تخزين في DB
- صالح مدة الجلسة (90 دقيقة للـ cookie، يمكن تمديده لـ RN)

### الإبقاء على المتصفح

- مسار /activate?t=TOKEN يبقى كما هو (cookie-based)
- مسار deep link جديد للـ RN فقط
- كلاهما يستخدم نفس التوكن

### QR في الإنتاج (المقترح)

الـ QR يشير إلى URL ويب عادي:
`
https://app.example.com/api/room-preview/sessions/[id]/activate?t=TOKEN
`

هذا الـ URL:
- في المتصفح: يضع cookie ويعيد التوجيه (المسار الحالي)
- في التطبيق Native (app links): التطبيق يعترضه ويستخرج sessionId+token

---

## 8. خطة QR والـ Deep Link

### الحل الموصى به: Universal Links / App Links

| النوع | الرابط | يعمل في |
|-------|--------|----------|
| ويب fallback | https://app.example.com/api/room-preview/sessions/[id]/activate?t=TOKEN | اي متصفح |
| App Link Android | https://app.example.com/room-preview/mobile/[id]?t=TOKEN | Android مع التطبيق |
| Universal Link iOS | https://app.example.com/room-preview/mobile/[id]?t=TOKEN | iOS مع التطبيق |
| Custom scheme | myapp://session/[id]?t=TOKEN | اختياري للاختبار |

### كيف يستخرج التطبيق البيانات

`	ypescript
// app/session/[sessionId].tsx
import * as Linking from expo-linking;

const url = Linking.useURL();
// استخراج: sessionId من path, token من query param t
`

### تدفق QR الكامل

1. QR يحتوي على: https://app.example.com/api/.../activate?t=TOKEN
2. إذا فُتح في المتصفح: cookie + redirect (المسار الحالي)
3. إذا كان التطبيق مثبتاً: Android/iOS يحوله لـ deep link تلقائياً
4. التطبيق يستقبل الـ URL في SessionEntryScreen
5. يستخرج sessionId وtoken
6. يحفظ التوكن في SecureStore
7. يستدعي /connect
8. يوجه للشاشة الصحيحة

---

## 9. خطة رفع الصور (Upload)

### كيف يعمل الرفع حالياً

مسارين:

**المسار 1 - Direct Upload (الانتاج مع R2):**
1. POST /room/upload-url: السيرفر يولد presigned PUT URL
2. PUT مباشر للصورة إلى Cloudflare R2
3. POST /room/confirm-upload: تأكيد + حفظ publicUrl في الجلسة

**المسار 2 - FormData (التطوير بدون R2):**
1. POST /room مع FormData تحتوي الصورة
2. السيرفر يحفظ في filesystem المحلي

### متطلبات الصورة

- الانواع: image/jpeg, image/png, image/webp
- الحجم الاقصى: 10MB (FormData) او 15MB (presigned)
- الابعاد الدنيا: 400x400 بكسل
- الابعاد القصوى: 20000x20000 بكسل
- نسبة الاتساع: بين 1:4 و 4:1

### كيف يعمل الرفع في React Native

`	ypescript
// imageUpload.ts
// 1. اختيار الصورة
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  quality: 0.8,
  allowsEditing: false,
});

// 2. ضغط الصورة إذا كانت كبيرة
const compressed = await ImageManipulator.manipulateAsync(
  result.assets[0].uri,
  [{ resize: { width: 2000 } }],
  { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
);

// 3. طلب presigned URL
const { uploadUrl, objectKey, publicUrl } = await api.getUploadUrl(...);

// 4. رفع مباشر لـ R2
await fetch(uploadUrl, {
  method: PUT,
  body: blob, // FileReader او fetch(fileUri)
  headers: {} // لا content-type (سبب موثق في upload-url/route.ts)
});

// 5. تأكيد
await api.confirmUpload({ objectKey, publicUrl, source, ... });
`

### مخاطر الرفع في RN

- **content-type:** لا تضع Content-Type في PUT لـ R2 (iOS Safari تضيف charset)
- **الحجم:** اضغط الصورة قبل الرفع (expo-image-manipulator)
- **الصلاحيات:** اطلب NSPhotoLibraryUsageDescription و CAMERA_PERMISSION
- **في dev:** endpoint /room/upload-url يرجع 501 - يجب الرجوع لـ FormData

---

## 10. خطة الرندر والـ Polling

### كيف يعمل الرندر حالياً

1. POST /render: يتحقق من حدود الرندر + device cooldown + screen budget
2. ينقل الجلسة إلى ready_to_render
3. يطلق executeRenderPipeline في after() (غير متزامن)
4. Pipeline: tryClaimRenderingSlot -> rendering -> AI render -> result_ready
5. كل تغيير في الحالة يُنشر عبر Redis pub/sub للـ SSE

### Polling في React Native (النسخة الأولى)

لا نستخدم SSE - polling فقط:

`	ypescript
// utils/polling.ts
export async function pollForResult(
  sessionId: string,
  token: string,
  onUpdate: (session: Session) => void
): Promise<Session> {
  const startedAt = Date.now();
  const TIMEOUT = 310_000; // 5 دقائق
  
  while (Date.now() - startedAt < TIMEOUT) {
    const session = await api.getSession(sessionId, token);
    onUpdate(session);
    
    if (session.status === result_ready || session.status === failed) {
      return session;
    }
    
    // interval متكيف: 2.5ث اول 30ث، ثم 5ث حتى 90ث، ثم 10ث
    const elapsed = Date.now() - startedAt;
    const interval = elapsed < 30000 ? 2500 : elapsed < 90000 ? 5000 : 10000;
    await sleep(interval);
  }
  throw new Error(timeout);
}
`

### دور الخادم مع الشاشة الكبيرة

- الشاشة تستمر تتلقى تحديثات عبر Redis SSE كما هو الحال الآن
- RN لا يتدخل في هذا المسار
- كل POST من RN ينشر event عبر publishRoomPreviewSessionEvent

---

## 11. خطة التعديل/اعادة المحاولة (Edit/Retry)

### المشكلة

عندما يضغط العميل تعديل:
1. الجوال يخفي النتيجة
2. العميل يختار منتجاً جديداً
3. يضغط ابدأ التصميم مرة ثانية
4. **الشاشة الكبيرة يجب أن تعلم بذلك**

### كيف يعمل حالياً

- setShowResult(false) في MobileSessionClient
- العميل يختار منتج -> POST /product (ينقل الحالة إلى product_selected وينشر event)
- POST /render -> ready_to_render وينشر event
- الشاشة تتلقى التحديثات عبر SSE تلقائياً

### في React Native

- نفس المنطق: POST /product ثم POST /render
- كل واحدة منها تنشر event عبر Redis -> الشاشة تتحدث
- لا يحتاج endpoint إضافي

### حدود الرندر

- MAX_RENDERS_PER_SESSION = 2 (env: MAX_RENDERS_PER_SESSION)
- عند الوصول: 429 مع RENDER_LIMIT_REACHED
- RN يجب عرض رسالة مناسبة
- عند فشل الرندر: renderCount يُنقص تلقائياً (decrementRenderCount)

### Endpoint request-retry المقترح

`
POST /api/room-preview/mobile/request-retry
Headers: x-session-token: TOKEN
Body: { productId: string }

// يقوم بـ:
1. selectProduct
2. التحقق من render limit
3. تغيير الحالة لـ product_selected
4. نشر event للشاشة
// لا يبدأ الرندر - العميل يضغط زر الرندر منفصل
`

---

## 12. عقد API المقترح لـ React Native

### نظرة عامة

جميع endpoints تقبل: Authorization: Bearer TOKEN او x-session-token: TOKEN

### GET /api/room-preview/mobile/session/[sessionId]
- الغرض: جلب حالة الجلسة الكاملة (للـ polling)
- Headers: x-session-token
- Response: RoomPreviewSession object
- الاخطاء: 404 SESSION_NOT_FOUND, 410 SESSION_EXPIRED
- يُستخدم في: كل شاشة، خاصة RenderingScreen
- الحالة الحالية: GET /api/room-preview/sessions/[id] يؤدي هذا الدور بالفعل

### POST /api/room-preview/mobile/connect
- الغرض: ربط الجوال بالجلسة
- Body: {}
- Response: RoomPreviewSession
- الاخطاء: 400 SESSION_INVALID_STATE, 404, 410
- الحالة الحالية: POST /sessions/[id]/connect يؤدي هذا الدور

### POST /api/room-preview/mobile/gate
- الغرض: اكمال البوابة (جديد - يحتاج انشاء)
- Body: { flow: customer_new|customer_existing|customer_confirm|employee, name, phone, countryCode, dialCode, customerId, employeeCode }
- Response: { ok: true, role: string }
- الاخطاء: 400 validation, 401 invalid token
- يستدعي داخلياً: createAndBindUserSession + connectMobileToSession
- **يحتاج إنشاء جديد في Next.js**

### GET /api/room-preview/mobile/products
- الغرض: قائمة المنتجات (جديد)
- Response: { products: RoomPreviewProduct[] }
- الحالة الحالية: المنتجات تُمرَّر من SSR props - لا يوجد JSON endpoint
- **يحتاج إنشاء جديد**

### POST /api/room-preview/mobile/select-product
- الغرض: اختيار منتج
- Body: { productId: string } او { barcode: string }
- Response: { success: true, product, session }
- الحالة الحالية: POST /sessions/[id]/product يؤدي هذا الدور

### POST /api/room-preview/mobile/upload-url
- الغرض: طلب presigned URL لـ R2
- Body: { source: camera|gallery, fileName, fileType, fileSize }
- Response: { uploadUrl, objectKey, publicUrl, method: PUT }
- الحالة الحالية: POST /sessions/[id]/room/upload-url يؤدي هذا الدور

### POST /api/room-preview/mobile/confirm-upload
- الغرض: تاكيد رفع الصورة
- Body: { objectKey, publicUrl, source, fileType, fileSize }
- Response: { success: true, room, session }
- الحالة الحالية: POST /sessions/[id]/room/confirm-upload يؤدي هذا الدور

### POST /api/room-preview/mobile/render
- الغرض: بدء الرندر
- Body: {}
- Response: 202 + RoomPreviewSession
- الاخطاء: 429 RENDER_LIMIT_REACHED, RENDER_DEVICE_COOLDOWN, SCREEN_BUDGET_EXHAUSTED
- الحالة الحالية: POST /sessions/[id]/render يؤدي هذا الدور

### GET /api/room-preview/mobile/result/[sessionId]
- الغرض: جلب نتيجة الرندر
- Response: { status, renderResult: { imageUrl, kind, generatedAt } }
- الحالة الحالية: GET /sessions/[id] يتضمن renderResult

### POST /api/room-preview/mobile/request-retry
- الغرض: طلب رندر جديد بعد التعديل (جديد)
- Body: { productId: string }
- يستدعي داخلياً: selectProduct + التحقق من الحدود
- **يحتاج إنشاء جديد**

### POST /api/room-preview/mobile/heartbeat
- الغرض: نبضة حياة
- Headers: x-session-token
- Response: { ok: true } او { ok: false, terminal: true }
- الحالة الحالية: POST /sessions/[id]/heartbeat يؤدي هذا الدور

### POST /api/room-preview/mobile/complete
- الغرض: تحديد الجلسة كمكتملة
- Response: { ok: true }
- الحالة الحالية: غير موجود - اكتمال الجلسة يحدث تلقائياً

---

## 13. قائمة تغييرات الـ Backend

### أعلى أولوية

- [ ] إضافة endpoint: POST /api/room-preview/mobile/gate (JSON بديل عن Server Actions)
- [ ] إضافة endpoint: GET /api/room-preview/mobile/products (قائمة المنتجات)
- [ ] إضافة endpoint: POST /api/room-preview/mobile/request-retry
- [ ] التأكد أن api-guard يقبل Authorization: Bearer TOKEN بالإضافة لـ x-session-token

### متوسط الأولوية

- [ ] فصل منطق البوابة عن Server Actions إلى service function مستقلة
- [ ] التأكد من أن POST /activate يرجع JSON مع التوكن (بالإضافة لوضع الـ cookie)
- [ ] توثيق جميع error codes في ملف مركزي

### منخفض الأولوية

- [ ] إضافة version prefix للـ mobile API: /api/room-preview/mobile/v1/
- [ ] rate limiting منفصل لـ RN (device ID مختلف عن IP)

### لا تُعدَّل

- session-machine.ts
- render-service.ts
- الـ SSE endpoint للشاشة
- schema.prisma

---

## 14. ما يجب ألا يُكسر

| العنصر | السبب |
|--------|-------|
| إنشاء الجلسة من الشاشة | قلب النظام |
| عرض QR | بوابة الدخول |
| مسار المتصفح الجوال | fallback إلزامي خلال الهجرة |
| لوحة التحكم الادمن | مستقلة تماماً |
| آلة الحالة session-machine | منطق الانتقالات |
| Redis + SSE للشاشة الكبيرة | التزامن مع الشاشة |
| pipeline رندر AI | الوظيفة الجوهرية |
| رفع الصور R2 | التخزين الدائم |
| بوابة العميل/الموظف الحالية | لا تُغلَق أثناء الهجرة |
| انتهاء الجلسة وتنظيفها | session-cleanup.ts |
| حدود الرندر | الحماية المالية |

---

## 15. ترتيب التنفيذ (الآمن)

| الخطوة | المهمة | الملاحظة |
|--------|---------|----------|
| 1 | توثيق التدفق الحالي | هذا الملف |
| 2 | تطبيع عقد API + انشاء endpoints الناقصة | في Next.js |
| 3 | إضافة Bearer token support (مع الابقاء على cookie) | تعديل api-guard |
| 4 | انشاء endpoint gate JSON | أولوية قصوى |
| 5 | انشاء endpoint products JSON | أولوية قصوى |
| 6 | اختبار أن مسار المتصفح لا يزال يعمل | اختبار يدوي |
| 7 | انشاء مشروع Expo خارج هذا المجلد | mobile-app/ |
| 8 | SessionEntryScreen + deep link | RN |
| 9 | GateScreen | RN |
| 10 | ProductSelectionScreen | RN |
| 11 | RoomUploadScreen | RN |
| 12 | RenderingScreen + polling | RN |
| 13 | ResultScreen | RN |
| 14 | Retry/Edit flow | RN |
| 15 | اختبار التدفق الكامل مع الشاشة | integration test |
| 16 | بناء Android APK | production |
| 17 | iOS لاحقاً | بعد Apple Developer |

---

## 16. ملاحظات ختامية

### نقاط قوة النظام الحالي لـ RN

- api-guard يدعم x-session-token header بالفعل
- التوكن HMAC حتمي لا يحتاج DB
- presigned URL upload يعمل مع RN مباشرة
- polling مدعوم في الكود الحالي

### نقاط تحتاج تطوير

- البوابة تحتاج JSON endpoint جديد
- قائمة المنتجات تحتاج JSON endpoint جديد
- Bearer token support في api-guard (يضيف سطرين فقط)

### نموذج Prisma المهم

- RoomPreviewSession: id, status, mobileConnected, selectedRoom, selectedProduct, renderResult, renderCount, customerId, lastMobileSeenAt
- Customer: id, phoneE164, name, countryCode, expiresAt
- CustomerExperience: resultImageUrl, productName (للعميل العائد)
- RenderJob: status, input, result, inputHash
- SessionEvent: للتشخيص والتتبع

# React Native Mobile App Migration Documentation

## 1. Project Overview

هذا المشروع هو نظام **Room Preview** يعمل داخل مشروع **Next.js App Router**. الفكرة الأساسية: شاشة كبيرة في المعرض تنشئ جلسة، تعرض QR، يفتح العميل الرابط على الجوال، يدخل بيانات البوابة، يختار منتجا، يرفع صورة الغرفة، ثم يقوم backend بتشغيل AI render ويعرض النتيجة على الجوال والشاشة الكبيرة.

| الجهة | الدور الحالي | قرار الهجرة |
|---|---|---|
| الشاشة الكبيرة | إنشاء الجلسة، عرض QR، متابعة الحالة والنتيجة عبر SSE/polling | تبقى Next.js |
| العميل على الجوال | Gate، اختيار المنتج، رفع الصورة، بدء الرندر، مشاهدة النتيجة | تستبدل بتطبيق React Native/Expo Native بالكامل |
| لوحة الإدارة | مراقبة الجلسات، الرندرات، diagnostics، issues، cleanup | تبقى Next.js |
| Backend/API/DB/AI | الجلسات، Prisma/PostgreSQL، Redis/SSE، R2/S3، Gemini، state machine | يبقى Next.js مصدر الحقيقة |

المهم: React Native سيستبدل فقط تجربة العميل على الجوال. لا يتم نقل الشاشة الكبيرة، لوحة الإدارة، قاعدة البيانات، Redis/SSE، R2، أو Gemini إلى التطبيق. التطبيق القادم لا يستخدم WebView، ولا يصل إلى قاعدة البيانات مباشرة، ولا يحمل أي Gemini/API secrets.

## 2. Current System Architecture

النظام الحالي مبني كالتالي:

- **Next.js App Router**: صفحات داخل `app/room-preview/*` وRoute Handlers داخل `app/api/room-preview/*`.
- **Big Screen UI**: `app/room-preview/screen/page.tsx` ينشئ جلسة، و`app/room-preview/screen/[sessionId]/page.tsx` يعرض QR وحالة الجلسة.
- **Mobile Web Flow**: `app/room-preview/activate/[sessionId]`, `app/room-preview/gate/[sessionId]`, و`app/room-preview/mobile/[sessionId]`.
- **API routes**: session CRUD، connect، heartbeat، room upload، product select، render، events، diagnostics، cleanup.
- **Prisma/PostgreSQL**: مصدر الحالة الدائم للجلسات، العملاء، render jobs، events، issues.
- **Redis/SSE**: الشاشة الكبيرة تستقبل updates من `/events`; Redis هو النقل بين instances، مع fallback in-memory.
- **Cloudflare R2/S3 uploads**: direct presigned upload في production، وfallback FormData/local storage في dev.
- **Gemini AI render pipeline**: `render-service.ts` + `gemini-provider.ts`.
- **Session state machine**: `session-machine.ts` يحدد transitions المسموحة.
- **Admin diagnostics**: `SessionEvent` و`SessionIssue` تعرض في `/admin` و`/admin/diagnostics`.
- **Cleanup/expiration**: cron/admin endpoint يغلق الجلسات المنتهية أو stuck.

رسم مبسط:

```text
Big Screen (Next.js)
  -> POST /api/room-preview/sessions
  -> QR: /api/room-preview/sessions/:id/activate?t=token
  -> GET /api/room-preview/sessions/:id/events (SSE)
  -> fallback polling GET /api/room-preview/sessions/:id

Mobile Web today / React Native later
  -> activate/deep link
  -> gate/connect/product/upload/render/result APIs
  -> polling GET /api/room-preview/sessions/:id

Next.js Backend
  -> session-machine
  -> Prisma/PostgreSQL
  -> Redis pub/sub
  -> R2/S3 upload
  -> Gemini render
  -> SessionEvent/SessionIssue
```

## 3. Current User Journey

| Step | Files | API | Status before/after | Mobile UI | Big screen |
|---|---|---|---|---|---|
| 1. إنشاء جلسة | `ScreenLauncherClient.tsx`, `sessions/route.ts`, `session-service.ts` | `POST /api/room-preview/sessions` | `none -> waiting_for_mobile` | لا يوجد | شاشة loading ثم QR |
| 2. عرض QR | `screen/[sessionId]/page.tsx`, `SessionQRCode.tsx` | `POST /screen-token`, `GET /events` | يبقى `waiting_for_mobile` | لا يوجد | QR ورقم/حالة انتظار الجوال |
| 3. فتح QR | `activate/route.ts` | `GET /api/room-preview/sessions/:id/activate?t=...` | لا يغير status مباشرة | redirect إلى gate/mobile | يسجل `qr_opened` |
| 4. token/cookie | `activate/route.ts`, `cookies.ts`, `session-token.ts` | activate GET/POST | لا يغير status | يضع `rp-mobile-token` HttpOnly | لا يتغير |
| 5. Gate | `gate/[sessionId]/page.tsx`, `actions.ts`, `gate-form.tsx` | Server Action وليس JSON API | قبل connect غالبا `waiting_for_mobile` | اختيار عميل جديد/عميل سابق، ثم تأكيد | ينتظر اتصال الجوال |
| 6. Mobile connect | `actions.ts`, `useMobileSession.ts`, `connect/route.ts` | `POST /connect` | `waiting_for_mobile -> mobile_connected` | تظهر شاشة رفع الصورة | الشاشة تعرض connected وتنتظر الغرفة |
| 7. رفع صورة الغرفة | `RoomStep.tsx`, `room-service.ts`, `room/* routes` | `POST /room/upload-url`, R2 PUT, `POST /room/confirm-upload` أو `POST /room` | `mobile_connected -> room_selected` | preview للصورة أو خطأ upload | يعرض صورة الغرفة وينتظر المنتج |
| 8. اختيار المنتج | `ProductStep.tsx`, `product-service.ts`, `product/route.ts` | `POST /product` | `room_selected -> product_selected` | carousel/thumbnail product | يعرض المنتج المختار |
| 9. بدء الرندر | `ResultStep.tsx`, `useMobileSession.ts`, `render/route.ts` | `POST /render` | `product_selected/result_ready/failed -> ready_to_render -> rendering` | شاشة انتظار native/web | الشاشة تعرض rendering |
| 10. اكتمال الرندر | `render-service.ts`, `gemini-provider.ts` | backend async via `after()` | `rendering -> result_ready` | نتيجة fullscreen | نتيجة fullscreen |
| 11. edit/retry | `ResultStep.tsx`, `session-machine.ts` | حاليا `POST /product` أو `POST /render`; لا يوجد `request-retry` مخصص | `result_ready -> product_selected` أو `ready_to_render` | تعديل/إعادة إنشاء | يجب أن يخرج من overlay القديم |
| 12. إنهاء/فشل/انتهاء | `session-cleanup.ts`, `cleanup/route.ts` | `GET /cleanup` أو admin actions | `result_ready -> completed`, أو `expired/failed` | expired/failed state | reset تلقائي للشاشة |

## 4. Current Mobile Web Flow Details

**Activation route**: المسار الأساسي هو `GET /api/room-preview/sessions/[sessionId]/activate?t=TOKEN&lang=...`. يتحقق من HMAC token بواسطة `verifySessionToken`، يضع cookie باسم `rp-mobile-token`، ثم يعمل redirect إلى `/room-preview/mobile/[sessionId]`. يوجد fallback قديم `ActivationHandler.tsx` يقرأ token من hash ويرسل POST، لكن التعليق في الكود يقول إن المسار الأساسي الآن هو GET API.

**Token/cookie**: `MOBILE_TOKEN_COOKIE = rp-mobile-token`. `guardSession` يقبل حاليا `x-session-token` أو cookie فقط. لا يقبل `Authorization: Bearer` بعد. `SCREEN_TOKEN_COOKIE = rp-screen-token` يستخدم للشاشة وSSE.

**Gate form**: `GatePage` يعرض `GateForm`. المنطق الفعلي في `actions.ts` كـ Server Action، لذلك هو غير مناسب مباشرة لتطبيق React Native. التدفقات الموجودة: `customer_new`, `customer_existing`, `customer_confirm`, `employee`. العميل السابق يتم البحث عنه بالهاتف ثم يذهب لشاشة تأكيد مع آخر `CustomerExperience` إن وجدت. بعد نجاح gate يتم إنشاء `UserSession`, ربطه بـ `RoomPreviewSession`, وربط `Customer` إذا كان عميلا، ثم محاولة `connectMobileToSession`.

**Mobile session page**: `mobile/[sessionId]/page.tsx` يتحقق من `gate_ok_${sessionId}` أو `sessionHasCompletedGate`. إذا لم تكتمل البوابة يوجه إلى gate. بعدها يمرر products من `getRoomPreviewMockProducts()` إلى `MobileSessionClient`.

**Client flow**: `useMobileSession.ts` هو orchestrator: fetch session، auto-connect إذا لم تكن متصلة، heartbeat، diagnostics، upload، product debounce، render request، polling حتى `result_ready/failed`.

**Room upload**: `RoomStep.tsx` حاليا يستخدم gallery فقط في الواجهة، لكن types/routes تدعم `camera` و`gallery`. يتم ضغط الصورة client-side عبر `compressRoomImage`. في production يطلب presigned URL ثم يرفع ArrayBuffer إلى R2 بدون Content-Type headers لتفادي CORS/iOS مشاكل، ثم يؤكد upload. عند عدم توفر R2 يستخدم FormData fallback إلى `/room`.

**Product selection**: `ProductStep.tsx` يعرض carousel من mock products. الحفظ مؤجل 700ms. قبل render يتم flush للمنتج pending.

**Render/waiting/result**: `ResultStep.tsx` يعرض زر create، ثم overlay progress. `POST /render` يرجع بسرعة بـ202 وحالة `ready_to_render`; backend يشغل `executeRenderPipeline` ويحدث الحالة إلى `rendering` ثم `result_ready`. الجوال يستخدم `pollForRenderResult`.

**Back navigation**: `useMobileSession` يدفع history entry ويلتقط `popstate`، ثم يعيد fetch للحالة ويثبت المستخدم في الخطوة الصحيحة بدلا من الخروج.

**Heartbeat**: `useMobileHeartbeat` يرسل `POST /heartbeat` كل 30 ثانية. إذا فشل يعرض تحذير اتصال ضعيف ويسجل `weak_connection_warning_shown`.

**Polling/SSE**: الجوال يستخدم polling، الشاشة تستخدم SSE من `/events` ثم polling fallback. أول نسخة Native يجب أن تستخدم polling كل 2 ثانية ولا تستخدم SSE.

## 5. Current Files Map

| File path | Purpose | Current responsibility | React Native migration decision | Risk/notes |
|---|---|---|---|---|
| `app/room-preview/mobile/[sessionId]/page.tsx` | صفحة mobile web | gate guard، redirect token، تحميل products | تستبدل UI، تبقى fallback browser | تعتمد على cookies وSSR |
| `components/room-preview/MobileSessionClient.tsx` | mobile web shell | يركب خطوات room/product/result | يستبدل بـ native screens | منطق كثير داخل hooks |
| `features/room-preview/mobile/useMobileSession.ts` | orchestration | connect/upload/product/render/poll/errors | يستخرج منه contract، لا يستخدم مباشرة في RN | browser APIs كثيرة |
| `features/room-preview/mobile/useMobileHeartbeat.ts` | presence | heartbeat كل 30s | يعاد تطبيقه Native | يحتاج Bearer auth |
| `features/room-preview/mobile/useMobileDiagnostics.ts` | lifecycle diagnostics | page visibility, JS errors, polling burst | يبقى web؛ RN ينشئ بديله | browser-only |
| `features/room-preview/mobile/RoomStep.tsx` | upload UI | gallery picker web | يستبدل بـ Camera/ImagePicker | validation يجب أن تبقى API |
| `features/room-preview/mobile/ProductStep.tsx` | product UI | carousel منتجات | يستبدل بـ native product screen | product API JSON مطلوب |
| `features/room-preview/mobile/ResultStep.tsx` | render/result UI | progress/result/edit/share | يستبدل بـ native result screen | edit حاليا ليس endpoint واضح |
| `app/room-preview/activate/[sessionId]/page.tsx` | fallback activate page | redirect قديم | يبقى web fallback | لا يكفي للتطبيق native |
| `app/api/room-preview/sessions/[sessionId]/activate/route.ts` | activation API | token verify + cookie + redirect | يضاف deep link/native support | token في query |
| `app/room-preview/gate/[sessionId]/*` | gate web | Server Action customer/employee | يحتاج JSON API جديد | أكبر refactor للموبايل |
| `app/room-preview/screen/*` | big screen | QR/status/result | يبقى Next.js | لا ينقل |
| `components/room-preview/ScreenSessionClient.tsx` | screen client | SSE/polling/result overlay | يبقى Next.js | يعتمد على EventSource cookie |
| `features/room-preview/screen/useScreenSession.ts` | screen state | SSE + fallback polling + auto reset | يبقى Next.js | مهم big-screen sync |
| `app/api/room-preview/sessions/route.ts` | create session | screen creates session + token | يبقى backend | rate limits/IP |
| `app/api/room-preview/sessions/[sessionId]/route.ts` | get session | JSON session | صالح لـ RN بعد auth policy review | حاليا GET لا يتطلب token |
| `connect/route.ts` | mobile connect | guard + status transition | reusable | Bearer مطلوب |
| `heartbeat/route.ts` | presence | mobile/screen heartbeat | reusable | يقبل `x-session-token`/cookies فقط |
| `room/route.ts` | FormData upload | server upload fallback | يبقى fallback | RN يفضل presigned |
| `room/upload-url/route.ts` | presigned upload | R2 PUT URL | reusable | RN content-type/CORS حساس |
| `room/confirm-upload/route.ts` | confirm upload | يثبت selectedRoom | reusable | لا يتحقق من وجود object فعليا |
| `product/route.ts` | select product | mock product by id/barcode | reusable جزئيا | لا يوجد GET products |
| `render/route.ts` | start render | limits, locks, budget, pipeline | reusable | لا تستدعى Gemini من RN |
| `events/route.ts` | SSE | screen realtime | يبقى للشاشة | RN v1 لا يستخدمه |
| `diagnostics/route.ts` | events/issues intake | rate limit/dedupe/log | reusable لـ RN | يحتاج auth/Bearer optional |
| `cleanup/route.ts` | cron cleanup | expire/stuck/complete | يبقى backend | لا علاقة مباشرة بـ RN |
| `lib/room-preview/session-machine.ts` | state transitions | source of truth | يبقى كما هو | لا تكسره |
| `lib/room-preview/session-service.ts` | service layer | create/connect/select | reusable | مناسب لاستخراج APIs |
| `lib/room-preview/session-repository.ts` | Prisma mapping | DB access | backend only | RN لا يصل له |
| `lib/room-preview/api-guard.ts` | mobile auth guard | cookie/x-session-token | refactor لإضافة Bearer | لا تكسر cookies |
| `lib/room-preview/session-token.ts` | HMAC token | generate/verify | reusable backend | token deterministic |
| `lib/room-preview/upload-service.ts` | server upload validation | MIME/size/dimensions/storage | backend only | presigned confirm يتجاوز بعض checks |
| `lib/room-preview/room-service.ts` | web upload client | direct upload/fallback | RN يبني نسخة API client | browser File/XHR |
| `lib/room-preview/render-service.ts` | render pipeline | RenderJob + Gemini + result | backend only | secret لا يظهر في RN |
| `lib/room-preview/render-providers/gemini-provider.ts` | Gemini provider | image prep, retries, validation | backend only | prompt details لا يحتاجها RN |
| `lib/room-preview/session-diagnostics.ts` | events/issues writer | SessionEvent/Issue | backend source | RN يرسل events عبر API |
| `lib/room-preview/issue-catalog.ts` | issue definitions | userVisible/messages/actions | reusable conceptually | تحتاج رسائل عربية Native |
| `lib/room-preview/stuck-detection.ts` | issue detection | stuck sessions | backend only | مفيد admin |
| `lib/room-preview/session-cleanup.ts` | cleanup | expired/failed/completed/stale | backend only | يحكم terminal states |
| `prisma/schema.prisma` | data model | DB schema | لا يصل له RN | مصدر العقود |

## 6. Current API Map

| Method | Path | Purpose | Request body/query | Auth | Response shape | Using component | Transition | RN ready? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/room-preview/sessions` | create session | headers `x-screen-token?`, `x-room-preview-source` | screen token optional | session + `token` | `ScreenLauncherClient` | none -> waiting_for_mobile | No for RN | خاص بالشاشة |
| GET | `/api/room-preview/sessions/[sessionId]` | fetch session | path | none currently | `RoomPreviewSession` or code/error | mobile/screen hooks | none | Needs refactor | RN يفضل token auth |
| GET | `/api/room-preview/sessions/[sessionId]/activate?t=` | QR activation | query `t`, `lang` | token query | redirect + cookie | QR browser | no status | Web only | RN يحتاج deep link parsing |
| POST | `/api/room-preview/sessions/[sessionId]/activate` | legacy activation | `{token}` | token body | `{ok:true}` + cookie | `ActivationHandler` | none | No | browser fallback |
| POST | `/api/room-preview/sessions/[sessionId]/connect` | connect mobile | empty | cookie or `x-session-token` | session | gate action/useMobileSession | waiting -> mobile_connected | Needs Bearer | reusable logic |
| POST | `/api/room-preview/sessions/[sessionId]/heartbeat` | presence | empty | cookie/`x-session-token`/screen cookie | `{ok, terminal?, status?}` | mobile/screen heartbeat | none | Needs Bearer | source auto-detected |
| POST | `/api/room-preview/sessions/[sessionId]/room/upload-url` | presigned R2 | `{fileName,fileType,fileSize,source}` | guardSession | `{uploadUrl,objectKey,publicUrl,method,headers}` | `room-service.ts` | none | Needs Bearer | supports JPEG/PNG/WebP, 15MB |
| PUT | R2 presigned URL | upload binary | raw bytes | signed URL | 2xx/4xx | browser XHR | none | Yes with care | send raw bytes, avoid content-type header |
| POST | `/api/room-preview/sessions/[sessionId]/room/confirm-upload` | confirm upload | `{objectKey,publicUrl,fileName,fileType,fileSize,source}` | guardSession | `{success,room,session}` | `room-service.ts` | mobile_connected -> room_selected | Needs Bearer | validates objectKey prefix |
| POST | `/api/room-preview/sessions/[sessionId]/room` | FormData fallback | `source`, `image` or demo | guardSession | `{success,room,session}` | fallback web | mobile_connected -> room_selected | Maybe | RN should prefer direct upload |
| POST | `/api/room-preview/sessions/[sessionId]/product` | select product | `{productId}` or `{barcode}` | guardSession | `{success,product,session}` | `ProductStep` | room_selected -> product_selected | Needs Bearer | no GET products |
| POST | `/api/room-preview/sessions/[sessionId]/render` | start render | empty | guardSession | session, status 202 | `ResultStep` | product_selected/result_ready/failed -> ready/rendering | Needs Bearer | enforces limits/budget |
| GET | `/api/room-preview/sessions/[sessionId]/events` | SSE screen updates | path | screen cookie or `x-session-token` | event stream | screen only | none | No for RN v1 | keep for big screen |
| POST | `/api/room-preview/sessions/[sessionId]/diagnostics` | log event/issue | `{source,eventType,level,code,...}` | currently session validity only | `{ok:true}` | diagnostics hooks | none | Needs refactor | should accept RN events |
| GET | `/api/room-preview/cleanup` | cron cleanup | headers secret/bearer cron | cleanup secret | counts | cron/admin | terminal transitions | No | backend only |
| POST | `/api/room-preview/sessions/[sessionId]/screen-token` | store screen cookie | `{token}` | token body | `{ok:true}` | screen launcher | none | No | screen only |

## 7. Session State Machine Mapping

| Status | Meaning | Mobile web UI | Future RN UI | Big screen | Moves in | Moves out | What can go wrong | Events/issues |
|---|---|---|---|---|---|---|---|---|
| `created` | legacy initial state | نادر | loading/connect | waiting | `createRoomPreviewSessionState` legacy | connect | stale legacy | `SESSION_STUCK` |
| `waiting_for_mobile` | QR جاهز ولم يتصل الجوال | gate/mobile loading | SessionEntry/Gate | QR + waiting phone | create session | connect | QR opened no connect | `session_created`, `qr_displayed`, `qr_opened`, `QR_OPENED_NO_MOBILE_CONNECT` |
| `mobile_connected` | الجوال متصل | RoomStep | RoomUploadScreen | waiting room | `POST /connect` أو gate action | upload room | no progress | `mobile_connect_success`, `MOBILE_OPENED_NO_PROGRESS` |
| `room_selected` | صورة الغرفة محفوظة | ProductStep | ProductSelectionScreen | room thumbnail, waiting product | `/room` أو `/confirm-upload` | select product | upload verify failed | `room_upload_completed`, `ROOM_UPLOAD_FAILED/STUCK` |
| `product_selected` | المنتج محفوظ | render CTA | Rendering ready CTA | product shown, waiting render | `/product` | `/render` | product not found | `product_selected`, `product_changed` |
| `ready_to_render` | render requested قبل claim | waiting overlay | RenderingScreen | preparing/rendering | `/render` | renderer claim | stuck before renderer | `render_requested`, `RENDER_TIMEOUT` |
| `rendering` | AI pipeline يعمل | progress overlay | RenderingScreen polling | rendering status | `tryClaimRenderingSlot` | complete/fail/cleanup | Gemini timeout/fail | `render_started`, `RENDER_FAILED`, `RENDER_TIMEOUT` |
| `result_ready` | النتيجة جاهزة | Result overlay | ResultScreen before/after | fullscreen result | render complete | completed أو retry/edit | stale old result on retry | `render_completed`, `result_seen_mobile`, `result_displayed_screen` |
| `completed` | عرض النتيجة انتهى | completed banner/expired-like | Result/Completed state | screen reset | cleanup after display | terminal | heartbeat stops | `session_completed` |
| `failed` | render failed أو stuck | failed state/retry | FailedScreen | failed + reset | render failure/cleanup | room/product/render allowed جزئيا | retry unclear | `render_failed`, `RENDER_FAILED` |
| `expired` | الجلسة انتهت | expired state | ExpiredScreen | reset/error | cleanup/admin/expiry | terminal | old QR | `session_expired`, `SESSION_STUCK` |

## 8. Database / Prisma Models

React Native لا يصل إلى Prisma أو PostgreSQL مباشرة. كل استخدام للبيانات يكون عبر Next.js API فقط.

| Model | Purpose | Important fields | Mobile use | Big screen use | Admin use | RN access |
|---|---|---|---|---|---|---|
| `RoomPreviewSession` | مصدر حالة الجلسة | `id,status,mobileConnected,renderCount,selectedRoom,selectedProduct,renderResult,expiresAt,screenId,userSessionId,customerId,lastMobileSeenAt,lastScreenSeenAt,lastRenderHash` | يعرض الحالة، يرفع الغرفة، يختار المنتج، يبدأ الرندر | QR/status/result | metrics/actions/diagnostics | API فقط |
| `RenderJob` | سجل كل محاولة render | `sessionId,status,input,result,failureReason,inputHash` | لا يراه غالبا إلا عبر status/result | لا يحتاجه مباشرة | render jobs feed | API فقط إن احتجنا |
| `SessionEvent` | timeline | `source,eventType,level,statusBefore,statusAfter,code,message,metadata` | يسجل أحداث mobile | يسجل screen events | diagnostics timeline | API diagnostics |
| `SessionIssue` | مشاكل قابلة للمراقبة | `issueType,severity,status,userVisible,customerMessageKey,adminMessage,recommendedAction,count` | رسائل أخطاء إذا userVisible | غالبا admin/screen فقط | issues table | API فقط |
| `UserSession` | gate identity قبل التجربة | `name,role,phone,countryCode,dialCode,employeeCode,ip` | gate customer/employee | لا يستخدم | analytics | API gate |
| `Customer` | ذاكرة العميل العائد | `name,phoneE164,countryCode,dialCode,lastSeenAt,expiresAt` | lookup/confirm | لا يستخدم | customer history | API gate |
| `CustomerExperience` | آخر نتائج العميل | `customerId,sessionId,roomImageUrl,productId,productName,resultImageUrl,expiresAt` | تظهر في confirm للعميل العائد | لا يستخدم | history | API gate |
| `Screen` | شاشة معرض مسجلة | `name,secretHash,dailyBudget,isActive,lastRenderAt` | لا يستخدم | create session/render budget | admin screens/budget | لا |

## 9. Auth / Token / QR / Deep Link Plan

الحالي:

- الشاشة تنشئ session وتستلم `token` من `generateSessionToken(session.id)`.
- QR الحالي غالبا: `/api/room-preview/sessions/SESSION_ID/activate?t=TOKEN&lang=ar`.
- activate API يتحقق من `verifySessionToken(token, sessionId)`.
- يضع cookie: `rp-mobile-token`.
- gate action يتحقق من cookie، وفي development يسمح أحيانا بدون token.
- `guardSession` يقبل `x-session-token` أو `rp-mobile-token`.
- `heartbeat` يقبل `x-session-token` أو `rp-mobile-token` للموبايل، و`rp-screen-token` للشاشة.
- screen token منفصل cookie باسم `rp-screen-token`.

خطة React Native:

- التطبيق يستقبل `sessionId` و`mobileToken` من QR/deep link.
- يخزن token في `Expo SecureStore`.
- كل requests ترسل `Authorization: Bearer ${mobileToken}`.
- backend يضيف Bearer support إلى `guardSession` و`heartbeat` مع إبقاء cookie و`x-session-token` حتى لا ينكسر web fallback.
- لا يتم حذف activate web flow.

Recommended URL formats:

```text
Web fallback:
https://your-domain.com/room-preview/activate?sessionId=SESSION_ID&t=TOKEN
أو الحالي:
https://your-domain.com/api/room-preview/sessions/SESSION_ID/activate?t=TOKEN

Native deep link:
baytpreview://session/SESSION_ID?t=TOKEN

Universal/App Link:
https://your-domain.com/app/session/SESSION_ID?t=TOKEN
```

في React Native: `deepLink.ts` يقرأ path أو query، يستخرج `sessionId` و`t`، يتحقق أنهما موجودان، يخزن token، ثم يفتح `SessionEntryScreen`.

## 10. React Native Target App Requirements

| Screen | Purpose | Current source | API calls | Local state | Navigation | Edge cases | Big screen sync | Statuses |
|---|---|---|---|---|---|---|---|---|
| `SessionEntryScreen` | استقبال deep link والتحقق من session | activate/mobile page | GET session, connect/heartbeat | token/sessionId | -> Gate أو Upload | invalid/expired token | connect update | waiting/mobile_connected |
| `GateScreen` | customer/employee login | gate page/actions/form | proposed `/mobile/gate` | form, flow, customerId | -> Products/Upload | validation/not found | mobile connect after success | waiting/mobile_connected |
| `ProductSelectionScreen` | اختيار المنتج | `ProductStep` | GET products, POST select-product | selectedProduct | -> Upload أو Rendering | product missing | product update | room/product_selected |
| `RoomUploadScreen` | camera/gallery upload | `RoomStep`, room-service | upload-url, R2 PUT, confirm-upload | asset/progress | -> Products/Rendering | permissions/large/invalid | room update | room_selected |
| `RenderingScreen` | انتظار AI | `ResultStep`, polling | POST render, GET session/result | progress/polling | -> Result/Failed | timeout/limit | rendering update | ready/rendering/result_ready |
| `ResultScreen` | before/after/result actions | `ResultStep` | GET result, request-retry | image/result | -> Products/Upload/Rendering | stale result/render limit | result overlay | result_ready/completed |
| `ExpiredScreen` | جلسة منتهية | mobile expired state | none/GET session | message | exit | old QR | screen reset | expired |
| `FailedScreen` | render failed | mobile failed state | retry/render/session | error | retry/edit | repeated fail | failed state | failed |
| `ErrorScreen` | network/unknown | SessionStatePanel | diagnostics optional | error code | retry | offline | none | any |

## 11. React Native App Architecture

المشروع القادم يجب أن يكون خارج Next.js، مثلا:

```text
mobile-app/
  app/
    _layout.tsx
    session/[sessionId].tsx
    gate.tsx
    products.tsx
    upload-room.tsx
    rendering.tsx
    result.tsx
    expired.tsx
    failed.tsx
    error.tsx
  src/
    api/
      roomPreviewApi.ts
    types/
      roomPreview.ts
    store/
      sessionStore.ts
    components/
      ScreenShell.tsx
      PrimaryButton.tsx
      ProductCard.tsx
      PhoneInput.tsx
      BeforeAfterSlider.tsx
      ErrorState.tsx
      LoadingState.tsx
    utils/
      tokenStorage.ts
      imageUpload.ts
      polling.ts
      deepLink.ts
    config/
      env.ts
```

Recommended libraries: Expo, Expo Router, Expo SecureStore, Expo ImagePicker, Expo Camera عند الحاجة، Zustand، React Query اختياري، وReact Native Gesture Handler/Reanimated للـ before/after slider.

سبب إبقاء التطبيق خارج Next.js: فصل native build lifecycle عن web/backend، تجنب خلط Metro وNext tooling، وعدم تعريض backend secrets داخل mobile bundle.

## 12. Native Screens Mapping

### SessionEntryScreen

- Current source files: `activate/route.ts`, `mobile/[sessionId]/page.tsx`, `useMobileSession.ts`.
- Current behavior: token query -> cookie -> mobile page -> gate check -> auto connect.
- Future native behavior: parse deep link, save token, fetch session, decide route.
- API calls: `GET /mobile/session/[sessionId]`, `POST /mobile/connect`, `POST /mobile/heartbeat`.
- Validation: missing token/session -> ErrorScreen؛ expired -> ExpiredScreen.
- Related events/issues: `qr_opened`, `mobile_page_loaded`, `mobile_connect_started/success/failed`, `QR_OPENED_NO_MOBILE_CONNECT`.
- Big screen update: connect must publish `session_updated`.

### GateScreen

- Current source: `gate/[sessionId]/actions.ts`, `gate-form.tsx`, `customer-service.ts`, `analytics/validators.ts`.
- Behavior: new customer creates/refreshes `Customer`; existing customer lookup ثم confirm؛ employee creates `UserSession`.
- Future: native forms with same flows and validation.
- API calls: `POST /mobile/gate`.
- Errors: invalid phone/name/employeeCode, customer not found, invalid token.
- Events/issues: `customer_info_submit_started/success/failed`, `customer_existing_found/not_found`.
- Big screen: after gate success connect session if still waiting.

### ProductSelectionScreen

- Current source: `ProductStep.tsx`, `mock-products.ts`, `product/route.ts`.
- Future: native grid/carousel. Should call GET products instead of receiving SSR products.
- API: `GET /mobile/products`, `POST /mobile/select-product`.
- Validation: productId or barcode required; unknown -> `PRODUCT_NOT_FOUND`.
- Events: `product_selected`, `product_changed`.
- Big screen: product thumbnail/name updates immediately.

### RoomUploadScreen

- Current source: `RoomStep.tsx`, `room-service.ts`, `upload-service.ts`, `room/upload-url`, `confirm-upload`.
- Future: camera/gallery picker, local compression, progress.
- API: `POST upload-url`, R2 PUT raw bytes, `POST confirm-upload`.
- Errors: permission denied, size/type invalid, upload failed/stuck.
- Issues: `ROOM_UPLOAD_FAILED`, `ROOM_UPLOAD_STUCK`, `IMAGE_TOO_LARGE`, `IMAGE_INVALID`.
- Big screen: selected room image appears after confirm.

### RenderingScreen

- Current source: `ResultStep.tsx`, `render/route.ts`, `render-service.ts`, `session-polling.ts`.
- Future: start render then poll every 2s initially.
- API: `POST /mobile/render`, `GET /mobile/session/[sessionId]`.
- Errors: `RENDER_LIMIT_REACHED`, `RENDER_DEVICE_COOLDOWN`, `SCREEN_BUDGET_EXHAUSTED`, timeout.
- Issues: `RENDER_TIMEOUT`, `RENDER_FAILED`.
- Big screen: ready/rendering/result updates through existing Redis/SSE.

### ResultScreen

- Current source: `ResultStep.tsx`, `ScreenSessionClient.tsx`, `session-machine.ts`.
- Future: show before/after, product card, save/share, edit/retry.
- API: `GET /mobile/result/[sessionId]`, `POST /mobile/request-retry`.
- Data: room image, product, result image, render count/limit.
- Risk: edit/retry must clear old `renderResult` and publish update immediately.

### ExpiredScreen / FailedScreen / ErrorScreen

- Current source: `MobileSessionClient.tsx`, `SessionStatePanel.tsx`, cleanup and render failure logic.
- Future: Arabic clear message, retry only where backend allows.
- API: mostly GET session, diagnostics, retry/render if failed.
- Events/issues: `session_expired`, `render_failed`, `NETWORK_INTERRUPTED`.

## 13. Upload & Image Handling Plan

Current upload:

1. Web selects `File`.
2. `compressRoomImage` compresses over 1MB to JPEG, max dimension 1920.
3. Web calls `/room/upload-url` if R2 enabled.
4. Browser uploads **ArrayBuffer** to presigned URL using XHR without headers.
5. Web calls `/room/confirm-upload`.
6. Backend calls `selectRoomForSession`, publishes SSE, resolves upload issues.
7. Fallback: `POST /room` FormData validates magic bytes/dimensions and uploads via `storageUpload`.

Important limits:

- `/room` FormData: 10MB pre-parse, supported JPEG/PNG/WebP, min 400px, max 20000px, aspect ratio 0.25-4.0.
- `/upload-url`: 15MB, JPEG/PNG/WebP, signed URL expires 5 minutes.
- R2 PUT intentionally does not sign Content-Type/Content-Length.

React Native plan:

1. User chooses Camera or Gallery.
2. App checks basic size/type if available.
3. App compresses/resizes to JPEG if large.
4. App requests presigned upload URL.
5. App uploads raw bytes to R2 without adding content-type unless backend changes the signing contract.
6. App calls confirm-upload with `objectKey/publicUrl/fileSize/fileType/source`.
7. Backend updates session and big screen receives update.

Failure cases:

- Permission denied: show "يرجى السماح بالوصول إلى الكاميرا أو الصور."
- Too large: "الصورة كبيرة جداً، يرجى اختيار صورة أصغر."
- Invalid image: "الصورة غير صالحة، يرجى اختيار صورة JPG أو PNG أو WebP."
- Upload failed: "تعذر رفع الصورة، يرجى المحاولة مرة أخرى."
- Upload stuck: show retry and log `ROOM_UPLOAD_STUCK`.

Needs verification: `confirm-upload` لا يتحقق فعليا من أن object موجود في R2 قبل حفظ `publicUrl`; يفضل إضافة HEAD أو signed callback لاحقا.

## 14. Render Flow Plan

Current render:

- Endpoint: `POST /api/room-preview/sessions/[sessionId]/render`.
- Requires selected room and product.
- Uses render lock via Redis/in-memory, render count limit default 2, device cooldown, screen cooldown/budget.
- Moves session to `ready_to_render`, clears old `renderResult`, publishes `session_updated`.
- `after()` runs `executeRenderPipeline`.
- Pipeline claims `ready_to_render -> rendering`, creates `RenderJob`, calls Gemini, uploads result, sets `result_ready`.
- Failure opens `RENDER_FAILED`, marks session `failed`, decrements render count.
- Cleanup marks stuck `ready_to_render/rendering` as `failed` and opens `RENDER_TIMEOUT`.

React Native:

- RN calls backend render endpoint only.
- RN never calls Gemini.
- RN polls every 2 seconds in v1. Later can tune to 2.5/5/10 like web.
- RN navigates to ResultScreen when status is `result_ready`.
- RN navigates to FailedScreen when status is `failed`.
- Big screen continues receiving Redis/SSE.

## 15. Result / Retry / Edit Flow

Current behavior:

- Mobile shows result overlay with result image, product card, download/share, modify.
- Big screen shows result fullscreen while status is `result_ready`.
- `markReadyToRenderTransition` clears old `renderResult` to force the screen out of old overlay.
- `selectProductTransition` allows status `result_ready`, sets status `product_selected`, clears old result.
- No dedicated `request-retry` endpoint exists in inspected files. Edit currently uses `onModify`: hides local result, tracks `edit_requested`, and if `localProductId` exists calls `handleProductSelect(localProductId)`.
- Render from `failed` is allowed if room/product still exist. Selecting a new room after `failed` clears product.

React Native behavior:

- `ResultScreen` shows before/after if possible: room image + result image.
- Edit/retry should call a dedicated `POST /api/room-preview/mobile/request-retry`.
- Backend should clear old `renderResult`, move to `product_selected` or `room_selected` depending on requested edit type, and publish update immediately.
- Render limit remains backend-enforced.
- If limit reached: "وصلت إلى عدد المحاولات المتاحة لهذه التجربة."

Known risk: retry/edit must not silently keep the old result on the big screen. Clearing `renderResult` and publishing `session_updated` is mandatory.

## 16. UX Session Issues / Customer-Facing Errors

| Technical issue/event | When it happens | Current code/file | Customer currently sees | Big screen | Admin dashboard | RN should show | Retry? | Related endpoint/status | Resolve/close | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `MOBILE_UI_BLOCKED` | UI unresponsive | catalog only | recovery reload if surfaced | no direct | open issue | "حدث خلل في واجهة التطبيق، يرجى المحاولة مرة أخرى." | Yes | diagnostics | reload/retry | Needs verification trigger |
| `MOBILE_HYDRATION_STUCK` | web hydration stuck | catalog only | reload | no direct | open issue | Not typical RN; show startup error | Yes | diagnostics | reload | Web-only mostly |
| `MOBILE_RAPID_RELOAD` | repeated reload within 10s | `useMobileDiagnostics` | not visible | none | warning issue | admin-only in RN unless crash loop | No | diagnostics | quiet period | admin-only |
| `MOBILE_EXCESSIVE_POLLING` | >6 fetches/10s | `useMobileDiagnostics` | not visible | none | warning issue | admin-only | No | diagnostics | fix loop | admin-only |
| `QR_OPENED_NO_MOBILE_CONNECT` | QR opened but no connect | `stuck-detection.ts` | reconnect message if surfaced | waiting | open issue | "تعذر الاتصال بالجلسة، يرجى مسح الرمز مرة أخرى." | Yes | activate/connect | connect succeeds | both |
| `MOBILE_OPENED_NO_PROGRESS` | mobile loaded but no room/product/render | `stuck-detection.ts` | none direct | waiting | open issue | "لم يتم تسجيل أي تقدم، يرجى المتابعة أو إعادة المحاولة." | Yes | session status | progress event | both |
| `ROOM_UPLOAD_FAILED` | upload save/confirm failed | `room/route.ts`, `confirm-upload` | upload error/recovery | old state | issue open | "تعذر رفع الصورة، يرجى المحاولة مرة أخرى." | Yes | room upload | successful upload resolves | both |
| `ROOM_UPLOAD_STUCK` | upload started no completion | `stuck-detection.ts` | none direct | waiting room/product | issue open | "استغرق رفع الصورة وقتاً أطول من المتوقع، يرجى المحاولة مرة أخرى." | Yes | room upload | upload complete resolves | both |
| `IMAGE_TOO_LARGE` | file size exceeds limit | `room/route.ts`, `upload-service.ts`, `upload-url` | too large/recovery | no change | issue open | "الصورة كبيرة جداً، يرجى اختيار صورة أصغر." | Yes | upload | choose smaller | both |
| `IMAGE_INVALID` | invalid mime/decode/dimensions | `upload-service.ts`, `room/route.ts` | invalid image | no change | issue open | "الصورة غير صالحة، يرجى اختيار صورة أوضح." | Yes | upload | valid upload | both |
| `IMAGE_QUALITY_INSUFFICIENT` | quality insufficient | catalog only | not currently triggered | no change | issue if opened | "الصورة غير مناسبة، يرجى تصوير الأرضية بشكل أوضح." | Yes | upload/render | retake | Needs verification trigger |
| `FLOOR_NOT_VISIBLE` | floor not visible | Gemini sentinel exists | likely render failed | failed | issue if opened | "الصورة غير مناسبة، يرجى إظهار الأرضية بوضوح." | Yes | render | retake/upload | Current provider throws generic error |
| `RENDER_TIMEOUT` | render stuck/timeout | cleanup/stuck detection/mobile timeout | retry render message | failed/reset | issue open | "استغرق التصميم وقتاً أطول من المتوقع، يرجى المحاولة مرة أخرى." | Yes | render | successful render resolves | both |
| `RENDER_FAILED` | Gemini/render pipeline failed | `render-service.ts`, `render/route.ts` | retry render/reload | failed | issue open | "تعذر إنشاء التصميم، يرجى المحاولة مرة أخرى." | Yes | render | successful render resolves | both |
| `SCREEN_NOT_UPDATING` | SSE failed, screen polling fallback | `useScreenSession.ts` | none | polling warning | issue/event | لا تعرض للعميل غالبا | No | events | SSE restored/manual | admin/screen only |
| `NETWORK_INTERRUPTED` | network failed | catalog/client errors | weak connection warning | maybe stale | issue if sent | "يبدو أن الاتصال ضعيف، يرجى التأكد من الإنترنت." | Yes | any | reconnect | both |
| `render_limit_reached`/`RENDER_LIMIT_REACHED` | max renders per session | `render/route.ts` | Arabic limit message | no new render | warning event | "وصلت إلى عدد المحاولات المتاحة لهذه التجربة." | No | render | new session | shown + logged |
| `screen_budget_exhausted`/`SCREEN_BUDGET_EXHAUSTED` | screen daily budget | `render/route.ts` | contact staff message | no render | warning event | "انتهى الحد اليومي لهذه الشاشة، يرجى التواصل مع الموظف." | No | render | admin budget reset | shown + logged |
| heartbeat failed | heartbeat request fails | heartbeat hooks | weak connection banner | maybe none | `mobile_stale_detected` later | "يبدو أن الاتصال ضعيف، يرجى التأكد من الإنترنت." | Yes | heartbeat | heartbeat success | both |
| expired session | expiresAt/cleanup | `session-status`, `cleanup` | expired screen | reset | event | "انتهت صلاحية الجلسة، يرجى مسح رمز QR جديد." | No | GET session | new QR | shown |
| failed session | render failed/stuck | render/cleanup | failed screen | failed/reset | issue/event | "تعذر إكمال التصميم، يمكنك المحاولة مرة أخرى." | Yes if backend allows | failed | retry success | shown |

رسائل عربية مقترحة:

- "تعذر رفع الصورة، يرجى المحاولة مرة أخرى."
- "الصورة كبيرة جداً، يرجى اختيار صورة أصغر."
- "الصورة غير مناسبة، يرجى تصوير الأرضية بشكل أوضح."
- "استغرق التصميم وقتاً أطول من المتوقع، يرجى المحاولة مرة أخرى."
- "انتهت صلاحية الجلسة، يرجى مسح رمز QR جديد."
- "يبدو أن الاتصال ضعيف، يرجى التأكد من الإنترنت."

تصنيف العرض:

- shown to customer: upload/render/expired/failed/network/limit/errors ذات `userVisible=true`.
- admin only: `SCREEN_NOT_UPDATING`, `MOBILE_RAPID_RELOAD`, `MOBILE_EXCESSIVE_POLLING`, `SESSION_STUCK` غالبا.
- both: upload failures، render failures، QR no connect، network interruptions.

## 17. API Contract Needed for React Native

كل endpoint مقترح يدعم:

- `Authorization: Bearer mobileToken`
- cookie fallback للمتصفح الحالي
- JSON ثابت: `{ ok, data?, error?: { code, message, customerMessage? } }`

| Endpoint | Purpose | Body/query | Response | Validation/auth | State transition | Screen |
|---|---|---|---|---|---|---|
| `GET /api/room-preview/mobile/session/[sessionId]` | fetch mobile-safe session | path | `{session, gateCompleted, limits?}` | Bearer/cookie | none | all |
| `POST /api/room-preview/mobile/connect` | connect mobile | `{sessionId}` | `{session}` | token matches session | waiting -> mobile_connected | SessionEntry |
| `POST /api/room-preview/mobile/gate` | customer/employee gate | `{sessionId, flow, ...}` | `{session, customer?, previousExperiences?}` | token + zod | creates UserSession, maybe connect | Gate |
| `GET /api/room-preview/mobile/products` | products list | optional category | `{products}` | token optional/required | none | Products |
| `POST /api/room-preview/mobile/select-product` | save product | `{sessionId, productId|barcode}` | `{session, product}` | token | room -> product | Products |
| `POST /api/room-preview/mobile/upload-url` | get R2 URL | `{sessionId,fileName,fileType,fileSize,source}` | `{uploadUrl,objectKey,publicUrl,headers}` | token, mime/size | none | Upload |
| `POST /api/room-preview/mobile/confirm-upload` | save uploaded room | `{sessionId,objectKey,publicUrl,fileType,fileSize,source}` | `{session,room}` | token, key prefix | connected -> room_selected | Upload |
| `POST /api/room-preview/mobile/render` | start render | `{sessionId}` | `{session}` | token, limits | product/result/failed -> ready | Rendering |
| `GET /api/room-preview/mobile/result/[sessionId]` | get result data | path | `{session,result,before,product}` | token | none | Result |
| `POST /api/room-preview/mobile/request-retry` | clear result/edit | `{sessionId, mode: "same_product"|"change_product"|"change_room"}` | `{session}` | token, render limit info | result_ready/failed -> product_selected/room_selected | Result/Failed |
| `POST /api/room-preview/mobile/heartbeat` | presence | `{sessionId}` أو path | `{ok, terminal, status}` | token | none | all |
| `POST /api/room-preview/mobile/complete` | optional completion | `{sessionId}` | `{session}` | token | result_ready -> completed optional | Result |

Most endpoints can reuse existing backend logic: `connectMobileToSession`, `selectRoomForSession`, `selectProductForSession`, render route internals, `trackSessionEvent`, `openSessionIssue`, customer services.

## 18. Backend Refactor Checklist

- فصل gate Server Action إلى service reusable ثم JSON endpoint.
- إضافة Bearer token support إلى `guardSession` و`heartbeat`.
- إبقاء cookie auth و`x-session-token` للمتصفح الحالي.
- إضافة mobile-safe GET session endpoint أو تأمين الحالي بدون كسر الشاشة.
- إضافة GET products JSON endpoint.
- توحيد JSON error codes ورسائل عربية customerMessage.
- جعل upload-url/confirm-upload مناسبين لـ RN raw byte upload.
- إضافة `request-retry` endpoint واضح.
- إضافة result endpoint mobile-friendly.
- ضمان heartbeat من native.
- جعل diagnostics يقبل native events ويحول codes إلى SessionIssue.
- ضمان كل native action تنشر `publishRoomPreviewSessionEvent`.
- اختبار أن browser mobile flow ما زال يعمل.

## 19. Things That Must NOT Be Broken

- big screen session creation.
- QR display.
- browser mobile fallback.
- admin dashboard.
- session state machine.
- Redis/SSE screen updates.
- AI render pipeline.
- R2 uploads.
- existing customer/employee gate.
- session expiration/cleanup.
- render limit logic.
- retry/edit behavior.
- heartbeat/presence.
- SessionEvent/SessionIssue diagnostics.
- current production deployment.

## 20. Migration Plan

1. Read and document current flow.
2. Normalize backend API contract.
3. Add Bearer token support while keeping cookies.
4. Add missing mobile JSON endpoints.
5. Add stable error codes.
6. Ensure SessionIssue/SessionEvent works for native actions.
7. Test existing browser mobile flow still works.
8. Create Expo app outside this project.
9. Configure deep links.
10. Implement SessionEntryScreen.
11. Implement GateScreen.
12. Implement ProductSelectionScreen.
13. Implement RoomUploadScreen.
14. Implement render polling.
15. Implement ResultScreen.
16. Implement retry/edit.
17. Implement expired/failed/error screens.
18. Test full flow with big screen.
19. Test bad network/upload failures/render failures.
20. Prepare Android build.
21. Prepare iOS build later.

## 21. Acceptance Criteria

- QR opens the app when installed.
- QR opens browser fallback when app is not installed.
- Native app connects to existing session.
- Gate works for customer and employee flows.
- Product selection works.
- Room image upload works.
- Render starts from native.
- Big screen updates during native actions.
- Native app polls status and shows progress.
- Result appears on native app.
- Result appears on big screen.
- Retry/edit works and clears old result.
- Render limit is enforced.
- Expired/failed sessions show correct native screens.
- UX errors show clear Arabic messages.
- Admin dashboard still shows events/issues.
- Existing browser mobile flow still works.
- No database access from React Native.
- No Gemini/API secret exposed to React Native.

## 22. Final Notes / Risks

- **Cookie auth vs Bearer auth**: أهم refactor. أضف Bearer بدون حذف cookies.
- **Deep link fallback**: يحتاج App Links/Universal Links واختبار QR scanners.
- **Image upload differences**: React Native blobs/ArrayBuffer وcontent-type قد تختلف عن المتصفح.
- **R2 CORS/content-type**: لا تضف headers غير موقعة حتى لا تفشل preflight أو signature.
- **Duplicate render risk**: أبق render lock والـ idempotency في backend.
- **Retry/edit stale result risk**: يجب مسح `renderResult` ونشر update فورا.
- **Big screen sync risk**: كل native mutation يجب أن يستخدم نفس services التي تنشر Redis/SSE.
- **Polling cost**: ابدأ كل 2 ثانية أثناء rendering فقط، وأبطئ بعد مدة طويلة.
- **Production flow**: لا تغير QR/browser fallback دفعة واحدة.

الخطوة التالية الموصى بها: قبل إنشاء تطبيق Expo، نفذ أو تحقق من عقد mobile API وBearer token support داخل Next.js مع إبقاء تجربة mobile web الحالية تعمل كما هي.
