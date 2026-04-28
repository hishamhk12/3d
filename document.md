# التوثيق التقني للمشروع

## 1. فكرة النظام كما تظهر من الكود

المشروع يبني تجربة معاينة أرضيات داخل غرفة عبر مسارين متزامنين: شاشة عرض في المعرض، وجهاز موبايل يفتحه العميل عبر QR. الشاشة تنشئ جلسة، تعرض QR، وتراقب حالة الجلسة حتى يظهر ناتج الرندر. الموبايل يدخل عبر رابط موقّع، يمر عبر نموذج تعريف المستخدم، ثم يرفع صورة غرفة أو يستخدم غرفة تجريبية، يختار منتج أرضيات، ويطلب توليد صورة معاينة.

النطاق الأساسي موجود تحت `room-preview`. الجلسة محفوظة في PostgreSQL عبر Prisma، وتنتقل بين حالات نصية مثل `waiting_for_mobile`, `mobile_connected`, `room_selected`, `product_selected`, `ready_to_render`, `rendering`, `result_ready`, `failed`, `expired`, و`completed`. الرندر الفعلي يستخدم مزود Gemini عبر `@google/genai` في `lib/room-preview/render-providers/gemini-provider.ts`. توجد بنية تشخيص منفصلة تسجل أحداث الجلسات ومشاكلها في جداول `SessionEvent` و`SessionIssue`.

## 2. البنية العامة للمشروع

الواجهات والصفحات موجودة داخل `app/` باستخدام App Router. أهم صفحات التجربة هي `app/room-preview/screen/page.tsx` لإنشاء جلسة الشاشة، و`app/room-preview/screen/[sessionId]/page.tsx` لعرض QR وحالة الجلسة، و`app/room-preview/mobile/[sessionId]/page.tsx` لتجربة الموبايل، و`app/room-preview/gate/[sessionId]/page.tsx` لبوابة تعريف المستخدم.

مكونات العرض الأساسية موجودة في `components/room-preview/`، مثل `ScreenLauncherClient.tsx`, `ScreenSessionClient.tsx`, `MobileSessionClient.tsx`, و`SessionQRCode.tsx`. منطق الواجهة مقسوم أيضاً داخل `features/room-preview/screen/` و`features/room-preview/mobile/`، خصوصاً `useScreenSession.ts` و`useMobileSession.ts`.

طبقة الخدمات موجودة في `lib/room-preview/`. ملفات `session-service.ts`, `session-machine.ts`, و`session-repository.ts` تمثل قلب دورة حياة الجلسة. ملفات `room-service.ts`, `product-service.ts`, و`upload-service.ts` تغطي حفظ الغرفة والمنتج ورفع الصور. الرندر موجود في `render-service.ts`, `render-repository.ts`, و`render-providers/`.

ملف قاعدة البيانات هو `prisma/schema.prisma`. الإعدادات العامة موزعة بين `next.config.ts`, `proxy.ts`, `instrumentation.ts`, `lib/env.ts`, `lib/redis.ts`, و`lib/server/prisma.ts`.

## 3. تدفق تجربة الشاشة

تبدأ الشاشة من `app/room-preview/screen/page.tsx` التي تعرض `ScreenLauncherClient`. هذا المكون يحاول أولاً إعادة استخدام جلسة مخزنة في `localStorage` إذا كانت غير منتهية، ثم ينشئ جلسة جديدة عبر `POST /api/room-preview/sessions`. إذا عاد token مع الجلسة، يتم إرساله إلى `POST /api/room-preview/sessions/[sessionId]/screen-token` لتخزينه في Cookie باسم `rp-screen-token`.

بعد ذلك تنتقل الشاشة إلى `/room-preview/screen/[sessionId]`. الصفحة تقرأ token الشاشة من الكوكي، وتبني رابط QR باتجاه:

`/api/room-preview/sessions/[sessionId]/activate?t=<token>&lang=<locale>`

ثم تولد QR على الخادم باستخدام مكتبة `qrcode`. في نفس الصفحة يتم عرض `ScreenSessionClient` الذي يستخدم `useScreenSession` لتحميل الجلسة مبدئياً من `GET /api/room-preview/sessions/[sessionId]`.

بعد التحميل، يحاول `useScreenSession` فتح قناة SSE عبر `GET /api/room-preview/sessions/[sessionId]/events`. هذه القناة ترسل تحديثات `session_updated` عند تغير الجلسة. إذا تعطلت SSE، ينتقل الكود إلى polling كل ثانيتين عبر `createRoomPreviewSessionPoller`.

عند الحالة `waiting_for_mobile` أو عدم وجود اتصال موبايل، تعرض الشاشة QR وحالة انتظار. عند اختيار الغرفة والمنتج، تتغير لوحة الحالة. عند `result_ready` ومع وجود `renderResult.imageUrl` تعرض الشاشة النتيجة كصورة كاملة. بعد مدة `SCREEN_RESULT_RESET_MS` يعيد Hook الشاشة إلى شاشة إنشاء جلسة جديدة. حالات الخطأ أو الانتهاء تعاد أيضاً إلى شاشة البداية بعد مؤقتات محددة في `constants.ts`.

## 4. تدفق تجربة الموبايل

يدخل المستخدم من QR إلى `GET /api/room-preview/sessions/[sessionId]/activate`. هذا المسار يتحقق من HMAC token، يضعه في Cookie باسم `rp-mobile-token`، ثم يعيد التوجيه إلى `/room-preview/mobile/[sessionId]`.

صفحة الموبايل `app/room-preview/mobile/[sessionId]/page.tsx` لا تعرض التجربة مباشرة إلا إذا اكتملت بوابة التعريف. إذا لم تكن الجلسة مرتبطة بـ `UserSession`، تعيد الصفحة التوجيه إلى `/room-preview/gate/[sessionId]`. نموذج البوابة في `app/room-preview/gate/[sessionId]/actions.ts` يتحقق من token الموجود في الكوكي، ثم ينشئ `UserSession` ويربطه بـ `RoomPreviewSession`.

بعد الدخول إلى تجربة الموبايل، يقوم `useMobileSession` بتحميل الجلسة من API، ثم ينفذ اتصالاً تلقائياً إن لم تكن `mobileConnected` مفعلة، عبر `POST /connect`. بعدها تظهر خطوة رفع صورة الغرفة في `RoomStep`. عند اختيار صورة من الكاميرا أو المعرض، يتم ضغطها في المتصفح عبر `compressRoomImage` ثم رفعها كـ `FormData` إلى `POST /room`.

بعد حفظ الغرفة، يظهر اختيار المنتج في `ProductStep`. اختيار المنتج يتم محلياً فوراً ثم يحفظ بعد debounce مدته 700ms عبر `POST /product`. بعد وجود غرفة ومنتج تظهر خطوة النتيجة في `ResultStep`، ومنها يرسل الموبايل `POST /render`. يرجع الطلب بسرعة نسبياً بجلسة في حالة `ready_to_render`، ثم يراقب الموبايل النتيجة عبر polling إلى أن تصبح الحالة `result_ready` أو `failed`.

## 5. دورة حياة الجلسة حسب الكود

الحالات معرفة في `lib/room-preview/types.ts`، ومنطق الانتقال في `lib/room-preview/session-machine.ts`.

الإنشاء الفعلي من `createRoomPreviewSession` يبدأ بحالة `waiting_for_mobile`، رغم أن النوع يحتوي أيضاً على `created` وأن `createSession` في repository يملك default باسم `created` إذا استدعي مباشرة. اتصال الموبايل ينقل الحالة إلى `mobile_connected`. حفظ الغرفة ينقلها إلى `room_selected`. حفظ المنتج ينقلها إلى `product_selected`. طلب الرندر ينقلها إلى `ready_to_render`. خط الرندر يلتقط الحالة ذرياً من قاعدة البيانات ويحولها إلى `rendering` عبر `tryClaimRenderingSlot`. عند نجاح الرندر تصبح `result_ready`. عند فشل الرندر تصبح `failed`.

هناك انتقالات تنظيف خارج تفاعل المستخدم في `session-cleanup.ts`: الجلسات القديمة تصبح `expired`، جلسات الانتظار الخاملة تصبح `expired`، جلسات `ready_to_render` أو `rendering` العالقة تصبح `failed`، وجلسات `result_ready` تتحول لاحقاً إلى `completed`.

## 6. واجهات الـ API

`POST /api/room-preview/sessions` ينشئ جلسة، يطبق rate limit حسب IP وعدد الجلسات النشطة، ويدعم ربط الجلسة بشاشة عند وجود `x-screen-token`. يرجع كائن الجلسة كاملاً مع `token`.

`GET /api/room-preview/sessions/[sessionId]` يرجع حالة الجلسة أو `404` عند عدم وجودها أو `410` عند انتهاء صلاحيتها.

`POST /api/room-preview/sessions/[sessionId]/connect` يتحقق من token عبر `guardSession`، ثم ينقل الجلسة إلى `mobile_connected`.

`POST /api/room-preview/sessions/[sessionId]/room` يستقبل `FormData` يحتوي `source`. المصدر قد يكون `demo` مع `demoRoomId`، أو `camera/gallery` مع ملف صورة. يحفظ الغرفة في الجلسة ويرجع `success` وبيانات الغرفة.

`POST /api/room-preview/sessions/[sessionId]/product` يستقبل JSON يحتوي `productId` أو `barcode`، يبحث في `data/room-preview/mock-products.ts`، ثم يحفظ المنتج في الجلسة.

`POST /api/room-preview/sessions/[sessionId]/render` يبدأ الرندر بعد التحقق من token، limits، cooldown، budget، وعدد الرندرات للجلسة. يرجع الجلسة بحالة `ready_to_render` مع status 202، ثم يشغل خط الرندر داخل `after()`.

`GET /api/room-preview/sessions/[sessionId]/events` يوفر SSE للشاشة، ويتحقق من token عبر header أو Cookie الشاشة.

`POST /api/room-preview/sessions/[sessionId]/diagnostics` يستقبل أحداث تشخيص من الموبايل أو الشاشة، يطبق dedupe وrate limit داخل الذاكرة، ثم يسجل الحدث في قاعدة البيانات عبر `after()`.

`GET/POST /api/room-preview/sessions/[sessionId]/activate` يفعّل رابط QR ويضع token الموبايل في Cookie. `POST /screen-token` يخزن token الشاشة في Cookie.

`GET /api/room-preview/cleanup` يشغل تنظيف الجلسات، ومحمي بـ `x-cleanup-secret` عند ضبط `CLEANUP_SECRET`.

توجد أيضاً واجهات إدارية للشاشات تحت `/api/admin/screens` لإضافة وتعديل وحذف الشاشات، محمية بـ Cookie الإدارة.

## 7. قاعدة البيانات والنماذج

`Screen` يمثل شاشة فعلية في المعرض. يحتوي الاسم، الموقع، hash للسر، ميزانية رندر يومية، حالة التفعيل، وآخر وقت رندر. يرتبط بعدة جلسات.

`RoomPreviewSession` هو محور النظام. يحتوي حالة الجلسة، اتصال الموبايل، عداد الرندرات، الغرفة المختارة، المنتج المختار، نتيجة الرندر، تاريخ الانتهاء، الشاشة المرتبطة، hash آخر رندر، وربط اختياري مع `UserSession`.

`RenderJob` يمثل محاولة رندر. يحتوي `status`, `input`, `result`, `failureReason`, و`inputHash`، ويرتبط بجلسة واحدة.

`SessionEvent` يسجل timeline تشخيصي للجلسة، مثل تغير الحالة، فتح QR، رفع الغرفة، بدء الرندر، وفشل الرندر.

`SessionIssue` يسجل مشاكل مجمعة قابلة للفتح والحل، مثل `ROOM_UPLOAD_FAILED`, `RENDER_TIMEOUT`, و`SCREEN_NOT_UPDATING`.

`UserSession` يمثل المستخدم الذي اجتاز بوابة الدخول، مع الاسم والدور ورقم الهاتف أو كود الموظف وIP. يرتبط بجلسة غرفة واحدة.

`Event` يمثل tracking عام لمسار المستخدم، مثل `user_entered`, `qr_scanned`, `room_opened`, و`render_completed`.

## 8. رفع الصور والتخزين

رفع صورة الغرفة يبدأ من الموبايل. قبل الرفع يحاول المتصفح ضغط الصورة في `lib/room-preview/image-compress.ts` بتقليل أطول ضلع إلى 1920px وإعادة الترميز كـ JPEG عند الحاجة.

الخادم يستقبل الصورة في `upload-service.ts`. التحقق يشمل حجم الملف، MIME types المسموحة `jpeg/png/webp`، magic bytes، وفحص أبعاد الصورة باستخدام `sharp`. الحد الأقصى للرفع 10MB، والحد الأدنى للأبعاد 400px، مع منع نسب أبعاد شاذة.

التخزين موحد عبر `lib/storage.ts`. في التطوير يمكن التخزين محلياً داخل `public/uploads/...`. في الإنتاج يمنع الكود التخزين المحلي ويرفع خطأ إذا لم يكن `STORAGE_PROVIDER` مضبوطاً على `r2` أو `s3`. التخزين السحابي يستخدم S3-compatible API عبر `@aws-sdk/client-s3`، والمتغيرات المستخدمة تحمل أسماء R2.

صور المنتجات في التدفق الحالي ليست مرفوعة من المستخدم، بل معرفة في `data/room-preview/mock-products.ts` وتشير إلى ملفات داخل `public/PQC201-1220X180X6/`.

## 9. الرندر وتوليد النتيجة

طلب الرندر يبدأ من `POST /render`. قبل التشغيل يتحقق المسار من token الجلسة، قفل Redis للرندر، cooldown للجهاز، حد أقصى لرندرين لكل جلسة، cooldown للشاشة، وميزانية يومية للشاشة إن كانت الجلسة مرتبطة بشاشة.

بعد نقل الجلسة إلى `ready_to_render`، يشغل `executeRenderPipeline` من `render-service.ts`. الخط يحاول ذرياً تحويل الجلسة من `ready_to_render` إلى `rendering`، ثم ينشئ `RenderJob` بحالة `pending` ويحدثه إلى `processing`.

المزود الفعلي هو Gemini عبر `gemini-provider.ts`. يتم تحميل صورة الغرفة وصورة المنتج، تقليل الحجم عند الحاجة، بناء prompt من `prompt-template-v2.ts`، ثم استدعاء `GoogleGenAI`. الكود يدعم عدة موديلات من `GEMINI_IMAGE_MODELS` مع retries. بعد الحصول على الصورة، يتحقق من الحجم، الأبعاد، اختلافها عن صورة الإدخال، وانحراف نسبة الأبعاد. النتيجة تحفظ كـ PNG عبر `storageUpload` داخل `uploads/room-preview/renders`.

عند النجاح يتم تحديث `RenderJob` إلى `completed`، وتخزين `renderResult` في الجلسة، ونقلها إلى `result_ready`. عند الفشل يتم تحديث job إلى `failed`، ونقل الجلسة إلى `failed`، وفتح issue من نوع `RENDER_FAILED` أو تسجيل timeout عند التنظيف.

## 10. التشخيص وتسجيل الأحداث

يوجد مستويان من التسجيل. الأول تشخيص الجلسات في `SessionEvent` و`SessionIssue` عبر `lib/room-preview/session-diagnostics.ts`. تستخدمه الخوادم والواجهات لتسجيل أحداث مثل `qr_displayed`, `mobile_page_loaded`, `room_upload_started`, `room_upload_completed`, `render_started`, `render_completed`, و`render_failed`.

المستوى الثاني هو tracking لمسار المستخدم في جدول `Event` عبر `lib/analytics/event-tracker.ts`. هذا يربط أحداثاً مثل دخول المستخدم، فتح الغرفة، ونتيجة الرندر بـ `UserSession`.

على العميل، `session-diagnostics-client.ts` يستخدم `sendBeacon` أو `fetch keepalive` مع throttle محلي. `useMobileDiagnostics.ts` يراقب lifecycle وأخطاء JS والتنقلات وتغير visibility. على الشاشة، `useScreenSession.ts` يسجل انقطاع التحديثات والانتقال إلى polling.

التسجيل النصي يستخدم `pino` عبر `lib/logger.ts`. كما توجد ملفات Sentry وتهيئة instrumentation لتفعيل Sentry والتحقق من env وتشغيل cleanup محلياً في التطوير.

## 11. الاعتماديات التقنية

Next.js 16 وReact 19 يشكلان إطار الواجهة والـ route handlers. Prisma 7 مع PostgreSQL يمثلان طبقة البيانات. Redis عبر `ioredis` يستخدم للـ rate limiting، قفل الرندر، SSE pub/sub، semaphore لمزود Gemini، وميزانية الشاشة اليومية. عند غيابه توجد fallbacks داخل الذاكرة أو قاعدة البيانات في بعض المسارات.

`@google/genai` يستخدم لتوليد صورة الرندر. `sharp` يستخدم لفحص وتحضير الصور والنتائج. `@aws-sdk/client-s3` يستخدم للتخزين المتوافق مع S3/R2. `qrcode` يستخدم لتوليد QR على الخادم. `zod` يستخدم للتحقق من بعض payloads مثل اختيار المنتج ونموذج البوابة والتشخيص. `pino` وSentry يستخدمان للتسجيل والمراقبة.

## 12. ملاحظات ومخاطر تقنية

يوجد عدم اتساق في تعريف الحالات: `types.ts` يتضمن `completed`، و`session-cleanup.ts` يحول `result_ready` إلى `completed`، لكن `validators.ts` لا يعتبر `completed` حالة جلسة صحيحة. هذا قد يؤدي إلى فشل تحقق استجابات الجلسة في العميل عند قراءة جلسة مكتملة.

حالة `created` موجودة في الأنواع وفي default داخل `createSession`، لكن إنشاء الجلسة عبر الخدمة يبدأ فعلياً من `waiting_for_mobile`. هذا ليس خطأ مباشراً، لكنه يجعل مصدر الحقيقة لحالة البداية غير موحد.

بعض مسارات التنظيف تحدث قاعدة البيانات مباشرة، خصوصاً تحويل `result_ready` إلى `completed`، ولا تنشر حدث SSE ولا تسجل دائماً transition event بنفس نمط `persistTransition`. أثر ذلك قد يظهر كتفاوت بين واقع قاعدة البيانات وما تراه الشاشة أو التشخيص لحظياً.

اعتماد SSE وrate limits وdiagnostics dedupe على in-memory fallback عند غياب Redis يعني أن السلوك يصبح محلياً للعملية الواحدة فقط. الكود يذكر هذا في التعليقات، لكنه يبقى مخاطرة حقيقية في بيئة متعددة النسخ أو serverless.

يوجد تضارب ظاهري في `Permissions-Policy`: `next.config.ts` يضع `camera=()` بينما `proxy.ts` يضع `camera=(self)`. حسب ترتيب التنفيذ قد يغلب proxy، لكن من الكود وحده توجد نية غير موحدة بخصوص السماح بالكاميرا.

نوع `CreateRoomPreviewSessionResponse` يصف استجابة فيها `sessionId` و`token`، بينما API الإنشاء يرجع كائن الجلسة كاملاً مع `token`، والعميل يعتمد فعلياً على تحقق `RoomPreviewSessionResponse`. هذا اختلاف عقد بين النوع والواقع.

قناة `GLOBAL_EVENTS_CHANNEL` في `session-events.ts` يتم النشر إليها لكن لا يظهر في الكود مشترك production يستخدمها حالياً، لذلك أثرها العملي غير واضح.

مسار `test-render` موجود ويستخدم `data/products.ts` بدلاً من `mock-products.ts` المستخدم في التدفق الأساسي، ويبدو مخصصاً للاختبار أو التطوير. استخدامه التشغيلي غير واضح من بقية الكود.

## 13. خلاصة تقنية

المشروع ناضج نسبياً في فصل المسؤوليات الأساسية: هناك state machine للجلسة، repository لقاعدة البيانات، خدمات للرفع والرندر، وقنوات تحديث وتشخيص. تدفق الشاشة والموبايل واضحان في الكود، وكذلك مسار الرندر من الطلب إلى التخزين.

الأجزاء التي تحتاج مراجعة أعمق هي اتساق حالات الجلسة بين الأنواع والتحقق والتنظيف، وسلوك النظام عند غياب Redis، وتوحيد عقود الاستجابة بين الأنواع والـ API. بشكل عام، النظام ليس مجرد prototype بسيط؛ هو تطبيق فعلي متعدد الطبقات، لكنه يحتوي على نقاط عدم اتساق قد تظهر في التشغيل طويل المدى أو في بيئة متعددة النسخ.
