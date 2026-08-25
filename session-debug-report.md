# Room Preview Session Debug Report

التاريخ: 2026-08-05  
المشروع الذي تم تحليله: `C:\Users\hisha\Downloads\main\3d`  
الفرع: `main`، مطابق لـ `origin/main` عند بدء العمل.

## الخلاصة

المشكلة ليست اختلافًا مباشرًا بين `id` و`sessionId`. قبل الإصلاح كان Route الإنشاء يعيد جلسة حقيقية بحقل `id`، وكان العميل يتحقق من الجلسة ثم يحول `session.id` إلى `sessionId`. لذلك لو كان `id` مفقودًا لما انتقلت الواجهة أصلًا إلى صفحة الجلسة، وكان الخطأ سيظهر كـ invalid create response، لا كـ `Failed to get session`.

السبب الجذري المؤكد من الكود هو أن مسار GET لم يكن يقرأ الجلسة فقط. منذ commit `1fe97d4` أصبح `getRoomPreviewSession()` ينفذ:

1. قراءة `RoomPreviewSession`.
2. ثم قراءة إلزامية ثانية من جدول التدقيق `session_events` عبر `hasCustomerRoleSelection()`.

بهذا صار جدول أحداث تشخيصي جزءًا إلزاميًا من قراءة الجلسة. إنشاء الجلسة يستطيع النجاح من `RoomPreviewSession`، بينما GET يفشل بالكامل إذا كان جدول `session_events` غير متوافق مع Production أو إذا فشل الاستعلام الإضافي/الاتصال الثاني. هذا يطابق السلوك المرصود: إنشاء ثم انتقال، وبعده استجابة 500 بالنص الموجود حصريًا في GET.

تاريخ Git يبين أيضًا أن migration المستقلة `20260423160000_add_session_diagnostics`، التي كانت تنشئ `session_events`، حُذفت لاحقًا عند ضغط migrations إلى baseline. هذا يجعل schema drift في قاعدة Production قديمة سببًا مرجحًا جدًا للمحفز الفعلي. لم تكن Logs القديمة تسجل مرحلة الفشل أو request correlation، لذلك لا يمكن الجزم هل خطأ Production كان `table missing` أو خطأ اتصال دون Stack القديم. الإصلاح لا يعتمد على هذا التخمين: أزال اعتماد القراءة الأساسية على جدول التدقيق نهائيًا.

أظهر سجل التشغيل المحلي بعد إضافة الـLogs عائقًا مستقلاً يسبق GET: `POST /api/room-preview/sessions` يفشل داخل `createSession` لأن Supabase pooler يرفض المستخدم/tenant الموجود في `DATABASE_URL` برسالة `ENOTFOUND tenant or user`. لذلك لم تُنشأ جلسة أصلًا ولم يوجد `sessionId` يمكن الانتقال به. يجب استبدال `DATABASE_URL` و`DIRECT_URL` بروابط الاتصال الحالية للمشروع المقصود؛ لا يستطيع كود التطبيق إصلاح اعتماد قاعدة بيانات محذوفًا أو رابطًا خاطئًا.

كشفت محاولة الفشل أيضًا مشكلة واجهة خاصة بوضع التطوير: إعادة تشغيل effects في React Strict Mode كانت تجعل `catch` يتجاهل خطأ POST، بينما يمنع قفل الـref المحاولة الثانية، فتظل الشاشة على `creating`. أصبحت الشاشة تعتمد على ref لحالة mount الفعلية، ولذلك تعرض رسالة الفشل وزر إعادة المحاولة بدل أن تبدو معلقة.

## الإصلاح الجذري

أصبحت `customerRoleSelected` حالة دائمة داخل صف `RoomPreviewSession` نفسه:

- أضيف عمود boolean افتراضيه `false`.
- أضيفت migration آمنة تعمل بـ `ADD COLUMN IF NOT EXISTS`.
- تعمل migration على backfill من `session_events` عندما يكون الجدول موجودًا، ولا تفشل على قواعد Legacy التي لا تحتويه.
- اختيار دور العميل يحدث العمود في صف الجلسة.
- حدث `gate_customer_role_selected` بقي للتدقيق فقط وبشكل best-effort؛ تعطل سجل الأحداث لم يعد يعطل قراءة الجلسة.
- GET أصبح ينفذ قراءة الجلسة من مصدر الحالة الأساسي نفسه الذي يستخدمه POST.

Redis ليس Session Store للجلسة الأساسية. الجلسات محفوظة في PostgreSQL عبر Prisma و`DATABASE_URL`. Redis مستخدم للـrate limiting والـlocks وSSE فقط.

## عقد Session ID قبل وبعد

قبل الإصلاح كانت استجابة POST بالشكل التالي، بلا `sessionId` صريح:

```json
{
  "id": "<persisted-cuid>",
  "status": "waiting_for_mobile",
  "mobileConnected": false,
  "token": "<redacted>"
}
```

كان العميل يحول `id` داخليًا إلى `sessionId`.

بعد الإصلاح أصبحت الاستجابة backward-compatible وواضحة:

```json
{
  "id": "<persisted-cuid>",
  "sessionId": "<the-same-persisted-cuid>",
  "status": "waiting_for_mobile",
  "mobileConnected": false,
  "customerRoleSelected": false,
  "token": "<redacted>"
}
```

العميل الآن:

- يتحقق أن `sessionId` string حقيقي وغير فارغ وليس `null` أو `undefined` كنص.
- يتحقق أن `sessionId === id`.
- يعيد فقط `{ sessionId, token }` للمستدعي، كما كان السلوك السابق.
- لا يسمح لأي Route builder بإنشاء `/sessions/null` أو `/sessions/undefined`.
- يعمل URL encoding لمقطع الجلسة.

## مسار الطلب الكامل بعد الإصلاح

1. زر Hero يفتح `/room-preview/screen?source=hero_try_button` من `Carousel3D`.
2. `ScreenLauncherClient` يفحص جلسة محفوظة قابلة لإعادة الاستخدام؛ إن لم توجد، يحصل على create lock.
3. `createRoomPreviewSession()` يسجل `create_session_called` ويرسل POST إلى `/api/room-preview/sessions` مع `x-room-preview-source: hero_try_button`.
4. POST يطبق حدود المعدل، ثم يستدعي service/repository.
5. Prisma ينشئ صفًا فعليًا في `RoomPreviewSession` ويعيد `id` المولد من قاعدة البيانات.
6. السيرفر يتحقق من `id`، ينشئ token، يسجل نجاح الحفظ، ويرجع `id` و`sessionId` متطابقين.
7. العميل يسجل وصول الاستجابة قبل قراءة ID، يتحقق من العقد، ثم يسجل ID المستخرج.
8. `ScreenLauncherClient` يحفظ ID في localStorage، يسجل وجهة الانتقال، ثم ينفذ `router.replace('/room-preview/screen/<sessionId>')`.
9. صفحة `[sessionId]` تمرر param إلى `useScreenSession`.
10. العميل يبني GET فقط بعد validation للـID ويرسل `/api/room-preview/sessions/<sessionId>`.
11. GET يسجل الاستقبال مع `requestId` و`databaseTarget`، يتحقق من ID، ويقرأ صف `RoomPreviewSession` نفسه.
12. عند النجاح يرجع الجلسة مع `Cache-Control: no-store` و`X-Request-Id`. عند 404 يسجل not-found. عند exception يسجل الخطأ الحقيقي وStack والمرحلة، ويرجع للمستخدم رسالة عامة مع correlation ID.

`existingSessionId` ليس معرّف الجلسة الجديدة ولا يشارك في الحفظ. إعادة استخدام الجلسة تُحسم في العميل قبل POST. كان السيرفر سابقًا يسجل `existingSessionId: null` بصورة ثابتة؛ الآن يمرر العميل القيمة القديمة الصالحة، إن وجدت، في header تشخيصي ويسجلها السيرفر كما هي، من دون استخدامها كبديل عن ID المولد من قاعدة البيانات.

## Logs المضافة

- `Room Preview session created and persisted`: بعد نجاح إنشاء وحفظ الجلسة.
- `create_session_response_received`: في العميل قبل استخراج `sessionId`؛ يسجل نوع الاستجابة وأسماء الحقول فقط.
- `create_session_id_resolved`: بعد التحقق من تطابق `id/sessionId`.
- `screen_session_navigation_requested`: قبل كل انتقال إلى صفحة الجلسة.
- `fetch_session_requested`: قبل GET، مع الرابط النهائي والـID.
- `Room Preview session GET received`: عند استقبال GET.
- `Room Preview session not found`: عند عدم وجود الجلسة.
- `Room Preview session read succeeded`: عند نجاح القراءة.
- `Failed to get session`: داخل catch مع `err` المهيكل، Stack، `stage`, `requestId`, `sessionId` وبصمة قاعدة البيانات.

لا يتم تسجيل token أو `DATABASE_URL`. `databaseTarget` عبارة عن SHA-256 مختصر لهدف الاتصال بعد حذف بيانات الاعتماد، ويسمح بمقارنة POST وGET بأمان. يجب أن تكون البصمة متطابقة للطلبين في نفس البيئة.

## معالجة الأخطاء

- ID غير صالح: HTTP 400، code=`INVALID_SESSION_ID`، ولا يتم استدعاء Session Store.
- جلسة غير موجودة: HTTP 404، code=`SESSION_NOT_FOUND`، مع Log تحذيري.
- جلسة منتهية: HTTP 410، code=`SESSION_EXPIRED`.
- فشل داخلي: HTTP 500، code=`SESSION_READ_FAILED`، و`requestId` للمطابقة مع السجل. تفاصيل قاعدة البيانات والـStack لا تظهر للمستخدم.
- فشل تسجيل الجلسة في active-session rate-limit tracker لم يعد يحول جلسة محفوظة بنجاح إلى استجابة create فاشلة؛ يسجل Warning وتبقى الجلسة صالحة.

## الملفات المعدلة

- `app/api/room-preview/sessions/route.ts`: عقد إنشاء صريح، تحقق ID، Logs نجاح/فشل وبصمة DB، وعزل فشل active-session tracker.
- `app/api/room-preview/sessions/[sessionId]/route.ts`: validation، request correlation، Logs GET/not-found/success/catch، واستجابة خطأ آمنة.
- `components/room-preview/ScreenLauncherClient.tsx`: Log منظم قبل الانتقال في مسارات create/reuse، وإظهار فشل الإنشاء بصورة صحيحة أثناء Strict Mode بدل البقاء في شاشة التحميل.
- `lib/room-preview/session-client.ts`: تحقق استجابة الإنشاء وتطابق IDs، Logs، وGET route النهائي.
- `lib/room-preview/constants.ts`: منع وبناء آمن لجميع روابط Session ID.
- `lib/room-preview/validators.ts`: validator موحد للـID وعقد create response.
- `lib/room-preview/session-repository.ts`: حفظ `customerRoleSelected` في الجلسة وإزالة اعتماد القراءة على event table.
- `lib/room-preview/session-service.ts`: GET بقراءة أساسية واحدة، مع بقاء audit event best-effort.
- `lib/server/database-target.ts`: بصمة هدف قاعدة بيانات آمنة.
- `prisma/schema.prisma`: العمود الدائم الجديد.
- `prisma/migrations/20260805090000_persist_customer_role_on_session/migration.sql`: إضافة العمود وbackfill متوافق مع Legacy.
- `tests/integration/sessions-api.test.ts`: عقد POST، فشل GET، وIDs غير الصالحة.
- `tests/unit/validators.test.ts`: حالات `null/undefined/empty` وtoken غير صالح.
- `tests/unit/room-preview-routes.test.ts`: منع روابط null/undefined وURL encoding.
- `tests/unit/session-client-create.test.ts`: استخراج ID الصريح ورفض اختلاف `id/sessionId`.
- `tests/unit/screen-launcher-client.test.tsx`: يثبت أن فشل POST أثناء Strict Mode يظهر حالة الخطأ ولا يطلق انتقالًا أو إنشاءً مكررًا.

## متغيرات البيئة وحالة التخزين

### التطوير المحلي الحالي

- `DATABASE_URL` و`DIRECT_URL` موجودان في `.env`، لكن الاتصال الفعلي يفشل بـ PostgreSQL/Supabase code `XX000` ورسالة tenant/user not found. يجب استبدالهما بروابط صالحة لنفس مشروع قاعدة البيانات قبل اختبار تكامل حقيقي.
- `DATABASE_POOL_SIZE` غير مضبوط؛ الكود يستخدم default=3. في Production serverless مع transaction pooler يوصى بـ1 أو 2 حسب المزود.
- `REDIS_URL` غير مضبوط محليًا. ليس سبب فقدان الجلسة، لكنه مطلوب في Production لاتساق SSE والـlocks والـrate limits بين instances.
- `NEXT_PUBLIC_BASE_URL` لم يظهر مضبوطًا في ملفات env المحلية التي تم فحصها. هو مطلوب في Production حسب `lib/env.ts`، مع أن صفحة الشاشة تفضل origin الحالي.

### Production

تعذر قراءة Vercel logs/env من CLI المحلي لأن الطلب انتهى timeout، لذلك لم يتم تغيير أو افتراض قيمة أي secret في Production. المطلوب التأكد من:

- POST وGET يعملان داخل deployment واحد ويحملان `databaseTarget` نفسه.
- `DATABASE_URL` هو runtime pooled URL لنفس PostgreSQL في كل Functions.
- `DIRECT_URL` يشير إلى نفس قاعدة البيانات ويستخدم لتطبيق migrations.
- migration الجديدة مطبقة قبل تشغيل الكود الذي يتوقع العمود.
- لا تستخدم Preview deployments قاعدة Production بالخطأ عند تجربة migrations.

## الاختبار محليًا

1. ضع `DATABASE_URL` و`DIRECT_URL` صالحين لقاعدة تطوير، وليس Production.
2. طبق migrations:

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

3. شغل `npm run dev`.
4. امسح المفتاحين `room-preview:screen-session-id` و`room-preview:screen-session-create-lock` من localStorage.
5. اضغط زر Hero.
6. تحقق من Network:
   - POST status=201.
   - `id` و`sessionId` موجودان ومتطابقان.
   - لا يوجد token في Logs.
   - الانتقال يحتوي ID حقيقيًا.
   - GET لنفس ID يرجع 200.
7. راقب Logs وتأكد أن `databaseTarget` متطابق بين create وGET.
8. اختبر `/api/room-preview/sessions/undefined` وتأكد من 400 وعدم تنفيذ DB read.

## الاختبار والنشر على Production

1. خذ backup أو snapshot لقاعدة Production.
2. شغل `npx prisma migrate status` باستخدام `DIRECT_URL` الصحيح.
3. بسبب وجود تاريخ سابق لضغط migrations إلى baseline، لا تستخدم `migrate resolve` بصورة عمياء. راجع جدول `_prisma_migrations` أولًا ثم طبق `npx prisma migrate deploy` ضمن release job معتمد.
4. انشر الكود بعد نجاح migration.
5. نفذ تجربة Hero واحدة وسجل `requestId` و`sessionId`.
6. تحقق من تسلسل Logs المذكور ومن تطابق `databaseTarget`.
7. تحقق مباشرة من وجود صف الجلسة والعمود `customerRoleSelected` في PostgreSQL دون طباعة بيانات مستخدم حساسة.
8. راقب 500/404 وconnection pool لمدة دورة نشر كاملة.

المهاجرة additive. الرجوع إلى نسخة كود أقدم يبقى ممكنًا مع ترك العمود؛ لا يلزم حذف العمود في rollback طارئ.

## نتائج الفحوص

- `npx prisma validate`: ناجح.
- الاختبارات الموجهة: 5 ملفات، 103 اختبارات، كلها ناجحة.
- `npx tsc --noEmit`: ناجح.
- ESLint للملفات المعدلة: ناجح بلا أخطاء.
- المجموعة الكاملة `npm test`: 65 ملفًا، 840 اختبارًا، كلها ناجحة.
- `npm run lint`: ناجح، 0 أخطاء و38 تحذيرًا قديمًا على مستوى المشروع، لا تحذيرات جديدة مرتبطة بالإصلاح.
- `npm run build`: ناجح وNext.js Production build اكتمل.

أثناء build ظهرت محاولات قراءة DB فاشلة بسبب `DATABASE_URL` المحلي غير الصالح، إضافة إلى تحذير غياب Redis وتحذيرات Sentry قديمة. الـbuild عاد exit code 0، لكن لا يمكن اعتبار ذلك اختبار تكامل DB؛ اختبار create→persist→GET الحقيقي يتطلب إصلاح متغيرات قاعدة التطوير وتطبيق migration.
